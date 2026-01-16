/**
 * Angular Direct Codegen
 *
 * Uses stateless single-call approach:
 * - Each component gets independent model call with cached system prefix
 * - System prompt includes full Code Connect API docs for Angular/HTML
 * - For each component: generate → validate → retry if needed → move to next
 * - Validate BEFORE moving on (prevents error accumulation)
 */

import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import { validateCodeConnectWithCLI } from '../util/validate-code-connect.js';
import type {
  FigmaEvidence,
  ComponentOrientation,
  CodegenResult,
  ProcessComponentOptions,
  ProcessAllComponentsOptions,
  AgentResponse,
  ValidationResult
} from '../types.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_MAX_RETRIES = 4;

/**
 * Extract code from agent response, handling markdown fences and explanatory text.
 */
function extractCodeFromResponse(responseText: string): string {
  let text = responseText.trim();
  
  // Look for code fence with optional language and metadata (```ts filename="...")
  // Matches: ```ts, ```tsx, ```typescript, ```javascript, ```js, or just ```
  // Also handles metadata after language: ```ts filename="component.figma.ts"
  const codeBlockMatch = text.match(/```(?:tsx?|typescript|javascript|js)?[^\n]*\n([\s\S]*?)```/);
  if (codeBlockMatch && codeBlockMatch[1]) {
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
 */
function buildSystemPrompt(includeAgenticTools = false): string {
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
  } catch (err: unknown) {
    const error = err as NodeJS.ErrnoException;
    if (error.code === 'ENOENT') {
      throw new Error(`Prompt file not found: ${error.path || 'unknown'}\n  This is likely a package installation issue. Try reinstalling: pnpm install`);
    }
    throw new Error(`Failed to read prompt files: ${error.message || String(err)}`);
  }
}

interface BuildStatelessMessagesParams {
  figmaEvidence: FigmaEvidence;
  orientation: ComponentOrientation;
  figmaUrl: string;
  sourceContext?: Record<string, string>;
  includeAgenticTools?: boolean;
}

/**
 * Build stateless messages for a single component call.
 * Returns {system, user} where system is the cached prefix.
 */
function buildStatelessMessages({
  figmaEvidence,
  orientation,
  figmaUrl,
  sourceContext,
  includeAgenticTools = false
}: BuildStatelessMessagesParams): { system: string; user: string } {
  const system = buildSystemPrompt(includeAgenticTools);
  // ARCHITECTURE NOTE: Agent SDK vs Messages API context strategy
  //
  // Messages API (includeAgenticTools=false):
  //   - Include full source file contents in the user prompt
  //   - Model gets everything upfront in a single call
  //   - Faster (no tool round-trips) but uses more non-cached tokens
  //
  // Agent SDK (includeAgenticTools=true):
  //   - Only include file PATHS, not contents
  //   - Agent uses Read/Glob/Grep tools to fetch files as needed
  //   - Better cache utilization (tool results may be cached internally)
  //   - Agent can explore beyond the files we pre-select
  const user = buildComponentPrompt({ 
    figmaEvidence, 
    orientation, 
    figmaUrl, 
    sourceContext,
    omitSourceContents: includeAgenticTools  // Agent SDK reads files via tools
  });
  return { system, user };
}

interface BuildComponentPromptParams {
  figmaEvidence: FigmaEvidence;
  orientation: ComponentOrientation;
  figmaUrl: string;
  sourceContext?: Record<string, string>;
  omitSourceContents?: boolean;
}

/**
 * Build the user prompt for a single Angular component.
 */
function buildComponentPrompt({
  figmaEvidence,
  orientation,
  figmaUrl,
  sourceContext,
  omitSourceContents = false
}: BuildComponentPromptParams): string {
  const sections: string[] = [];

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
    if (omitSourceContents) {
      // Agent SDK mode: list paths only, agent will use Read tool to fetch contents
      // This enables better caching and lets the agent explore beyond pre-selected files
      sections.push('## Source Files (use Read tool to examine)\n');
      sections.push('The following source files are relevant to this component. Use the Read tool to examine them:\n');
      for (const filePath of Object.keys(sourceContext)) {
        sections.push(`- \`${filePath}\``);
      }
      sections.push('');
    } else {
      // Messages API mode: include full contents inline
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
  }

  sections.push('Now generate the .figma.ts file. Output ONLY the code, no markdown blocks.');

  return sections.join('\n');
}

/**
 * Build a retry prompt with validation errors.
 */
function buildRetryPrompt(previousCode: string, errors: string[]): string {
  const sections: string[] = [];

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

interface BuildRepairMessagesParams {
  system: string;
  originalUser: string;
  previousCode: string;
  errors: string[];
}

/**
 * Build repair messages for a retry call after validation failure.
 * Combines original payload + previous output + validation errors.
 */
function buildRepairMessages({
  system,
  originalUser,
  previousCode,
  errors
}: BuildRepairMessagesParams): { system: string; user: string } {
  const retryPrompt = buildRetryPrompt(previousCode, errors);
  // Combine original context + retry instruction
  const user = `${originalUser}\n\n---\n\n${retryPrompt}`;
  return { system, user };
}

/**
 * Process a single Angular component with retry logic using stateless calls.
 * Each call is independent with cached system prefix.
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
}: ProcessComponentOptions): Promise<CodegenResult> {
  // Build initial messages
  const messages = buildStatelessMessages({
    figmaEvidence,
    orientation,
    figmaUrl,
    sourceContext,
    includeAgenticTools
  });

  let attempt = 0;
  let lastCode: string | null = null;
  let lastErrors: string[] = [];
  const attempts: CodegenResult['attempts'] = []; // Track each attempt for logging

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
            previousCode: lastCode!,
            errors: lastErrors
          });

      const response: AgentResponse = await agent.chatStateless({
        system: messagesForCall.system,
        user: messagesForCall.user,
        maxTokens,
        logLabel,
        logDir
      });

      // Extract code from response (handles markdown fences and explanatory text)
      const code = extractCodeFromResponse(response.text || String(response));

      lastCode = code;

      // Validate the generated code using Figma CLI as authoritative source
      const validationResult: ValidationResult = validateFn
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
        return {
          componentName: figmaEvidence.componentName,
          success: true,
          code,
          errors: [],
          attempts
        };
      }

      // Validation failed - errors captured in attempts array
      lastErrors = validationResult.errors;
    } catch (err: unknown) {
      // Preserve detailed error information for network issues
      const error = err as Error & { code?: string };
      const errorMsg = error.message || String(err);
      const isNetworkError = error?.code === 'ENOTFOUND' || error?.code === 'ECONNREFUSED' ||
                             error?.code === 'ETIMEDOUT' || error?.code === 'ECONNRESET' ||
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

  return {
    componentName: figmaEvidence.componentName,
    success: false,
    code: lastCode,
    errors: lastErrors,
    attempts
  };
}

/**
 * Process all Angular components with stateless calls.
 * Each component gets an independent call with cached system prefix.
 */
async function processAllComponents({
  createAgent,
  components,
  maxRetries = DEFAULT_MAX_RETRIES,
  maxTokens = 16384,
  onProgress
}: ProcessAllComponentsOptions): Promise<CodegenResult[]> {
  const results: CodegenResult[] = [];
  const agent = createAgent();

  for (let i = 0; i < components.length; i++) {
    const component = components[i];
    if (!component) continue;
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

    results.push(result);

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

export {
  buildSystemPrompt,
  buildComponentPrompt,
  buildRetryPrompt,
  buildStatelessMessages,
  buildRepairMessages,
  processComponent,
  processAllComponents,
  DEFAULT_MAX_RETRIES
};
