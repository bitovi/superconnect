# Superconnect: Code Generator for Figma Code Connect

Superconnect is an AI-powered code generation tool that writes your Figma Code Connect mappings for you. It does this by:

- Scanning your Figma file via API
- Exploring your React or Angular component repo
- Using coding agents to generate `.figma.tsx` or `.figma.ts` files

Then you publish these back to your Figma file using Figma's own CLI tool to `figma connect publish`.

Figma Code Connect [also offers an interactive setup to help create Code Connect files](https://developers.figma.com/docs/code-connect/quickstart-guide/#use-the-interactive-setup), but Superconnect:

- **Works fully automatically** - no interactive terminal prompts, maps all components in one run
- **Supports Angular/HTML** - Figma's interactive setup and AI features only work for React components; Angular requires manual mapping
- **Lets you bring your own AI model** - use Claude, OpenAI, or switch to a smarter model if needed

# Installation

- Run directly with npx (recommended for one-off use)
  - `npx @bitovi/superconnect@latest`

- Install globally from npm
  - `pnpm add -g @bitovi/superconnect`
  - `npm install -g @bitovi/superconnect`
  - `yarn global add @bitovi/superconnect`

- Install from git
  - clone this repo
  - `pnpm install && pnpm link`

# Required environment and config

- Requires Node.js >= 22.0.0
- Environment variables (set in your shell or in a `.env` file in your repo)
  - `FIGMA_ACCESS_TOKEN` – Figma personal access token (see [Figma access token](#1-figma-access-token) below)
  - One AI provider key (depending on which API you choose):
    - `ANTHROPIC_API_KEY` – for Anthropic Claude (the default)
    - `OPENAI_API_KEY` – for OpenAI or OpenAI-compatible endpoints

- superconnect.toml
  - Superconnect looks for this config file in the current working directory
  - If missing, the tool will prompt you on first run and create it for you

# Workflow

## 0. Pre-requisites

You have:

- a Figma file with components, an Enterprise Figma account, and write permissions to that file
- a repo implementing those same components (React or Angular)
- the Figma Code Connect CLI installed (`@figma/code-connect`)
  - `npm install -g @figma/code-connect`
  - `pnpm add -g @figma/code-connect`
  - `yarn global add @figma/code-connect`

## 1. Figma access token

Superconnect relies on a Figma personal access token, which you create through Figma. To get the token:

- In Figma, open your account menu
- Choose **Settings** (or **Profile & Settings**)
- Scroll to **Personal access tokens**
- Click **Generate new token** and make sure it has the scopes listed below
- Give it a descriptive name and copy the token value
- In your terminal environment (or `.env` in your component repo), set
  - `FIGMA_ACCESS_TOKEN=<your token here>`

### Scopes for the token

- Files
  - `file_content:read` (to read components)
- Development
  - `file_code_connect:write`  (to write Code Connect content)
  - `file_dev_resources:read` + `write`  (to read and write Code Connect content)

## 2. Publish Figma assets (if not already published)

For Code Connect mappings to work, assets from the design system must first be "published" within Figma. If you've already published your design system components, you can skip this step.

To publish (or verify publication status):

- Switch to the **Assets** tab in the left sidebar (not in dev mode)
- Click the **Library** icon (looks like a book) to open the **Manage libraries** dialog
- Under **This file**, you should see your design system file listed
- If not already published, click **Publish…**

(Reminder: your Figma design system file should be in an Enterprise org where you have edit rights.)

## 3. Code Generation

From the root of your React or Angular component repo, run `superconnect`. It will prompt you for the Figma file URL and save your settings to a config file, `superconnect.toml`. 

`superconnect` will proceed to:

- Inspect the repo and figure out if it's React or Angular (combination projects not supported!)
- Scan the components in your Figma file
- Find the corresponding components in your repo
- Write out a set of Code Connect mappings to:
  - `codeConnect/*.figma.tsx` for React
  - `codeConnect/*.figma.ts` for Angular
- Generate `figma.config.json` at the repo root so the Figma CLI knows what to publish

At this point you have local Code Connect mappings but Figma does not see them yet.

## 4. Publish mappings to Figma 

Next you push the generated mappings back to Figma, using Figma's own CLI. You must have `@figma/code-connect` installed in the component repo or globally. Run:

```bash
figma connect publish

# or, without a global install
npx --package @figma/code-connect figma connect publish
```

This command reads `figma.config.json`, uploads your Code Connect files, and associates them with the Figma file.

## 5. Profit

Now you can inspect the mappings in Figma.

- Open the design system file and switch into Dev Mode
- Select an instance of a component you mapped (for example, a Button)
- In the right-hand sidebar, scroll to the **Code Connect** section
- Click the **Connect Components** button or the **View connections** button and then select the Button component

You should now see:

- The Code Connect mapping written by Superconnect
- The generated example snippet for your framework (React JSX or Angular template)
- Any props that were inferred from Figma variants or component properties

If the **Code Connect** section is missing

- Double-check that
  - `figma connect publish` completed successfully
  - The Assets panel shows your design system file as published
  - Your Figma user has access to the Enterprise org and file where mappings were published


# How It Works

Superconnect runs a five-stage pipeline:

1. **Repo summarizer** - Scans your React or Angular repo for components and structure
2. **Figma scan** - Downloads component metadata from your Figma file via API
3. **Orienter** - AI decides which source files correspond to each Figma component
4. **Codegen** - AI generates `.figma.tsx` (React) or `.figma.ts` (Angular) mappings
5. **Finalizer** - Writes `figma.config.json` and prints a summary

All artifacts are written to `superconnect-logs/` and `codeConnect/` directories in your repo. For implementation details, see `docs/ARCHITECTURE.md`.


# Agent Configuration

Superconnect uses Claude's Agent SDK by default, which allows the model to intelligently explore your codebase using tools. This typically results in lower token usage and better context selection.

Configure the `[agent]` section in `superconnect.toml`:

```toml
[agent]
# Backend for code generation:
#   "anthropic-agent-sdk"     (default) — Claude explores your codebase using tools
#   "anthropic-messages-api"  — Anthropic Messages API (curated context)
#   "openai-chat-api"        — OpenAI Chat Completions API or compatible provider
api = "anthropic-agent-sdk"
model = "claude-sonnet-4-5"
```

| API | Environment Variable | Description |
|-----|---------------------|-------------|
| `anthropic-agent-sdk` (default) | `ANTHROPIC_API_KEY` | Claude Agent SDK with tool-based exploration |
| `anthropic-messages-api` | `ANTHROPIC_API_KEY` | Anthropic Messages API (deterministic context) |
| `openai-chat-api` | `OPENAI_API_KEY` | OpenAI Chat Completions API or compatible endpoint |

**When to use `anthropic-messages-api` (Messages API):**
- Provider flexibility — works with OpenAI, local models, or other LLM providers
- Deterministic context — you control exactly what the model sees
- Restricted AI access — model cannot explore beyond curated files

**Using OpenAI-compatible endpoints:** Set `api = "openai-chat-api"` and add `llm_proxy_url` for services like LiteLLM, Azure OpenAI, vLLM, or LocalAI.

# Output Files

Generated files in your repo:

**superconnect-logs/** - Pipeline artifacts
- `repo-summary.json` - Detected components and framework info
- `figma-components-index.json` - Figma component catalog
- `figma-components/*.json` - Per-component Figma metadata
- `orientation.jsonl` - File-to-component mappings
- `orienter-agent.log`, `codegen-summaries/*.json`, `codegen-agent-transcripts/*.log` - Agent logs

**codeConnect/** - Generated Code Connect files
- `*.figma.tsx` (React) or `*.figma.ts` (Angular)

**Root** - Configuration
- `figma.config.json` - Tells Figma CLI what to publish


# Interrupts & Reruns

The pipeline is designed for graceful partial runs:

- Ctrl+C during codegen
    - Codegen finishes the current component, then stops processing more
    - superconnect-logs/codegen-summaries/, codegen-agent-transcripts/, and codeConnect/ contain whatever was completed so far
    - The pipeline still runs the finalizer, so you get an accurate summary of what was built versus skipped
- Rerunning without `--force`
    - Repo summary, Figma scan, and orienter are skipped if their outputs already exist
    - Codegen re-invokes the agent for each mapped component but:
        - Does not overwrite existing .figma.tsx files unless `--force` is used
        - Marks such components as “skipped” with an explanatory reason
- Rerunning with `--force`
    - Clears relevant logs and lets codegen overwrite existing .figma.tsx files
    - Upstream stages are re-run as needed (Figma scan, summary, orientation)

This makes it safe to interrupt, inspect, tweak prompts/config, and then rerun the pipeline without losing context


# Troubleshooting

## Getting an old version with npx

npx caches packages locally. If you're getting an older version of Superconnect:

```bash
# Always use @latest to ensure you get the current version
npx @bitovi/superconnect@latest

# Or clear the npx cache entirely
npx clear-npx-cache
# Then run again
npx @bitovi/superconnect@latest
```

## Missing environment variables

If you see errors about missing API keys:

1. **FIGMA_ACCESS_TOKEN** - See [Figma access token](#1-figma-access-token) above
2. **ANTHROPIC_API_KEY** or **OPENAI_API_KEY** - Get from your AI provider's dashboard

Set these in your shell or in a `.env` file in your component repo.
