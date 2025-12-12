# Superconnect: Code Generator for Figma Code Connect

Superconnect is an AI-powered code generation tool that turns a Figma design system file and a React or Angular component repo into Figma Code Connect mappings. It:

- Scans your Figma file
- Explores your React or Angular component repo
- Generates a set of Code Connect files for you (`.figma.tsx` or `.figma.ts`), ready to be published to your Figma file

# Installation

- Install globally from npm
  - `npm install -g superconnect`
  - now you can run `superconnect` from any React or Angular repo

- Or use npx without a global install
  - `npx superconnect`

# Required environment and config

- Requires Node.js >= 20.0.0
- Environment variables
  - `FIGMA_ACCESS_TOKEN` – Figma personal access token used by the Figma scan stage
  - `ANTHROPIC_API_KEY` – required when `backend = "claude"` (default)
  - `OPENAI_API_KEY` – required when `backend = "openai"`
  - these can be set in your shell or in an `.env` file in your React or Angular repo

- superconnect.toml
  - Superconnect seeks `superconnect.toml` config file in the current working directory
  - If missing, the tool will prompt you the first time and then write the config file for you

# Workflow

## 0. Pre-requisites

You have:

- a Figma file containing some components
  - assumes an Enterprise Figma account, and that you have full write permissions
- a repo implementing those same components (React or Angular)

## 1. Figma access token

Superconnect relies on a Figma personal access token, which you generate. You must have full write permissions to the Figma file and Code Connect must be enabled in your "Enterprise"-level Figma org.

### Getting a Figma access token

- In Figma, open your account menu
- Choose **Settings** (or **Profile & Settings**)
- Scroll to **Personal access tokens**
- Click **Generate new token** and make sure it has the scopes listed below
- Give it a descriptive name and copy the token value
- In your terminal environment (or `.env` in your component repo), set
  - `FIGMA_ACCESS_TOKEN=<your token here>`

Minimum scopes for the token:

- Files
  - `file_content:read`  (to download the Figma file and component nodes during the scan stage)
- Development
  - `file_code_connect:write`  (to write Code Connect content)
  - `file_dev_resources:read` + `write`  (to read and write Code Connect content)

## 2. Publish Figma assets

For Code Connect mappings to work, assets from the design system must first be "published" within Figma. (Reminder, your Figma design system file should be in an Enterprise org where you have edit rights.)

- Switch to the **Assets** tab in the left sidebar (must not be in dev mode)
- Click the **Library** icon to open the **Manage libraries** dialog
- Under **This file**, you should see your design system file listed
- Click **Publish…**

## 3. Code Generation

From the root of your React or Angular component repo, run `superconnect`. It will prompt you for the Figma file URL and save your settings to a config file, `superconnect.toml`. You can set your preferred AI -- the default is 'claude' (claude-haiku-4-5), and ANTHROPIC_API_KEY is assumed to be in your environment. If you switch to 'openai' (gpt-5.1-codex-mini), it will look for your OPENAI_API_KEY. 

`superconnect` will:

- Inspect the repo and figure out if it's React or Angular (combination projects not supported!)
- Scan the components in your Figma file
- Find the corresponding components in your repo
- Write out a set of Code Connect mappings to:
  - `codeConnect/*.figma.tsx` for React
  - `codeConnect/*.figma.ts` for Angular
- Generate `figma.config.json` at the repo root so the Figma CLI knows what to publish

At this point you have local Code Connect mappings but Figma does not see them yet.

## 4. Publish mappings to Figma

Next you push the generated mappings to Figma using Figma's own CLI. You must have `@figma/code-connect` installed in the component repo or globally. Run:

```bash
npx figma connect publish
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
  5. Finalizer (scripts/finalize.js)
      - Input: everything above
      - Output: A human-friendly run summary printed to stdout (no file), with colored sections and stats, plus figma.config.json written at the repo root (parser/label and include globs set for React or Angular)


# Agent Backends

Superconnect abstracts the “agent” through adapters; you choose the backend in superconnect.toml:

- Claude SDK (backend = "claude")
    - Uses @anthropic-ai/sdk
    - Requires ANTHROPIC_API_KEY
    - sdk_model sets the Claude model (e.g., claude-haiku-4-5)
    - max_tokens caps response length
- OpenAI SDK (backend = "openai")
    - Uses the openai Responses API
    - Requires OPENAI_API_KEY
    - sdk_model sets the OpenAI model (e.g., gpt-5.1-codex-mini)
    - max_tokens caps response length

Agents log to superconnect/orienter-agent.log and superconnect/mapping-agent-logs

# Outputs

`superconnect` writes these files to your component repo:

- In superconnect/:
    - figma-components-index.json: canonical list of Figma components
    - figma-components/*.json: per-component extracted Figma metadata
    - repo-summary.json: lightweight summary of the repo (framework detection, Angular component metadata, exports)
    - orientation.jsonl: agent suggestions for which files to read for each Figma component
    - component-logs/*.json: per-component codegen decisions and metadata
    - mapping-agent-logs/*.log, orienter-agent.log: raw agent interaction logs
- In codeConnect/
    - *.figma.tsx or *.figma.ts files for each successfully mapped component, ready for Code Connect
- At repo root:
    - figma.config.json pointing Code Connect to generated files (uses react parser for .tsx, html parser for .ts)


# Interrupts & Reruns

The pipeline is designed for graceful partial runs:

- Ctrl+C during codegen
    - Codegen finishes the current component, then stops processing more
    - superconnect/component-logs/ and codeConnect/ contain whatever was completed so far
    - The pipeline still runs the finalizer, so you get an accurate summary of what was built versus skipped
- Rerunning without --force
    - Repo summary, Figma scan, and orienter are skipped if their outputs already exist
    - Codegen re-invokes the agent for each mapped component but:
        - Does not overwrite existing .figma.tsx files unless --force is used
        - Marks such components as “skipped” with an explanatory reason
- Rerunning with --force
    - Clears relevant logs and lets codegen overwrite existing .figma.tsx files
    - Upstream stages are re-run as needed (Figma scan, summary, orientation)

This makes it safe to interrupt, inspect, tweak prompts/config, and then rerun the pipeline without losing context
