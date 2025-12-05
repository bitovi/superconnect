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
/**
 * CodexCliAgentAdapter implements the AgentAdapter contract using the Codex CLI.
 */
class CodexCliAgentAdapter {
  constructor(options = {}) {
    this.runner = options.runner;
    this.defaultLogDir = options.logDir || null;
    this.defaultCwd = options.cwd;
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

  run({ payload, logLabel, logDir, cwd, outputStream } = {}) {
    const logStream = openLogStream(logDir || this.defaultLogDir, logLabel);
    return new Promise((resolve) => {
      const child = spawn(this.runner, { shell: true, cwd: cwd || this.defaultCwd });
      let stdout = '';
      let stderr = '';

      const writeLog = (text) => {
        if (logStream?.stream) logStream.stream.write(text);
      };
      const writeOutput = (text) => {
        if (outputStream) outputStream.write(text);
      };

      child.stdout.on('data', (chunk) => {
        const text = chunk.toString();
        stdout += text;
        writeLog(text);
        writeOutput(text);
      });
      child.stderr.on('data', (chunk) => {
        const text = chunk.toString();
        stderr += text;
        writeLog(text);
      });

      child.on('close', (code) => {
        if (logStream?.stream) logStream.stream.end();
        if (outputStream) outputStream.end();
        resolve({ code: code || 0, stdout, stderr, logFile: logStream?.file || null });
      });

      child.stdin.write(payload);
      child.stdin.end();
    });
  }
}

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
    this.model = options.model || 'claude-3-haiku-20240307';
    this.maxTokens = parseMaxTokens(options.maxTokens, 12000);
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
}

module.exports = {
  CodexCliAgentAdapter,
  OpenAIAgentAdapter,
  ClaudeAgentAdapter,
  sanitizeSlug,
  parseMaxTokens
};
