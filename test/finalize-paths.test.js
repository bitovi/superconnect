const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs-extra');
const path = require('path');
const { spawnSync } = require('child_process');

const finalizeScript = path.join(__dirname, '..', 'scripts', 'finalize.js');

const writeJson = (file, data) => {
  fs.ensureDirSync(path.dirname(file));
  fs.writeJsonSync(file, data, { spaces: 2 });
};

describe('finalize emits figma.config.json with package path aliases', () => {
  it('adds paths for packages/*/src/index.tsx', () => {
    const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'finalize-paths-'));

    // Minimal repo layout
    const pkgDir = path.join(tmp, 'packages', 'ui');
    fs.ensureDirSync(path.join(pkgDir, 'src'));
    fs.writeFileSync(path.join(pkgDir, 'src', 'index.tsx'), '// entry');
    writeJson(path.join(pkgDir, 'package.json'), { name: '@acme/ui', version: '0.0.0' });

    // Minimal superconnect artifacts
    const superDir = path.join(tmp, 'superconnect');
    writeJson(path.join(superDir, 'figma-components-index.json'), { fileKey: 'file', components: [] });
    fs.writeFileSync(path.join(superDir, 'orientation.jsonl'), '');
    fs.ensureDirSync(path.join(tmp, 'codeConnect'));

    const result = spawnSync('node', [finalizeScript, '--cwd', tmp], {
      encoding: 'utf8'
    });
    if (result.status !== 0) {
      throw new Error(result.stdout + result.stderr);
    }

    const configPath = path.join(tmp, 'figma.config.json');
    assert.ok(fs.existsSync(configPath));
    const config = fs.readJsonSync(configPath);
    assert.deepStrictEqual(config.codeConnect.paths, {
      '@acme/ui': ['packages/ui/src/index.tsx']
    });

    fs.removeSync(tmp);
  });

  it('omits paths block when no package entrypoints found', () => {
    const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'finalize-paths-'));

    // Minimal superconnect artifacts without packages
    const superDir = path.join(tmp, 'superconnect');
    writeJson(path.join(superDir, 'figma-components-index.json'), { fileKey: 'file', components: [] });
    fs.writeFileSync(path.join(superDir, 'orientation.jsonl'), '');
    fs.ensureDirSync(path.join(tmp, 'codeConnect'));

    const result = spawnSync('node', [finalizeScript, '--cwd', tmp], {
      encoding: 'utf8'
    });
    if (result.status !== 0) {
      throw new Error(result.stdout + result.stderr);
    }

    const configPath = path.join(tmp, 'figma.config.json');
    const config = fs.readJsonSync(configPath);
    assert.strictEqual(config.codeConnect.paths, undefined);

    fs.removeSync(tmp);
  });
});

