/**
 * Angular Direct Codegen
 *
 * Uses stateless single-call approach:
 * - Each component gets independent model call with cached system prefix
 * - System prompt includes full Code Connect API docs for Angular/HTML
 * - For each component: generate → validate → retry if needed → move to next
 * - Validate BEFORE moving on (prevents error accumulation)
 */

const fs = require('fs-extra');
const path = require('path');
const { validateCodeConnectWithCLI } = require('../util/validate-code-connect');

const DEFAULT_MAX_RETRIES = 4;

/**
 * Extract code from agent response, handling markdown fences and explanatory text.
 * @param {string} responseText - The raw response from the agent
 * @returns {string} - The extracted code
 */
function extractCodeFromResponse(responseText) {
  let text = responseText.trim();
  
  // Look for code fence with optional language and metadata (```ts filename="...")
  // Matches: ```ts, ```tsx, ```typescript, ```javascript, ```js, or just ```
  // Also handles metadata after language: ```ts filename="component.figma.ts"
  const codeBlockMatch = text.match(/```(?:tsx?|typescript|javascript|js)?[^\n]*\n([\s\S]*?)```/);
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim();
  }
  
  // If no code fence found but text starts with one, strip it
  if (text.startsWith('```')) {
    text = text.replace(/^```[^\n]*\n?/, '').replace(/\n?```$/, '');
  }
  
  return text;
}

/**
 * Build the system prompt combining our guidance with Figma's official API docs.
 * @param {boolean} includeAgenticTools - Whether to include agentic exploration guidance
 * @returns {string}
 */
function buildSystemPrompt(includeAgenticTools = false) {
  const promptsDir = path.join(__dirname, '..', '..', 'prompts');
  const refDocsDir = path.join(promptsDir, 'reference-docs');
  const guidancePath = path.join(promptsDir, 'angular-direct-codegen.md');
  const agenticPath = path.join(promptsDir, 'agentic-exploration.md');
  
  // Reference docs: config (02) + Angular/HTML-specific (04)
  // NOTE: 01-quickstart.md is excluded because it shows React's 3-arg form
  // figma.connect(Component, url, config) which confuses the LLM.
  // Angular uses the 2-arg form: figma.connect(url, config)
  const refDocFiles = [
    '02-config-file.md',
    '04-html-angular.md'
  ];
  
  try {
    const guidance = fs.readFileSync(guidancePath, 'utf8');
    const refDocs = refDocFiles
      .map(f => fs.readFileSync(path.join(refDocsDir, f), 'utf8'))
      .join('\n\n---\n\n');
    
    // Reference docs first (background knowledge), then guidance (rules)
    let systemPrompt = `${refDocs}\n\n---\n\n${guidance}`;
    
    if (includeAgenticTools) {
      const agenticGuidance = fs.readFileSync(agenticPath, 'utf8');
      systemPrompt += `\n\n---\n\n${agenticGuidance}`;
    }
    
    return systemPrompt;
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error(`Prompt file not found: ${err.path}\n  This is likely a package installation issue. Try reinstalling: pnpm install`);
    }
    throw new Error(`Failed to read prompt files: ${err.message}`);
  }
}

/**
 * Build stateless messages for a single component call.
 * Returns {system, user} where system is the cached prefix.
 * @param {object} params
 * @param {object} params.figmaEvidence - Figma component data
 * @param {object} params.orientation - Orienter output for this component
 * @param {string} params.figmaUrl - The Figma URL for this component
 * @param {object} params.sourceContext - Source file contents (optional)
 * @param {boolean} params.includeAgenticTools - Whether to include agentic exploration guidance
 * @returns {{ system: string, user: string }}
 */
function buildStatelessMessages({ figmaEvidence, orientation, figmaUrl, sourceContext, includeAgenticTools = false }) {
  const system = buildSystemPrompt(includeAgenticTools);
  const user = buildComponentPrompt({ figmaEvidence, orientation, figmaUrl, sourceContext });
  return { system, user };
}

/**
 * Build the user prompt for a single Angular component.
 * @param {object} params
 * @param {object} params.figmaEvidence - Figma component data
 * @param {object} params.orientation - Orienter output for this component
 * @param {string} params.figmaUrl - The Figma URL for this component
 * @param {object} params.sourceContext - Source file contents (optional)
 * @returns {string}
 */
