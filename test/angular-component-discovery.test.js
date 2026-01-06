const fs = require('fs-extra');
const path = require('path');
const { execFileSync } = require('child_process');

const buildIndexScript = path.join(__dirname, '..', 'scripts', 'build-repo-index.js');

// This test is obsolete - angular_components was removed from build-repo-index output
// during 0.3.x cleanup. Angular components are now discovered dynamically during codegen.
describe.skip('angular component discovery', () => {
  test('obsolete - angular_components removed from repo index', () => {});
});
