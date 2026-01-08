/**
 * Tests for Direct Codegen (React & Angular)
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

describe.each(['react', 'angular'])('%s Direct Codegen', (framework) => {
  let buildSystemPrompt, buildComponentPrompt, buildRetryPrompt, processComponent;
  
  beforeAll(() => {
    const module = require(`../src/${framework}/direct-codegen`);
    buildSystemPrompt = module.buildSystemPrompt;
    buildComponentPrompt = module.buildComponentPrompt;
    buildRetryPrompt = module.buildRetryPrompt;
    processComponent = module.processComponent;
  });

  describe('buildSystemPrompt', () => {
    it('returns the prompt content', () => {
      const prompt = buildSystemPrompt();
      expect(prompt).toContain('Code Connect');
      expect(prompt).toContain('figma.connect');
      
      if (framework === 'angular') {
        expect(prompt).toContain('html');
        expect(prompt).toContain('Angular');
      }
    });
  });

  describe('buildComponentPrompt', () => {
    it('includes Figma evidence', () => {
      const orientation = framework === 'react'
        ? { importPath: './Button', canonicalName: 'Button' }
        : { selector: 'app-button', canonicalName: 'ButtonComponent' };
      
      const prompt = buildComponentPrompt({
        figmaEvidence: {
          componentName: 'Button',
          variantProperties: { Size: ['sm', 'md'] },
          componentProperties: [{ name: 'Disabled', type: 'BOOLEAN' }],
          textLayers: [{ name: 'Label' }],
          slotLayers: [{ name: 'Icon' }]
        },
        orientation,
        figmaUrl: 'https://figma.com/test',
        sourceContext: {}
      });

      expect(prompt).toContain('Button');
      expect(prompt).toContain('Size');
      expect(prompt).toContain('Disabled');
      expect(prompt).toContain('https://figma.com/test');
      
      if (framework === 'angular') {
        expect(prompt).toContain('app-button');
      }
    });

    it('includes source context when provided', () => {
      const orientation = framework === 'react'
        ? { importPath: './Button', canonicalName: 'Button' }
        : { selector: 'app-button' };
      
      const sourceFile = framework === 'react'
        ? 'src/Button.tsx'
        : 'src/button.component.ts';
      const sourceContent = framework === 'react'
        ? 'export const Button = () => <button />'
        : '@Component({ selector: "app-button" })';
      
      const prompt = buildComponentPrompt({
        figmaEvidence: { componentName: 'Test' },
        orientation,
        figmaUrl: 'https://figma.com/test',
        sourceContext: { [sourceFile]: sourceContent }
      });

      expect(prompt).toContain(sourceFile);
      if (framework === 'react') {
        expect(prompt).toContain('export const Button');
      } else {
        expect(prompt).toContain('@Component');
      }
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
      const validCode = framework === 'react'
        ? `
import figma from '@figma/code-connect/react'
import { Button } from './Button'

figma.connect(Button, 'https://figma.com/test', {
  props: {
    size: figma.enum('Size', { 'Small': 'sm' }),
  },
  example: (props) => <Button size={props.size}>Click</Button>
})
        `
        : `
import figma, { html } from '@figma/code-connect/html'

figma.connect('https://figma.com/test', {
  props: {
    size: figma.enum('Size', { 'Small': 'sm' }),
  },
  example: (props) => html\`
    <app-button [size]="\${props.size}">Click</app-button>
  \`
})
        `;

      const mockAgent = {
        chatStateless: jest.fn().mockResolvedValue(validCode)
      };

      const orientation = framework === 'react'
        ? { importPath: './Button', canonicalName: 'Button' }
        : { selector: 'app-button' };

      const result = await processComponent({
        agent: mockAgent,
        figmaEvidence: {
          componentName: 'Button',
          variantProperties: { Size: ['Small', 'Large'] },
          componentProperties: [],
          textLayers: [],
          slotLayers: []
        },
        orientation,
        figmaUrl: 'https://figma.com/test',
        sourceContext: {},
        maxRetries: 2,
        maxTokens: 2048,
        logDir: null
      });

      expect(result.success).toBe(true);
      expect(result.code).toContain('figma.connect');
      if (framework === 'angular') {
        expect(result.code).toContain('html');
      }
      expect(result.errors).toHaveLength(0);
    });

    it('retries on validation failure', async () => {
      const invalidCode = framework === 'react'
        ? `
import figma from '@figma/code-connect/react'
import { Button } from './Button'
figma.connect(Button, 'url', {
  props: {
    invalid: figma.boolean('NonExistent'),
  },
  example: (props) => <Button />
})
          `
        : `
import figma, { html } from '@figma/code-connect/html'
figma.connect('url', {
  props: {
    invalid: figma.boolean('NonExistent'),
  },
  example: (props) => html\`<app-button />\`
})
          `;

      const validCode = framework === 'react'
        ? `
import figma from '@figma/code-connect/react'
import { Button } from './Button'
figma.connect(Button, 'url', {
  props: {
    disabled: figma.boolean('Disabled'),
  },
  example: (props) => <Button disabled={props.disabled} />
})
          `
        : `
import figma, { html } from '@figma/code-connect/html'
figma.connect('url', {
  props: {
    disabled: figma.boolean('Disabled'),
  },
  example: (props) => html\`<app-button [disabled]="\${props.disabled}" />\`
})
          `;

      const mockAgent = {
        chatStateless: jest.fn()
          .mockResolvedValueOnce(invalidCode)
          .mockResolvedValueOnce(validCode)
      };

      const orientation = framework === 'react'
        ? { importPath: './Button' }
        : { selector: 'app-button' };

      const result = await processComponent({
        agent: mockAgent,
        figmaEvidence: {
          componentName: 'Button',
          variantProperties: {},
          componentProperties: [{ name: 'Disabled', type: 'BOOLEAN' }],
          textLayers: [],
          slotLayers: []
        },
        orientation,
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
      const invalidCode = framework === 'react'
        ? `
import figma from '@figma/code-connect/react'
import { Button } from './Button'
figma.connect(Button, 'url', {
  props: {
    bad: figma.boolean('NonExistent'),
  },
  example: (props) => <Button />
})
        `
        : `
import figma, { html } from '@figma/code-connect/html'
figma.connect('url', {
  props: {
    bad: figma.boolean('NonExistent'),
  },
  example: (props) => html\`<div />\`
})
        `;

      const mockAgent = {
        chatStateless: jest.fn().mockResolvedValue(invalidCode)
      };

      const orientation = framework === 'react'
        ? { importPath: './Button' }
        : {};

      const result = await processComponent({
        agent: mockAgent,
        figmaEvidence: {
          componentName: 'Button',
          variantProperties: {},
          componentProperties: [],
          textLayers: [],
          slotLayers: []
        },
        orientation,
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