function buildComponentPrompt({ figmaEvidence, orientation, figmaUrl, sourceContext }) {
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

  sections.push('## Angular Component Info\n');
  const selector = orientation.selector || orientation.canonicalName?.toLowerCase() || 'app-component';
  sections.push(`- **Selector**: ${selector}`);
  sections.push(`- **Component Class**: ${orientation.canonicalName || figmaEvidence.componentName}`);
  if (orientation.inputs) {
    sections.push(`- **Inputs**: ${Array.isArray(orientation.inputs) ? orientation.inputs.join(', ') : JSON.stringify(orientation.inputs)}`);
  }
  sections.push('');

  sections.push(`## Figma URL\n`);
  sections.push(`\`${figmaUrl}\`\n`);

  if (sourceContext && Object.keys(sourceContext).length > 0) {
    sections.push('## Source File Context\n');
    for (const [filePath, content] of Object.entries(sourceContext)) {
      sections.push(`### ${filePath}\n`);
      sections.push('```typescript');
      // Allow generous source context - models have large context windows
      // and truncating too aggressively cuts off important export declarations
      sections.push(content.slice(0, 20000));
      sections.push('```\n');
    }
  }

  sections.push('Now generate the .figma.ts file. Output ONLY the code, no markdown blocks.');

  return sections.join('\n');
}

/**
 * Build a retry prompt with validation errors.
 * @param {string} previousCode - The code that failed validation
 * @param {string[]} errors - Validation error messages
 * @returns {string}
 */
function buildRetryPrompt(previousCode, errors) {
  const sections = [];

  sections.push('The previous output had validation errors. Please fix them.\n');
  sections.push('## Errors Found\n');
  errors.forEach((error) => {
    sections.push(`- ${error}`);
  });
  sections.push('\n');

  sections.push('## Previous Code\n');
  sections.push('```typescript');
  sections.push(previousCode);
  sections.push('```\n');

  sections.push('**CRITICAL**: Review the "Figma Component Data" section above to see the ACTUAL available properties.');
  sections.push('Only use properties that are explicitly listed in:');
  sections.push('- `componentProperties[]` for figma.boolean(), figma.string(), figma.instance()');
  sections.push('- `variantProperties{}` for figma.enum()');
  sections.push('- `textLayers[]` for figma.textContent()');
  sections.push('- `slotLayers[]` for figma.children()\n');
  sections.push('Please output the corrected .figma.ts file. Output ONLY the code, no markdown blocks.');

  return sections.join('\n');
}

/**
 * Build repair messages for a retry call after validation failure.
 * Combines original payload + previous output + validation errors.
 * @param {object} params
 * @param {string} params.system - System prompt (same cached prefix)
 * @param {string} params.originalUser - Original component prompt
 * @param {string} params.previousCode - Code that failed validation
 * @param {string[]} params.errors - Validation errors
 * @returns {{ system: string, user: string }}
 */
function buildRepairMessages({ system, originalUser, previousCode, errors }) {
  const retryPrompt = buildRetryPrompt(previousCode, errors);
  // Combine original context + retry instruction
  const user = `${originalUser}\n\n---\n\n${retryPrompt}`;
  return { system, user };
}

/**
 * Process a single Angular component with retry logic using stateless calls.
 * Each call is independent with cached system prefix.
 * @param {object} params
 * @param {object} params.agent - The agent adapter instance
 * @param {object} params.figmaEvidence - Figma component data
 * @param {object} params.orientation - Orienter output
 * @param {string} params.figmaUrl - Figma URL
 * @param {object} params.sourceContext - Source files (optional)
 * @param {number} params.maxRetries - Max retry count
 * @param {number} params.maxTokens - Max tokens per call
 * @param {boolean} params.includeAgenticTools - Whether to include agentic exploration guidance * @param {Function} [params.validateFn] - Custom validator (for testing; defaults to CLI validation) * @returns {Promise<{success: boolean, code: string|null, errors: string[]}>}
 */
