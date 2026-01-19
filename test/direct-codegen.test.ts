/**
 * Tests for Direct Codegen (React & Angular)
 *
 * Uses mock validator to avoid spawning Figma CLI in unit tests.
 * Real CLI validation is tested in validate-code-connect.test.js and E2E tests.
 */
import { describe, it, before, mock } from 'node:test';
import assert from 'node:assert';

// ---------------------------------------------------------------------------
// Shared Fixtures
// ---------------------------------------------------------------------------

const FIXTURES = {
  react: {
    validCode: `
import figma from '@figma/code-connect/react'
import { Button } from './Button'

figma.connect(Button, 'https://figma.com/test', {
  props: { size: figma.enum('Size', { 'Small': 'sm' }) },
  example: (props) => <Button size={props.size}>Click</Button>
})`,
    invalidCode: `
import figma from '@figma/code-connect/react'
import { Button } from './Button'
figma.connect(Button, 'url', {
  props: { invalid: figma.boolean('NonExistent') },
  example: (props) => <Button />
})`,
    fixedCode: `
import figma from '@figma/code-connect/react'
import { Button } from './Button'
figma.connect(Button, 'url', {
  props: { disabled: figma.boolean('Disabled') },
  example: (props) => <Button disabled={props.disabled} />
})`,
    orientation: { importPath: './Button', canonicalName: 'Button' },
    sourceFile: 'src/Button.tsx',
    sourceContent: 'export const Button = () => <button />'
  },
  angular: {
    validCode: `
import figma, { html } from '@figma/code-connect/html'

figma.connect('https://figma.com/test', {
  props: { size: figma.enum('Size', { 'Small': 'sm' }) },
  example: (props) => html\`<app-button [size]="\${props.size}">Click</app-button>\`
})`,
    invalidCode: `
import figma, { html } from '@figma/code-connect/html'
figma.connect('url', {
  props: { invalid: figma.boolean('NonExistent') },
  example: (props) => html\`<app-button />\`
})`,
    fixedCode: `
import figma, { html } from '@figma/code-connect/html'
figma.connect('url', {
  props: { disabled: figma.boolean('Disabled') },
  example: (props) => html\`<app-button [disabled]="\${props.disabled}" />\`
})`,
    orientation: { selector: 'app-button', canonicalName: 'ButtonComponent' },
    sourceFile: 'src/button.component.ts',
    sourceContent: '@Component({ selector: "app-button" })'
  }
};

// Mock validator that simulates CLI validation behavior
function mockValidator({ generatedCode }: { generatedCode: string }): { valid: boolean; errors: string[] } {
  if (!generatedCode.includes('figma.connect')) {
    return { valid: false, errors: ['Missing figma.connect call'] };
  }
  if (generatedCode.includes('NonExistent')) {
    return { valid: false, errors: ['Property "NonExistent" does not exist'] };
  }
  return { valid: true, errors: [] };
}

// ---------------------------------------------------------------------------
// Tests for both frameworks
// ---------------------------------------------------------------------------

