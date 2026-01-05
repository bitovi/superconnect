/**
 * Unit tests for unified agentic codegen
 */

const path = require('path');
const {
  buildSystemPrompt,
  buildUserPrompt,
  buildRetryPrompt,
  processComponentWithTools
} = require('../src/agent/unified-codegen');

describe('Unified Agentic Codegen', () => {
  describe('buildSystemPrompt', () => {
    it('should build system prompt for React', () => {
      const prompt = buildSystemPrompt('react');
      expect(prompt).toContain('Available Tools');
      expect(prompt).toContain('queryIndex');
      expect(prompt).toContain('readFile');
      expect(prompt).toContain('listFiles');
      expect(prompt).toContain('React Agentic Code Connect Generator');
    });

    it('should build system prompt for Angular', () => {
      const prompt = buildSystemPrompt('angular');
      expect(prompt).toContain('Available Tools');
      expect(prompt).toContain('queryIndex');
      expect(prompt).toContain('Angular');
    });
  });

  describe('buildUserPrompt', () => {
    it('should build user prompt with Figma data', () => {
      const params = {
        figmaEvidence: {
          componentName: 'Button',
          variantProperties: { size: ['small', 'large'] },
          componentProperties: [],
          textLayers: [],
          slotLayers: []
        },
        figmaUrl: 'https://figma.com/file/abc',
        indexSummary: {
          totalFiles: 50,
          componentCount: 20,
          packageRoots: ['packages/ui']
        }
      };

      const prompt = buildUserPrompt(params);
      expect(prompt).toContain('Button');
      expect(prompt).toContain('https://figma.com/file/abc');
      expect(prompt).toContain('Total indexed files: 50');
      expect(prompt).toContain('Use the tools to find and read');
    });
  });

  describe('buildRetryPrompt', () => {
    it('should build retry prompt with errors', () => {
      const previousCode = 'figma.enum("invalid", {})';
      const errors = ['Property "invalid" not found in variantProperties'];

      const prompt = buildRetryPrompt(previousCode, errors);
      expect(prompt).toContain('Validation Errors');
      expect(prompt).toContain('invalid');
      expect(prompt).toContain('Fix the errors');
    });
  });

  describe('processComponentWithTools', () => {
    it('should build correct prompts and call agent with tools', async () => {
      // Mock agent and tools
      const mockAgent = {
        chatWithTools: jest.fn().mockResolvedValue({
          text: `import figma from '@figma/code-connect'
import { Button } from './Button'
export default figma.connect(Button, 'url', {
  example: () => <Button />
})`,
          usage: { inputTokens: 100, outputTokens: 50 },
          toolCalls: [
            { name: 'queryIndex', input: { query: { type: 'exports', value: 'Button' } } }
          ]
        })
      };

      const mockTools = {
        queryIndex: jest.fn().mockResolvedValue({ files: [], total_matches: 0, truncated: false }),
        readFile: jest.fn(),
        listFiles: jest.fn(),
        getMetrics: jest.fn().mockReturnValue({}),
        saveMetrics: jest.fn().mockResolvedValue()
      };

      const params = {
        agent: mockAgent,
        tools: mockTools,
        figmaEvidence: {
          componentName: 'Button',
          variantProperties: {},
          componentProperties: [],
          textLayers: [],
          slotLayers: []
        },
        figmaUrl: 'https://figma.com/file/abc',
        indexSummary: { totalFiles: 10 },
        framework: 'react',
        maxRetries: 2,
        maxTokens: 4096,
        logDir: '/tmp',
        componentId: 'button-test'
      };

      const result = await processComponentWithTools(params);

      // Verify agent was called with system and user prompts
      expect(mockAgent.chatWithTools).toHaveBeenCalled();
      const callArgs = mockAgent.chatWithTools.mock.calls[0][0];
      expect(callArgs.system).toContain('Available Tools');
      expect(callArgs.user).toContain('Button');
      expect(callArgs.tools).toBeDefined();
      expect(callArgs.toolHandler).toBeDefined();
    });

    it('should call agent with retry prompt on validation failure', async () => {
      let callCount = 0;
      const mockAgent = {
        chatWithTools: jest.fn().mockImplementation(async () => {
          callCount++;
          if (callCount === 1) {
            // First attempt - invalid code (missing import and export default)
            return {
              text: `figma.connect('Button', 'url', { example: () => <Button /> })`,
              usage: { inputTokens: 100, outputTokens: 50 },
              toolCalls: []
            };
          } else {
            // Second attempt - valid code
            return {
              text: `import figma from '@figma/code-connect'
import { Button } from './Button'
export default figma.connect(Button, 'url', {
  example: () => <Button />
})`,
              usage: { inputTokens: 100, outputTokens: 50 },
              toolCalls: []
            };
          }
        })
      };

      const mockTools = {
        queryIndex: jest.fn(),
        readFile: jest.fn(),
        listFiles: jest.fn(),
        getMetrics: jest.fn().mockReturnValue({}),
        saveMetrics: jest.fn().mockResolvedValue()
      };

      const params = {
        agent: mockAgent,
        tools: mockTools,
        figmaEvidence: {
          componentName: 'Button',
          variantProperties: {},
          componentProperties: [],
          textLayers: [],
          slotLayers: []
        },
        figmaUrl: 'https://figma.com/file/abc',
        indexSummary: { totalFiles: 10 },
        framework: 'react',
        maxRetries: 2,
        maxTokens: 4096,
        logDir: '/tmp',
        componentId: 'button-test'
      };

      const result = await processComponentWithTools(params);

      // Verify retry was attempted
      expect(mockAgent.chatWithTools).toHaveBeenCalledTimes(2);
      
      // Second call should include retry prompt
      const secondCall = mockAgent.chatWithTools.mock.calls[1][0];
      expect(secondCall.user).toContain('Validation Errors');
    });
  });
});
