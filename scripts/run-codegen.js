#!/usr/bin/env node

/**
 * Stage 3: Unified Agentic Code Connect generation (0.3.x)
 *
 * Single agentic flow per component that handles both orientation and code generation.
 * The agent uses tools (queryIndex, readFile, listFiles) to explore the codebase.
 *
 * Inputs:
 *  - Figma components index + per-component JSON (from figma-scan.js)
 *  - Repo index (from build-repo-index.js or summarize-repo.js)
 *  - Agent configuration (model, API key, max tokens)
 *
 * For each component:
 *  - Load Figma metadata
 *  - Create AgentTools instance with repo index
 *  - Call unified codegen which:
 *    - Builds tool-enabled prompts
 *    - Allows agent to explore via tools
 *    - Generates code with validation loop
 *    - Retries on validation failure
 *  - Write output and metrics
 */

const fs = require('fs-extra');
const path = require('path');
const { Command } = require('commander');
const chalk = require('chalk');
const { ClaudeAgentAdapter } = require('../src/agent/agent-adapter');
const { processAllComponents } = require('../src/agent/unified-codegen');
const { figmaColor, codeColor, generatedColor, highlight } = require('./colors');

const DEFAULT_CODECONNECT_DIR = 'codeConnect';

/**
 * Sanitize component name to valid filename
 */
