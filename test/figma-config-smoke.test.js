const fs = require('fs-extra');
const path = require('path');
const os = require('os');

describe('figma.config.json smoke', () => {
  test('includes codeConnect include/exclude and parser defaults', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'figma-config-smoke-'));
    const configPath = path.join(tmp, 'figma.config.json');
    const config = {
      schemaVersion: 1,
      codeConnect: {
        include: ['codeConnect/**/*.figma.tsx', 'packages/**/*.{ts,tsx}'],
        exclude: ['**/node_modules/**'],
        parser: 'react',
        label: 'react'
      }
    };
    fs.writeJsonSync(configPath, config, { spaces: 2 });

    const read = fs.readJsonSync(configPath);
    expect(read.codeConnect.include).toContain('codeConnect/**/*.figma.tsx');
    expect(read.codeConnect.exclude).toContain('**/node_modules/**');
    expect(read.codeConnect.parser).toBe('react');
    expect(read.codeConnect.label).toBe('react');

    fs.removeSync(tmp);
  });
});

