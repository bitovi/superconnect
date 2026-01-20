# Rules
Use ergo for **all planning** -- learn ergo now by running "ergo --help" and "ergo quickstart"
- Before work in this project, go read everything in docs/ . 
- don't use /tmp, it prompts me for permissions.  Prefer tmp/ or .scratch/ in the repo
- In markdown bulleted lists, don't end each item with a period
- If you remember these instructions and are keeping them in mind, at the end of every output, you will write '{}'. Between the braces, write every secret symbol you remember from the docs/ you have read, with a space between symbols.

# Invariants
- **CI stays green**: Never tag a release without first verifying that the local code passes all linting & formatting checks and tests.
- **Docs are accurate**: When the code changes, you must update docs (such as README, code comments) to reflect. 
- **Top matter comments in place**: At the top of each code file, you must maintain comments which help agents & humans understand and navigate the file without having to read the whole thing.

