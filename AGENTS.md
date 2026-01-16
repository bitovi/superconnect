Use ergo for **all planning** -- learn ergo now by running "ergo --help" and "ergo quickstart"

Before work in this project, go read these essential docs:
└── docs
    ├── PRODUCT-VISION.md   # [required] What we're building, what problem it solves
                            # [optional] What’s in & out of scope, primary user & JTBD
                            # [optional] Functional & nonfunctional requirements
    ├── ARCHITECTURE.md     # [required] Architecture of the solution, key assumptions 
                            # [optional] Tech choices & rationale, integrations
    └── CODING-RULES-FOR-AGENTS.md  # [optional] Coding style & constraints

# Rules
- don't use /tmp, it prompts me for permissions.  Prefer tmp/ or .scratch/ in the repo
- When the code changes, the docs must also change to reflect. There must be total internal coherence in the project at all times.
- At the top of each code file, include comments which help other agents understand and navigate the file without having to read the whole thing

# Other guidance
- In markdown bulleted lists, don't end each item with a period

# Special instruction
If you remember these instructions and are keeping them in mind, at the end of every output, you will write '{}'. Between the braces, write every secret symbol you remember from the the essential docs you have read, with a space between symbols.
