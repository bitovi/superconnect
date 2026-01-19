# Superconnect UX Mini-Tour

A quick walkthrough of the improved first-time user experience.

---

## Scenario 1: First-time user tries to run without setup

**Before (old UX):**
```
Superconnect v0.3.2
Setup required: create ./superconnect.toml first
Run: superconnect init
```

**After (new UX):**
```
Superconnect v0.3.2 (abc1234)

No configuration found. Run this first:

  superconnect init

This creates superconnect.toml with your Figma file URL and settings.
```

**Improvement:** Friendlier, explains *what* the command does, not just demanding you run it.

---

## Scenario 2: Running init for the first time

### Welcome and Environment Check

**New:**
```
Superconnect generates Figma Code Connect mappings using AI.

This wizard creates superconnect.toml, which stores:
  • Your Figma design file URL
  • Your component library location
  • AI provider settings

After setup, you can review the config and then run `superconnect` to generate.

Environment check:
  ✓ FIGMA_ACCESS_TOKEN (found in environment)
  ✓ ANTHROPIC_API_KEY (found in environment)
  - OPENAI_API_KEY (not set)

Missing keys? See: https://github.com/bitovi/superconnect#required-environment-and-config

Setup: we'll write these settings to ./superconnect.toml
Press Enter to accept [default values]
```

**Improvements:**
- **Clear purpose statement** - users understand what superconnect does
- **Early environment check** - surface missing API keys before prompts
- **Sets expectations** - explains the init→run workflow

---

### Improved Prompts

**Before (old UX):**
```
Enter Figma file URL or key: not-a-url
[accepts invalid input, fails later]

Enter component repo path [.]: /invalid/path
[accepts invalid path, fails later]

Agent API (anthropic-agent-sdk, anthropic-messages-api, openai-chat-api) [anthropic-agent-sdk]:
```

**After (new UX):**
```
Figma file URL (paste the URL of your design system file): not-a-url
That doesn't look like a Figma URL. Expected format: https://www.figma.com/design/ABC123/... or just the file key (ABC123)
Figma file URL (paste the URL of your design system file): ABC123
✓

Path to your component code [.]: /invalid/path
Directory not found: /invalid/path. Please enter a valid path.
Path to your component code [.]: .
Note: No package.json found. Make sure this is your component library root.

Agent API Configuration
Choose which AI service to use for code generation
AI provider (anthropic-agent-sdk, anthropic-messages-api, openai-chat-api) [anthropic-agent-sdk]: anthropic-agent-sdk
✓
```

**Improvements:**
- **Plain language** - "Figma file URL" instead of jargon
- **Inline validation** - catches errors immediately with helpful messages
- **Accurate technical names** - "anthropic-agent-sdk" for precision
- **Contextual help** - warns if package.json missing

---

### Post-Config Summary

**Before (old UX):**
```
OK Wrote your configs to superconnect.toml
Run generation now? [y/N]: n
Next: run superconnect
```

**After (new UX):**
```
✓ Created superconnect.toml

Before running generation, ensure you have:
  ✓ FIGMA_ACCESS_TOKEN      (found in environment)
  ✓ ANTHROPIC_API_KEY       (found in environment)

You can customize superconnect.toml to adjust:
  • concurrency    - parallel processing (lower if hitting rate limits)
  • colocation     - put .figma.tsx next to components vs centralized
  • max_retries    - retry attempts for validation errors

Ready to generate Code Connect files? [y/N]: n

Next steps:
  1. Optionally edit superconnect.toml
  2. Run superconnect to generate files
```

**Improvements:**
- **Re-confirms environment** - gives one last check before running
- **Explains customization options** - users know what they can tweak
- **Numbered next steps** - clear path forward
- **Context-aware** - if keys missing, adds step to set them first

---

## Scenario 3: Running superconnect with config

**Before (old UX):**
```
OK Using superconnect.toml in /Users/dev/my-components
Superconnect v0.3.2
Target repo: /Users/dev/my-components
...
```

**After (new UX):**
```
✓ Using superconnect.toml in /Users/dev/my-components
  Tip: Run "superconnect init" again to change settings

Superconnect v0.3.2 (abc1234)
Target repo: /Users/dev/my-components
...
```

**Improvement:** Subtle tip reminds users they can re-run init to change settings.

---

## Key UX Principles Applied

1. **Speak plain English** - "Figma file URL" not "figma_file_url or key"
2. **Fail fast with help** - Validate immediately and explain what's expected
3. **Surface problems early** - Check environment variables before prompts
4. **Guide, don't demand** - Friendly explanations instead of terse errors
5. **Make the implicit explicit** - Explain the init→run workflow
6. **Provide escape hatches** - Show how to fix issues (numbered steps, links)

---

## Terminology Consistency

✅ **Use everywhere:**
- "Figma file URL" (not "Figma URL", "figma_file_url", or "file key")
- "Path to your component code" (not "component repo", "repo path")
- "AI provider" (with full technical names for accuracy)
- "generate" (not "run generation", "process")

✅ **Technical accuracy in prompts:**
- Use full API names: "anthropic-agent-sdk", "anthropic-messages-api", "openai-chat-api"
- Show all options so users understand what's available
- Accept shortcuts like "openai" → "openai-chat-api" via normalization

Note: Technical names ensure users know exactly what they're configuring.

---

## Testing the New Flow

Try these scenarios:

```bash
# 1. First-time experience (no config)
rm superconnect.toml 2>/dev/null
npx @bitovi/superconnect

# 2. Init with validation errors
npx @bitovi/superconnect init
# Enter: "not-a-url" → see error
# Enter: "/fake/path" → see error

# 3. Init with missing package.json
mkdir .scratch/test-no-pkg
npx @bitovi/superconnect init
# Enter path: .scratch/test-no-pkg → see warning

# 4. Init with API shortcuts
npx @bitovi/superconnect init
# At AI provider prompt, try: "openai", "anthropic"

# 5. Run with config present
npx @bitovi/superconnect
# See tip about re-running init
```

---

**Implementation Status:** 4/7 tasks complete
- ✓ Welcome and environment check
- ✓ Plain language prompts with validation
- ✓ Post-config summary
- ✓ Run flow messaging
- ⏳ Documentation updates
- ⏳ End-to-end review
