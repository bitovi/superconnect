#!/usr/bin/env node

/**
 * Integration spike: Run a single component through the agentic flow
 * 
 * This script tests the full end-to-end flow:
 * 1. Load Figma component data
 * 2. Load repo index
 * 3. Process component with agent tools
 * 4. Validate generated code
 * 5. Write output
 */

const path = require('path');
const fs = require('fs');
const { processComponentWithTools } = require('../src/agent/unified-codegen');
const { ClaudeAgentAdapter } = require('../src/agent/agent-adapter');
const { AgentTools } = require('../src/agent/agent-tools');

async function main() {
  const fixtureDir = path.join(__dirname, '../fixtures/react-sample');
  const superconnectDir = path.join(fixtureDir, 'superconnect');
  
  console.log('🧪 Integration Spike: Processing FixtureComponent through agentic flow\n');
  
  // 1. Load Figma component data
  console.log('📦 Loading Figma component metadata...');
  const figmaIndex = JSON.parse(
    fs.readFileSync(path.join(superconnectDir, 'figma-components-index.json'), 'utf8')
  );
  const component = figmaIndex.components[0];
  console.log(`   Component: ${component.name} (${component.id})`);
  
  // 2. Load orientation data
  console.log('\n🧭 Loading orientation data...');
  const orientationPath = path.join(superconnectDir, 'orientation.jsonl');
  const orientationData = fs.readFileSync(orientationPath, 'utf8')
    .trim()
    .split('\n')
    .map(line => JSON.parse(line))
    .find(o => o.figma_component_id === component.id);
  
  if (!orientationData) {
    throw new Error(`No orientation data found for ${component.id}`);
  }
  console.log(`   Status: ${orientationData.status}`);
  console.log(`   Files: ${orientationData.files.join(', ')}`);
  
  // 3. Load repo index
  console.log('\n📚 Loading repo index...');
  const repoIndexPath = path.join(superconnectDir, 'repo-index.json');
  const repoIndex = JSON.parse(fs.readFileSync(repoIndexPath, 'utf8'));
  console.log(`   Files indexed: ${repoIndex.files.length}`);
  console.log(`   Exports: ${repoIndex.exports ? Object.keys(repoIndex.exports).length : 0}`);
  
  // 4. Create Figma evidence (mock for now)
  const figmaEvidence = {
    componentName: component.name,
    figmaUrl: `https://figma.com/file/${figmaIndex.fileKey}?node-id=${component.id}`,
    componentProperties: [
      {
        name: 'label',
        type: 'TEXT',
        defaultValue: 'Click me'
      },
      {
        name: 'disabled',
        type: 'BOOLEAN',
        defaultValue: false
      }
    ],
    variantProperties: {
      'variant': ['primary', 'secondary']
    },
    textLayers: [],
    slotLayers: []
  };
  
  // 5. Create index summary
  const indexSummary = {
    fileCount: repoIndex.files.length,
    primaryPaths: ['src/components', 'src/'],
    exportCount: repoIndex.exports ? Object.keys(repoIndex.exports).length : 0
  };
  
  // 6. Initialize agent adapter and tools
  console.log('\n🤖 Initializing agent and tools...');
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY environment variable not set');
  }
  
  const agent = new ClaudeAgentAdapter({ apiKey, model: 'claude-sonnet-4-20250514' });
  const tools = new AgentTools({
    repoIndex,
    workspaceRoot: fixtureDir,
    maxFileReads: 20,
    maxFileSize: 5 * 1024 * 1024,
    maxListCalls: 10
  });
  
  console.log('   Agent model:', agent.model);
  console.log('   Tools initialized with limits');
  
  // 7. Process component
  console.log('\n⚙️  Processing component with agent tools...\n');
  console.log('=' .repeat(80));
  
  try {
    const result = await processComponentWithTools({
      agent,
      tools,
      framework: 'react',
      componentName: component.name,
      figmaEvidence,
      figmaUrl: figmaEvidence.figmaUrl,
      indexSummary,
      maxRetries: 2,
      logDir: superconnectDir,
      componentId: component.id
    });
    
    console.log('=' .repeat(80));
    
    if (result.success) {
      console.log('\n✅ Success! Generated code:\n');
      console.log(result.code);
    } else {
      console.log('\n⚠️  Failed after retries. Last code:\n');
      console.log(result.code || '(no code generated)');
      console.log('\n❌ Final errors:');
      result.errors.forEach(err => console.log(`   - ${err}`));
    }
    
    console.log('\n📊 Metrics:');
    console.log(`   Success: ${result.success}`);
    console.log(`   Attempts: ${result.attempts.length}`);
    if (result.toolMetrics) {
      console.log(`   Files read: ${result.toolMetrics.filesRead || 0}`);
      console.log(`   Queries: ${result.toolMetrics.queries || 0}`);
      console.log(`   List calls: ${result.toolMetrics.listCalls || 0}`);
    }
    
    // Show attempt details
    console.log('\n📝 Attempt details:');
    result.attempts.forEach((attempt, i) => {
      console.log(`   Attempt ${attempt.attempt}:`);
      console.log(`     Valid: ${attempt.valid}`);
      if (attempt.errors.length > 0) {
        console.log(`     Errors: ${attempt.errors.join('; ')}`);
      }
      if (attempt.toolCalls) {
        console.log(`     Tool calls: ${attempt.toolCalls.length}`);
      }
    });
    
    // 8. Write output if we have code
    if (result.code) {
      const outputPath = path.join(superconnectDir, 'spike-output.figma.tsx');
      fs.writeFileSync(outputPath, result.code, 'utf8');
      console.log(`\n💾 Output written to: ${outputPath}`);
    }
    
    console.log('\n🎉 Integration spike complete!');
    
    if (!result.success) {
      console.log('\n⚠️  Note: Component did not validate successfully');
      process.exit(1);
    }
    
  } catch (error) {
    console.log('=' .repeat(80));
    console.error('\n❌ Error processing component:', error.message);
    console.error('\nStack trace:');
    console.error(error.stack);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = { main };
