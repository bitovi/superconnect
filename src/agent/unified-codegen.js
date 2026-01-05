/**
 * Unified Agentic Codegen
 *
 * Collapses orientation + codegen into a single agent call per component.
 * The agent uses tools to explore the codebase and generates Code Connect directly.
 *
 * Flow:
 * 1. Agent receives Figma component data + repo index
 * 2. Agent uses queryIndex, readFile, listFiles to orient itself
 * 3. Agent generates .figma.tsx/.figma.ts file
 * 4. Validate → retry if needed → move to next
 */

const fs = require('fs-extra');
const path = require('path');
const { AgentTools, createToolDefinitions } = require('./agent-tools');
const { validateCodeConnectWithCLI } = require('../util/validate-code-connect');

const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_MAX_TOKENS = 4096;

/**
 * Build system prompt for unified agentic codegen
 * @param {string} framework - 'react' or 'angular'
 * @returns {string}
 */
function buildSystemPrompt(framework) {
  const promptsDir = path.join(__dirname, '..', '..', 'prompts');
  
  // Use new agentic prompts that include tool guidance
  const agenticPromptFile = framework === 'react' 
    ? 'react-agentic-codegen.md' 
    : 'angular-agentic-codegen.md';
  const apiDocsFile = framework === 'react'
    ? 'figma-code-connect-react.md'
    : 'figma-code-connect-html.md';

  try {
    const agenticPrompt = fs.readFileSync(path.join(promptsDir, agenticPromptFile), 'utf8');
    const apiDocs = fs.readFileSync(path.join(promptsDir, apiDocsFile), 'utf8');

    return `${agenticPrompt}\n\n---\n\n## Figma Code Connect API Reference\n\n${apiDocs}`;
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error(`Prompt file not found: ${err.path}\n  Make sure ${agenticPromptFile} exists in prompts/`);
    }
    throw new Error(`Failed to read prompt files: ${err.message}`);
  }
}

/**
 * Build user prompt for a component
 * @param {object} params
 * @param {object} params.figmaEvidence - Figma component data
 * @param {string} params.figmaUrl - Figma URL
 * @param {object} params.indexSummary - Brief summary of repo structure from index
 * @returns {string}
 */
function buildUserPrompt({ figmaEvidence, figmaUrl, indexSummary }) {
  const sections = [];

  sections.push('## Figma Component Data\n');
  sections.push('```json');
  sections.push(JSON.stringify({
    componentName: figmaEvidence.componentName,
    variantProperties: figmaEvidence.variantProperties || {},
    componentProperties: figmaEvidence.componentProperties || [],
    textLayers: figmaEvidence.textLayers || [],
    slotLayers: figmaEvidence.slotLayers || []
  }, null, 2));
  sections.push('```\n');

  sections.push(`## Figma URL\n\`${figmaUrl}\`\n`);

  if (indexSummary) {
    sections.push('## Repository Overview\n');
    sections.push(`- Total indexed files: ${indexSummary.totalFiles || 0}`);
    sections.push(`- Component files: ${indexSummary.componentCount || 0}`);
    if (indexSummary.packageRoots && indexSummary.packageRoots.length > 0) {
      sections.push(`- Package roots: ${indexSummary.packageRoots.join(', ')}`);
    }
    sections.push('');
  }

  sections.push('Use the tools to find and read the matching component file, then generate the Code Connect file.');

  return sections.join('\n');
}

/**
 * Build retry prompt after validation failure
 * @param {string} previousCode - Code that failed validation
 * @param {string[]} errors - Validation errors
 * @returns {string}
 */
function buildRetryPrompt(previousCode, errors) {
  const sections = [];

  sections.push('## Validation Errors\n');
  sections.push('Your previous output had validation errors:\n');
  errors.forEach(error => {
    sections.push(`- ${error}`);
  });
  sections.push('');

  sections.push('## Previous Code\n');
  sections.push('```tsx');
  sections.push(previousCode);
  sections.push('```\n');

  sections.push('**Fix the errors and output the corrected code.**');
  sections.push('Remember: Only use properties from the Figma Component Data.');
  sections.push('Output ONLY the corrected code, no markdown fences.');

  return sections.join('\n');
}

/**
 * Process a single component with agent tools
 * @param {object} params
 * @param {object} params.agent - Agent adapter instance with tool support
 * @param {object} params.tools - AgentTools instance for this component
 * @param {object} params.figmaEvidence - Figma component data
 * @param {string} params.figmaUrl - Figma URL
 * @param {object} params.indexSummary - Repository overview
 * @param {string} params.framework - 'react' or 'angular'
 * @param {number} params.maxRetries - Max validation retries
 * @param {number} params.maxTokens - Max tokens per call
 * @param {string} params.logDir - Directory for logs
 * @param {string} params.componentId - Component identifier for logging
 * @returns {Promise<{success: boolean, code: string|null, errors: string[], attempts: array, toolMetrics: object}>}
 */
