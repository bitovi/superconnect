/**
 * Shared TypeScript types for Superconnect codegen
 */

/**
 * Figma component evidence extracted from the Figma API
 */
export interface FigmaEvidence {
  /** Component name from Figma */
  componentName: string;
  /** Variant properties (e.g., "Size", "Variant") */
  variantProperties?: Record<string, string[] | boolean[]>;
  /** Component properties (e.g., boolean, string, instance swap properties) */
  componentProperties?: Array<{
    name: string;
    type: 'BOOLEAN' | 'INSTANCE_SWAP' | 'TEXT';
    defaultValue?: string | boolean;
    preferredValues?: Array<{ key: string; value: string }>;
  }>;
  /** Text layers in the component */
  textLayers?: string[];
  /** Slot layers (for children insertion points) */
  slotLayers?: string[];
}

/**
 * Orientation data from the orienter agent
 * Contains information about the component in the codebase
 */
export interface ComponentOrientation {
  /** Import path for the component (React) or selector (Angular) */
  importPath?: string;
  /** Canonical name of the component */
  canonicalName?: string;
  /** Valid props for the component (React) */
  validProps?: Set<string>;
  /** Angular component selector */
  selector?: string;
  /** Angular component inputs */
  inputs?: string[] | Record<string, unknown>;
  /** Source file paths */
  files?: string[];
}

/**
 * Result from processing a single component
 */
export interface CodegenResult {
  /** Component name that was processed */
  componentName: string;
  /** Whether code generation succeeded */
  success: boolean;
  /** Generated Code Connect code (null if failed) */
  code: string | null;
  /** Validation errors (empty if success) */
  errors: string[];
  /** Detailed information about each attempt */
  attempts?: Array<{
    attempt: number;
    usage: { input_tokens?: number; output_tokens?: number } | null;
    valid: boolean;
    errors: string[];
    errorType?: 'network' | 'agent';
  }>;
}

/**
 * Options for processComponent
 */
export interface ProcessComponentOptions {
  /** Agent adapter instance */
  agent: AgentAdapter;
  /** Figma component evidence */
  figmaEvidence: FigmaEvidence;
  /** Orientation data from orienter */
  orientation: ComponentOrientation;
  /** Figma URL for the component */
  figmaUrl: string;
  /** Source file contents keyed by file path */
  sourceContext?: Record<string, string>;
  /** Maximum number of retries */
  maxRetries: number;
  /** Maximum tokens per LLM call */
  maxTokens: number;
  /** Directory for logging LLM exchanges */
  logDir?: string;
  /** Whether to include agentic exploration guidance */
  includeAgenticTools?: boolean;
  /** Package name for imports (e.g., @corp/design-system) */
  importFrom?: string | null;
  /** Custom validation function (for testing) */
  validateFn?: ((params: { generatedCode: string; figmaEvidence: FigmaEvidence }) => ValidationResult) | null;
}

/**
 * Validation result structure
 */
export interface ValidationResult {
  /** Whether the code is valid */
  valid: boolean;
  /** List of validation errors */
  errors: string[];
}

/**
 * Agent adapter interface - minimal shape for what codegen needs
 */
export interface AgentAdapter {
  /**
   * Make a stateless chat call (system + user messages)
   */
  chatStateless(params: {
    system: string;
    user: string;
    maxTokens: number;
    logLabel: string;
    logDir?: string;
  }): Promise<AgentResponse>;
}

/**
 * Response from agent call
 */
export interface AgentResponse {
  /** Generated text */
  text?: string;
  /** Token usage information */
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
}

/**
 * Progress callback parameters
 */
export interface ProgressInfo {
  /** Current phase: 'processing', 'completed', or 'failed' */
  phase: 'processing' | 'completed' | 'failed';
  /** Index of current component (0-based) */
  componentIndex: number;
  /** Name of current component */
  componentName: string;
  /** Total number of components */
  total: number;
  /** Errors if failed */
  errors?: string[];
}

/**
 * Options for processAllComponents
 */
export interface ProcessAllComponentsOptions {
  /** Factory function to create agent adapter */
  createAgent: () => AgentAdapter;
  /** All components to process */
  components: Array<{
    figmaEvidence: FigmaEvidence;
    orientation: ComponentOrientation;
    figmaUrl: string;
    sourceContext?: Record<string, string>;
  }>;
  /** Maximum number of retries per component */
  maxRetries?: number;
  /** Maximum tokens per LLM call */
  maxTokens?: number;
  /** Progress callback */
  onProgress?: (info: ProgressInfo) => void;
}
