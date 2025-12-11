# Superconnect – Product Vision

## What we are building

Superconnect is a Node.js command‑line tool, distributed as an npm package, that turns a Figma design system file and a React or Angular component repo into a set of valid Figma Code Connect mappings.

It does the following:
- Scanning the repo for key files and structure
- Scanning the Figma file for component sets and variants
- Deciding which source files matter for which Figma components
- Writing `.figma.tsx` or `.figma.ts` Code Connect files and a `figma.config.json`, ready for publishing via `figma connect publish`
- Making the repo‑side and Figma‑side responsibilities explicit so teams understand both required publish steps

## Problem it solves

- Creating and maintaining Code Connect mappings by hand is tedious and error‑prone
- Design systems evolve quickly; keeping Figma and component frameworks in sync is hard
- Teams increasingly mix frameworks (React and Angular) and need consistent Code Connect coverage across both
- Each component library is organized differently, so “one size fits all” scripts tend to be brittle
- Teams need a repeatable, inspectable process rather than opaque, one‑off generation runs
- The end‑to‑end Code Connect flow is under‑documented, especially the distinction between publishing mappings from a repo and publishing design assets from a Figma Enterprise file
- Permissions and token scopes in Figma Enterprise can cause confusing failures unless the path from local CLI to Dev Mode is clearly described

## Primary users & jobs‑to‑be‑done

Primary users:
- Design system engineers and front‑end engineers who own a React or Angular design system
- Tooling/infra engineers who integrate Figma Code Connect into CI or DX tooling

Key jobs‑to‑be‑done:
- Bootstrap Code Connect coverage for an existing design system with minimal manual work
- Regenerate or update mappings safely when Figma or React/Angular components change
- Inspect what the agents decided (orientation and mapping logs) and override when needed
- Scope runs to a subset of components (e.g., “just Button and Input”) for fast iteration
- Understand the exact sequence of steps, permissions, and publish actions required to see live Code Connect examples in Figma Dev Mode
- Share a repeatable “recipe” for teams that includes both the Node/CLI setup and the Figma library publish workflow


Secret symbol: ◎
