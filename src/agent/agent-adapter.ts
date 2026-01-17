// @ts-nocheck - Mechanically converted from JS, needs type refinement

/**
 * Agent Adapters for LLM backends (OpenAI, Anthropic)
 * 
 * Provides unified interface for:
 * - OpenAI Responses API
 * - Anthropic Messages API (Claude)
 * - Anthropic Agent SDK (with built-in tools)
 */

import fs from 'fs-extra';
import path from 'path';
import { spawn } from 'child_process';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';

export const sanitizeSlug = (value: string, fallback: string = 'component'): string =>
  (value || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || fallback;

const openLogStream = (dir: string | null, name: string): { stream: any, file: string } | null => {
  if (!dir) return null;
  const isFile = path.extname(dir) !== '';
  const file = isFile ? dir : path.join(dir, `${sanitizeSlug(name)}.log`);
  const parent = isFile ? path.dirname(file) : dir;
  fs.ensureDirSync(parent);
  const stream = fs.createWriteStream(file, { flags: 'w' });
  stream.write('=== AGENT OUTPUT ===\n');
  return { stream, file };
};

export const parseMaxTokens = (value: any, fallback: any): any => {
  const parsed = value ? parseInt(value, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

/**
 * Extract clean code from LLM responses, handling markdown fences and thinking text.
 * Used by agent-SDK to strip explanatory text that sometimes leaks through.
 */
const extractCleanCode = (text: string): string => {
  if (!text) return '';
  text = text.trim();
  
  // Extract code from markdown fence
  const fenceMatch = text.match(/```(?:tsx?|typescript|javascript|js)?[^\n]*\n([\s\S]*?)```/);
  if (fenceMatch) return fenceMatch[1].trim();
  
  // If starts with import/const/figma, assume it's pure code
  if (/^(import\s|const\s|export\s|figma\.)/.test(text)) return text;
  
  // Otherwise return as-is (validation will catch issues)
  return text;
};

/**
 * AgentAdapter interface (contract):
 *  - orient({ payload, logLabel?, outputStream?, logDir? }) -> Promise<{ code, stdout, stderr, logFile }>
 *  - codegen({ payload, logLabel?, cwd?, logDir? }) -> Promise<{ code, stdout, stderr, logFile }>
 *
 * Implementations abstract how we talk to an agent (CLI, SDK, etc.).
 */
const extractResponseText = (response: any): string => {
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
export class OpenAIAgentAdapter {
  model: string;
  maxTokens: any;
  defaultLogDir: string | null;
  defaultCwd: string | undefined;
  client: OpenAI;
  baseURL: string | undefined;

  constructor(options: any = {}) {
    this.model = options.model || 'gpt-5.2-codex';
    this.maxTokens = parseMaxTokens(options.maxTokens, null);
    this.defaultLogDir = options.logDir || null;
    this.defaultCwd = options.cwd;
    
    // Allow base URL override for LiteLLM, Azure OpenAI, vLLM, or other OpenAI-compatible endpoints
    const baseURL = options.baseUrl || process.env.OPENAI_BASE_URL || undefined;
    const apiKey = options.apiKey || process.env.OPENAI_API_KEY;
    
    // When using custom base URL, allow placeholder API key (some proxies don't require it)
    if (!apiKey && !baseURL) {
      throw new Error(
        'OPENAI_API_KEY environment variable is required\n\n' +
        '💡 How to fix:\n' +
        '  1. Get an API key from https://platform.openai.com/api-keys\n' +
        '  2. Add to your .env file: OPENAI_API_KEY=sk-...\n' +
        '  3. Or export in your shell: export OPENAI_API_KEY=sk-...\n' +
        '  4. Ensure .env file is in your project root directory\n' +
        '  5. Or set llm_proxy_url in superconnect.toml for custom endpoints (LiteLLM, etc.)'
      );
    }
    
    this.client = new OpenAI({ 
      apiKey: apiKey || 'unused',  // Some proxies accept any value
      baseURL 
    });
    this.baseURL = baseURL;  // Store for error messages
  }

  orient({ payload, logLabel = 'orienter', outputStream = null, logDir }: any = {}): Promise<any> {
    return this.run({
      payload,
      logLabel,
      logDir,
      outputStream
    });
  }

  codegen({ payload, logLabel = 'component', cwd, logDir }: any = {}): Promise<any> {
    return this.run({
      payload,
      logLabel,
      logDir,
      cwd
    });
  }

  async run({ payload, logLabel, logDir, outputStream }: any = {}): Promise<any> {
    const logStream = openLogStream(logDir || this.defaultLogDir, logLabel);
    const writeLog = (text: string) => {
      if (logStream?.stream) logStream.stream.write(text);
    };
    const writeOutput = (text: string) => {
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
    } catch (err: any) {
      let message = err?.message || 'Unknown OpenAI error';
      
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
      if (err?.status === 400 && (message.includes('Invalid model') || message.includes('model name'))) {
        const modelSuggestions = [
          '💡 Invalid Model Name:',
          '',
          `  Current model: ${this.model}`,
          `  ${message}`,
          '',
          'How to fix:',
          '  1. Set a different model in superconnect.toml:',
          '     [agent]',
          '     model = "gpt-4o"  # or gpt-4-turbo, gpt-3.5-turbo',
          '',
          '  2. Or use CLI flag: --agent-model gpt-4o',
          '',
          '  3. Check available models: curl https://api.openai.com/v1/models \\',
          '       -H "Authorization: Bearer $OPENAI_API_KEY"',
          '',
          'Note: Model availability depends on your API key tier and account.'
        ];
        message = modelSuggestions.join('\n');
      } else if (err?.status === 401 || message.includes('authentication') || message.includes('API key')) {
        message = `OpenAI API authentication failed: ${message}\n\n💡 Troubleshooting:\n  - Verify OPENAI_API_KEY is set correctly in your environment or .env file\n  - Check that your API key is valid at https://platform.openai.com/api-keys\n  - Ensure your .env file is in the project root directory`;
      } else if (err?.status === 429 || message.includes('rate limit')) {
        message = `OpenAI API rate limit exceeded: ${message}\n\n💡 Troubleshooting:\n  - Lower concurrency in superconnect.toml: concurrency = 1\n  - Check your usage at https://platform.openai.com/usage\n  - Consider upgrading your API plan\n  - Try again in a few minutes`;
      } else if (err?.status === 402 || message.includes('insufficient_quota') || message.includes('billing') || message.includes('exceeded your current quota')) {
        message = `OpenAI API billing/quota error: ${message}\n\n💡 Troubleshooting:\n  - Check your billing status at https://platform.openai.com/account/billing\n  - Add payment method or increase spending limit\n  - Your free tier credits may have expired`;
      } else if (err?.status === 408 || message.includes('timeout') || message.includes('timed out')) {
        message = `OpenAI API request timed out: ${message}\n\n💡 Troubleshooting:\n  - The request took too long to complete\n  - Try again - this may be a temporary issue\n  - If persistent, check your network connection`;
      } else if (err?.status === 413 || message.includes('too large') || message.includes('maximum context length')) {
        message = `Request too large for model: ${message}\n\n💡 Troubleshooting:\n  - The component context exceeds the model's token limit\n  - Try a model with larger context (e.g., gpt-4-turbo with 128k tokens)\n  - Reduce component complexity or split into smaller components`;
      } else if (message.includes('content_policy') || message.includes('content policy') || message.includes('flagged')) {
        message = `Content policy violation: ${message}\n\n💡 This error usually means:\n  - The model detected potentially problematic content in the request\n  - Check component names and properties for unusual text\n  - This is sometimes a false positive - try again`;
      } else if (err?.status === 502 || err?.status === 503 || message.includes('Service Unavailable') || message.includes('Bad Gateway')) {
        message = `API service unavailable (${err?.status || 503}): ${message}\n\n💡 Troubleshooting:\n  - If using LiteLLM, Bedrock, or another proxy: lower concurrency in superconnect.toml:\n      [codegen]\n      concurrency = 1\n  - Check that your LLM proxy/server is running and healthy\n  - The upstream provider may be experiencing issues - try again shortly`;
      } else if (err?.status === 403) {
        message = `OpenAI API access denied: ${message}\n\n💡 Troubleshooting:\n  - Your API key may not have access to the requested model\n  - Check your organization settings at https://platform.openai.com/account/organization`;
      } else if (err?.code === 'ENOTFOUND' || err?.code === 'ECONNREFUSED' || err?.code === 'ETIMEDOUT' || 
                 err?.code === 'ECONNRESET' || message.includes('fetch failed') || 
                 message.includes('certificate') || message.includes('self-signed') || 
                 message.includes('SSL') || message.includes('TLS')) {
        // Enhanced network error handling for corporate environments
        const endpoint = this.baseURL || 'api.openai.com';
        const networkTips = [
          '💡 Network/Certificate Error - Common in corporate environments:',
          '',
          'Quick diagnostics:',
          `  1. Test API connectivity: curl -v ${this.baseURL ? this.baseURL + '/v1/models' : 'https://api.openai.com/v1/models'}`,
          '  2. Check if you can reach the API from your network',
          '',
          'Possible solutions:',
          '  • Corporate proxy: Set HTTP_PROXY and HTTPS_PROXY environment variables',
          this.baseURL 
            ? `  • Check LiteLLM/proxy status: Ensure ${this.baseURL} is running and accessible`
            : '  • Certificate issues: Your IT may need to add OpenAI\'s certs to the trust store',
          `  • Firewall: Ensure ${endpoint} (port 443) is allowed`,
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
   */
  async chat({ messages, logLabel = 'chat' }: any = {}): Promise<string> {
    if (!this.client) {
      throw new Error('OPENAI_API_KEY is required for OpenAIAgentAdapter');
    }

    // Convert to OpenAI chat format
    const chatMessages = messages.map((m: any) => ({
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
   */
  async chatStateless({ system, user, maxTokens, logLabel = 'stateless' }: any = {}): Promise<any> {
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

    return { text: response.choices?.[0]?.message?.content || '', usage };
  }
}

const extractClaudeText = (message: any): string => {
  if (!message || !Array.isArray(message.content)) return '';
  for (const block of message.content) {
    if (block.type === 'text' && typeof block.text === 'string') return block.text;
  }
  return '';
};

/**
 * ClaudeAgentAdapter implements the AgentAdapter contract using the Claude (Anthropic) JS SDK.
 */
export class ClaudeAgentAdapter {
  model: string;
  maxTokens: any;
  defaultLogDir: string | null;
  defaultCwd: string | undefined;
  client: Anthropic;

  constructor(options: any = {}) {
    this.model = options.model || 'claude-sonnet-4-5';
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

  orient({ payload, logLabel = 'orienter', outputStream = null, logDir }: any = {}): Promise<any> {
    return this.run({
      payload,
      logLabel,
      logDir,
      outputStream
    });
  }

  codegen({ payload, logLabel = 'component', cwd, logDir }: any = {}): Promise<any> {
    return this.run({
      payload,
      logLabel,
      logDir,
      cwd
    });
  }

  async run({ payload, logLabel, logDir, outputStream }: any = {}): Promise<any> {
    const logStream = openLogStream(logDir || this.defaultLogDir, logLabel);
    const writeLog = (text: string) => {
      if (logStream?.stream) logStream.stream.write(text);
    };
    const writeOutput = (text: string) => {
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
        // Console logging removed - details captured in attempts array
      }
      
      const stdout = extractClaudeText(response) || '';
      writeLog(stdout);
      writeOutput(stdout);
      if (logStream?.stream) logStream.stream.end();
      if (outputStream) outputStream.end();
      return { code: 0, stdout, stderr: '', logFile: logStream?.file || null };
    } catch (err: any) {
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
        message = `Claude API rate limit exceeded: ${message}\n\n💡 Troubleshooting:\n  - Lower concurrency in superconnect.toml: concurrency = 1\n  - Check your usage at https://console.anthropic.com/settings/usage\n  - Consider upgrading your API plan\n  - Try again in a few minutes`;
      } else if (err?.status === 529 || message.includes('overloaded')) {
        message = `Claude API is overloaded: ${message}\n\n💡 Troubleshooting:\n  - The API is experiencing high demand\n  - Lower concurrency in superconnect.toml: concurrency = 1\n  - Wait a few minutes and try again`;
      } else if (err?.status === 402 || message.includes('billing') || message.includes('credit')) {
        message = `Claude API billing error: ${message}\n\n💡 Troubleshooting:\n  - Check your billing status at https://console.anthropic.com/settings/billing\n  - Add credits or payment method\n  - Your account may need a spending limit increase`;
      } else if (err?.status === 408 || message.includes('timeout') || message.includes('timed out')) {
        message = `Claude API request timed out: ${message}\n\n💡 Troubleshooting:\n  - The request took too long to complete\n  - Try again - this may be a temporary issue\n  - If persistent, check your network connection`;
      } else if (message.includes('too large') || message.includes('maximum') || message.includes('context length') || message.includes('token limit')) {
        message = `Request too large for model: ${message}\n\n💡 Troubleshooting:\n  - The component context exceeds the model's token limit\n  - Try claude-sonnet (200k context) or reduce component complexity\n  - Split large components into smaller pieces`;
      } else if (message.includes('content_policy') || message.includes('content policy') || message.includes('flagged') || message.includes('safety')) {
        message = `Content policy violation: ${message}\n\n💡 This error usually means:\n  - The model detected potentially problematic content in the request\n  - Check component names and properties for unusual text\n  - This is sometimes a false positive - try again`;
      } else if (err?.status === 502 || err?.status === 503 || message.includes('Service Unavailable') || message.includes('Bad Gateway')) {
        message = `API service unavailable (${err?.status || 503}): ${message}\n\n💡 Troubleshooting:\n  - If using LiteLLM, Bedrock, or another proxy: lower concurrency in superconnect.toml:\n      [codegen]\n      concurrency = 1\n  - Check that your LLM proxy/server is running and healthy\n  - The upstream provider may be experiencing issues - try again shortly`;
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
          `  1. Test API connectivity: curl -v https://api.anthropic.com/v1/messages`,
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
   */
  async chat({ messages, logLabel = 'chat' }: any = {}): Promise<string> {
    if (!this.client) {
      throw new Error('ANTHROPIC_API_KEY is required for ClaudeAgentAdapter');
    }

    // Separate system message from user/assistant messages
    const systemMessage = messages.find((m: any) => m.role === 'system');
    const chatMessages = messages.filter((m: any) => m.role !== 'system');

    // Use prompt caching for the system message (guidance + Figma docs)
    // Haiku 4.5 requires 4096 tokens minimum for caching to activate
    // Combined prompts should be ~5600 tokens (22k chars / 4)
    const systemContent = systemMessage ? [
      {
        type: 'text' as const,
        text: systemMessage.content,
        cache_control: { type: 'ephemeral' as const }
      }
    ] : undefined;

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      system: systemContent,
      messages: chatMessages.map((m: any) => ({ role: m.role, content: m.content }))
    });

    return extractClaudeText(response) || '';
  }

  /**
   * Stateless single-turn call for direct codegen with prompt caching.
   * Each call is independent with cached system prefix.
   */
  async chatStateless({ system, user, maxTokens, logLabel = 'stateless', logDir }: any = {}): Promise<any> {
    if (!this.client) {
      throw new Error('ANTHROPIC_API_KEY is required for ClaudeAgentAdapter');
    }

    const logStream = openLogStream(logDir || this.defaultLogDir, logLabel);
    const writeLog = (text: string) => {
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
          type: 'text' as const,
          text: system,
          cache_control: { type: 'ephemeral' as const }
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
    } catch (err: any) {
      writeLog(`\nError: ${err.message}\n`);
      if (logStream?.stream) logStream.stream.end();
      throw err;
    }
  }
}

/**
 * AgentSDKAdapter uses Anthropic's Claude Agent SDK with built-in tools.
 * Allows agent to explore codebase with Read, Glob, Grep before generating.
 */
export class AgentSDKAdapter {
  model: string;
  maxTokens: any;
  cwd: string;
  defaultLogDir: string | null;

  constructor(options: any = {}) {
    this.model = options.model || 'claude-sonnet-4-5';
    this.maxTokens = parseMaxTokens(options.maxTokens, 4096);
    this.cwd = options.cwd || process.cwd();
    this.defaultLogDir = options.logDir || null;
    
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        'ANTHROPIC_API_KEY environment variable is required\n\n' +
        '💡 How to fix:\n' +
        '  1. Get an API key from https://console.anthropic.com/settings/keys\n' +
        '  2. Add to your .env file: ANTHROPIC_API_KEY=sk-ant-...\n' +
        '  3. Or export in your shell: export ANTHROPIC_API_KEY=sk-ant-...'
      );
    }
  }

  /**
   * Stateless single-turn call for direct codegen with Agent SDK.
   * Agent can explore codebase with built-in tools before generating.
   */
  async chatStateless({ system, user, maxTokens, logLabel = 'agent-sdk', logDir }: any = {}): Promise<any> {
    // Dynamic import for Agent SDK (CommonJS module)
    const { query } = await import('@anthropic-ai/claude-agent-sdk');
    
    const logStream = openLogStream(logDir || this.defaultLogDir, logLabel);
    const writeLog = (text: string) => {
      if (logStream?.stream) logStream.stream.write(text);
    };

    try {
      writeLog('=== AGENT INPUT ===\n');
      writeLog('## System\n');
      writeLog(system);
      writeLog('\n\n## User\n');
      writeLog(user);
      writeLog('\n\n=== AGENT OUTPUT ===\n');

      const prompt = `${system}\n\n${user}`;
      
      let resultText = '';
      let totalUsage = {
        inputTokens: 0,
        outputTokens: 0,
        cacheWriteTokens: 0,
        cacheReadTokens: 0
      };
      
      // Track tool usage for summary
      const toolCounts: any = { Read: 0, Glob: 0, Grep: 0 };

      // Stream messages from agent
      for await (const message of query({
        prompt,
        options: {
          cwd: this.cwd,
          model: this.model,
          allowedTools: ['Read', 'Glob', 'Grep'],
          permissionMode: 'bypassPermissions',
          maxTokens: maxTokens || this.maxTokens
        }
      })) {
        // Log assistant messages (tool calls and text responses)
        if (message.type === 'assistant' && message.message?.content) {
          for (const block of message.message.content) {
            if (block.type === 'tool_use') {
              writeLog(`\n--- TOOL CALL: ${block.name} ---\n`);
              writeLog(`Input: ${JSON.stringify(block.input, null, 2)}\n`);
              
              // Count tool usage
              if (toolCounts[block.name] !== undefined) {
                toolCounts[block.name]++;
              }
            } else if (block.type === 'text') {
              // Log assistant's thinking/reasoning text
              writeLog(`\n--- ASSISTANT ---\n`);
              writeLog(block.text);
              writeLog('\n');
            }
          }
        }

        // Log tool results (returned in synthetic user messages)
        if (message.type === 'user' && message.tool_use_result !== undefined) {
          writeLog(`\n--- TOOL RESULT ---\n`);
          const resultStr = typeof message.tool_use_result === 'string' 
            ? message.tool_use_result 
            : JSON.stringify(message.tool_use_result, null, 2);
          // Truncate very long results (e.g., large file reads)
          const maxResultLen = 2000;
          if (resultStr.length > maxResultLen) {
            writeLog(resultStr.slice(0, maxResultLen));
            writeLog(`\n... [truncated ${resultStr.length - maxResultLen} chars]\n`);
          } else {
            writeLog(resultStr);
          }
          writeLog('\n');
        }

        // Capture final result
        if (message.type === 'result') {
          const rawResult = message.result || '';
          resultText = extractCleanCode(rawResult);  // Strip thinking text and extract code
          
          if (message.usage) {
            totalUsage.inputTokens = message.usage.input_tokens || 0;
            totalUsage.outputTokens = message.usage.output_tokens || 0;
            totalUsage.cacheWriteTokens = message.usage.cache_creation_input_tokens || 0;
            totalUsage.cacheReadTokens = message.usage.cache_read_input_tokens || 0;
          }
        }
      }

      writeLog('\n--- FINAL OUTPUT ---\n');
      writeLog(resultText);
      
      // Log tool usage summary
      const totalTools = toolCounts.Read + toolCounts.Glob + toolCounts.Grep;
      if (totalTools > 0) {
        const toolSummary = `\n[Tool Usage: ${totalTools} total (Read=${toolCounts.Read}, Glob=${toolCounts.Glob}, Grep=${toolCounts.Grep})]`;
        writeLog(toolSummary);
      }
      
      const usageMsg = `\n[Token Usage: in=${totalUsage.inputTokens} out=${totalUsage.outputTokens} cacheWrite=${totalUsage.cacheWriteTokens} cacheRead=${totalUsage.cacheReadTokens}]\n`;
      writeLog(usageMsg);

      if (logStream?.stream) logStream.stream.end();
      
      return { text: resultText, usage: totalUsage };
    } catch (err: any) {
      const errorMsg = err.message || String(err);
      writeLog(`\nError: ${errorMsg}\n`);
      if (logStream?.stream) logStream.stream.end();
      
      // Enhanced error handling for common cases
      if (err?.status === 429 || errorMsg.includes('rate limit') || errorMsg.includes('429')) {
        throw new Error(
          `Anthropic API rate limit exceeded: ${errorMsg}\n\n` +
          '💡 Troubleshooting:\n' +
          '  - Lower concurrency in superconnect.toml: concurrency = 1\n' +
          '  - Wait a few minutes and try again\n' +
          '  - Check your usage at https://console.anthropic.com/settings/usage\n' +
          '  - Consider upgrading your API plan'
        );
      }
      
      if (err?.status === 502 || err?.status === 503 || errorMsg.includes('Service Unavailable') || errorMsg.includes('Bad Gateway')) {
        throw new Error(
          `API service unavailable (${err?.status || 503}): ${errorMsg}\n\n` +
          '💡 Troubleshooting:\n' +
          '  - If using LiteLLM, Bedrock, or another proxy: lower concurrency in superconnect.toml:\n' +
          '      [codegen]\n' +
          '      concurrency = 1\n' +
          '  - Check that your LLM proxy/server is running and healthy\n' +
          '  - The upstream provider may be experiencing issues - try again shortly'
        );
      }
      
      if (err?.status === 529 || errorMsg.includes('overloaded')) {
        throw new Error(
          `Claude API is overloaded: ${errorMsg}\n\n` +
          '💡 Troubleshooting:\n' +
          '  - The API is experiencing high demand\n' +
          '  - Lower concurrency in superconnect.toml: concurrency = 1\n' +
          '  - Wait a few minutes and try again'
        );
      }
      
      if (err?.status === 402 || errorMsg.includes('billing') || errorMsg.includes('credit')) {
        throw new Error(
          `Claude API billing error: ${errorMsg}\n\n` +
          '💡 Troubleshooting:\n' +
          '  - Check your billing at https://console.anthropic.com/settings/billing\n' +
          '  - Add credits or payment method\n' +
          '  - Your account may need a spending limit increase'
        );
      }
      
      if (errorMsg.includes('too large') || errorMsg.includes('maximum') || errorMsg.includes('context length') || errorMsg.includes('token limit')) {
        throw new Error(
          `Request too large for model: ${errorMsg}\n\n` +
          '💡 Troubleshooting:\n' +
          '  - The component context exceeds the model\'s token limit\n' +
          '  - Try claude-sonnet (200k context) or reduce component complexity\n' +
          '  - Split large components into smaller pieces'
        );
      }
      
      if (errorMsg.includes('content_policy') || errorMsg.includes('content policy') || errorMsg.includes('flagged') || errorMsg.includes('safety')) {
        throw new Error(
          `Content policy violation: ${errorMsg}\n\n` +
          '💡 This error usually means:\n' +
          '  - The model detected potentially problematic content\n' +
          '  - Check component names and properties for unusual text\n' +
          '  - This is sometimes a false positive - try again'
        );
      }
      
      if (err?.status === 401 || errorMsg.includes('authentication') || errorMsg.includes('API key')) {
        throw new Error(
          `Anthropic API authentication failed: ${errorMsg}\n\n` +
          '💡 How to fix:\n' +
          '  1. Check your ANTHROPIC_API_KEY environment variable\n' +
          '  2. Get a valid key from https://console.anthropic.com/settings/keys\n' +
          '  3. Verify the key starts with "sk-ant-"'
        );
      }
      
      if (err?.code === 'ETIMEDOUT' || err?.code === 'ECONNREFUSED' || errorMsg.includes('timeout')) {
        throw new Error(
          `Anthropic API timeout: ${errorMsg}\n\n` +
          '💡 Possible causes:\n' +
          '  - Network connectivity issues\n' +
          '  - Agent SDK taking too long to complete\n' +
          '  - Try reducing --concurrency or simplifying the task'
        );
      }
      
      throw err;
    }
  }
}