async function processComponent({
  agent,
  figmaEvidence,
  orientation,
  figmaUrl,
  sourceContext,
  maxRetries,
  maxTokens,
  logDir,
  includeAgenticTools = false,
  validateFn = null
}) {
  // Build initial messages
  const messages = buildStatelessMessages({
    figmaEvidence,
    orientation,
    figmaUrl,
    sourceContext,
    includeAgenticTools
  });

  let attempt = 0;
  let lastCode = null;
  let lastErrors = [];
  const attempts = []; // Track each attempt for logging

  while (attempt <= maxRetries) {
    attempt++;

    try {
      const componentName = figmaEvidence.componentName || 'component';
      const logLabel = `angular-${componentName}-attempt${attempt}`;

      // Call agent with stateless messages (or repair messages on retry)
      const messagesForCall = attempt === 1 
        ? messages 
        : buildRepairMessages({
            system: messages.system,
            originalUser: messages.user,
            previousCode: lastCode,
            errors: lastErrors
          });

      const response = await agent.chatStateless({
        system: messagesForCall.system,
        user: messagesForCall.user,
        maxTokens,
        logLabel,
        logDir
      });

      // Extract code from response (handles markdown fences and explanatory text)
      const code = extractCodeFromResponse(response.text || response);

      lastCode = code;

      // Validate the generated code using Figma CLI as authoritative source
      const validationResult = validateFn
        ? validateFn({ generatedCode: code, figmaEvidence })
        : validateCodeConnectWithCLI({
            generatedCode: code,
            figmaEvidence,
            framework: 'angular'
          });

      // Track this attempt
      const attemptRecord = {
        attempt,
        usage: response.usage || null,
        valid: validationResult.valid,
        errors: validationResult.valid ? [] : validationResult.errors
      };
      attempts.push(attemptRecord);

      if (validationResult.valid) {
        return { success: true, code, errors: [], attempts };
      }

      // Validation failed - errors captured in attempts array
      lastErrors = validationResult.errors;
    } catch (err) {
      // Preserve detailed error information for network issues
      const errorMsg = err.message || String(err);
      const isNetworkError = err?.code === 'ENOTFOUND' || err?.code === 'ECONNREFUSED' ||
                             err?.code === 'ETIMEDOUT' || err?.code === 'ECONNRESET' ||
                             errorMsg.includes('Network') || errorMsg.includes('certificate') ||
                             errorMsg.includes('TLS') || errorMsg.includes('SSL');
      
      if (isNetworkError) {
        lastErrors = [errorMsg]; // Preserve full network error details
      } else {
        lastErrors = [`Agent error: ${errorMsg}`];
      }
      
      attempts.push({ 
        attempt, 
        usage: null, 
        valid: false, 
        errors: lastErrors,
        errorType: isNetworkError ? 'network' : 'agent'
      });
      
      if (attempt > maxRetries) break;
    }
  }

  return { success: false, code: lastCode, errors: lastErrors, attempts };
}

/**
 * Process all Angular components with stateless calls.
 * Each component gets an independent call with cached system prefix.
 * @param {object} params
 * @param {Function} params.createAgent - Factory function to create agent
 * @param {Array} params.components - All components to process
 * @param {number} params.maxRetries - Max retries per component
 * @param {number} params.maxTokens - Max tokens per call
 * @param {Function} params.onProgress - Progress callback (optional)
 * @returns {Promise<Array<{componentName: string, success: boolean, code: string|null, errors: string[]}>>}
 */
async function processAllComponents({
  createAgent,
  components,
  maxRetries = DEFAULT_MAX_RETRIES,
  maxTokens = 16384,
  onProgress
}) {
  const results = [];
  const agent = createAgent();

  for (let i = 0; i < components.length; i++) {
    const component = components[i];
    const componentName = component.figmaEvidence.componentName || `Component ${i + 1}`;

    if (onProgress) {
      onProgress({
        phase: 'processing',
        componentIndex: i,
        componentName,
        total: components.length
      });
    }

    const result = await processComponent({
      agent,
      figmaEvidence: component.figmaEvidence,
      orientation: component.orientation,
      figmaUrl: component.figmaUrl,
      sourceContext: component.sourceContext,
      maxRetries,
      maxTokens
    });

    results.push({
      componentName,
      ...result
    });

    if (onProgress) {
      onProgress({
        phase: result.success ? 'completed' : 'failed',
        componentIndex: i,
        componentName,
        total: components.length,
        errors: result.errors
      });
    }
  }

  return results;
}

module.exports = {
  buildSystemPrompt,
  buildComponentPrompt,
  buildRetryPrompt,
  buildStatelessMessages,
  buildRepairMessages,
  processComponent,
  processAllComponents,
  DEFAULT_MAX_RETRIES
};