async function processComponentWithTools({
  agent,
  tools,
  figmaEvidence,
  figmaUrl,
  indexSummary,
  framework,
  maxRetries,
  maxTokens,
  logDir,
  componentId
}) {
  const system = buildSystemPrompt(framework);
  const userPrompt = buildUserPrompt({ figmaEvidence, figmaUrl, indexSummary });

  let attempt = 0;
  let lastCode = null;
  let lastErrors = [];
  const attempts = [];

  while (attempt <= maxRetries) {
    attempt++;

    try {
      const logLabel = `${framework}-${componentId}-attempt${attempt}`;

      // On retry, append error feedback to user prompt
      const userMessage = attempt === 1
        ? userPrompt
        : `${userPrompt}\n\n---\n\n${buildRetryPrompt(lastCode, lastErrors)}`;

      // Call agent with tools
      const response = await agent.chatWithTools({
        system,
        user: userMessage,
        tools: createToolDefinitions(),
        toolHandler: async (toolName, toolInput) => {
          // Route tool calls to AgentTools instance
          switch (toolName) {
            case 'queryIndex':
              return await tools.queryIndex(toolInput);
            case 'readFile':
              return await tools.readFile(toolInput);
            case 'listFiles':
              return await tools.listFiles(toolInput);
            default:
              return { error: { message: `Unknown tool: ${toolName}` } };
          }
        },
        maxTokens,
        logLabel,
        logDir
      });

      // Extract code from response
      let code = (response.text || response).trim();
      if (code.startsWith('```')) {
        code = code.replace(/^```\w*\n?/, '').replace(/\n?```$/, '');
      }

      lastCode = code;

      // Validate
      const validationResult = validateCodeConnectWithCLI({
        generatedCode: code,
        figmaEvidence,
        framework
      });

      attempts.push({
        attempt,
        usage: response.usage || null,
        valid: validationResult.valid,
        errors: validationResult.valid ? [] : validationResult.errors,
        toolCalls: response.toolCalls || []
      });

      if (validationResult.valid) {
        const toolMetrics = tools.getMetrics();
        await tools.saveMetrics(logDir);
        return {
          success: true,
          code,
          errors: [],
          attempts,
          toolMetrics
        };
      }

      lastErrors = validationResult.errors;
    } catch (err) {
      const errorMsg = err.message || String(err);
      lastErrors = [`Agent error: ${errorMsg}`];
      attempts.push({
        attempt,
        usage: null,
        valid: false,
        errors: lastErrors
      });

      if (attempt > maxRetries) break;
    }
  }

  const toolMetrics = tools.getMetrics();
  await tools.saveMetrics(logDir);

  return {
    success: false,
    code: lastCode,
    errors: lastErrors,
    attempts,
    toolMetrics
  };
}

/**
 * Process all components using unified agentic approach
 * @param {object} params
 * @param {object} params.agent - Agent adapter with tool support
 * @param {string} params.repoRoot - Repository root path
 * @param {string} params.indexPath - Path to repo index
 * @param {Array} params.components - Components to process
 * @param {string} params.framework - 'react' or 'angular'
 * @param {number} params.maxRetries - Max retries per component
 * @param {number} params.maxTokens - Max tokens per call
 * @param {string} params.logDir - Directory for logs
 * @param {Function} params.onProgress - Progress callback
 * @returns {Promise<Array>}
 */
async function processAllComponents({
  agent,
  repoRoot,
  indexPath,
  components,
  framework,
  maxRetries = DEFAULT_MAX_RETRIES,
  maxTokens = DEFAULT_MAX_TOKENS,
  logDir,
  onProgress
}) {
  const results = [];

  // Load index once for summary
  const { loadIndex } = require('../index/index-query');
  const index = await loadIndex(indexPath);
  const indexSummary = {
    totalFiles: index.files.length,
    componentCount: index.files.filter(f => f.tags.includes('component')).length,
    packageRoots: [...new Set(index.files.map(f => f.packageRoot).filter(Boolean))]
  };

  for (let i = 0; i < components.length; i++) {
    const component = components[i];
    const componentName = component.figmaEvidence.componentName || `Component ${i + 1}`;
    const componentId = component.figmaEvidence.id || `component-${i}`;

    if (onProgress) {
      onProgress({
        phase: 'processing',
        componentIndex: i,
        componentName,
        total: components.length
      });
    }

    // Create AgentTools instance for this component
    const tools = new AgentTools(repoRoot, indexPath, componentId);
    await tools.init();

    const result = await processComponentWithTools({
      agent,
      tools,
      figmaEvidence: component.figmaEvidence,
      figmaUrl: component.figmaUrl,
      indexSummary,
      framework,
      maxRetries,
      maxTokens,
      logDir,
      componentId
    });

    results.push({
      componentName,
      componentId,
      ...result
    });

    if (onProgress) {
      onProgress({
        phase: result.success ? 'completed' : 'failed',
        componentIndex: i,
        componentName,
        total: components.length,
        errors: result.errors,
        toolMetrics: result.toolMetrics
      });
    }
  }

  return results;
}

module.exports = {
  buildSystemPrompt,
  buildUserPrompt,
  buildRetryPrompt,
  processComponentWithTools,
  processAllComponents,
  DEFAULT_MAX_RETRIES,
  DEFAULT_MAX_TOKENS
};
