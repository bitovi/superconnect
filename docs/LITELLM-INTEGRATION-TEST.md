# LiteLLM Integration Test

This document describes how to manually test LiteLLM support in Superconnect.

## Prerequisites

- LiteLLM installed (`pip install litellm[proxy]`)
- An API key for at least one LLM provider (e.g., OpenAI, Anthropic, Azure, etc.)
- A test Figma file with components
- A test component repository (e.g., fixtures/react-sample or fixtures/angular-sample)

## Test Setup

### 1. Start LiteLLM Proxy

Create a LiteLLM config file `litellm_config.yaml`:

```yaml
model_list:
  - model_name: gpt-4
    litellm_params:
      model: gpt-4
      api_key: YOUR_OPENAI_API_KEY
  - model_name: claude-3-sonnet
    litellm_params:
      model: claude-3-sonnet-20240229
      api_key: YOUR_ANTHROPIC_API_KEY
```

Start the proxy:
```bash
litellm --config litellm_config.yaml --port 4000
```

The proxy should start on http://localhost:4000

### 2. Configure Superconnect

In your test repo's `superconnect.toml`:

```toml
[inputs]
figma_url = "YOUR_FIGMA_URL"
component_repo_path = "."

[agent]
backend = "openai"
sdk_model = "gpt-4"  # or claude-3-sonnet
base_url = "http://localhost:4000/v1"
api_key = "sk-1234"  # LiteLLM doesn't validate keys by default
max_tokens = 2048
```

### 3. Set Environment Variables

```bash
export FIGMA_ACCESS_TOKEN=your_figma_token
# Note: OPENAI_API_KEY not needed since we're using base_url with LiteLLM
```

## Test Execution

### Test 1: Orientation Stage

Run just the orienter to verify LiteLLM connectivity:

```bash
cd fixtures/react-sample  # or your test repo
node ../../scripts/run-orienter.js \
  --figma-index superconnect/figma-components-index.json \
  --repo-summary superconnect/repo-summary.json \
  --output superconnect/orientation.jsonl \
  --agent-backend openai \
  --agent-model gpt-4 \
  --agent-base-url http://localhost:4000/v1 \
  --agent-api-key sk-1234
```

**Expected:**
- Orienter completes successfully
- `superconnect/orientation.jsonl` is created
- LiteLLM proxy shows the request in its logs

### Test 2: Full Pipeline

Run the complete pipeline:

```bash
cd fixtures/react-sample
npx superconnect
```

**Expected:**
- All pipeline stages complete
- Code Connect files generated in `codeConnect/`
- No network errors
- LiteLLM proxy logs show multiple requests

### Test 3: Verify Backward Compatibility

Remove `base_url` and `api_key` from `superconnect.toml`, set `OPENAI_API_KEY`:

```toml
[agent]
backend = "openai"
sdk_model = "gpt-4"
```

```bash
export OPENAI_API_KEY=your_real_openai_key
npx superconnect
```

**Expected:**
- Pipeline connects directly to OpenAI (not through LiteLLM)
- Works identically to previous versions

## Troubleshooting

### LiteLLM Connection Errors

If you see connection errors:

1. Check LiteLLM is running: `curl http://localhost:4000/v1/models`
2. Check LiteLLM logs for errors
3. Verify `base_url` includes `/v1` suffix
4. Check `superconnect/orienter-agent.log` for detailed error info

### Model Not Found

If LiteLLM reports model not found:
- Ensure the model name in TOML matches one in `litellm_config.yaml`
- Check LiteLLM proxy logs for model loading errors

### Certificate Errors

If you get TLS/SSL errors with LiteLLM:
- Use `http://` not `https://` for local LiteLLM (unless you've configured SSL)
- See [NETWORK-TROUBLESHOOTING.md](NETWORK-TROUBLESHOOTING.md) for corporate environment issues

## Validation

After running the test, verify:

1. ✅ LiteLLM proxy received requests (check proxy logs)
2. ✅ Orientation completed successfully
3. ✅ Code generation completed for at least one component
4. ✅ Generated `.figma.tsx` files are syntactically valid
5. ✅ Error messages mention custom endpoint URL (if errors occur)
6. ✅ Backward compatibility works (direct OpenAI without `base_url`)

## Clean Up

```bash
# Stop LiteLLM proxy (Ctrl+C)
# Remove test outputs
rm -rf superconnect/ codeConnect/ figma.config.json
```
