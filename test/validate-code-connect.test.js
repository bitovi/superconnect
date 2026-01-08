const {
  validateCodeConnect,
  validateCodeConnectWithCLI,
  extractFigmaCalls,
  buildValidKeySets,
  normalizeKey
} = require('../src/util/validate-code-connect');
const { validateWithFigmaCLI } = require('../src/util/validate-with-figma-cli');

describe('validate-code-connect', () => {
  const basicEvidence = {
    variantProperties: {},
    componentProperties: [],
    textLayers: [],
    slotLayers: []
  };

  describe('normalizeKey', () => {
    it('normalizes Figma keys (strips dots, question marks, lowercases)', () => {
      expect(normalizeKey('.iconStart')).toBe('iconstart');
      expect(normalizeKey('iconStart?')).toBe('iconstart');
      expect(normalizeKey('.iconStart?')).toBe('iconstart');
      expect(normalizeKey('ColorPalette')).toBe('colorpalette');
    });
  });

  describe('extractFigmaCalls', () => {
    it('extracts figma helper calls from code', () => {
      const code = `
figma.connect(Button, 'url', {
  props: {
    label: figma.string('Label'),
    disabled: figma.boolean('Disabled'),
    size: figma.enum('Size', { Small: 'sm' }),
    icon: figma.instance('Icon'),
    buttonText: figma.textContent('Label'),
    content: figma.children('Content')
  }
});`;
      const calls = extractFigmaCalls(code);
      expect(calls).toHaveLength(6);
      expect(calls.map(c => c.helper)).toEqual(['string', 'boolean', 'enum', 'instance', 'textContent', 'children']);
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

  describe('validateCodeConnect - core validation', () => {
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
      variantProperties: { Size: ['Small', 'Medium'] },
      componentProperties: [{ name: 'label', type: 'TEXT' }],
      textLayers: [],
      slotLayers: []
    };

    it('returns valid for correct code', () => {
      const result = validateCodeConnect({ generatedCode: validCode, figmaEvidence: evidence });
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('catches invalid property key', () => {
      const badCode = validCode.replace("figma.string('label')", "figma.string('nonexistent')");
      const result = validateCodeConnect({ generatedCode: badCode, figmaEvidence: evidence });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('nonexistent'))).toBe(true);
    });

    it('catches invalid enum key', () => {
      const badCode = validCode.replace("figma.enum('Size'", "figma.enum('InvalidAxis'");
      const result = validateCodeConnect({ generatedCode: badCode, figmaEvidence: evidence });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('InvalidAxis'))).toBe(true);
    });

    it('catches missing figma.connect', () => {
      const badCode = `import figma from '@figma/code-connect/react';`;
      const result = validateCodeConnect({ generatedCode: badCode, figmaEvidence: evidence });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('figma.connect'))).toBe(true);
    });

    it('catches missing import', () => {
      const badCode = `figma.connect(Button, 'url', {});`;
      const result = validateCodeConnect({ generatedCode: badCode, figmaEvidence: evidence });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('import'))).toBe(true);
    });

    it('validates textContent against textLayers', () => {
      const code = `
import figma from '@figma/code-connect/react';
figma.connect(Button, 'url', {
  props: { text: figma.textContent('Label') },
  example: () => null
});`;
      const evidenceWithTextLayer = {
        ...evidence,
        textLayers: [{ name: 'Label', type: 'TEXT' }]
      };
      
      const result = validateCodeConnect({ generatedCode: code, figmaEvidence: evidenceWithTextLayer });
      expect(result.valid).toBe(true);
    });

    it('catches invalid textContent layer name', () => {
      const code = `
import figma from '@figma/code-connect/react';
figma.connect(Button, 'url', {
  props: { text: figma.textContent('NonexistentLayer') },
  example: () => null
});`;
      
      const result = validateCodeConnect({ generatedCode: code, figmaEvidence: evidence });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('NonexistentLayer'))).toBe(true);
    });
  });

  describe('validateCodeConnect - forbidden expressions', () => {
    const angularEvidence = {
      componentProperties: [{ name: 'Label', type: 'TEXT' }, { name: 'Disabled', type: 'BOOLEAN' }],
      variantProperties: { State: ['Disabled', 'Default'] },
      textLayers: [],
      slotLayers: []
    };

    const reactEvidence = {
      componentProperties: [{ name: 'Label', type: 'TEXT' }, { name: 'Icon', type: 'BOOLEAN' }],
      variantProperties: {},
      textLayers: [],
      slotLayers: []
    };

    it.each([
      [
        'ternary in Angular template',
        `import figma, { html } from '@figma/code-connect/html';
figma.connect('url', {
  props: { hasIcon: figma.boolean('Icon') },
  example: ({ hasIcon }) => html\`<button \${hasIcon ? 'icon="star"' : ''}></button>\`
});`,
        { componentProperties: [{ name: 'Icon', type: 'BOOLEAN' }], variantProperties: {}, textLayers: [], slotLayers: [] },
        'Ternary expression'
      ],
      [
        'logical operator in Angular template',
        `import figma, { html } from '@figma/code-connect/html';
figma.connect('url', {
  props: { disabled: figma.boolean('Disabled') },
  example: ({ disabled }) => html\`<button \${disabled && 'disabled'}></button>\`
});`,
        angularEvidence,
        'Logical operator'
      ],
      [
        'prefix unary operator in Angular template',
        `import figma, { html } from '@figma/code-connect/html';
figma.connect('url', {
  props: { disabled: figma.boolean('Disabled') },
  example: ({ disabled }) => html\`<button [disabled]="\${!disabled}"></button>\`
});`,
        angularEvidence,
        'Prefix unary operator'
      ],
      [
        'comparison operator in Angular template',
        `import figma, { html } from '@figma/code-connect/html';
figma.connect('url', {
  props: { state: figma.enum('State', { Disabled: 'disabled' }) },
  example: ({ state }) => html\`<input [disabled]="\${state === 'disabled'}"/>\`
});`,
        angularEvidence,
        'Comparison operator'
      ],
      [
        'ternary in React JSX props',
        `import figma from '@figma/code-connect/react';
import { Button } from './Button';
figma.connect(Button, 'url', {
  props: { hasIcon: figma.boolean('Icon') },
  example: ({ hasIcon }) => <Button icon={hasIcon ? 'star' : undefined} />
});`,
        reactEvidence,
        'Ternary expression in JSX'
      ],
      [
        'logical operator in React JSX props',
        `import figma from '@figma/code-connect/react';
import { Button } from './Button';
figma.connect(Button, 'url', {
  props: { label: figma.string('Label') },
  example: ({ label }) => <Button label={label || 'Default'} />
});`,
        reactEvidence,
        'Logical operator in JSX'
      ],
      [
        'logical operator in React conditional rendering',
        `import figma from '@figma/code-connect/react';
import { Tooltip, TooltipArrowTip } from './Tooltip';
figma.connect(Tooltip, 'url', {
  props: { showArrow: figma.boolean('Icon') },
  example: ({ showArrow }) => (
    <Tooltip>
      {showArrow && <TooltipArrowTip />}
      Content
    </Tooltip>
  )
});`,
        reactEvidence,
        'Logical operator in JSX'
      ]
    ])('catches %s', (_desc, badCode, evidence, expectedError) => {
      const result = validateCodeConnect({ generatedCode: badCode, figmaEvidence: evidence });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes(expectedError))).toBe(true);
    });

    it('catches function body with statements before return', () => {
      const badCode = `
import figma, { html } from '@figma/code-connect/html';
figma.connect('url', {
  props: { icon: figma.string('Label') },
  example: ({ icon }) => {
    const hasIcon = icon !== undefined;
    return html\`<button>\${icon}</button>\`;
  }
});`;
      
      const result = validateCodeConnect({ generatedCode: badCode, figmaEvidence: angularEvidence });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Example function has a body'))).toBe(true);
    });
  });

  describe('validateCodeConnect - AST structural invariants', () => {
    it('catches non-literal URL', () => {
      const badCode = `
import figma from '@figma/code-connect/react';
const url = 'https://figma.com/file';
figma.connect(Button, url, {});`;
      
      const result = validateCodeConnect({ generatedCode: badCode, figmaEvidence: basicEvidence });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('URL must be a string literal'))).toBe(true);
    });

    it('catches non-object-literal config', () => {
      const badCode = `
import figma from '@figma/code-connect/react';
const config = { example: () => <Button /> };
figma.connect(Button, 'url', config);`;
      
      const result = validateCodeConnect({ generatedCode: badCode, figmaEvidence: basicEvidence });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Config must be an object literal'))).toBe(true);
    });

    it('catches example function with block body', () => {
      const badCode = `
import figma from '@figma/code-connect/react';
figma.connect(Button, 'url', {
  example: (props) => {
    return <Button />;
  }
});`;
      
      const result = validateCodeConnect({ generatedCode: badCode, figmaEvidence: basicEvidence });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('directly return an expression'))).toBe(true);
    });

    it('allows valid example with direct return', () => {
      const goodCode = `
import figma from '@figma/code-connect/react';
figma.connect(Button, 'url', {
  props: { label: figma.string('Label') },
  example: (props) => <Button>{props.label}</Button>
});`;
      
      const result = validateCodeConnect({
        generatedCode: goodCode,
        figmaEvidence: { componentProperties: [{ name: 'Label', type: 'TEXT' }], variantProperties: {}, textLayers: [], slotLayers: [] }
      });
      expect(result.valid).toBe(true);
    });
  });

  describe('validateCodeConnect - enum mapping validation', () => {
    const evidence = {
      variantProperties: { Size: ['Small', 'Medium', 'Large'] },
      componentProperties: [],
      textLayers: [],
      slotLayers: []
    };

    it('catches invalid enum option key', () => {
      const badCode = `
import figma from '@figma/code-connect/react';
figma.connect(Button, 'url', {
  props: {
    size: figma.enum('Size', { Small: 'sm', InvalidOption: 'invalid' })
  },
  example: ({ size }) => <Button size={size} />
});`;
      
      const result = validateCodeConnect({ generatedCode: badCode, figmaEvidence: evidence });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('InvalidOption'))).toBe(true);
    });

    it('shows available values in error message', () => {
      const badCode = `
import figma from '@figma/code-connect/react';
figma.connect(Button, 'url', {
  props: {
    size: figma.enum('Size', { Tiny: 'xs', InvalidOption: 'invalid' })
  },
  example: ({ size }) => <Button size={size} />
});`;
      
      const result = validateCodeConnect({ generatedCode: badCode, figmaEvidence: evidence });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Small'))).toBe(true);
      expect(result.errors.some(e => e.includes('Medium'))).toBe(true);
      expect(result.errors.some(e => e.includes('Large'))).toBe(true);
    });

    it('allows valid enum mappings', () => {
      const goodCode = `
import figma from '@figma/code-connect/react';
figma.connect(Button, 'url', {
  props: {
    size: figma.enum('Size', { Small: 'sm', Medium: 'md', Large: 'lg' })
  },
  example: ({ size }) => <Button size={size} />
});`;
      
      const result = validateCodeConnect({ generatedCode: goodCode, figmaEvidence: evidence });
      expect(result.valid).toBe(true);
    });

    it('allows partial enum mappings (subset of values)', () => {
      const goodCode = `
import figma from '@figma/code-connect/react';
figma.connect(Button, 'url', {
  props: {
    size: figma.enum('Size', { Small: 'sm', Medium: 'md' })
  },
  example: ({ size }) => <Button size={size} />
});`;
      
      const result = validateCodeConnect({ generatedCode: goodCode, figmaEvidence: evidence });
      expect(result.valid).toBe(true);
    });
  });

  describe('validateCodeConnectWithCLI', () => {
    it('falls back to pre-check when skipCLI is true', () => {
      const code = `
import figma from '@figma/code-connect/react';
import { Button } from './Button';
figma.connect(Button, 'https://figma.com/file', {
  props: { label: figma.string('nonexistent') },
  example: () => null
});`;
      
      const evidence = {
        variantProperties: {},
        componentProperties: [],
        textLayers: [],
        slotLayers: []
      };
      
      const result = validateCodeConnectWithCLI({
        generatedCode: code,
        figmaEvidence: evidence,
        tempCodeConnectFile: '/fake/path.figma.tsx',
        tempDir: '/fake',
        skipCLI: true
      });
      
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('nonexistent'))).toBe(true);
    });

    it('catches pre-check errors before CLI validation', () => {
      const badCode = `
import figma from '@figma/code-connect/react';
figma.connect(Button, 'url', {
  props: { label: figma.string('nonexistent') },
  example: () => null
});`;
      
      const evidence = {
        variantProperties: {},
        componentProperties: [],
        textLayers: [],
        slotLayers: []
      };
      
      const result = validateCodeConnectWithCLI({
        generatedCode: badCode,
        figmaEvidence: evidence,
        tempCodeConnectFile: '/fake/path.figma.tsx',
        tempDir: '/fake',
        skipCLI: true
      });
      
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  /**
   * Windows Regression Test: Shell out to real Figma CLI
   *
   * This test actually spawns the Figma CLI to validate Code Connect files.
   * It guards against regressions in cross-platform subprocess handling:
   *
   * - npx.cmd requires shell:true on Windows (batch files need a shell)
   * - shell:true requires command string, not args array (DEP0190)
   * - Windows may hold file locks after subprocess exits (EBUSY on cleanup)
   * - Timeout must be generous for Windows CI (package download + slow spawn)
   *
   * See commits: 3960104, e1b9646, a6285af for the fixes this guards.
   */
  describe('validateWithFigmaCLI (real CLI)', () => {
    it('successfully shells out to Figma CLI for validation', () => {
      // This valid React Code Connect file should pass CLI validation
      const validReactCode = `
import figma from '@figma/code-connect/react';
import { Button } from './Button';

figma.connect(Button, 'https://figma.com/design/abc123/file?node-id=1-2', {
  props: {
    label: figma.string('Label'),
  },
  example: ({ label }) => <Button>{label}</Button>
});
`;

      const result = validateWithFigmaCLI({
        code: validReactCode,
        parser: 'react'
      });

      // The CLI should successfully parse this file
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('detects invalid Code Connect via CLI', () => {
      // This code references a prop in example() that isn't defined in props
      // The Figma CLI validates that all props used in example() are defined
      const invalidCode = `
import figma from '@figma/code-connect/react';
import { Button } from './Button';

figma.connect(Button, 'https://figma.com/design/abc/file?node-id=1-2', {
  props: {
    label: figma.string('Label'),
  },
  example: (props) => <Button unknownProp={props.doesNotExist} />
});
`;

      const result = validateWithFigmaCLI({
        code: invalidCode,
        parser: 'react'
      });

      // The CLI should detect the undefined prop reference
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('doesNotExist');
    });
  });
});
