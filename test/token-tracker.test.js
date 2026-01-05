const fs = require('fs-extra');
const path = require('path');
const {
  TokenTracker,
  MODEL_PRICING,
  getModelPricing,
  calculateCost
} = require('../src/util/token-tracker');

describe('Token Tracker', () => {
  describe('getModelPricing', () => {
    it('returns exact model pricing', () => {
      const pricing = getModelPricing('claude-haiku-4-5');
      expect(pricing).toEqual({ input: 0.80, output: 4.00 });
    });

    it('handles prefix matching for versioned models', () => {
      const pricing = getModelPricing('claude-3-opus-20240229-v2');
      expect(pricing).toEqual({ input: 15.00, output: 75.00 });
    });

    it('returns default pricing for unknown models', () => {
      const pricing = getModelPricing('unknown-model');
      expect(pricing).toEqual({ input: 5.00, output: 15.00 });
    });
  });

  describe('calculateCost', () => {
    it('calculates cost correctly', () => {
      const cost = calculateCost('claude-haiku-4-5', 1000, 500);
      // Input: (1000/1M) * $0.80 = $0.0008
      // Output: (500/1M) * $4.00 = $0.002
      // Total: $0.0028
      expect(cost.input_cost_usd).toBe(0.0008);
      expect(cost.output_cost_usd).toBe(0.002);
      expect(cost.total_cost_usd).toBe(0.0028);
    });

    it('handles large token counts', () => {
      const cost = calculateCost('claude-sonnet-4-5', 100000, 50000);
      // Input: (100k/1M) * $3.00 = $0.30
      // Output: (50k/1M) * $15.00 = $0.75
      // Total: $1.05
      expect(cost.input_cost_usd).toBe(0.3);
      expect(cost.output_cost_usd).toBe(0.75);
      expect(cost.total_cost_usd).toBe(1.05);
    });
  });

  describe('TokenTracker', () => {
    let tracker;

    beforeEach(() => {
      tracker = new TokenTracker();
    });

    describe('record', () => {
      it('records token usage', () => {
        const record = tracker.record({
          componentId: 'comp-1',
          componentName: 'Button',
          stage: 'codegen',
          model: 'claude-haiku-4-5',
          inputTokens: 1000,
          outputTokens: 500,
          maxTokens: 2048
        });

        expect(record.component_id).toBe('comp-1');
        expect(record.component_name).toBe('Button');
        expect(record.stage).toBe('codegen');
        expect(record.tokens.input).toBe(1000);
        expect(record.tokens.output).toBe(500);
        expect(record.tokens.total).toBe(1500);
        expect(record.costs.total_cost_usd).toBe(0.0028);
      });

      it('includes pricing info', () => {
        const record = tracker.record({
          componentId: 'comp-1',
          componentName: 'Button',
          stage: 'codegen',
          model: 'claude-haiku-4-5',
          inputTokens: 1000,
          outputTokens: 500,
          maxTokens: 2048
        });

        expect(record.pricing).toEqual({ input: 0.80, output: 4.00 });
      });
    });

    describe('getSummary', () => {
      it('returns empty summary for no records', () => {
        const summary = tracker.getSummary();
        expect(summary.total_calls).toBe(0);
        expect(summary.total_tokens).toBe(0);
        expect(summary.total_cost_usd).toBe(0);
      });

      it('aggregates multiple records', () => {
        tracker.record({
          componentId: 'comp-1',
          componentName: 'Button',
          stage: 'codegen',
          model: 'claude-haiku-4-5',
          inputTokens: 1000,
          outputTokens: 500,
          maxTokens: 2048
        });

        tracker.record({
          componentId: 'comp-2',
          componentName: 'Input',
          stage: 'codegen',
          model: 'claude-haiku-4-5',
          inputTokens: 2000,
          outputTokens: 1000,
          maxTokens: 2048
        });

        const summary = tracker.getSummary();
        expect(summary.total_calls).toBe(2);
        expect(summary.total_input_tokens).toBe(3000);
        expect(summary.total_output_tokens).toBe(1500);
        expect(summary.total_tokens).toBe(4500);
        expect(summary.total_cost_usd).toBeCloseTo(0.0084, 4);
      });

      it('groups by stage', () => {
        tracker.record({
          componentId: 'comp-1',
          componentName: 'Button',
          stage: 'orient',
          model: 'claude-haiku-4-5',
          inputTokens: 10000,
          outputTokens: 1000,
          maxTokens: 32768
        });

        tracker.record({
          componentId: 'comp-1',
          componentName: 'Button',
          stage: 'codegen',
          model: 'claude-haiku-4-5',
          inputTokens: 1000,
          outputTokens: 500,
          maxTokens: 2048
        });

        const summary = tracker.getSummary();
        expect(summary.by_stage.orient).toBeDefined();
        expect(summary.by_stage.codegen).toBeDefined();
        expect(summary.by_stage.orient.input_tokens).toBe(10000);
        expect(summary.by_stage.codegen.input_tokens).toBe(1000);
      });

      it('groups by model', () => {
        tracker.record({
          componentId: 'comp-1',
          componentName: 'Button',
          stage: 'codegen',
          model: 'claude-haiku-4-5',
          inputTokens: 1000,
          outputTokens: 500,
          maxTokens: 2048
        });

        tracker.record({
          componentId: 'comp-2',
          componentName: 'Input',
          stage: 'codegen',
          model: 'claude-sonnet-4-5',
          inputTokens: 2000,
          outputTokens: 1000,
          maxTokens: 4096
        });

        const summary = tracker.getSummary();
        expect(summary.by_model['claude-haiku-4-5']).toBeDefined();
        expect(summary.by_model['claude-sonnet-4-5']).toBeDefined();
        expect(summary.by_model['claude-haiku-4-5'].calls).toBe(1);
        expect(summary.by_model['claude-sonnet-4-5'].calls).toBe(1);
      });

      it('groups by component', () => {
        tracker.record({
          componentId: 'comp-1',
          componentName: 'Button',
          stage: 'codegen',
          model: 'claude-haiku-4-5',
          inputTokens: 1000,
          outputTokens: 500,
          maxTokens: 2048
        });

        tracker.record({
          componentId: 'comp-1',
          componentName: 'Button',
          stage: 'retry',
          model: 'claude-haiku-4-5',
          inputTokens: 1500,
          outputTokens: 600,
          maxTokens: 2048
        });

        const summary = tracker.getSummary();
        expect(summary.by_component['comp-1']).toBeDefined();
        expect(summary.by_component['comp-1'].calls).toBe(2);
        expect(summary.by_component['comp-1'].total_tokens).toBe(3600);
      });
    });

    describe('save and load', () => {
      it('saves records to JSONL', async () => {
        const tmpPath = path.join(__dirname, '..', 'tmp', 'test-tokens.jsonl');
        await fs.ensureDir(path.dirname(tmpPath));

        tracker.record({
          componentId: 'comp-1',
          componentName: 'Button',
          stage: 'codegen',
          model: 'claude-haiku-4-5',
          inputTokens: 1000,
          outputTokens: 500,
          maxTokens: 2048
        });

        await tracker.save(tmpPath);

        const exists = await fs.pathExists(tmpPath);
        expect(exists).toBe(true);

        const content = await fs.readFile(tmpPath, 'utf8');
        expect(content).toContain('Button');
        expect(content).toContain('codegen');

        // Cleanup
        await fs.remove(tmpPath);
      });

      it('loads records from JSONL', async () => {
        const tmpPath = path.join(__dirname, '..', 'tmp', 'test-tokens-load.jsonl');
        await fs.ensureDir(path.dirname(tmpPath));

        // Save first
        tracker.record({
          componentId: 'comp-1',
          componentName: 'Button',
          stage: 'codegen',
          model: 'claude-haiku-4-5',
          inputTokens: 1000,
          outputTokens: 500,
          maxTokens: 2048
        });
        await tracker.save(tmpPath);

        // Load into new tracker
        const newTracker = new TokenTracker();
        await newTracker.load(tmpPath);

        expect(newTracker.records.length).toBe(1);
        expect(newTracker.records[0].component_name).toBe('Button');

        // Cleanup
        await fs.remove(tmpPath);
      });
    });

    describe('parseFromLogFile', () => {
      it('extracts token usage from log', async () => {
        const tmpPath = path.join(__dirname, '..', 'tmp', 'test-log.txt');
        await fs.ensureDir(path.dirname(tmpPath));

        const logContent = `=== AGENT INPUT ===
Some prompt here
=== AGENT OUTPUT ===
Some response
[Usage: in=1234 out=5678 max=8192]
`;
        await fs.writeFile(tmpPath, logContent, 'utf8');

        const usage = await TokenTracker.parseFromLogFile(tmpPath);
        expect(usage).toEqual({
          inputTokens: 1234,
          outputTokens: 5678,
          maxTokens: 8192
        });

        // Cleanup
        await fs.remove(tmpPath);
      });

      it('returns null for missing file', async () => {
        const usage = await TokenTracker.parseFromLogFile('/nonexistent/path.txt');
        expect(usage).toBeNull();
      });
    });
  });
});
