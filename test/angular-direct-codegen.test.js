/**
 * Tests for Angular Direct Codegen
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
} = require('../src/angular/direct-codegen');

describe('Angular Direct Codegen', () => {
  describe('buildSystemPrompt', () => {
    it('returns the prompt content for Angular', () => {
      const prompt = buildSystemPrompt();
      expect(prompt).toContain('Code Connect');
      expect(prompt).toContain('figma.connect');
      expect(prompt).toContain('html');
      expect(prompt).toContain('Angular');
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
          selector: 'app-button',
          canonicalName: 'ButtonComponent'
        },
        figmaUrl: 'https://figma.com/test',
        sourceContext: {}
      });

      expect(prompt).toContain('Button');
      expect(prompt).toContain('Size');
      expect(prompt).toContain('Disabled');
      expect(prompt).toContain('app-button');
      expect(prompt).toContain('https://figma.com/test');
    });

    it('includes source context when provided', () => {
      const prompt = buildComponentPrompt({
        figmaEvidence: { componentName: 'Test' },
        orientation: { selector: 'app-test' },
        figmaUrl: 'https://figma.com/test',
        sourceContext: {
          'src/button.component.ts': '@Component({ selector: "app-button" })'
        }
      });

      expect(prompt).toContain('src/button.component.ts');
      expect(prompt).toContain('@Component');
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
import figma, { html } from '@figma/code-connect/html'

figma.connect('https://figma.com/test', {
  props: {
    size: figma.enum('Size', { 'Small': 'sm' }),
  },
  example: (props) => html\`
    <app-button [size]="\${props.size}">Click</app-button>
  \`
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
        orientation: { selector: 'app-button' },
        figmaUrl: 'https://figma.com/test',
        sourceContext: {},
        maxRetries: 2,
        maxTokens: 2048,
        logDir: null
      });

      expect(result.success).toBe(true);
      expect(result.code).toContain('figma.connect');
      expect(result.code).toContain('html');
      expect(result.errors).toHaveLength(0);
    });

    it('retries on validation failure', async () => {
      const mockAgent = {
        chatStateless: jest.fn()
          .mockResolvedValueOnce(`
import figma, { html } from '@figma/code-connect/html'
figma.connect('url', {
  props: {
    invalid: figma.boolean('NonExistent'),
  },
  example: (props) => html\`<app-button />\`
})
          `)
          .mockResolvedValueOnce(`
import figma, { html } from '@figma/code-connect/html'
figma.connect('url', {
  props: {
    disabled: figma.boolean('Disabled'),
  },
  example: (props) => html\`<app-button [disabled]="\${props.disabled}" />\`
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
        orientation: { selector: 'app-button' },
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
import figma, { html } from '@figma/code-connect/html'
figma.connect('url', {
  props: {
    bad: figma.boolean('NonExistent'),
  },
  example: (props) => html\`<div />\`
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
        orientation: {},
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
