/**
 * Unit tests for LiteLLM/OpenAI-compatible endpoint support
 */

const { OpenAIAgentAdapter } = require('../src/agent/agent-adapter');
const os = require('os');
const path = require('path');
const fs = require('fs-extra');

describe('LiteLLM Support', () => {
  let testLogDir;

  beforeEach(async () => {
    testLogDir = path.join(os.tmpdir(), `test-litellm-${Date.now()}`);
    await fs.ensureDir(testLogDir);
  });

  afterEach(async () => {
    await fs.remove(testLogDir);
  });

  describe('OpenAIAgentAdapter baseURL support', () => {
    it('should accept baseUrl option', () => {
      const adapter = new OpenAIAgentAdapter({
        model: 'gpt-4',
        logDir: testLogDir,
        baseUrl: 'http://localhost:4000/v1',
        apiKey: 'test-key'
      });
      expect(adapter).toBeDefined();
      expect(adapter.baseURL).toBe('http://localhost:4000/v1');
    });

    it('should fall back to OPENAI_BASE_URL env var', () => {
      const originalEnv = process.env.OPENAI_BASE_URL;
      process.env.OPENAI_BASE_URL = 'http://localhost:5000/v1';
      
      const adapter = new OpenAIAgentAdapter({
        model: 'gpt-4',
        logDir: testLogDir,
        apiKey: 'test-key'
      });
      
      expect(adapter).toBeDefined();
      expect(adapter.baseURL).toBe('http://localhost:5000/v1');
      
      // Restore env
      if (originalEnv) {
        process.env.OPENAI_BASE_URL = originalEnv;
      } else {
        delete process.env.OPENAI_BASE_URL;
      }
    });

    it('should accept apiKey option', () => {
      const adapter = new OpenAIAgentAdapter({
        model: 'gpt-4',
        logDir: testLogDir,
        baseUrl: 'http://localhost:4000/v1',
        apiKey: 'custom-api-key'
      });
      expect(adapter).toBeDefined();
      // Note: We don't expose the API key for security, just verify it doesn't throw
    });

    it('should fall back to OPENAI_API_KEY env var', () => {
      const originalEnv = process.env.OPENAI_API_KEY;
      process.env.OPENAI_API_KEY = 'env-api-key';
      
      const adapter = new OpenAIAgentAdapter({
        model: 'gpt-4',
        logDir: testLogDir,
        baseUrl: 'http://localhost:4000/v1'
      });
      
      expect(adapter).toBeDefined();
      
      // Restore env
      if (originalEnv) {
        process.env.OPENAI_API_KEY = originalEnv;
      } else {
        delete process.env.OPENAI_API_KEY;
      }
    });

    it('should allow placeholder API key when baseURL is set', () => {
      const adapter = new OpenAIAgentAdapter({
        model: 'gpt-4',
        logDir: testLogDir,
        baseUrl: 'http://localhost:4000/v1',
        apiKey: 'unused'
      });
      expect(adapter).toBeDefined();
    });

    it('should work without baseUrl (standard OpenAI)', () => {
      const originalEnv = process.env.OPENAI_API_KEY;
      process.env.OPENAI_API_KEY = 'test-key';
      
      const adapter = new OpenAIAgentAdapter({
        model: 'gpt-4',
        logDir: testLogDir
      });
      
      expect(adapter).toBeDefined();
      expect(adapter.baseURL).toBeUndefined();
      
      // Restore env
      if (originalEnv) {
        process.env.OPENAI_API_KEY = originalEnv;
      } else {
        delete process.env.OPENAI_API_KEY;
      }
    });
  });

  describe('normalizeAgentConfig', () => {
    // We'll test this by directly importing the function if we expose it,
    // or by testing the full pipeline behavior in integration tests.
    // For now, skipping since normalizeAgentConfig is not exported.
    it.skip('should extract base_url from agent config', () => {
      // Implementation would go here if we expose normalizeAgentConfig
    });

    it.skip('should extract api_key from agent config', () => {
      // Implementation would go here if we expose normalizeAgentConfig
    });

    it.skip('should warn if base_url is set with non-OpenAI backend', () => {
      // Implementation would go here if we expose normalizeAgentConfig
    });
  });
});
