# Network Troubleshooting

This guide helps diagnose and resolve network connectivity issues when running Superconnect in corporate or restricted network environments.

## Common Symptoms

- Any pipeline stage (Figma scan, orienter, codegen) fails with exit code 1
- Error messages mentioning "fetch failed", "ENOTFOUND", "ECONNREFUSED", "ETIMEDOUT", "ECONNRESET"
- TLS/SSL certificate errors or "self-signed certificate" messages
- Warning: `NODE_TLS_REJECT_UNAUTHORIZED environment variable to '0'`
- Authentication errors (401/403) that work on other networks

## Quick Diagnostics

### 1. Test API Connectivity

For Figma API:
```bash
curl -v https://api.figma.com/v1/me -H "X-Figma-Token: YOUR_TOKEN"
```

For Claude (Anthropic):
```bash
curl -v https://api.anthropic.com/v1/messages
```

For OpenAI:
```bash
curl -v https://api.openai.com/v1/models
```

For LiteLLM or custom endpoints:
```bash
# Replace with your actual endpoint URL
curl -v http://localhost:4000/v1/models -H "Authorization: Bearer YOUR_API_KEY"
```

If these fail, you have a network connectivity issue.

### 2. Check Log Files

When any stage fails, Superconnect writes detailed error information to log files:

- **Figma scan**: Error shown directly in console output (no separate log file)
- **Orienter**: `superconnect/orienter-agent.log`
- **Codegen**: `superconnect/codegen-agent-transcripts/*.log` (one per component)

These log files contain:
- Complete error details (type, code, status, message)
- Stack traces (if available)
- Full request/response information

Always check these logs first for detailed diagnostic information.

## Common Issues and Solutions

### Corporate Proxy

If your organization uses a corporate proxy:

```bash
# Set proxy environment variables
export HTTP_PROXY=http://proxy.company.com:8080
export HTTPS_PROXY=http://proxy.company.com:8080

# Or with authentication
export HTTP_PROXY=http://username:password@proxy.company.com:8080
export HTTPS_PROXY=http://username:password@proxy.company.com:8080
```

### Certificate Issues

Corporate networks often use custom SSL certificates or man-in-the-middle inspection.

**Best solution:** Ask your IT department to add the API provider's certificates to your system trust store.

**Workaround (INSECURE - testing only):**
```bash
export NODE_TLS_REJECT_UNAUTHORIZED=0
```

⚠️ **Warning:** This disables certificate verification completely and makes your connections insecure. Only use for testing to confirm that certificates are the issue, then work with IT for a proper solution.

### Firewall Rules

Ensure these domains and ports are allowed:

- **Figma API:** `api.figma.com` port 443
- **Claude (Anthropic):** `api.anthropic.com` port 443
- **OpenAI:** `api.openai.com` port 443
- **Custom endpoints:** Your configured `base_url` (e.g., `localhost:4000` for LiteLLM)

### Using LiteLLM or Custom Endpoints

LiteLLM provides a proxy/gateway that can help in corporate environments by:
- Routing through a single internal endpoint
- Supporting 100+ LLM providers
- Providing unified API interface

To configure a custom OpenAI-compatible endpoint in `superconnect.toml`:

```toml
[agent]
backend = "openai"
base_url = "http://localhost:4000/v1"  # LiteLLM proxy
api_key = "sk-your-key"  # optional, overrides OPENAI_API_KEY
sdk_model = "gpt-4"  # or your model name
```

Or via environment variables:
```bash
export OPENAI_BASE_URL=http://localhost:4000/v1
export OPENAI_API_KEY=sk-your-key
```

This is useful when:
- Your IT team runs an internal LiteLLM proxy
- You need to route through Azure OpenAI
- Corporate firewall blocks direct OpenAI/Claude access
- You want to use vLLM or other OpenAI-compatible servers

### VPN Issues

Some VPNs block or restrict API access:

1. Try running with VPN **connected**
2. Try running with VPN **disconnected**
3. Try connecting through a different VPN profile (if available)

### DNS Resolution

Test DNS resolution:
```bash
nslookup api.figma.com
nslookup api.anthropic.com
nslookup api.openai.com
```

If DNS fails, you may need to:
- Configure custom DNS servers
- Add entries to `/etc/hosts` (requires IT assistance)

## Getting Help

When reporting network issues, include:

1. **Which stage failed**: Figma scan, orienter, or codegen
2. The complete error message from the terminal
3. Contents of the relevant log file (if available):
   - `superconnect/orienter-agent.log` for orienter
   - `superconnect/codegen-agent-transcripts/*.log` for codegen
4. Results of the "Quick Diagnostics" curl commands (for all three APIs)
5. Your network environment (corporate network, VPN, proxy, etc.)
6. Operating system and Node.js version (`node --version`)

## Switching to a Different Provider

If one API provider is blocked, try switching:

In `superconnect.toml`:
```toml
[agent]
backend = "openai"  # or "claude"
```

Or via command-line flag:
```bash
npx superconnect --agent-backend openai
```

Different providers may have different network accessibility in your environment.
