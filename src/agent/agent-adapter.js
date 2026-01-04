const fs = require('fs-extra');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');

const sanitizeSlug = (value, fallback = 'component') =>
  (value || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || fallback;

const openLogStream = (dir, name) => {
  if (!dir) return null;
  const isFile = path.extname(dir) !== '';
  const file = isFile ? dir : path.join(dir, `${sanitizeSlug(name)}.log`);
  const parent = isFile ? path.dirname(file) : dir;
  fs.ensureDirSync(parent);
  const stream = fs.createWriteStream(file, { flags: 'w' });
  stream.write('=== AGENT OUTPUT ===\n');
  return { stream, file };
};

const parseMaxTokens = (value, fallback) => {
  const parsed = value ? parseInt(value, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

/**
 * AgentAdapter interface (contract):
 *  - orient({ payload, logLabel?, outputStream?, logDir? }) -> Promise<{ code, stdout, stderr, logFile }>
 *  - codegen({ payload, logLabel?, cwd?, logDir? }) -> Promise<{ code, stdout, stderr, logFile }>
 *
 * Implementations abstract how we talk to an agent (CLI, SDK, etc.).
 */
const extractClaudeText = (message) => {
  if (!message || !Array.isArray(message.content)) return '';
  for (const block of message.content) {
    if (block.type === 'text' && typeof block.text === 'string') return block.text;
  }
  return '';
};

/**
 * ClaudeAgentAdapter implements the AgentAdapter contract using the Claude (Anthropic) JS SDK.
 */
class ClaudeAgentAdapter {
  constructor(options = {}) {
    this.model = options.model || 'claude-haiku-4-5';
    this.maxTokens = parseMaxTokens(options.maxTokens, null);
    this.defaultLogDir = options.logDir || null;
    this.defaultCwd = options.cwd;
    const apiKey = process.env.ANTHROPIC_API_KEY;

    if (!apiKey) {
      throw new Error(
        'ANTHROPIC_API_KEY environment variable is required\n\n' +
        '💡 How to fix:\n' +
        '  1. Get an API key from https://console.anthropic.com/settings/keys\n' +
        '  2. Add to your .env file: ANTHROPIC_API_KEY=sk-ant-...\n' +
        '  3. Or export in your shell: export ANTHROPIC_API_KEY=sk-ant-...\n' +
        '  4. Ensure .env file is in your project root directory'
      );
    }

    // Set a longer timeout (20 minutes) for large orientation tasks
    this.client = new Anthropic({
      apiKey,
      timeout: 20 * 60 * 1000 // 20 minutes in milliseconds
    });
  }

  orient({ payload, logLabel = 'orienter', outputStream = null, logDir } = {}) {
    return this.run({
      payload,
      logLabel,
      logDir,
      outputStream
    });
  }

  codegen({ payload, logLabel = 'component', cwd, logDir } = {}) {
    return this.run({
      payload,
      logLabel,
      logDir,
      cwd
    });
  }

  async run({ payload, logLabel, logDir, outputStream } = {}) {
    const logStream = openLogStream(logDir || this.defaultLogDir, logLabel);
    const writeLog = (text) => {
      if (logStream?.stream) logStream.stream.write(text);
    };
    const writeOutput = (text) => {
      if (outputStream) outputStream.write(text);
    };
    try {
      if (!this.client) {
        throw new Error('ANTHROPIC_API_KEY is required for ClaudeAgentAdapter');
      }
      writeLog('=== AGENT INPUT ===\n');
      writeLog(payload);
      writeLog('\n\n=== AGENT OUTPUT ===\n');
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: this.maxTokens,
        messages: [{ role: 'user', content: payload }],
        stream: false
      });

      // Log token usage if available
      if (response.usage) {
        const { input_tokens, output_tokens } = response.usage;
        const usageMsg = `\n[Usage: in=${input_tokens} out=${output_tokens} max=${this.maxTokens}]\n`;
        writeLog(usageMsg);
      }

      const stdout = extractClaudeText(response) || '';
      writeLog(stdout);
      writeOutput(stdout);
      if (logStream?.stream) logStream.stream.end();
      if (outputStream) outputStream.end();
      return { code: 0, stdout, stderr: '', logFile: logStream?.file || null };
    } catch (err) {
      // Extract detailed error message from Anthropic API errors
      let message = err?.message || 'Unknown Claude error';

      // Check for rate limit errors in the error response
      if (err?.status === 400 || err?.status === 429) {
        const errorBody = err?.error || {};
        if (errorBody.type === 'invalid_request_error' && errorBody.message) {
          message = errorBody.message;
        }
      }

      // Log detailed error info for debugging
      const errorDetails = [
        `Error type: ${err?.constructor?.name || 'Unknown'}`,
        `Error code: ${err?.code || 'none'}`,
        `Status: ${err?.status || 'none'}`,
        `Message: ${message}`
      ];
      if (err?.cause) {
        errorDetails.push(`Cause: ${err.cause}`);
      }
      writeLog(`\n=== ERROR DETAILS ===\n${errorDetails.join('\n')}\n`);

      // Provide helpful context for common errors
      if (err?.status === 400 && (message.includes('Invalid model') || message.includes('model') || message.includes('invalid_model_requested'))) {
        const modelSuggestions = [
          '💡 Invalid Model Name:',
          '',
          `  Current model: ${this.model}`,
          `  ${message}`,
          '',
          'How to fix:',
          '  1. Set a different model in superconnect.toml:',
          '     [agent]',
          '     model = "claude-opus-4-5"  # or claude-sonnet-4-5, claude-haiku-4-5',
          '',
          '  2. Or use CLI flag: --agent-model claude-sonnet-4-5',
          '',
          '  3. Check available models at: https://docs.anthropic.com/en/docs/about-claude/models',
          '',
          'Note: Model availability depends on your API key tier and account.'
        ];
        message = modelSuggestions.join('\n');
      } else if (err?.status === 401 || message.includes('authentication') || message.includes('API key')) {
        message = `Claude API authentication failed: ${message}\n\n💡 Troubleshooting:\n  - Verify ANTHROPIC_API_KEY is set correctly in your environment or .env file\n  - Get your API key from https://console.anthropic.com/settings/keys\n  - Ensure your .env file is in the project root directory`;
      } else if (err?.status === 429 || message.includes('rate limit')) {
        message = `Claude API rate limit exceeded: ${message}\n\n💡 Troubleshooting:\n  - Check your usage at https://console.anthropic.com/settings/usage\n  - Consider upgrading your API plan\n  - Try again in a few minutes or reduce concurrency`;
      } else if (err?.status === 403) {
        message = `Claude API access denied: ${message}\n\n💡 Troubleshooting:\n  - Your API key may not have access to the requested model\n  - Verify your account status at https://console.anthropic.com`;
      } else if (err?.code === 'ENOTFOUND' || err?.code === 'ECONNREFUSED' || err?.code === 'ETIMEDOUT' ||
                 err?.code === 'ECONNRESET' || message.includes('fetch failed') ||
                 message.includes('certificate') || message.includes('self-signed') ||
                 message.includes('SSL') || message.includes('TLS')) {
        // Enhanced network error handling for corporate environments
        const networkTips = [
          '💡 Network/Certificate Error - Common in corporate environments:',
          '',
          'Quick diagnostics:',
          '  1. Test API connectivity: curl -v https://api.anthropic.com/v1/messages',
          '  2. Check if you can reach the API from your network',
          '',
          'Possible solutions:',
          '  • Corporate proxy: Set HTTP_PROXY and HTTPS_PROXY environment variables',
          '  • Certificate issues: Your IT may need to add Anthropic\'s certs to the trust store',
          '  • Firewall: Ensure api.anthropic.com (port 443) is allowed',
          '  • VPN: Try connecting/disconnecting from corporate VPN',
          '',
          'As a last resort (INSECURE - only for testing):',
          '  export NODE_TLS_REJECT_UNAUTHORIZED=0',
          '',
          `Raw error: ${message}`
        ];
        message = networkTips.join('\n');
      }

      writeLog(`${message}\n`);
      if (logStream?.stream) logStream.stream.end();
      if (outputStream) outputStream.end();
      return { code: 1, stdout: '', stderr: message, logFile: logStream?.file || null };
    }
  }

  /**
   * Multi-turn chat for direct codegen.
   * @param {object} params
   * @param {Array<{role: string, content: string}>} params.messages - Chat messages
   * @param {string} params.logLabel - Label for logging
   * @returns {Promise<string>} - Assistant response text
   */
  async chat({ messages, logLabel = 'chat' } = {}) {
    if (!this.client) {
      throw new Error('ANTHROPIC_API_KEY is required for ClaudeAgentAdapter');
    }

    // Separate system message from user/assistant messages
    const systemMessage = messages.find((m) => m.role === 'system');
    const chatMessages = messages.filter((m) => m.role !== 'system');

    // Use prompt caching for the system message (guidance + Figma docs)
    // Haiku 4.5 requires 4096 tokens minimum for caching to activate
    // Combined prompts should be ~5600 tokens (22k chars / 4)
    const systemContent = systemMessage ? [
      {
        type: 'text',
        text: systemMessage.content,
        cache_control: { type: 'ephemeral' }
      }
    ] : undefined;

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      system: systemContent,
      messages: chatMessages.map((m) => ({ role: m.role, content: m.content }))
    });

    return extractClaudeText(response) || '';
  }

  /**
   * Stateless single-turn call for direct codegen with prompt caching.
   * Each call is independent with cached system prefix.
   * @param {object} params
   * @param {string} params.system - System message (guidance + API docs)
   * @param {string} params.user - User message (component payload)
   * @param {number} params.maxTokens - Max tokens for this call (overrides default)
   * @param {string} params.logLabel - Label for logging
   * @param {string} params.logDir - Directory for I/O logs
   * @returns {Promise<{text: string, usage: object}>} - Response text and usage info
   */
  async chatStateless({ system, user, maxTokens, logLabel = 'stateless', logDir } = {}) {
    if (!this.client) {
      throw new Error('ANTHROPIC_API_KEY is required for ClaudeAgentAdapter');
    }

    const logStream = openLogStream(logDir || this.defaultLogDir, logLabel);
    const writeLog = (text) => {
      if (logStream?.stream) logStream.stream.write(text);
    };

    try {
      writeLog('=== AGENT INPUT ===\n');
      writeLog('## System\n');
      writeLog(system);
      writeLog('\n\n## User\n');
      writeLog(user);
      writeLog('\n\n=== AGENT OUTPUT ===\n');

      // System message with cache control
      // Haiku 4.5 requires 4096 tokens minimum for caching to activate
      const systemContent = [
        {
          type: 'text',
          text: system,
          cache_control: { type: 'ephemeral' }
        }
      ];

      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: maxTokens || this.maxTokens,
        system: systemContent,
        messages: [{ role: 'user', content: user }],
        stream: false
      });

      // Capture token usage
      const usage = response.usage ? {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cacheWriteTokens: response.usage.cache_creation_input_tokens || 0,
        cacheReadTokens: response.usage.cache_read_input_tokens || 0
      } : null;

      const text = extractClaudeText(response) || '';
      writeLog(text);

      if (usage) {
        const usageMsg = `\n\n[Usage: in=${usage.inputTokens} out=${usage.outputTokens} cacheWrite=${usage.cacheWriteTokens} cacheRead=${usage.cacheReadTokens}]\n`;
        writeLog(usageMsg);
      }

      if (logStream?.stream) logStream.stream.end();
      return { text, usage };
    } catch (err) {
      writeLog(`\nError: ${err.message}\n`);
      if (logStream?.stream) logStream.stream.end();
      throw err;
    }
  }
}

module.exports = {
  ClaudeAgentAdapter,
  sanitizeSlug,
  parseMaxTokens
};
