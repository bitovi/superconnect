# Superconnect: Code Generator for Figma Code Connect

Superconnect is an AI-powered code generation tool that writes your Figma Code Connect mappings for you. It does this by:

- Scanning your Figma file via API
- Exploring your React or Angular component repo
- Using coding agents to generate `.figma.tsx` or `.figma.ts` files

Then you publish these back to your Figma file using Figma's own CLI tool to `figma connect publish`.

Figma Code Connect [also offers an interactive setup to help create Code Connect files](https://developers.figma.com/docs/code-connect/quickstart-guide/#use-the-interactive-setup), but Superconnect:

- **Works fully automatically** - no interactive terminal prompts, maps all components in one run
- **Supports Angular/HTML** - Figma's interactive setup and AI features only work for React components; Angular requires manual mapping
- **Uses advanced agent tools** - agents explore your codebase intelligently during generation, finding the right files and understanding your architecture

# Installation

- Install from npm
  - `pnpm add -g @bitovi/superconnect`

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

- `superconnect.toml`
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

## 2. Publish Figma assets

For Code Connect mappings to work, assets from the design system must first be "published" within Figma. (Reminder, your Figma design system file should be in an Enterprise org where you have edit rights.)

- Switch to the **Assets** tab in the left sidebar (not in dev mode)
- Click the **Library** icon (looks like a book) to open the **Manage libraries** dialog
- Under **This file**, you should see your design system file listed
- Click **Publish…**

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


# Pipeline Stages

Superconnect runs a four-stage pipeline:

1. **Repo indexer** (`scripts/build-repo-index.js`) — builds searchable index of codebase for agent tools
   - Input: Component repo path
   - Output: `superconnect/repo-index.json` (file tree, imports, exports, component definitions)

2. **Figma scan** (`scripts/figma-scan.js`) — extracts component metadata from Figma
   - Input: Figma URL/key + API token
   - Output: `superconnect/figma-components-index.json` and per-component JSON files

3. **Unified codegen** (`scripts/run-codegen.js`) — generates Code Connect files using agent with tools
   - Agent explores source files via `queryIndex`, `readFile`, `listFiles` tools
   - Output: `codeConnect/{component}.figma.tsx` (React) or `.figma.ts` (Angular)
   - Agents follow Figma's Code Connect API:
     - [React docs](https://developers.figma.com/docs/code-connect/react/)
     - [HTML/Angular docs](https://developers.figma.com/docs/code-connect/html/)

4. **Finalizer** (`scripts/finalize.js`) — summarizes run and writes `figma.config.json`


# Agent Configuration

Superconnect uses Claude Sonnet 4 by default to generate Code Connect mappings. Configure in `superconnect.toml`:

```toml
[agent]
api = "anthropic"
model = "claude-sonnet-4-20250514"
```

**Environment variable:** `ANTHROPIC_API_KEY`

# Outputs

Superconnect writes files to your component repo:

**In `superconnect/` directory:**
- `figma-components-index.json` — list of Figma components
- `figma-components/*.json` — per-component Figma metadata
- `repo-index.json` — searchable codebase index for agent tools
- `codegen-summaries/*.json` — per-component results (status, attempts, metrics)
- `codegen-agent-transcripts/*.log` — full agent I/O for debugging

**In `codeConnect/` directory:**
- `*.figma.tsx` or `*.figma.ts` — generated Code Connect files

**At repo root:**
- `figma.config.json` — configuration for Code Connect CLI


# Interrupts & Reruns

The pipeline is designed for graceful partial runs:

- Ctrl+C during codegen
    - Codegen finishes the current component, then stops processing more
    - superconnect/codegen-summaries/, codegen-agent-transcripts/, and codeConnect/ contain whatever was completed so far
    - The pipeline still runs the finalizer, so you get an accurate summary of what was built versus skipped
- Rerunning without --force
    - Skips stages with existing outputs (Figma scan, repo index)
    - Does not overwrite existing .figma.tsx files
    - Marks such components as "skipped" with an explanatory reason
- Rerunning with --force
    - Re-runs all stages and overwrites existing Code Connect files

This makes it safe to interrupt, inspect, tweak prompts/config, and then rerun the pipeline without losing context
