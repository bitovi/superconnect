#!/usr/bin/env node

/**
 * Capture git SHA for inclusion in npm package.
 * Run automatically before publishing via prepublishOnly script.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

try {
  const sha = execSync('git rev-parse --short HEAD', { 
    encoding: 'utf8', 
    stdio: ['pipe', 'pipe', 'pipe'] 
  }).trim();
  
  const shaFile = path.join(__dirname, '..', '.version-sha');
  fs.writeFileSync(shaFile, sha, 'utf8');
  console.log(`Captured version SHA: ${sha}`);
} catch (error) {
  console.warn('Warning: Could not capture git SHA (not in a git repo?)');
  process.exit(0); // Don't fail the build
}
