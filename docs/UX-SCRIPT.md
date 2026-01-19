# Superconnect UX Script

This document shows the exact terminal output for all superconnect CLI flows. Implementation tasks must match this script exactly.

**Notation:**
- `[green]text[/green]` - green colored text
- `[cyan]text[/cyan]` - cyan colored text
- `[dim]text[/dim]` - dimmed/gray text
- `[yellow]text[/yellow]` - yellow colored text
- `[red]text[/red]` - red colored text
- `[bold]text[/bold]` - bold text
- `[highlight]text[/highlight]` - highlighted (typically cyan with special formatting)
- `<user input>` - text entered by user

---

## Flow 1: No Config, Run `superconnect`

User runs `superconnect` without `superconnect.toml` file present.

```
Superconnect v0.3.2 (abc1234)

No configuration found. Run this first:

  [highlight]superconnect init[/highlight]

This creates superconnect.toml with your Figma file URL and settings.
```

**Exit code:** 1

---

## Flow 2: Init Flow (Complete Session)

User runs `superconnect init` in an empty directory.

### 2.1: Welcome and Environment Check

```
Superconnect generates Figma Code Connect mappings using AI.

This wizard creates superconnect.toml, which stores:
  • Your Figma design file URL
  • Your component library location  
  • AI provider settings

After setup, you can review the config and then run `superconnect` to generate.

[dim]Environment check:[/dim]
  [green]✓[/green] FIGMA_ACCESS_TOKEN [dim](found in environment)[/dim]
  [green]✓[/green] ANTHROPIC_API_KEY [dim](found in environment)[/dim]
  [dim]-[/dim] OPENAI_API_KEY [dim](not set)[/dim]

[dim]Missing keys? See: https://github.com/bitovi/superconnect#required-environment-and-config[/dim]

[bold]Setup[/bold]: we'll write these settings to [highlight]./superconnect.toml[/highlight]
[dim]Press Enter to accept [default values][/dim]

```

### 2.2: Figma URL Prompt (Valid Input)

```
[cyan]Figma file URL (paste the URL of your design system file)[/cyan]: <https://www.figma.com/design/ABC123/MyDesignSystem>
```

### 2.3: Figma URL Prompt (Invalid Input - Error Path)

```
[cyan]Figma file URL (paste the URL of your design system file)[/cyan]: <not-a-url>
[red]That doesn't look like a Figma URL. Expected format: https://www.figma.com/design/ABC123/... or just the file key (ABC123)[/red]
[cyan]Figma file URL (paste the URL of your design system file)[/cyan]: <ABC123>
```

### 2.4: Repo Path Prompt (Valid Input)

```
[cyan]Path to your component code[/cyan] [[dim].[/dim]]: <Enter>
```

### 2.5: Repo Path Prompt (Invalid Path - Error Path)

```
[cyan]Path to your component code[/cyan] [[dim].[/dim]]: </invalid/path>
[red]Directory not found: /invalid/path. Please enter a valid path.[/red]
[cyan]Path to your component code[/cyan] [[dim].[/dim]]: <.>
```

### 2.6: Repo Path Prompt (No package.json - Warning Path)

```
[cyan]Path to your component code[/cyan] [[dim].[/dim]]: <./some-dir>
[yellow]Note: No package.json found. Make sure this is your component library root.[/yellow]
```

### 2.7: AI Provider Prompt

```

[bold]Agent API Configuration[/bold]
[dim]Choose which AI service to use for code generation[/dim]
[cyan]AI provider (claude, openai)[/cyan] [[dim]claude[/dim]]: <Enter>
```

### 2.8: AI Provider Prompt (OpenAI with Custom Endpoint)

```
[cyan]AI provider (claude, openai)[/cyan] [[dim]claude[/dim]]: <openai>

[dim]OpenAI-compatible endpoints: LiteLLM, Azure OpenAI, vLLM, LocalAI, etc.[/dim]
[cyan]Custom base URL (optional, press Enter to use api.openai.com)[/cyan]: <http://localhost:4000/v1>
[dim]Using custom endpoint:[/dim] http://localhost:4000/v1
[cyan]Custom API key (optional, press Enter to use OPENAI_API_KEY env var)[/cyan]: <Enter>
```

### 2.9: Post-Config Summary (All Keys Present)

