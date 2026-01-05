/**
 * Token Usage Tracker
 *
 * Tracks token usage and costs for LLM API calls per component.
 * Supports both Anthropic and OpenAI pricing models.
 */

const fs = require('fs-extra');
const path = require('path');

/**
 * Model pricing (per million tokens)
 * Updated 2025-01 from official pricing pages
 */
const MODEL_PRICING = {
  // Anthropic Claude
  'claude-opus-4-5': { input: 15.00, output: 75.00 },
  'claude-sonnet-4-5': { input: 3.00, output: 15.00 },
  'claude-haiku-4-5': { input: 0.80, output: 4.00 },
  'claude-3-5-sonnet-20241022': { input: 3.00, output: 15.00 },
  'claude-3-opus-20240229': { input: 15.00, output: 75.00 },
  'claude-3-sonnet-20240229': { input: 3.00, output: 15.00 },
  'claude-3-haiku-20240307': { input: 0.25, output: 1.25 },

  // OpenAI models
  'gpt-5.1-codex-mini': { input: 1.00, output: 3.00 }, // Placeholder pricing
  'gpt-4-turbo': { input: 10.00, output: 30.00 },
  'gpt-4': { input: 30.00, output: 60.00 },
  'gpt-3.5-turbo': { input: 0.50, output: 1.50 }
};

/**
 * Get pricing for a model (with fallback)
 */
function getModelPricing(model) {
  // Try exact match first
  if (MODEL_PRICING[model]) {
    return MODEL_PRICING[model];
  }

  // Try prefix match (for versioned models)
  for (const [key, pricing] of Object.entries(MODEL_PRICING)) {
    if (model.startsWith(key)) {
      return pricing;
    }
  }

  // Default conservative estimate
  return { input: 5.00, output: 15.00 };
}

/**
 * Calculate cost for token usage
 */
