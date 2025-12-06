const fs = require('fs-extra');
const path = require('path');
const { execFileSync } = require('child_process');

const pipelineScript = path.join(__dirname, '..', 'scripts', 'run-pipeline.js');

const runPipelineDry = (target) => {
  const superconnectDir = path.join(target, 'superconnect');
  fs.removeSync(path.join(superconnectDir, 'repo-summary.json'));
  fs.removeSync(path.join(superconnectDir, 'orientation.jsonl'));
  fs.removeSync(path.join(superconnectDir, 'codegen-logs'));
  fs.removeSync(path.join(superconnectDir, 'mapping-agent-logs'));
  const result = execFileSync('node', [pipelineScript, '--target', target, '--dry-run'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  return result;
};

const readPayload = (target) => {
  const payloadPath = path.join(target, 'superconnect', 'orienter-agent.log', 'payload.txt');
  return fs.readFileSync(payloadPath, 'utf8');
};

describe('framework plumbing through pipeline', () => {
  test('react fixture threads target framework to orienter and summary', () => {
    const target = path.join(__dirname, '..', 'fixtures', 'react-sample');
    const output = runPipelineDry(target);
    const payload = readPayload(target);
    expect(payload).toContain('"react"');
    expect(output.toLowerCase()).toContain('target framework');
    expect(output.toLowerCase()).toContain('react');
  });

  test('angular fixture threads target framework to orienter and summary', () => {
    const target = path.join(__dirname, '..', 'fixtures', 'angular-sample');
    const output = runPipelineDry(target);
    const payload = readPayload(target);
    expect(payload).toContain('"angular"');
    expect(output.toLowerCase()).toContain('target framework');
    expect(output.toLowerCase()).toContain('angular');
  });
});