```
[green]✓[/green] Created superconnect.toml

Before running generation, ensure you have:
  [green]✓[/green] FIGMA_ACCESS_TOKEN      [dim](found in environment)[/dim]
  [green]✓[/green] ANTHROPIC_API_KEY       [dim](found in environment)[/dim]

You can customize superconnect.toml to adjust:
  • concurrency    - parallel processing (lower if hitting rate limits)
  • colocation     - put .figma.tsx next to components vs centralized
  • max_retries    - retry attempts for validation errors

Ready to generate Code Connect files? [[dim]y/N[/dim]]: <n>

[dim]Next steps:[/dim]
  1. Optionally edit [highlight]superconnect.toml[/highlight]
  2. Run [highlight]superconnect[/highlight] to generate files
```

### 2.10: Post-Config Summary (Missing Required Key)

```
[green]✓[/green] Created superconnect.toml

Before running generation, ensure you have:
  [green]✓[/green] FIGMA_ACCESS_TOKEN      [dim](found in environment)[/dim]
  [dim]-[/dim] ANTHROPIC_API_KEY       [dim](not set - required for Claude)[/dim]

You can customize superconnect.toml to adjust:
  • concurrency    - parallel processing (lower if hitting rate limits)
  • colocation     - put .figma.tsx next to components vs centralized
  • max_retries    - retry attempts for validation errors

Ready to generate Code Connect files? [[dim]y/N[/dim]]: <n>

[dim]Next steps:[/dim]
  1. Set missing environment variables (see above)
  2. Optionally edit [highlight]superconnect.toml[/highlight]
  3. Run [highlight]superconnect[/highlight] to generate files
```

### 2.11: Post-Config Summary (Custom LLM Endpoint Warning)

```
[green]✓[/green] Created superconnect.toml

Before running generation, ensure you have:
  [green]✓[/green] FIGMA_ACCESS_TOKEN      [dim](found in environment)[/dim]
  [green]✓[/green] OPENAI_API_KEY          [dim](found in environment)[/dim]

[yellow]⚠[/yellow]  You configured a custom LLM endpoint. Verify llm_proxy_url in superconnect.toml.

You can customize superconnect.toml to adjust:
  • concurrency    - parallel processing (lower if hitting rate limits)
  • colocation     - put .figma.tsx next to components vs centralized
  • max_retries    - retry attempts for validation errors

Ready to generate Code Connect files? [[dim]y/N[/dim]]: <y>

[proceeds to run generation]
```

### 2.12: Init When Config Already Exists

```
[green]OK[/green] [highlight]./superconnect.toml[/highlight] already exists
[bold]Setup[/bold]: we'll write these settings to [highlight]./superconnect.toml[/highlight]
[dim]Press Enter to accept [default values][/dim]

[cyan]Figma file URL (paste the URL of your design system file)[/cyan]: 
...
[continues with normal flow, overwrites existing file]
```

---

## Flow 3: Run Flow (With Config)

User runs `superconnect` with valid `superconnect.toml` file present.

```
[green]✓[/green] Using [highlight]superconnect.toml[/highlight] in /Users/dev/my-components
  [dim]Tip: Run "superconnect init" again to change settings[/dim]

Superconnect v0.3.2 (abc1234)
Target repo: /Users/dev/my-components
[dim]Environment variables found:[/dim]
  [green]OK[/green] FIGMA_ACCESS_TOKEN [dim](from target repo .env)[/dim]
  [green]OK[/green] ANTHROPIC_API_KEY [dim](from your environment)[/dim]
  [dim]-[/dim] OPENAI_API_KEY [dim](not set)[/dim]

[dim]AI provider: anthropic-agent-sdk (from config)[/dim]

[dim]Plan:[/dim]
  Target: [highlight]/Users/dev/my-components[/highlight]
  Figma: [highlight]https://www.figma.com/design/ABC123/MyDesignSystem[/highlight]
  Output: [highlight]colocated next to components[/highlight]
  Stages: repo [highlight]scan[/highlight], figma [highlight]scan[/highlight], orienter [highlight]run[/highlight], codegen [highlight]run[/highlight]

Proceed with generation? [[dim]Y/n[/dim]]: 
```

---

## Flow 4: Generated superconnect.toml

Complete contents of `superconnect.toml` after running init with Claude (default):

