import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { spawnSync, execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const finalizeScript = path.join(__dirname, '..', 'scripts', 'finalize.ts');

const writeJson = (file: string, data: any): void => {
  fs.ensureDirSync(path.dirname(file));
  fs.writeJsonSync(file, data, { spaces: 2 });
};

describe('finalize.js', () => {
  describe('package path aliases', () => {
    it('adds paths for packages/*/src/index.tsx', () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'finalize-paths-'));

      // Minimal repo layout
      const pkgDir = path.join(tmp, 'packages', 'ui');
      fs.ensureDirSync(path.join(pkgDir, 'src'));
      fs.writeFileSync(path.join(pkgDir, 'src', 'index.tsx'), '// entry');
      writeJson(path.join(pkgDir, 'package.json'), { name: '@acme/ui', version: '0.0.0' });

      // Minimal superconnect-logs artifacts
      const superDir = path.join(tmp, 'superconnect-logs');
      writeJson(path.join(superDir, 'figma-components-index.json'), { fileKey: 'file', components: [] });
      fs.writeFileSync(path.join(superDir, 'orientation.jsonl'), '');
      fs.ensureDirSync(path.join(tmp, 'codeConnect'));

      const result = spawnSync(process.execPath, ['--experimental-strip-types', finalizeScript, '--cwd', tmp], {
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
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'finalize-paths-'));

      // Minimal superconnect-logs artifacts without packages
      const superDir = path.join(tmp, 'superconnect-logs');
      writeJson(path.join(superDir, 'figma-components-index.json'), { fileKey: 'file', components: [] });
      fs.writeFileSync(path.join(superDir, 'orientation.jsonl'), '');
      fs.ensureDirSync(path.join(tmp, 'codeConnect'));

      const result = spawnSync(process.execPath, ['--experimental-strip-types', finalizeScript, '--cwd', tmp], {
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

  describe('Angular config', () => {
    const fixtureDir = path.join(__dirname, '..', 'fixtures', 'angular-sample');

    const runFinalize = () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'finalize-angular-'));
      fs.copySync(fixtureDir, tmpDir, {
        dereference: true,
        filter: (src) => !src.endsWith(`${path.sep}repo-summary.json`)
      });
      const repoSummarySrc = path.join(fixtureDir, 'superconnect-logs', 'repo-summary.json');
      const repoSummaryDest = path.join(tmpDir, 'superconnect-logs', 'repo-summary.json');
      if (fs.existsSync(repoSummarySrc)) {
        fs.ensureDirSync(path.dirname(repoSummaryDest));
        fs.writeFileSync(repoSummaryDest, fs.readFileSync(repoSummarySrc));
      }
      execFileSync('node', ['--experimental-strip-types', finalizeScript, '--cwd', tmpDir, '--target-framework', 'angular'], {
        cwd: tmpDir,
        stdio: 'ignore'
      });
      const configPath = path.join(tmpDir, 'figma.config.json');
      const config = fs.readJsonSync(configPath);
      fs.removeSync(tmpDir);
      return config;
    };

    it('sets html parser and angular include glob', () => {
      const config = runFinalize();
      assert.strictEqual(config.codeConnect.parser, 'html');
      assert.ok(config.codeConnect.include.includes('codeConnect/**/*.figma.ts'));
    });
  });
});