const sanitizeSlug = (value, fallback = 'component') => {
  const base = (value || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return base || fallback;
};

/**
 * Match component name/ID against filters
 */
const matchesFilter = (component, filters) => {
  if (!filters || filters.length === 0) return true;
  const name = component.name || '';
  const id = component.id || '';
  return filters.some(filter => {
    const pattern = filter.replace(/\*/g, '.*');
    const regex = new RegExp(`^${pattern}$`, 'i');
    return regex.test(name) || regex.test(id);
  });
};

async function main() {
  const program = new Command();
  program
    .requiredOption('--figma-index <path>', 'Path to figma-components-index.json')
    .requiredOption('--repo-summary <path>', 'Path to repo-summary.json (or repo-index.json)')
    .option('--agent-model <model>', 'Agent model name')
    .option('--agent-max-tokens <n>', 'Max tokens per agent call', '4096')
    .option('--max-retries <n>', 'Max validation retries', '2')
    .option('--target-framework <framework>', 'Target framework (react|angular)')
    .option('--only <patterns>', 'Only process components matching patterns (comma-separated)')
    .option('--exclude <patterns>', 'Exclude components matching patterns (comma-separated)')
    .option('--force', 'Overwrite existing Code Connect files', false)
    .parse(process.argv);

  const args = program.opts();

  // Load Figma index
  const figmaIndex = await fs.readJson(args.figmaIndex);
  const components = figmaIndex.components || [];
  
  if (components.length === 0) {
    console.log(chalk.yellow('⚠️  No components found in Figma index'));
    return;
  }

  // Filter components
  const onlyFilters = args.only ? args.only.split(',').map(s => s.trim()) : [];
  const excludeFilters = args.exclude ? args.exclude.split(',').map(s => s.trim()) : [];
  
  let filteredComponents = components;
  if (onlyFilters.length > 0) {
    filteredComponents = filteredComponents.filter(c => matchesFilter(c, onlyFilters));
  }
  if (excludeFilters.length > 0) {
    filteredComponents = filteredComponents.filter(c => !matchesFilter(c, excludeFilters));
  }

  console.log(`${chalk.dim('•')} Processing ${filteredComponents.length} of ${components.length} components`);

  // Determine framework
  let framework = args.targetFramework;
  if (!framework) {
    const summary = await fs.readJson(args.repoSummary);
    framework = summary.primary_framework || 'react';
  }
  framework = framework.toLowerCase();
  
  if (framework !== 'react' && framework !== 'angular') {
    console.error(`❌ Unsupported framework: ${framework}`);
    process.exit(1);
  }

  console.log(`${chalk.dim('•')} Framework: ${highlight(framework)}`);

  // Get repo root and paths
  const repoSummaryPath = path.resolve(args.repoSummary);
  const repoRoot = path.dirname(path.dirname(repoSummaryPath)); // superconnect/ -> repo root
  const superconnectDir = path.dirname(repoSummaryPath);
  const figmaComponentsDir = path.join(superconnectDir, 'figma-components');
  const codeConnectDir = path.join(repoRoot, DEFAULT_CODECONNECT_DIR);
  
  fs.ensureDirSync(codeConnectDir);
  fs.ensureDirSync(path.join(superconnectDir, 'codegen-summaries'));

  // Initialize agent
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('❌ ANTHROPIC_API_KEY environment variable not set');
    process.exit(1);
  }

  const agent = new ClaudeAgentAdapter({
    apiKey,
    model: args.agentModel || 'claude-sonnet-4-20250514'
  });

  console.log(`${chalk.dim('•')} Agent: ${highlight(args.agentModel || 'claude-sonnet-4-20250514')}`);

  // Build component data for processAllComponents
  const componentData = [];
  
  for (const comp of filteredComponents) {
    const slug = sanitizeSlug(comp.name);
    const componentJsonPath = path.join(figmaComponentsDir, `${slug}.json`);
    
    let figmaEvidence = null;
    if (fs.existsSync(componentJsonPath)) {
      figmaEvidence = await fs.readJson(componentJsonPath);
    } else {
      // Minimal fallback if component JSON doesn't exist
      figmaEvidence = {
        id: comp.id,
        componentName: comp.name,
        variantProperties: {},
        componentProperties: [],
        textLayers: [],
        slotLayers: []
      };
    }

    componentData.push({
      figmaEvidence,
      figmaUrl: `https://figma.com/file/${figmaIndex.fileKey}?node-id=${comp.id}`
    });
  }

  // Use repo index if it exists, otherwise use repo summary
  let indexPath = args.repoSummary.replace('repo-summary.json', 'repo-index.json');
  if (!fs.existsSync(indexPath)) {
    console.log(chalk.yellow(`⚠️  repo-index.json not found, using repo-summary.json as fallback`));
    console.log(chalk.dim(`   Agent tools will have limited effectiveness`));
    indexPath = args.repoSummary;
  }

  // Process all components
  console.log(`\n${highlight('Starting unified codegen...')}\n`);
  
  const maxRetries = parseInt(args.maxRetries, 10);
  const maxTokens = parseInt(args.agentMaxTokens, 10);

  const results = await processAllComponents({
    agent,
    repoRoot,
    indexPath,
    components: componentData,
    framework,
    maxRetries,
    maxTokens,
    logDir: superconnectDir,
    onProgress: ({ phase, componentIndex, componentName, total, errors, toolMetrics }) => {
      if (phase === 'processing') {
        console.log(`${chalk.dim(`[${componentIndex + 1}/${total}]`)} Processing ${generatedColor(componentName)}...`);
      } else if (phase === 'completed') {
        console.log(`${chalk.green('✓')} ${componentName} (${toolMetrics.filesRead || 0} files read, ${toolMetrics.queries || 0} queries)`);
      } else if (phase === 'failed') {
        console.log(`${chalk.red('✗')} ${componentName} - ${errors.join('; ')}`);
      }
    }
  });

  // Write outputs
  console.log(`\n${highlight('Writing outputs...')}\n`);
  
  let successCount = 0;
  let failureCount = 0;

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const component = filteredComponents[i];
    const slug = sanitizeSlug(component.name);
    const extension = framework === 'react' ? '.figma.tsx' : '.figma.ts';
    const outputPath = path.join(codeConnectDir, `${slug}${extension}`);
    const summaryPath = path.join(superconnectDir, 'codegen-summaries', `${slug}-codegen-summary.json`);

    // Check if file exists and --force not set
    if (!args.force && fs.existsSync(outputPath)) {
      console.log(`${chalk.dim('•')} Skipping ${codeColor(path.relative(repoRoot, outputPath))} (already exists, use --force to overwrite)`);
      continue;
    }

    if (result.success && result.code) {
      await fs.writeFile(outputPath, result.code, 'utf8');
      console.log(`${chalk.green('✓')} Wrote ${generatedColor(path.relative(repoRoot, outputPath))}`);
      successCount++;
      
      // Write summary
      await fs.writeJson(summaryPath, {
        componentId: component.id,
        componentName: component.name,
        status: 'success',
        attempts: result.attempts.length,
        outputPath: path.relative(repoRoot, outputPath),
        toolMetrics: result.toolMetrics
      }, { spaces: 2 });
    } else {
      failureCount++;
      console.log(`${chalk.red('✗')} Failed to generate ${component.name}: ${result.errors.join('; ')}`);
      
      // Write failure summary
      await fs.writeJson(summaryPath, {
        componentId: component.id,
        componentName: component.name,
        status: 'failure',
        attempts: result.attempts.length,
        errors: result.errors,
        toolMetrics: result.toolMetrics
      }, { spaces: 2 });
    }
  }

  console.log(`\n${chalk.green('✓')} Codegen complete: ${successCount} succeeded, ${failureCount} failed`);
  
  if (failureCount > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error(`\n❌ Codegen failed: ${err.message}`);
  if (process.env.SUPERCONNECT_E2E_VERBOSE === '1') {
    console.error(`\nStack trace:\n${err.stack}`);
  }
  process.exit(1);
});