```toml
# Superconnect configuration
#
# This file tells superconnect where to find your Figma design system
# and how to generate Code Connect mappings.
#
# Common customizations:
#   [codegen] concurrency  - Lower to 1-2 if hitting rate limits
#   [codegen] colocation   - Set false to put all files in codeConnect/
#   [agent] model          - Change AI model (e.g., claude-sonnet-4-5)
#
# Docs: https://github.com/bitovi/superconnect#readme

[inputs]
figma_file_url = "https://www.figma.com/design/ABC123/MyDesignSystem"
component_repo_path = "."
# Also requires FIGMA_ACCESS_TOKEN env var

[agent]
# Backend for code generation:
#   "anthropic-agent-sdk"     (default) — Claude explores your codebase using tools
#   "anthropic-messages-api"  — Anthropic Messages API (curated context)
#   "openai-chat-api"        — OpenAI Chat Completions API or compatible provider
api = "anthropic-agent-sdk"
model = "claude-sonnet-4-5"

# Alternative backends:
#   api = "anthropic-messages-api"   # Messages API (deterministic context)
#   api = "openai-chat-api"
#   model = "gpt-5.2-codex"
#   llm_proxy_url = "http://localhost:4000/v1"  # LiteLLM, Azure, vLLM, LocalAI

[codegen]
# How many times to retry if generated code fails validation (0-10)
max_retries = 4

# Number of components to process in parallel (1-16)
# Higher = faster, but may cause errors with some LLM proxies (LiteLLM, Bedrock, etc.)
# If you see 503/rate-limit errors, try lowering this to 1
concurrency = 5

# Place Code Connect files next to source components (default: true)
# When true: Button.tsx → Button.figma.tsx in same directory
# When false: all files go to code_connect_output_dir
# colocation = true

# Where to write Code Connect files when colocation = false (default: codeConnect/)
# code_connect_output_dir = "codeConnect"

[figma]
# How deep to scan Figma's component tree. Increase if nested variants aren't detected.
# layer_depth = 3
```

### Variant: OpenAI with Custom Endpoint

```toml
# Superconnect configuration
#
# This file tells superconnect where to find your Figma design system
# and how to generate Code Connect mappings.
#
# Common customizations:
#   [codegen] concurrency  - Lower to 1-2 if hitting rate limits
#   [codegen] colocation   - Set false to put all files in codeConnect/
#   [agent] model          - Change AI model (e.g., claude-sonnet-4-5)
#
# Docs: https://github.com/bitovi/superconnect#readme

[inputs]
figma_file_url = "https://www.figma.com/design/ABC123/MyDesignSystem"
component_repo_path = "."
# Also requires FIGMA_ACCESS_TOKEN env var

[agent]
# AI provider: "anthropic-agent-sdk" (default) or "openai-chat-api"
# Anthropic requires ANTHROPIC_API_KEY env var
# OpenAI requires OPENAI_API_KEY env var (or use llm_proxy_url for LiteLLM, Azure, etc.)
api = "openai-chat-api"
model = "gpt-5.2-codex"
llm_proxy_url = "http://localhost:4000/v1"

# To use Anthropic instead, comment out the above and uncomment:
# api = "anthropic-agent-sdk"
# model = "claude-sonnet-4-5"

[codegen]
# How many times to retry if generated code fails validation (0-10)
max_retries = 4

# Number of components to process in parallel (1-16)
# Higher = faster, but may cause errors with some LLM proxies (LiteLLM, Bedrock, etc.)
# If you see 503/rate-limit errors, try lowering this to 1
concurrency = 5

# Place Code Connect files next to source components (default: true)
# When true: Button.tsx → Button.figma.tsx in same directory
# When false: all files go to code_connect_output_dir
# colocation = true

# Where to write Code Connect files when colocation = false (default: codeConnect/)
# code_connect_output_dir = "codeConnect"

[figma]
# How deep to scan Figma's component tree. Increase if nested variants aren't detected.
# layer_depth = 3
```

---

## Design Notes

### Terminology Consistency

**Approved terms (use these):**
- "Figma file URL" or "Figma design file URL"
- "component code" or "component library"
- "AI provider" (Claude, OpenAI)
- "generate" (not "run generation")
- "Code Connect files"

**Deprecated terms (do NOT use):**
- "component repo path" ❌
- "agent API" ❌
- "agent SDK" ❌ (use in toml comments as technical detail only)
- "run generation now" ❌

### Color Usage

- Green `✓` for success/found
- Dim `-` for not set/missing
- Yellow `⚠` for warnings
- Red for errors
- Cyan for prompts
- Dim for explanatory text
- Highlight (cyan+special) for commands and file names

### Validation Rules

1. **Figma URL**: Must match `https://www.figma.com/(file|design)/[A-Za-z0-9]+` OR be 22-char alphanumeric
2. **Repo path**: Must exist as directory; warn (don't error) if no package.json
3. **AI provider**: Accept aliases: `claude` → `anthropic-agent-sdk`, `openai` → `openai-chat-api`

### Error Recovery

All validation errors should:
- Show clear error message in red
- Explain what format is expected
- Re-prompt immediately (don't exit)

### Spacing

- Blank line before major sections
- Two blank lines after environment check before prompts
- Blank line between prompt groups