function calculateCost(model, inputTokens, outputTokens) {
  const pricing = getModelPricing(model);
  const inputCost = (inputTokens / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;
  return {
    input_cost_usd: parseFloat(inputCost.toFixed(6)),
    output_cost_usd: parseFloat(outputCost.toFixed(6)),
    total_cost_usd: parseFloat((inputCost + outputCost).toFixed(6))
  };
}

/**
 * Token Tracker
 */
class TokenTracker {
  constructor() {
    this.records = [];
  }

  /**
   * Record a token usage event
   */
  record({
    componentId,
    componentName,
    stage, // 'orient' | 'codegen' | 'retry'
    model,
    inputTokens,
    outputTokens,
    maxTokens,
    timestamp = new Date().toISOString()
  }) {
    const costs = calculateCost(model, inputTokens, outputTokens);

    const record = {
      timestamp,
      component_id: componentId,
      component_name: componentName,
      stage,
      model,
      tokens: {
        input: inputTokens,
        output: outputTokens,
        total: inputTokens + outputTokens,
        max_allowed: maxTokens
      },
      costs,
      pricing: getModelPricing(model)
    };

    this.records.push(record);
    return record;
  }

  /**
   * Get summary statistics
   */
  getSummary() {
    if (this.records.length === 0) {
      return {
        total_calls: 0,
        total_input_tokens: 0,
        total_output_tokens: 0,
        total_tokens: 0,
        total_cost_usd: 0,
        by_stage: {},
        by_model: {},
        by_component: {}
      };
    }

    const summary = {
      total_calls: this.records.length,
      total_input_tokens: 0,
      total_output_tokens: 0,
      total_tokens: 0,
      total_cost_usd: 0,
      by_stage: {},
      by_model: {},
      by_component: {}
    };

    for (const record of this.records) {
      summary.total_input_tokens += record.tokens.input;
      summary.total_output_tokens += record.tokens.output;
      summary.total_tokens += record.tokens.total;
      summary.total_cost_usd += record.costs.total_cost_usd;

      // By stage
      if (!summary.by_stage[record.stage]) {
        summary.by_stage[record.stage] = {
          calls: 0,
          input_tokens: 0,
          output_tokens: 0,
          total_tokens: 0,
          cost_usd: 0
        };
      }
      const stageStats = summary.by_stage[record.stage];
      stageStats.calls += 1;
      stageStats.input_tokens += record.tokens.input;
      stageStats.output_tokens += record.tokens.output;
      stageStats.total_tokens += record.tokens.total;
      stageStats.cost_usd += record.costs.total_cost_usd;

      // By model
      if (!summary.by_model[record.model]) {
        summary.by_model[record.model] = {
          calls: 0,
          input_tokens: 0,
          output_tokens: 0,
          total_tokens: 0,
          cost_usd: 0
        };
      }
      const modelStats = summary.by_model[record.model];
      modelStats.calls += 1;
      modelStats.input_tokens += record.tokens.input;
      modelStats.output_tokens += record.tokens.output;
      modelStats.total_tokens += record.tokens.total;
      modelStats.cost_usd += record.costs.total_cost_usd;

      // By component
      const compKey = record.component_id || record.component_name || 'unknown';
      if (!summary.by_component[compKey]) {
        summary.by_component[compKey] = {
          name: record.component_name,
          calls: 0,
          input_tokens: 0,
          output_tokens: 0,
          total_tokens: 0,
          cost_usd: 0
        };
      }
      const compStats = summary.by_component[compKey];
      compStats.calls += 1;
      compStats.input_tokens += record.tokens.input;
      compStats.output_tokens += record.tokens.output;
      compStats.total_tokens += record.tokens.total;
      compStats.cost_usd += record.costs.total_cost_usd;
    }

    // Round all costs to 6 decimal places
    summary.total_cost_usd = parseFloat(summary.total_cost_usd.toFixed(6));
    for (const stats of Object.values(summary.by_stage)) {
      stats.cost_usd = parseFloat(stats.cost_usd.toFixed(6));
    }
    for (const stats of Object.values(summary.by_model)) {
      stats.cost_usd = parseFloat(stats.cost_usd.toFixed(6));
    }
    for (const stats of Object.values(summary.by_component)) {
      stats.cost_usd = parseFloat(stats.cost_usd.toFixed(6));
    }

    return summary;
  }

  /**
   * Save token records to JSONL
   */
  async save(outputPath) {
    await fs.ensureDir(path.dirname(outputPath));
    const lines = this.records.map(r => JSON.stringify(r)).join('\n');
    if (lines) {
      await fs.writeFile(outputPath, lines + '\n', 'utf8');
    }
  }

  /**
   * Load token records from JSONL
   */
  async load(inputPath) {
    if (!await fs.pathExists(inputPath)) {
      return;
    }
    const content = await fs.readFile(inputPath, 'utf8');
    const lines = content.trim().split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        this.records.push(JSON.parse(line));
      } catch (err) {
        // Skip malformed lines
      }
    }
  }

  /**
   * Parse token usage from agent adapter response
   */
  static parseFromAgentResponse(response) {
    // Check if response has usage data
    if (!response || !response.usage) {
      return null;
    }

    return {
      inputTokens: response.usage.input_tokens || 0,
      outputTokens: response.usage.output_tokens || 0
    };
  }

  /**
   * Extract token usage from log file
   */
  static async parseFromLogFile(logPath) {
    if (!await fs.pathExists(logPath)) {
      return null;
    }

    const content = await fs.readFile(logPath, 'utf8');

    // Look for pattern: [Usage: in=1234 out=5678 max=8192]
    const match = content.match(/\[Usage: in=(\d+) out=(\d+) max=(\d+)\]/);
    if (match) {
      return {
        inputTokens: parseInt(match[1], 10),
        outputTokens: parseInt(match[2], 10),
        maxTokens: parseInt(match[3], 10)
      };
    }

    return null;
  }
}

module.exports = {
  TokenTracker,
  MODEL_PRICING,
  getModelPricing,
  calculateCost
};
