const fs = require('fs-extra');
const path = require('path');
const { spawn } = require('child_process');
const OpenAI = require('openai');
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
const extractResponseText = (response) => {
  if (!response || !Array.isArray(response.output)) return '';
  for (const item of response.output) {
    if (Array.isArray(item.content)) {
      for (const content of item.content) {
        if (typeof content.text === 'string') return content.text;
        if (typeof content.output_text === 'string') return content.output_text;
      }
    }
    if (typeof item.text === 'string') return item.text;
  }
  return '';
};

/**
 * OpenAIAgentAdapter implements the AgentAdapter contract using the OpenAI JS SDK Responses API.
 */
class OpenAIAgentAdapter {
  constructor(options = {}) {
    this.model = options.model || 'gpt-5.1-codex-mini';
    this.maxTokens = parseMaxTokens(options.maxTokens, null);
    this.defaultLogDir = options.logDir || null;
    this.defaultCwd = options.cwd;
    const apiKey = process.env.OPENAI_API_KEY;
    this.client = apiKey ? new OpenAI({ apiKey }) : null;
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
        throw new Error('OPENAI_API_KEY is required for OpenAIAgentAdapter');
      }
      writeLog('=== AGENT INPUT ===\n');
      writeLog(payload);
      writeLog('\n\n=== AGENT OUTPUT ===\n');
      const response = await this.client.responses.create({
        model: this.model,
        input: payload,
        max_output_tokens: this.maxTokens
      });
      const stdout = extractResponseText(response) || '';
      writeLog(stdout);
      writeOutput(stdout);
      if (logStream?.stream) logStream.stream.end();
      if (outputStream) outputStream.end();
      return { code: 0, stdout, stderr: '', logFile: logStream?.file || null };
    } catch (err) {
      const message = err?.message || 'Unknown OpenAI error';
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
      throw new Error('OPENAI_API_KEY is required for OpenAIAgentAdapter');
    }

    // Convert to OpenAI chat format
    const chatMessages = messages.map((m) => ({
      role: m.role === 'system' ? 'developer' : m.role,
      content: m.content
    }));

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: chatMessages,
      max_tokens: this.maxTokens
    });

    return response.choices?.[0]?.message?.content || '';
  }

  /**
   * Stateless single-turn call for direct codegen with prompt caching.
   * @param {object} params
   * @param {string} params.system - System message (guidance + API docs)
   * @param {string} params.user - User message (component payload)
   * @param {number} params.maxTokens - Max tokens for this call (overrides default)
   * @param {string} params.logLabel - Label for logging
   * @returns {Promise<{text: string, usage: object}>} - Response text and usage info
   */
  async chatStateless({ system, user, maxTokens, logLabel = 'stateless' } = {}) {
    if (!this.client) {
      throw new Error('OPENAI_API_KEY is required for OpenAIAgentAdapter');
    }

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'developer', content: system },
        { role: 'user', content: user }
      ],
      max_tokens: maxTokens || this.maxTokens
    });

    // Capture token usage
    const usage = response.usage ? {
      inputTokens: response.usage.prompt_tokens,
      outputTokens: response.usage.completion_tokens,
      cacheWriteTokens: 0,
      cacheReadTokens: 0
    } : null;

    // Log token usage
    if (response.usage) {
      const { prompt_tokens, completion_tokens } = response.usage;
      console.log(`  ${logLabel} tokens: in=${prompt_tokens} out=${completion_tokens}`);
    }

    return { text: response.choices?.[0]?.message?.content || '', usage };
  }
}

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
    this.client = apiKey ? new Anthropic({ apiKey }) : null;
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
        messages: [{ role: 'user', content: payload }]
      });
      
      // Log token usage if available
      if (response.usage) {
        const { input_tokens, output_tokens } = response.usage;
        const usageMsg = `\n[Usage: in=${input_tokens} out=${output_tokens} max=${this.maxTokens}]\n`;
        writeLog(usageMsg);
        // Also log to console for visibility
        console.log(`  ${logLabel} tokens: in=${input_tokens} out=${output_tokens}${response.stop_reason === 'max_tokens' ? ' (TRUNCATED)' : ''}`);
      }
      
      const stdout = extractClaudeText(response) || '';
      writeLog(stdout);
      writeOutput(stdout);
      if (logStream?.stream) logStream.stream.end();
      if (outputStream) outputStream.end();
      return { code: 0, stdout, stderr: '', logFile: logStream?.file || null };
    } catch (err) {
      const message = err?.message || 'Unknown Claude error';
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

    // Log token usage for analysis
    if (response.usage) {
      const { input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens } = response.usage;
      const cacheInfo = [];
      if (cache_creation_input_tokens) cacheInfo.push(`cache_write=${cache_creation_input_tokens}`);
      if (cache_read_input_tokens) cacheInfo.push(`cache_read=${cache_read_input_tokens}`);
      const cacheStr = cacheInfo.length > 0 ? ` ${cacheInfo.join(' ')}` : ' (cache not active - prompt may be <4096 tokens)';
      console.log(`  ${logLabel} tokens: in=${input_tokens} out=${output_tokens}${cacheStr}`);
    }

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
   * @returns {Promise<{text: string, usage: object}>} - Response text and usage info
   */
  async chatStateless({ system, user, maxTokens, logLabel = 'stateless' } = {}) {
    if (!this.client) {
      throw new Error('ANTHROPIC_API_KEY is required for ClaudeAgentAdapter');
    }

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
      messages: [{ role: 'user', content: user }]
    });

    // Capture token usage
    const usage = response.usage ? {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheWriteTokens: response.usage.cache_creation_input_tokens || 0,
      cacheReadTokens: response.usage.cache_read_input_tokens || 0
    } : null;

    // Log token usage for analysis
    if (response.usage) {
      const { input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens } = response.usage;
      const cacheInfo = [];
      if (cache_creation_input_tokens) cacheInfo.push(`cache_write=${cache_creation_input_tokens}`);
      if (cache_read_input_tokens) cacheInfo.push(`cache_read=${cache_read_input_tokens}`);
      const cacheStr = cacheInfo.length > 0 ? ` ${cacheInfo.join(' ')}` : ' (cache not active - prompt may be <4096 tokens)';
      console.log(`  ${logLabel} tokens: in=${input_tokens} out=${output_tokens}${cacheStr}`);
    }

    return { text: extractClaudeText(response) || '', usage };
  }
}

module.exports = {
  OpenAIAgentAdapter,
  ClaudeAgentAdapter,
  sanitizeSlug,
  parseMaxTokens
};
