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


# Implementation

Superconnect runs five logical stages:

  1. Repo summarizer (scripts/summarize-repo.js) -- scans a React/Typescript or Angular component repo to get the lay of the land
      - Input: repo root (component_repo_path)
      - Output: superconnect/repo-summary.json (exports, file structure hints, detected frameworks, Angular component selectors/modules/templates, etc.)
  2. Figma scan (scripts/figma-scan.js) -- scans a design system in Figma and extracts component metadata
      - Input: Figma URL/key + Figma token
      - Output:
          - superconnect/figma-components-index.json
          - One JSON per component set in superconnect/figma-components/
  3. Orienter (scripts/run-orienter.js) -- first step of the code generation phase; agent narrows which files to use for each Figma component
      - Input: Figma index + repo summary + optional target framework hint
      - Output: superconnect/orientation.jsonl (one JSON per Figma component), oriented logs grouped with codegen in stdout coloring; supports --dry-run and fake outputs for tests
  4. Codegen (scripts/run-codegen.js) -- a series of agents that each write a single Code Code mapping file {component}.figma.tsx (React) or {component}.figma.ts (Angular). If the agent isn't confident about a mapping, it will log its explanation or fall back to stubs for Angular
      - Input:
          - superconnect/orientation.jsonl
          - superconnect/figma-components/{component}.json
          - superconnect/repo-summary.json (framework hints, Angular components)
          - Source files from the component repo
      - Output: codeConnect/{component}.figma.tsx or .figma.ts
      - Agents follow Figma's Code Connect API documentation:
          - React: https://developers.figma.com/docs/code-connect/react/
          - HTML/Angular: https://developers.figma.com/docs/code-connect/html/
  5. Finalizer (scripts/finalize.js)
      - Input: everything above
      - Output: A human-friendly run summary printed to stdout (no file), with colored sections and stats, plus figma.config.json written at the repo root (parser/label and include globs set for React or Angular)


# Agent Configuration

Superconnect uses AI to generate your Code Connect mappings. By default it uses Anthropic's Claude, but you can switch to OpenAI or any OpenAI-compatible service.

## Choosing an API

The `api` setting determines which API format Superconnect uses to communicate with AI services.

Edit the `[agent]` section in `superconnect.toml`:

```toml
[agent]
api = "anthropic"             # or "openai"
model = "claude-haiku-4-5"    # model to use
```

| API | Environment Variable | Example Models | Notes |
|-----|---------------------|----------------|-------|
| `anthropic` (default) | `ANTHROPIC_API_KEY` | claude-haiku-4-5, claude-sonnet-4-20250514 | Anthropic Claude only |
| `openai` | `OPENAI_API_KEY` | gpt-5.1-codex-mini | OpenAI + any compatible service |

**Note:** Setting `api = "openai"` doesn't mean you're using OpenAI's service—it means you're using the OpenAI-compatible API format. You can route to any provider using `base_url`.

## Custom OpenAI-Compatible Endpoints (Advanced)

Many services implement the OpenAI API format. You can use them by setting `api = "openai"` and adding a custom `base_url`:

```toml
[agent]
api = "openai"
base_url = "http://localhost:4000/v1"  # your proxy endpoint
model = "gpt-5.1-codex-mini"
```

Common use cases:
- **LiteLLM** - proxy/gateway for 100+ LLM providers
- **Azure OpenAI** - Microsoft's hosted OpenAI with enterprise security
- **vLLM** - self-hosted inference server
- **LocalAI** - run models offline

When using a custom endpoint, the API key comes from `OPENAI_API_KEY` (or set `api_key` in TOML if your proxy needs a different key).

For connection issues with custom endpoints, see [docs/NETWORK-TROUBLESHOOTING.md](docs/NETWORK-TROUBLESHOOTING.md).

Code gen agents log to superconnect/orienter-agent.log, superconnect/codegen-summaries/, and superconnect/codegen-agent-transcripts/

# Outputs

`superconnect` writes these files to your component repo:

- In superconnect/:
    - figma-components-index.json: canonical list of Figma components
    - figma-components/*.json: per-component extracted Figma metadata
    - repo-summary.json: lightweight summary of the repo (framework detection, Angular component metadata, exports)
    - orientation.jsonl: agent suggestions for which files to read for each Figma component
    - orienter-agent.log: orientation agent interaction logs
    - codegen-summaries/*.json: per-component codegen results (status, attempts, errors)
    - codegen-agent-transcripts/*.log: full agent I/O transcripts for debugging
- In codeConnect/
    - *.figma.tsx or *.figma.ts files for each successfully mapped component, ready for Code Connect
- At repo root:
    - figma.config.json pointing Code Connect to generated files (uses react parser for .tsx, html parser for .ts)


# Interrupts & Reruns

The pipeline is designed for graceful partial runs:

- Ctrl+C during codegen
    - Codegen finishes the current component, then stops processing more
    - superconnect/codegen-summaries/, codegen-agent-transcripts/, and codeConnect/ contain whatever was completed so far
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
