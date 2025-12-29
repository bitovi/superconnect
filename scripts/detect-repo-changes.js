const fs = require('fs-extra');
const path = require('path');
const fg = require('fast-glob');
const { summarizeComponentRoots } = require('./summarize-repo.js');

/**
 * Build metadata map of all component files (path -> {mtime, size})
 */
async function buildFileMetadata(targetPath, componentRoots) {
  
  const metadata = {};
  
  for (const root of componentRoots) {
    const componentPath = path.join(targetPath, root.path);
    const files = await fg(['**/*.{ts,tsx}'], {
      cwd: componentPath,
      ignore: ['**/node_modules/**', '**/*.d.ts'],
      absolute: true
    });
    
    for (const file of files) {
      try {
        const stats = fs.statSync(file);
        const relFile = path.relative(targetPath, file);
        metadata[relFile] = {
          mtime: stats.mtimeMs,
          size: stats.size
        };
      } catch {
        // Skip files that can't be accessed
      }
    }
  }
  
  return metadata;
}

/**
 * Save file metadata to disk
 */
async function saveFileMetadata(metadataPath, metadata) {
  await fs.ensureDir(path.dirname(metadataPath));
  await fs.writeJson(metadataPath, metadata, { spaces: 2 });
}

/**
 * Load file metadata from disk
 */
async function loadFileMetadata(metadataPath) {
  try {
    if (await fs.pathExists(metadataPath)) {
      return await fs.readJson(metadataPath);
    }
  } catch {
    // Return empty if can't load
  }
  return {};
}

/**
 * Detect if repository components have changed since last summary generation.
 * 
 * Performs multiple checks:
 * 1. Component root count (added/removed directories)
 * 2. Component paths (renamed/moved directories)
 * 3. File counts within component roots
 * 4. File modifications (compares stored metadata: mtime and size)
 * 
 * @param {object} options
 * @param {string} options.targetPath - Root path of the target repository
 * @param {string} options.summaryPath - Path to repo-summary.json
 * @param {string} options.superconnectDir - Path to superconnect directory
 * @param {object} options.chalk - Chalk instance for colored output
 * @returns {Promise<{ changed: boolean, reason: string | null }>}
 */
async function detectRepoChanges({ targetPath, summaryPath, superconnectDir, chalk }) {
  const metadataPath = path.join(superconnectDir, 'component-metadata.json');

  try {
    if (!fs.existsSync(summaryPath)) {
      return { changed: true, reason: 'Summary file does not exist' };
    }

    const previousSummary = fs.readJsonSync(summaryPath);
    const previousRoots = previousSummary?.components?.roots || [];
    const previousRootCount = previousRoots.length;
    
    // Get current component roots
    const currentRoots = await summarizeComponentRoots(targetPath);
    const currentRootCount = currentRoots.length;
    
    // Check 1: Number of component roots changed
    if (currentRootCount !== previousRootCount) {
      console.log(`${chalk.yellow('⚠️  Component structure changed:')} ${previousRootCount} → ${currentRootCount} component roots`);
      console.log(`${chalk.dim('   Re-generating repo summary...')}`);
      return { changed: true, reason: `Component root count changed: ${previousRootCount} → ${currentRootCount}` };
    }
    
    // Check 2: Component root paths changed (renamed/moved directories)
    const previousPaths = new Set(previousRoots.map(r => r.path));
    const currentPaths = new Set(currentRoots.map(r => r.path));
    const pathsMatch = previousPaths.size === currentPaths.size &&
      [...previousPaths].every(p => currentPaths.has(p));
    
    if (!pathsMatch) {
      console.log(`${chalk.yellow('⚠️  Component directories moved or renamed')}`);
      console.log(`${chalk.dim('   Re-generating repo summary...')}`);
      return { changed: true, reason: 'Component directories moved or renamed' };
    }
    
    // Check 3: File counts within component roots changed
    const previousCountMap = new Map(previousRoots.map(r => [r.path, r.tsxCount]));
    for (const root of currentRoots) {
      const prevCount = previousCountMap.get(root.path);
      if (prevCount !== undefined && prevCount !== root.tsxCount) {
        console.log(`${chalk.yellow('⚠️  File count changed in')} ${root.path}: ${prevCount} → ${root.tsxCount}`);
        console.log(`${chalk.dim('   Re-generating repo summary...')}`);
        return { changed: true, reason: `File count changed in ${root.path}: ${prevCount} → ${root.tsxCount}` };
      }
    }
    
    // Check 4: Any component file modified since last summary generation
    const previousMetadata = await loadFileMetadata(metadataPath);
    const currentMetadata = await buildFileMetadata(targetPath, currentRoots);
    
    // Check for new, deleted, or modified files
    const allFiles = new Set([...Object.keys(previousMetadata), ...Object.keys(currentMetadata)]);
    
    for (const file of allFiles) {
      const prev = previousMetadata[file];
      const curr = currentMetadata[file];
      
      // File was added
      if (!prev && curr) {
        console.log(`${chalk.yellow('⚠️  Component file added:')} ${file}`);
        console.log(`${chalk.dim('   Re-generating repo summary...')}`);
        return { changed: true, reason: `Component file added: ${file}`, currentMetadata };
      }
      
      // File was deleted
      if (prev && !curr) {
        console.log(`${chalk.yellow('⚠️  Component file deleted:')} ${file}`);
        console.log(`${chalk.dim('   Re-generating repo summary...')}`);
        return { changed: true, reason: `Component file deleted: ${file}`, currentMetadata };
      }
      
      // File was modified (mtime or size changed)
      if (prev && curr && (prev.mtime !== curr.mtime || prev.size !== curr.size)) {
        console.log(`${chalk.yellow('⚠️  Component file modified:')} ${file}`);
        console.log(`${chalk.dim('   Re-generating repo summary...')}`);
        return { changed: true, reason: `Component file modified: ${file}`, currentMetadata };
      }
    }
    
    return { changed: false, reason: null, currentMetadata };
  } catch (err) {
    console.warn(`${chalk.yellow('⚠️  Could not check for component changes:')} ${err.message}`);
    console.log(`${chalk.dim('   Continuing with existing repo summary...')}`);
    return { changed: false, reason: null, currentMetadata: null };
  }
}

module.exports = { detectRepoChanges, saveFileMetadata };
