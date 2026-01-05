const fs = require('fs-extra');
const path = require('path');
const { execFileSync } = require('child_process');

const pipelineScript = path.join(__dirname, '..', 'scripts', 'run-pipeline.js');

const runPipelineDry = (target) => {
  const superconnectDir = path.join(target, 'superconnect');
  fs.ensureDirSync(superconnectDir);
  const result = execFileSync('node', [pipelineScript, '--target', target, '--dry-run'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    cwd: target
  });
  return result;
};

const readPayload = (target) => {
  // 0.3.x: No orienter-agent.log (unified codegen)
  const payloadPath = path.join(target, 'superconnect', 'orienter-agent.log', 'payload.txt');
  if (!fs.existsSync(payloadPath)) {
    return ''; // Skip test if 0.3.x (no orienter)
  }
  return fs.readFileSync(payloadPath, 'utf8');
};

// 0.3.x: Framework plumbing tests skipped (no separate orienter stage)
describe.skip('framework plumbing through pipeline', () => {
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
