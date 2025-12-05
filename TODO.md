# Figma Code Connect AI POC - TODO

## Project Overview

This project demonstrates automated Figma Code Connect integration using AI to bridge design and code.
NOTE: The active pipeline is JSON-only; any YAML references below are legacy/backlog items.

---

## Phase 1: Component Discovery (COMPLETED)

- [x] Fetch Figma components via API (`fetchComponents.js`)
- [x] Parse component variants and properties
- [x] Generate YAML files in `figma-variants/` directory
- [x] Build Figma configuration (`buildFigmaConfig.js`)

---

## Phase 2: Code Analysis (COMPLETED)

- [x] Create component props extraction script (`code-component-scanner.js`, replacing `extractComponentProps.js`)
- [x] Scan React TypeScript components in `chakra-ui/apps/compositions/src/ui/`
- [x] Extract component interfaces and prop types
- [x] Generate YAML files in `components-props/` directory (226 components extracted)
- [x] Fix exported interface detection bug
- [x] Validate prop extraction across all components

---

## Phase 3: Figma Design Updates (IN PROGRESS)

### Recreate Components in Figma

Update Figma file components to match Code Connect structure:

- [x] **Button Component**
  - [x] Recreate with proper variants matching `ButtonProps`
  - [x] Ensure variant properties align with code (size, variant, colorPalette, loading, disabled)
  - [x] Test Code Connect mapping

- [x] **Alert Component**
  - [x] Recreate with proper variants matching `AlertProps`
  - [x] Ensure variant properties align with code (startElement, endElement, title, icon)
  - [x] Test Code Connect mapping

- [ ] **Avatar Component**
  - [ ] Recreate with proper variants matching `AvatarProps`
  - [ ] Ensure variant properties align with code (size, variant, shape, etc.)
  - [ ] Test Code Connect mapping

- [ ] **Accordion Component**
  - [ ] Recreate with proper variants matching `AccordionProps`
  - [ ] Ensure variant properties align with code (variant, size, collapsible, etc.)
  - [ ] Test Code Connect mapping


### Code Requirements

- [ ] **Component Structure Organization**
  - [ ] Reorganize project structure to group component artifacts together
  - [ ] Create folder structure where each component has its own directory (JSON artifacts)
  - [ ] Migrate existing files from `figma-variants/` to new structure
  - [ ] Migrate existing files from `components-props/` to new structure
  - [ ] Update scripts to read/write from new organized structure
  - [ ] Group primitive components under `components/primitives/` subfolder
  - [ ] Benefits:
    - All component artifacts in one place
    - Easier to find related files
    - Better scalability for large component libraries
    - Clearer organization for automated Code Connect generation

### Design Requirements

  - [ ] Match extracted component props from component folders (e.g., `components/button/button.code-props.json`)
- [ ] Use consistent naming between Figma variants and code props
- [ ] Ensure all boolean props have corresponding boolean variants in Figma
- [ ] Align enum values between Figma variant options and code prop types
- [ ] Document variant-to-prop mapping strategy for each component
- [ ] Test that Code Connect mappings work correctly with new structure
- [ ] Create Figma component naming convention guide
- [ ] Ensure Figma component nodes match expected file structure

---

## Phase 4: Automated Code Connect Generation (PLANNED)

- [ ] **Script Development**
  - [ ] Create script to scan organized `components/` folder structure
  - [ ] Auto-match `*.code-props.json` with `*.figma-variants.json` per component
  - [ ] Generate `.figma.tsx` Code Connect files
  - [ ] Support both primitive and composite component types

- [ ] **Mapping Logic**
  - [ ] Implement intelligent prop-to-variant matching algorithm
  - [ ] Handle type conversions (boolean, enum, string, number)
  - [ ] Map nested props to nested Figma properties
  - [ ] Generate proper import statements for component paths
  - [ ] Handle optional vs required props correctly

- [ ] **Validation & Testing**
  - [ ] Validate generated `.figma.tsx` files against Code Connect schema
  - [ ] Test mappings with Figma Dev Mode
  - [ ] Verify all variants are properly mapped
  - [ ] Create validation report for each component
  - [ ] Test end-to-end workflow from code extraction to Figma connection

- [ ] **Documentation**
  - [ ] Document the automated generation process
  - [ ] Create troubleshooting guide for common mapping issues
  - [ ] Add examples of generated Code Connect files

---

## Phase 5: Integration & Testing (PLANNED)

- [ ] Set up automated testing for Code Connect
- [ ] Create documentation for the workflow
- [ ] Implement CI/CD integration
- [ ] Create demo showcasing the complete flow