for (const framework of ['react', 'angular'] as const) {
  const fx = FIXTURES[framework];

  describe(`${framework} Direct Codegen`, () => {
    let buildSystemPrompt: (includeAgenticTools?: boolean, importFrom?: string | null) => string;
    let buildComponentPrompt: (args: any) => string;
    let buildRetryPrompt: (code: string, errors: string[]) => string;
    let processComponent: (args: any) => Promise<any>;

    before(async () => {
      const mod = await import(`../src/${framework}/direct-codegen.ts`);
      buildSystemPrompt = mod.buildSystemPrompt;
      buildComponentPrompt = mod.buildComponentPrompt;
      buildRetryPrompt = mod.buildRetryPrompt;
      processComponent = mod.processComponent;
    });

    describe('buildSystemPrompt', () => {
      it('returns prompt with Code Connect docs', () => {
        const prompt = buildSystemPrompt();
        assert.ok(prompt.includes('Code Connect'));
        assert.ok(prompt.includes('figma.connect'));
        if (framework === 'angular') {
          assert.ok(prompt.includes('html'));
          assert.ok(prompt.includes('Angular'));
        }
      });

      it('includes importFrom package name in prompt when provided', () => {
        const promptWithImport = buildSystemPrompt(false, '@my-company/design-system');
        assert.ok(promptWithImport.includes('@my-company/design-system'));
        assert.ok(promptWithImport.includes('import source') || promptWithImport.includes('Import'));
      });

      it('includes fallback import instructions when importFrom is null', () => {
        const promptWithoutImport = buildSystemPrompt(false, null);
        assert.ok(promptWithoutImport.includes('import') || promptWithoutImport.includes('Import'));
        assert.ok(!promptWithoutImport.includes('@my-company'));
      });
    });

    describe('buildComponentPrompt', () => {
      it('includes Figma evidence and orientation', () => {
        const prompt = buildComponentPrompt({
          figmaEvidence: {
            componentName: 'Button',
            variantProperties: { Size: ['sm', 'md'] },
            componentProperties: [{ name: 'Disabled', type: 'BOOLEAN' }],
            textLayers: [{ name: 'Label' }],
            slotLayers: [{ name: 'Icon' }]
          },
          orientation: fx.orientation,
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
        const prompt = buildComponentPrompt({
          figmaEvidence: { componentName: 'Test' },
          orientation: fx.orientation,
          figmaUrl: 'https://figma.com/test',
          sourceContext: { [fx.sourceFile]: fx.sourceContent }
        });

        assert.ok(prompt.includes(fx.sourceFile));
        assert.ok(prompt.includes(fx.sourceContent.slice(0, 20)));
      });
    });

    describe('buildRetryPrompt', () => {
      it('includes previous code and errors', () => {
        const prompt = buildRetryPrompt('const bad = code;', ['Error 1', 'Error 2']);
        assert.ok(prompt.includes('validation errors'));
        assert.ok(prompt.includes('const bad = code;'));
        assert.ok(prompt.includes('Error 1'));
        assert.ok(prompt.includes('Error 2'));
      });
    });

    describe('processComponent', () => {
      it('returns success when validation passes', async () => {
        const chatStateless = mock.fn(() => Promise.resolve(fx.validCode));

        const result = await processComponent({
          agent: { chatStateless },
          figmaEvidence: {
            componentName: 'Button',
            variantProperties: { Size: ['Small', 'Large'] },
            componentProperties: [],
            textLayers: [],
            slotLayers: []
          },
          orientation: fx.orientation,
          figmaUrl: 'https://figma.com/test',
          sourceContext: {},
          maxRetries: 2,
          maxTokens: 2048,
          logDir: null,
          validateFn: mockValidator
        });

        assert.strictEqual(result.success, true);
        assert.ok(result.code.includes('figma.connect'));
        assert.strictEqual(result.errors.length, 0);
      });

      it('retries on validation failure then succeeds', async () => {
        let callCount = 0;
        const chatStateless = mock.fn(() => {
          callCount++;
          return Promise.resolve(callCount === 1 ? fx.invalidCode : fx.fixedCode);
        });

        const result = await processComponent({
          agent: { chatStateless },
          figmaEvidence: {
            componentName: 'Button',
            variantProperties: {},
            componentProperties: [{ name: 'Disabled', type: 'BOOLEAN' }],
            textLayers: [],
            slotLayers: []
          },
          orientation: fx.orientation,
          figmaUrl: 'https://figma.com/test',
          sourceContext: {},
          maxRetries: 2,
          maxTokens: 2048,
          logDir: null,
          validateFn: mockValidator
        });

        assert.strictEqual(result.success, true);
        assert.strictEqual(chatStateless.mock.calls.length, 2);
      });

      it('fails after max retries exceeded', async () => {
        const chatStateless = mock.fn(() => Promise.resolve(fx.invalidCode));

        const result = await processComponent({
          agent: { chatStateless },
          figmaEvidence: {
            componentName: 'Button',
            variantProperties: {},
            componentProperties: [],
            textLayers: [],
            slotLayers: []
          },
          orientation: fx.orientation,
          figmaUrl: 'url',
          sourceContext: {},
          maxRetries: 1,
          maxTokens: 2048,
          validateFn: mockValidator
        });

        assert.strictEqual(result.success, false);
        assert.ok(result.errors.length > 0);
        assert.strictEqual(chatStateless.mock.calls.length, 2); // initial + 1 retry
      });
    });
  });
}
