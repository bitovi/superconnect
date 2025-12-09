# Superconnect: Code Generator for Figma Code Connect

Superconnect is an AI-enhanced tool that turns a Figma design system file and a React or Angular component repo into Figma Code Connect mappings. It:

- Scans your design system in Figma and extracts component metadata
- Explores your React/Typescript or Angular component repo to understand exports, file structure, and patterns
- Generates `.figma.tsx` (React) or `.figma.ts` (Angular) Code Connect files

# Quickstart

  1. Install dependencies (in this repo)
     npm install
  
  2. Link the CLI globally (so you can run it from any React or Angular repo)
     npm link
  
  3. Set up your environment variables
      - Figma: Set FIGMA_ACCESS_TOKEN in your environment to allow the script to access your design system Figma file
      - Agent backend: Claude (default): requires ANTHROPIC_API_KEY, OpenAI requires OPENAI_API_KEY

  4. Run it from your React or Angular repo root

     superconnect
     # or if you prefer npx with the linked binary:
     npx --no-install superconnect

      If superconnect.toml is missing in the current directory, you’ll be prompted for:
        - Figma URL or file key
        - Component repo path root
        - Agent backend (default to claude with claude-haiku-4-5)
        - Optional target framework hint (react|angular)

      This will:
        - Scan your repo for components/exports (including Angular components, selectors, and modules)
        - Scan your Figma file and find all the components
        - Run orientation + code generation to produce codeConnect/*.figma.tsx or *.figma.ts
        - Report on which components it was able to code gen, which it wasn't, and why
        - Write figma.config.json in the repo root for Code Connect to discover generated files

  4. Wire it up in Figma and view Code Connect output
      - Add the new codeConnect/*.figma.tsx files to git and push to your main branch
      - Open your design system file in Figma
      - In Figma Dev/Code view, add your code repo as a Code Connect source
      - Navigate to a component that Superconnect successfully generated
      - Open the Code / Code Connect panel:
          - Select the corresponding Code Connect mapping
          - You should see the generated JSX and props schema in the Code Connect UI, linked to the selected Figma component

# Configuration

Superconnect is configured via a superconnect.toml in the current working directory, but will create it for you if it doesn't exist

# Pipeline Stages

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

Running the full pipeline (once configured) produces (in your component repo):

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
- Printed to stdout:
    - A colorized Superconnect run summary showing:
        - Scanning stats (Figma file, component counts)
        - Repo scan stats
        - Codegen stats (orientation coverage, candidates, built vs skipped, reasons)
        - Where logs and generated files live

# ZapUI E2E validation

- Initialize the ZapUI fixture submodule: `git submodule update --init fixtures/zapui`
- Ensure FIGMA_ACCESS_TOKEN and ANTHROPIC_API_KEY are set (or stored in .env)
- Run `npm run test:e2e:zapui` to copy the ZapUI repo to a temp dir, run Superconnect for Angular, then `figma connect parse` and `figma connect publish --dry-run`
- Optional verbose mode: add an npm config flag (`npm run test:e2e:zapui --zapui-e2e-verbose=true`) or pass `--verbose` (`npm run test:e2e:zapui -- --verbose`, note npm itself becomes verbose); env alternative: `ZAPUI_E2E_VERBOSE=1`
- Uses the Zap UI Kit Figma file at https://www.figma.com/design/GqZ6Bvsu8w8q2ukS1FDPX7/Zap-UI-Kit--Community-?m=auto&t=GVF9lkWuNBY6BgRq-6
- Chakra React E2E:
  - Initialize the Chakra submodule: `git submodule update --init fixtures/chakra-ui`
  - Ensure FIGMA_ACCESS_TOKEN and ANTHROPIC_API_KEY are set (or stored in .env)
  - Run `npm run test:e2e:chakra` to copy Chakra to a temp dir, run Superconnect for React with a limited `--only` subset, then `figma connect parse` and `figma connect publish --dry-run`
  - Default subset (~10): Button, Input, Checkbox, Switch, Select, Tabs.List, Tabs.Trigger, Accordion, Tooltip, Card (override via `CHAKRA_E2E_ONLY` or `--chakra-e2e-only=`); verbose via `--chakra-e2e-verbose` or `-- --verbose`
  - Uses the Chakra UI Figma file at https://www.figma.com/design/mgzCV3zD3iWpctEI6UoUhB/Chakra-UI

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
