const {
  validateCodeConnect,
  validateCodeConnectWithCLI,
  extractFigmaCalls,
  buildValidKeySets,
  normalizeKey
} = require('../src/util/validate-code-connect');

describe('validate-code-connect', () => {
  describe('normalizeKey', () => {
    it('strips leading dot', () => {
      expect(normalizeKey('.iconStart')).toBe('iconstart');
    });

    it('strips trailing question mark', () => {
      expect(normalizeKey('iconStart?')).toBe('iconstart');
    });

    it('handles both dot and question mark', () => {
      expect(normalizeKey('.iconStart?')).toBe('iconstart');
    });

    it('lowercases the key', () => {
      expect(normalizeKey('ColorPalette')).toBe('colorpalette');
    });
  });

  describe('extractFigmaCalls', () => {
    it('extracts figma.string calls', () => {
      const code = `figma.string('label')`;
      const calls = extractFigmaCalls(code);
      expect(calls).toHaveLength(1);
      expect(calls[0]).toEqual({ helper: 'string', key: 'label', line: 1 });
    });

    it('extracts multiple calls on different lines', () => {
      const code = `
const props = {
  label: figma.string('Label'),
  disabled: figma.boolean('Disabled'),
  size: figma.enum('Size', { Small: 'sm' }),
};`;
      const calls = extractFigmaCalls(code);
      expect(calls).toHaveLength(3);
      expect(calls.map(c => c.helper)).toEqual(['string', 'boolean', 'enum']);
    });

    it('extracts figma.textContent calls', () => {
      const code = `buttonText: figma.textContent('Label')`;
      const calls = extractFigmaCalls(code);
      expect(calls).toHaveLength(1);
      expect(calls[0]).toEqual({ helper: 'textContent', key: 'Label', line: 1 });
    });

    it('extracts figma.children calls', () => {
      const code = `content: figma.children('Content')`;
      const calls = extractFigmaCalls(code);
      expect(calls).toHaveLength(1);
      expect(calls[0]).toEqual({ helper: 'children', key: 'Content', line: 1 });
    });
  });

  describe('buildValidKeySets', () => {
    it('builds key sets from figma evidence', () => {
      const evidence = {
        variantProperties: {
          Size: ['sm', 'md'],
          Variant: ['solid', 'ghost']
        },
        componentProperties: [
          { name: 'label', type: 'TEXT' },
          { name: '.iconStart?', type: 'BOOLEAN' },
          { name: 'iconStart', type: 'INSTANCE_SWAP' }
        ],
        textLayers: [
          { name: 'Label', type: 'TEXT' }
        ],
        slotLayers: [
          { name: 'Icon', type: 'FRAME' }
        ]
      };

      const keySets = buildValidKeySets(evidence);

      expect(keySets.enumKeys.has('size')).toBe(true);
      expect(keySets.enumKeys.has('variant')).toBe(true);
      expect(keySets.stringKeys.has('label')).toBe(true);
      expect(keySets.booleanKeys.has('iconstart')).toBe(true);
      expect(keySets.instanceKeys.has('iconstart')).toBe(true);
      expect(keySets.textLayerNames.has('label')).toBe(true);
      expect(keySets.slotLayerNames.has('icon')).toBe(true);
    });
  });

  describe('validateCodeConnect', () => {
    const validCode = `
import figma from '@figma/code-connect/react';
import { Button } from './Button';

figma.connect(Button, 'https://figma.com/design/abc/file?node-id=1-2', {
  props: {
    label: figma.string('label'),
    size: figma.enum('Size', { Small: 'sm' }),
  },
  example: (props) => <Button size={props.size}>{props.label}</Button>
});
`;

    const evidence = {
      variantProperties: {
        Size: ['sm', 'md']
      },
      componentProperties: [
        { name: 'label', type: 'TEXT' }
      ],
      textLayers: [],
      slotLayers: []
    };

    it('returns valid for correct code', () => {
      const result = validateCodeConnect({
        generatedCode: validCode,
        figmaEvidence: evidence
      });
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('catches invalid property key', () => {
      const badCode = validCode.replace("figma.string('label')", "figma.string('nonexistent')");
      const result = validateCodeConnect({
        generatedCode: badCode,
        figmaEvidence: evidence
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('nonexistent'))).toBe(true);
    });

    it('catches invalid enum key', () => {
      const badCode = validCode.replace("figma.enum('Size'", "figma.enum('InvalidAxis'");
      const result = validateCodeConnect({
        generatedCode: badCode,
        figmaEvidence: evidence
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('InvalidAxis'))).toBe(true);
    });

    it('catches missing figma.connect', () => {
      const badCode = `import figma from '@figma/code-connect/react';`;
      const result = validateCodeConnect({
        generatedCode: badCode,
        figmaEvidence: evidence
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('figma.connect'))).toBe(true);
    });

    it('catches missing import', () => {
      const badCode = `figma.connect(Button, 'url', {});`;
      const result = validateCodeConnect({
        generatedCode: badCode,
        figmaEvidence: evidence
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('import'))).toBe(true);
    });

    it('validates textContent against textLayers', () => {
      const codeWithTextContent = `
import figma from '@figma/code-connect/react';
figma.connect(Button, 'url', {
  props: { text: figma.textContent('Label') },
  example: () => null
});`;
      const evidenceWithTextLayer = {
        ...evidence,
        textLayers: [{ name: 'Label', type: 'TEXT' }]
      };
      
      const result = validateCodeConnect({
        generatedCode: codeWithTextContent,
        figmaEvidence: evidenceWithTextLayer
      });
      expect(result.valid).toBe(true);
    });

    it('catches invalid textContent layer name', () => {
      const codeWithTextContent = `
import figma from '@figma/code-connect/react';
figma.connect(Button, 'url', {
  props: { text: figma.textContent('NonexistentLayer') },
  example: () => null
});`;
      
      const result = validateCodeConnect({
        generatedCode: codeWithTextContent,
        figmaEvidence: evidence
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('NonexistentLayer'))).toBe(true);
    });

    it('catches ternary expressions in template interpolation', () => {
      const badCode = `
import figma, { html } from '@figma/code-connect/html';
figma.connect('url', {
  props: { hasIcon: figma.boolean('Icon') },
  example: ({ hasIcon }) => html\`<button \${hasIcon ? 'icon="star"' : ''}></button>\`
});`;
      
      const result = validateCodeConnect({
        generatedCode: badCode,
        figmaEvidence: { componentProperties: [{ name: 'Icon', type: 'BOOLEAN' }], variantProperties: {}, textLayers: [], slotLayers: [] }
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Ternary expression'))).toBe(true);
    });

    it('catches nested template literals in interpolation', () => {
      const badCode = `
import figma, { html } from '@figma/code-connect/html';
figma.connect('url', {
  props: { label: figma.string('Label') },
  example: ({ label }) => html\`<input [label]="\${label ? \\\`'\${label}'\\\` : ''}"/>\`
});`;
      
      const result = validateCodeConnect({
        generatedCode: badCode,
        figmaEvidence: { componentProperties: [{ name: 'Label', type: 'TEXT' }], variantProperties: {}, textLayers: [], slotLayers: [] }
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Nested template literal'))).toBe(true);
    });

    it('catches logical operators in template interpolation', () => {
      const badCode = `
import figma, { html } from '@figma/code-connect/html';
figma.connect('url', {
  props: { disabled: figma.boolean('Disabled') },
  example: ({ disabled }) => html\`<button \${disabled && 'disabled'}></button>\`
});`;
      
      const result = validateCodeConnect({
        generatedCode: badCode,
        figmaEvidence: { componentProperties: [{ name: 'Disabled', type: 'BOOLEAN' }], variantProperties: {}, textLayers: [], slotLayers: [] }
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Logical operator'))).toBe(true);
    });

    it('catches prefix unary operators in template interpolation', () => {
      const badCode = `
import figma, { html } from '@figma/code-connect/html';
figma.connect('url', {
  props: { disabled: figma.boolean('Disabled') },
  example: ({ disabled }) => html\`<button [disabled]="\${!disabled}"></button>\`
});`;

      const result = validateCodeConnect({
        generatedCode: badCode,
        figmaEvidence: { componentProperties: [{ name: 'Disabled', type: 'BOOLEAN' }], variantProperties: {}, textLayers: [], slotLayers: [] }
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Prefix unary operator'))).toBe(true);
    });

    it('catches ternary expressions in JSX props (React)', () => {
      const badCode = `
import figma from '@figma/code-connect/react';
import { Button } from './Button';
figma.connect(Button, 'url', {
  props: { hasIcon: figma.boolean('Icon') },
  example: ({ hasIcon }) => <Button icon={hasIcon ? 'star' : undefined} />
});`;
      
      const result = validateCodeConnect({
        generatedCode: badCode,
        figmaEvidence: { componentProperties: [{ name: 'Icon', type: 'BOOLEAN' }], variantProperties: {}, textLayers: [], slotLayers: [] }
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Ternary expression in JSX'))).toBe(true);
    });

    it('catches logical operators in JSX props (React)', () => {
      const badCode = `
import figma from '@figma/code-connect/react';
import { Button } from './Button';
figma.connect(Button, 'url', {
  props: { label: figma.string('Label') },
  example: ({ label }) => <Button label={label || 'Default'} />
});`;
      
      const result = validateCodeConnect({
        generatedCode: badCode,
        figmaEvidence: { componentProperties: [{ name: 'Label', type: 'TEXT' }], variantProperties: {}, textLayers: [], slotLayers: [] }
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Logical operator in JSX'))).toBe(true);
    });

    it('catches logical operators in JSX conditional rendering (React)', () => {
      const badCode = `
import figma from '@figma/code-connect/react';
import { Tooltip, TooltipArrowTip } from './Tooltip';
figma.connect(Tooltip, 'url', {
  props: { showArrow: figma.boolean('ShowArrow') },
  example: ({ showArrow }) => (
    <Tooltip>
      {showArrow && <TooltipArrowTip />}
      Content
    </Tooltip>
  )
});`;
      
      const result = validateCodeConnect({
        generatedCode: badCode,
        figmaEvidence: { componentProperties: [{ name: 'ShowArrow', type: 'BOOLEAN' }], variantProperties: {}, textLayers: [], slotLayers: [] }
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Logical operator in JSX'))).toBe(true);
    });

    it('catches comparison operators in template interpolation', () => {
      const badCode = `
import figma, { html } from '@figma/code-connect/html';
figma.connect('url', {
  props: { state: figma.enum('State', { Disabled: 'disabled' }) },
  example: ({ state }) => html\`<input [disabled]="\${state === 'disabled'}"/>\`
});`;
      
      const result = validateCodeConnect({
        generatedCode: badCode,
        figmaEvidence: { variantProperties: { State: ['Disabled', 'Default'] }, componentProperties: [], textLayers: [], slotLayers: [] }
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Comparison operator'))).toBe(true);
    });

    it('catches function body with statements before return', () => {
      const badCode = `
import figma, { html } from '@figma/code-connect/html';
figma.connect('url', {
  props: { icon: figma.string('Icon') },
  example: ({ icon }) => {
    const hasIcon = icon !== undefined;
    return html\`<button>\${icon}</button>\`;
  }
});`;
      
      const result = validateCodeConnect({
        generatedCode: badCode,
        figmaEvidence: { componentProperties: [{ name: 'Icon', type: 'TEXT' }], variantProperties: {}, textLayers: [], slotLayers: [] }
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Example function has a body'))).toBe(true);
    });

    it('catches bare ternary expressions in JSX (not wrapped in braces)', () => {
      const badCode = `
import figma from '@figma/code-connect/react';
import { Modal } from './Modal';
figma.connect(Modal, 'https://figma.com/file/abc?node-id=1-2', {
  props: { footer: figma.children('.footer?') },
  example: ({ footer }) => (
    <Modal>
      <ModalBody>Content</ModalBody>
      footer ? <ModalFooter>{footer}</ModalFooter> : null
    </Modal>
  )
});`;
      
      const result = validateCodeConnect({
        generatedCode: badCode,
        figmaEvidence: { variantProperties: {}, componentProperties: [], textLayers: [], slotLayers: [{ name: '.footer?' }] }
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Ternary expression in JSX'))).toBe(true);
    });

    it('catches bare logical operators in JSX (not wrapped in braces)', () => {
      const badCode = `
import figma from '@figma/code-connect/react';
import { EmptyState } from './EmptyState';
figma.connect(EmptyState, 'https://figma.com/file/abc?node-id=1-2', {
  props: { iconStart: figma.instance('.iconStart?') },
  example: ({ iconStart }) => (
    <EmptyState>
      iconStart && <Icon>{iconStart}</Icon>
      <EmptyStateTitle>Empty</EmptyStateTitle>
    </EmptyState>
  )
});`;
      
      const result = validateCodeConnect({
        generatedCode: badCode,
        figmaEvidence: { variantProperties: {}, componentProperties: [{ name: '.iconStart?', type: 'INSTANCE_SWAP' }], textLayers: [], slotLayers: [] }
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Logical operator in JSX'))).toBe(true);
    });
  });

  describe('validateCodeConnectWithCLI', () => {
    it('falls back to pre-check when skipCLI is true', () => {
      const goodCode = `
import figma from '@figma/code-connect/react';
import { Button } from './Button';

figma.connect(Button, 'https://figma.com/file/abc?node-id=1-2', {
  props: {
    label: figma.string('Label'),
  },
  example: ({ label }) => <Button>{label}</Button>
});`;

      const result = validateCodeConnectWithCLI({
        generatedCode: goodCode,
        figmaEvidence: { 
          variantProperties: {}, 
          componentProperties: [{ name: 'Label', type: 'TEXT' }], 
          textLayers: [], 
          slotLayers: [] 
        },
        skipCLI: true
      });

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('catches pre-check errors before CLI validation', () => {
      // Missing figma.connect call - just imports but no connection
      const badCode = `
import figma from '@figma/code-connect/react';
import { Button } from './Button';

export const Button = () => <button>Click</button>;`;

      const result = validateCodeConnectWithCLI({
        generatedCode: badCode,
        figmaEvidence: { 
          variantProperties: {}, 
          componentProperties: [], 
          textLayers: [], 
          slotLayers: [] 
        },
        skipCLI: true
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Missing figma.connect'))).toBe(true);
    });
  });
});
