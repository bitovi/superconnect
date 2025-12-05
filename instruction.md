# Figma Connect AI Proof of Concept: Project Instructions

## Overview

This project automates the generation of `.figma.tsx` files for React components, enabling seamless Figma-to-code handoff. The workflow is divided into three clear phases, each building on the previous to produce robust, production-ready component wrappers that map Figma variants to React props.

---

## Project Phases

### **Phase 1: Fetch Figma Variant Data**
- **Script:** `fetchComponents.js`
- **Output Directory:** `figma-variants/`
- **Purpose:**
  - Extracts variant and property data from Figma components.
  - Stores results as JSON files in `figma-variants/`.
- **How to Run:**
  - Execute `node fetchComponents.js <fileKey|Figma URL> --token <figmaApiToken>`
  - Required inputs:
    - `<fileKey|Figma URL>`: The file key or a full Figma URL (first positional arg)
    - Output format: JSON only
    - `--token <figmaApiToken>`: Your Figma API access token (or set `FIGMA_ACCESS_TOKEN` in `.env`)
  - Example:
    - `node fetchComponents.js https://www.figma.com/design/abc123xyz/My-Design --token <your_token>`
  - Ensure you have Figma API credentials set up if required.

### **Phase 2: Extract Component Props and Recipe Variants**
- **Prompt Reference:** `PROPS_EXTRACTIONS_PROMPS.md`
- **Output Directory:** `components-props/`
- **Purpose:**
  - Extracts TypeScript prop definitions, recipe variants, and mapping hints from Chakra UI components.
  - Stores results as JSON files in `components-props/`.
- **How to Run:**
  - Follow the instructions in `PROPS_EXTRACTIONS_PROMPS.md` to run the extraction script.
  - The script will parse component source files and output prop metadata.

### **Phase 3: Generate `.figma.tsx` Files**
- **Prompt Reference:** `CODE_CONNECT_GENERATION_PROMPT.md`
- **Script:** To be built as `scripts/generateFigmaConnect.js`
- **Purpose:**
  - Uses outputs from Phases 1 & 2 to generate `.figma.tsx` wrappers for each component.
  - Maps Figma variants to React props, providing a ready-to-use integration layer.
- **How to Run:**
  - Follow the requirements in `CODE_CONNECT_GENERATION_PROMPT.md` to build the script.
  - Run the script with options like `--dry-run`, `--overwrite`, `--filter <component>`, and `--verbose`.
  - The script will create `.figma.tsx` files in each component's folder under `chakra-ui/packages/react/src/components/<component>/`.

---

## Output Structure

- **`figma-variants/`**: Contains Figma variant data for each component (JSON).
- **`components-props/`**: Contains extracted prop definitions and mapping hints (JSON).
- **`chakra-ui/packages/react/src/components/<component>/<component>.figma.tsx`**: Auto-generated wrapper files mapping Figma variants to React props.

---

## Example Workflow

1. **Fetch Figma Data:**
   - Run Phase 1 script to populate `figma-variants/`.
2. **Extract Props:**
   - Run Phase 2 script to populate `components-props/`.
3. **Generate Wrappers:**
   - Build and run Phase 3 script to generate `.figma.tsx` files.

---

## Tips for New Contributors

- **Node.js & TypeScript:** Basic knowledge is helpful but not required; scripts are self-contained and documented.
- **Figma API:** You may need an access token for Phase 1.
- **JSON:** Familiarity will help in understanding the output files.
- **Error Handling:** All scripts are designed to log errors and warnings clearly. Use `--verbose` for more details.
- **Customization:** You can filter components or preview output before writing files using CLI options.

---

## Troubleshooting

- If you encounter missing data, check that both `figma-variants/` and `components-props/` are populated before running Phase 3.
- For API issues, verify your Figma credentials and network access.
- For script errors, use the `--verbose` flag and consult the logs for details.

---

## Additional Resources

- `README.md`: Project overview and quickstart.
- `PROPS_EXTRACTIONS_PROMPS.md`: Details on prop extraction.
- `CODE_CONNECT_GENERATION_PROMPT.md`: Full requirements for the wrapper generation script.
- `instruction.md`: This file, for step-by-step guidance.

---

## Summary

By following these phases, you can automate the creation of Figma-integrated React component wrappers, making your design-to-code workflow faster, more reliable, and easier for new team members to adopt.
