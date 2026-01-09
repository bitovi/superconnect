/**
 * Tests for Direct Codegen (React & Angular)
 *
 * Note: We use a mock validator function injected into processComponent
 * to avoid spawning the Figma CLI in every unit test. This dramatically
 * improves test speed, especially on Windows where subprocess spawning
 * is 5x slower.
 *
 * Real CLI validation is tested in:
 *   - test/validate-code-connect.test.js (dedicated CLI shell-out test)
 *   - E2E tests (chakra, zapui)
 */
const { describe, it, before } = require('node:test');
const assert = require('node:assert');
const { createMock } = require('./test-utils');

// Create a mock validator that simulates validation behavior
function createMockValidator() {
  return (params) => {
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
  };
}

for (const framework of ['react', 'angular']) {
  describe(`${framework} Direct Codegen`, () => {
    let buildSystemPrompt, buildComponentPrompt, buildRetryPrompt, processComponent;
    
    before(() => {
      const module = require(`../src/${framework}/direct-codegen`);
      buildSystemPrompt = module.buildSystemPrompt;
      buildComponentPrompt = module.buildComponentPrompt;
      buildRetryPrompt = module.buildRetryPrompt;
      processComponent = module.processComponent;
    });

    describe('buildSystemPrompt', () => {
      it('returns the prompt content', () => {
        const prompt = buildSystemPrompt();
        assert.ok(prompt.includes('Code Connect'));
        assert.ok(prompt.includes('figma.connect'));
        
        if (framework === 'angular') {
          assert.ok(prompt.includes('html'));
          assert.ok(prompt.includes('Angular'));
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

        assert.ok(prompt.includes('Button'));
        assert.ok(prompt.includes('Size'));
        assert.ok(prompt.includes('Disabled'));
        assert.ok(prompt.includes('https://figma.com/test'));
        
        if (framework === 'angular') {
          assert.ok(prompt.includes('app-button'));
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

        assert.ok(prompt.includes(sourceFile));
        if (framework === 'react') {
          assert.ok(prompt.includes('export const Button'));
        } else {
          assert.ok(prompt.includes('@Component'));
        }
      });
    });

    describe('buildRetryPrompt', () => {
      it('includes previous code and errors', () => {
        const prompt = buildRetryPrompt(
          'const bad = code;',
          ['Error 1: Invalid key', 'Error 2: Missing layer']
        );

        assert.ok(prompt.includes('validation errors'));
        assert.ok(prompt.includes('const bad = code;'));
        assert.ok(prompt.includes('Error 1: Invalid key'));
        assert.ok(prompt.includes('Error 2: Missing layer'));
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
          chatStateless: createMock(validCode).mockResolvedValue(validCode)
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
          logDir: null,
          validateFn: createMockValidator()
        });

        assert.strictEqual(result.success, true);
        assert.ok(result.code.includes('figma.connect'));
        if (framework === 'angular') {
          assert.ok(result.code.includes('html'));
        }
        assert.strictEqual(result.errors.length, 0);
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
          chatStateless: createMock()
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
          logDir: null,
          validateFn: createMockValidator()
        });

        // Should succeed on second attempt
        assert.strictEqual(result.success, true);
        assert.strictEqual(mockAgent.chatStateless.calls.length, 2);
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
          chatStateless: createMock().mockResolvedValue(invalidCode)
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
          maxTokens: 2048,
          validateFn: createMockValidator()
        });

        assert.strictEqual(result.success, false);
        assert.ok(result.errors.length > 0);
        // Initial attempt + 1 retry = 2 calls
        assert.strictEqual(mockAgent.chatStateless.calls.length, 2);
      });
    });
  });
}
