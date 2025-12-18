/**
 * Tests for React Direct Codegen
 *
 * Note: We mock validateCodeConnectWithCLI to avoid spawning the Figma CLI
 * in every unit test. This dramatically improves test speed, especially on
 * Windows where subprocess spawning is 5x slower.
 *
 * Real CLI validation is tested in:
 *   - test/validate-code-connect.test.js (dedicated CLI shell-out test)
 *   - E2E tests (chakra, zapui)
 */

// Mock the validation module to avoid slow subprocess calls
jest.mock('../src/util/validate-code-connect', () => {
  const original = jest.requireActual('../src/util/validate-code-connect');
  return {
    ...original,
    validateCodeConnectWithCLI: jest.fn((params) => {
      // Simulate validation: check for obvious issues that would fail CLI
      const code = params.generatedCode || '';
      
      // Check for figma.connect call
      if (!code.includes('figma.connect')) {
        return { valid: false, errors: ['Missing figma.connect call'] };
      }
      
      // Check for references to non-existent Figma properties (simulates CLI error)
      // This allows retry tests to work by detecting "NonExistent" prop references
      if (code.includes('NonExistent')) {
        return { valid: false, errors: ['Property "NonExistent" does not exist on this component'] };
      }
      
      return { valid: true, errors: [] };
    })
  };
});

const {
  buildSystemPrompt,
  buildComponentPrompt,
  buildRetryPrompt,
  buildStatelessMessages,
  buildRepairMessages,
  processComponent
} = require('../src/react/direct-codegen');

describe('React Direct Codegen', () => {
  describe('buildSystemPrompt', () => {
    it('returns the prompt content', () => {
      const prompt = buildSystemPrompt();
      expect(prompt).toContain('Code Connect');
      expect(prompt).toContain('figma.connect');
    });
  });

  describe('buildComponentPrompt', () => {
    it('includes Figma evidence', () => {
      const prompt = buildComponentPrompt({
        figmaEvidence: {
          componentName: 'Button',
          variantProperties: { Size: ['sm', 'md'] },
          componentProperties: [{ name: 'Disabled', type: 'BOOLEAN' }],
          textLayers: [{ name: 'Label' }],
          slotLayers: [{ name: 'Icon' }]
        },
        orientation: {
          importPath: './Button',
          canonicalName: 'Button'
        },
        figmaUrl: 'https://figma.com/test',
        sourceContext: {}
      });

      expect(prompt).toContain('Button');
      expect(prompt).toContain('Size');
      expect(prompt).toContain('Disabled');
      expect(prompt).toContain('https://figma.com/test');
    });

    it('includes source context when provided', () => {
      const prompt = buildComponentPrompt({
        figmaEvidence: { componentName: 'Test' },
        orientation: {},
        figmaUrl: 'https://figma.com/test',
        sourceContext: {
          'src/Button.tsx': 'export const Button = () => <button />'
        }
      });

      expect(prompt).toContain('src/Button.tsx');
      expect(prompt).toContain('export const Button');
    });
  });

  describe('buildRetryPrompt', () => {
    it('includes previous code and errors', () => {
      const prompt = buildRetryPrompt(
        'const bad = code;',
        ['Error 1: Invalid key', 'Error 2: Missing layer']
      );

      expect(prompt).toContain('validation errors');
      expect(prompt).toContain('const bad = code;');
      expect(prompt).toContain('Error 1: Invalid key');
      expect(prompt).toContain('Error 2: Missing layer');
    });
  });

  describe('processComponent', () => {
    it('returns success when validation passes', async () => {
      const mockAgent = {
        chatStateless: jest.fn().mockResolvedValue(`
import figma from '@figma/code-connect/react'
import { Button } from './Button'

figma.connect(Button, 'https://figma.com/test', {
  props: {
    size: figma.enum('Size', { 'Small': 'sm' }),
  },
  example: (props) => <Button size={props.size}>Click</Button>
})
        `)
      };

      const result = await processComponent({
        agent: mockAgent,
        figmaEvidence: {
          componentName: 'Button',
          variantProperties: { Size: ['Small', 'Large'] },
          componentProperties: [],
          textLayers: [],
          slotLayers: []
        },
        orientation: { importPath: './Button', canonicalName: 'Button' },
        figmaUrl: 'https://figma.com/test',
        sourceContext: {},
        maxRetries: 2,
        maxTokens: 2048,
        logDir: null
      });

      expect(result.success).toBe(true);
      expect(result.code).toContain('figma.connect');
      expect(result.errors).toHaveLength(0);
    });

    it('retries on validation failure', async () => {
      const mockAgent = {
        chatStateless: jest.fn()
          .mockResolvedValueOnce(`
import figma from '@figma/code-connect/react'
import { Button } from './Button'
figma.connect(Button, 'url', {
  props: {
    invalid: figma.boolean('NonExistent'),
  },
  example: (props) => <Button />
})
          `)
          .mockResolvedValueOnce(`
import figma from '@figma/code-connect/react'
import { Button } from './Button'
figma.connect(Button, 'url', {
  props: {
    disabled: figma.boolean('Disabled'),
  },
  example: (props) => <Button disabled={props.disabled} />
})
          `)
      };

      const result = await processComponent({
        agent: mockAgent,
        figmaEvidence: {
          componentName: 'Button',
          variantProperties: {},
          componentProperties: [{ name: 'Disabled', type: 'BOOLEAN' }],
          textLayers: [],
          slotLayers: []
        },
        orientation: { importPath: './Button' },
        figmaUrl: 'https://figma.com/test',
        sourceContext: {},
        maxRetries: 2,
        maxTokens: 2048,
        logDir: null
      });

      // Should succeed on second attempt
      expect(result.success).toBe(true);
      expect(mockAgent.chatStateless).toHaveBeenCalledTimes(2);
    });

    it('fails after max retries exceeded', async () => {
      const mockAgent = {
        chatStateless: jest.fn().mockResolvedValue(`
import figma from '@figma/code-connect/react'
import { Button } from './Button'
figma.connect(Button, 'url', {
  props: {
    bad: figma.boolean('NonExistent'),
  },
  example: (props) => <Button />
})
        `)
      };

      const result = await processComponent({
        agent: mockAgent,
        figmaEvidence: {
          componentName: 'Button',
          variantProperties: {},
          componentProperties: [],
          textLayers: [],
          slotLayers: []
        },
        orientation: { importPath: './Button' },
        figmaUrl: 'url',
        sourceContext: {},
        maxRetries: 1,
        maxTokens: 2048
      });

      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      // Initial attempt + 1 retry = 2 calls
      expect(mockAgent.chatStateless).toHaveBeenCalledTimes(2);
    });
  });

});
