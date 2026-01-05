#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const projectRoot = process.cwd();
const mappingPath = path.join(projectRoot, 'codeConnect/mapping.json');
const evidencePath = path.join(projectRoot, 'codeConnect/.figma-evidence');
const outputDir = path.join(projectRoot, 'codeConnect');
const figmaFileUrl = 'https://www.figma.com/design/ChohwrZwvllBgHWzBslmUg/Zap-UI-Kit--Bitovi---Copy-';

const mapping = JSON.parse(fs.readFileSync(mappingPath, 'utf8'));

mapping.components.forEach(component => {
  const evidenceFile = path.join(evidencePath, `${component.normalizedName}.json`);
  if (!fs.existsSync(evidenceFile)) {
    console.log(`Warning: No evidence file for ${component.normalizedName}`);
    return;
  }

  const evidence = JSON.parse(fs.readFileSync(evidenceFile, 'utf8'));
  
  // Generate props mapping
  const propsMapping = [];
  
  // Add variant properties as enums
  if (evidence.variantProperties && Object.keys(evidence.variantProperties).length > 0) {
    Object.entries(evidence.variantProperties).forEach(([name, values]) => {
      const propKey = name.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
      const enumMapping = values.map(v => `      '${v}': '${v.toLowerCase()}'`).join(',\n');
      propsMapping.push(`    ${propKey}: figma.enum('${name}', {\n${enumMapping}\n    })`);
    });
  }
  
  // Add component properties
  if (evidence.componentProperties && evidence.componentProperties.length > 0) {
    evidence.componentProperties.forEach(prop => {
      const propKey = prop.name.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
      if (prop.type === 'TEXT') {
        propsMapping.push(`    ${propKey}: figma.string('${prop.name}')`);
      } else if (prop.type === 'BOOLEAN') {
        propsMapping.push(`    ${propKey}: figma.boolean('${prop.name}')`);
      } else if (prop.type === 'INSTANCE_SWAP') {
        propsMapping.push(`    ${propKey}: figma.instance('${prop.name}')`);
      }
    });
  }
  
  // Add text layers
  if (evidence.textLayers && evidence.textLayers.length > 0) {
    evidence.textLayers.forEach(layer => {
      const propKey = layer.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
      propsMapping.push(`    ${propKey}: figma.textContent('${layer}')`);
    });
  }
  
  // Generate example props usage
  const exampleProps = [];
  if (evidence.variantProperties && Object.keys(evidence.variantProperties).length > 0) {
    Object.keys(evidence.variantProperties).forEach(name => {
      const propKey = name.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
      exampleProps.push(`  ${propKey}="\${props.${propKey}}"`);
    });
  }
  
  if (evidence.componentProperties && evidence.componentProperties.length > 0) {
    evidence.componentProperties.forEach(prop => {
      const propKey = prop.name.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
      if (prop.type === 'BOOLEAN') {
        exampleProps.push(`  ${propKey}=\${props.${propKey}}`);
      } else {
        exampleProps.push(`  ${propKey}="\${props.${propKey}}"`);
      }
    });
  }
  
  // Generate the Code Connect file
  const codeConnect = `import figma, { html } from '@figma/code-connect/html';

figma.connect('${figmaFileUrl}', {
  props: {
${propsMapping.join(',\n')}
  },
  example: (props) =>
    html\`
<${component.selector}
${exampleProps.join('\n')}
>
</${component.selector}>\`,
  imports: ["import { ${component.componentName} } from '@zap/${component.normalizedName}'"],
});
`;

  const outputFile = path.join(outputDir, `${component.normalizedName}.figma.ts`);
  fs.writeFileSync(outputFile, codeConnect);
  console.log(`Generated: ${component.normalizedName}.figma.ts`);
});

console.log('\nCode Connect files generated successfully!');
