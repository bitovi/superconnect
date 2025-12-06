# Superconnect – Product Vision

## What we are building

Superconnect is a command‑line tool that turns a Figma design system file and a React or Angular component repo into Figma Code Connect mappings.

It automates the pipeline from:
- Scanning a Figma file for component sets and variants
- Understanding the structure and exports of a component library (React or Angular)
- Deciding which source files implement which Figma components
- Emitting `.figma.tsx` or `.figma.ts` Code Connect files and a `figma.config.json` that Figma can consume

## Problem it solves

- Creating and maintaining Code Connect mappings by hand is tedious and error‑prone
- Design systems evolve quickly; keeping Figma and component frameworks in sync is hard
- Teams increasingly mix frameworks (React and Angular) and need consistent Code Connect coverage across both
- Each component library is organized differently, so “one size fits all” scripts tend to be brittle
- Teams need a repeatable, inspectable process rather than opaque, one‑off generation runs

Superconnect provides a repeatable, inspectable pipeline that adapts to different repos via agent‑based orientation and mapping.

## Primary users & jobs‑to‑be‑done

Primary users:
- Design system engineers and front‑end engineers who own a React or Angular design system
- Tooling/infra engineers who integrate Figma Code Connect into CI or DX tooling

Key jobs‑to‑be‑done:
- Bootstrap Code Connect coverage for an existing design system with minimal manual work
- Regenerate or update mappings safely when Figma or React/Angular components change
- Inspect what the agents decided (orientation and mapping logs) and override when needed
- Scope runs to a subset of components (e.g., “just Button and Input”) for fast iteration
