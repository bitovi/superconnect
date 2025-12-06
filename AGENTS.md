Read these essential docs:
└── docs
    ├── PRODUCT-VISION.md       # [required] What are we building, what problem does it solve         
                                # [optional] what’s in & out of scope, primary user & JTBD
                                # [optional] functional & nonfunctional requirements
    ├── ARCHITECTURE.md         # [required] Architecture of the solution, important assumptions 
                                # [optional] technology choices & rationale, integrations
    ├── AGENT-TOOLS.md          # [required] Brief catalog of relevant, installed tools agents 
                                # should use to get work done efficiently
    └── CODING-PHILOSOPHY.md    # [optional] Crucial guidance & constraints for agents

# Rules
- If an essential doc does not exist, orient yourself as best you can, then WRITE THAT FILE (required sections only), being succinct and clear.
- PRODUCT-VISION.md and ARCHITECTURE.md may describe an unimplemented goal state, which is OK. However, if your assigned coding task *conflicts outright* with PRODUCT-VISION.md or ARCHITECTURE.md, ask the user if you should update those files as well, for consistency. Consistency between docs and implementation, and amongst the docs themselves, is crucial for this project.
- Also: check whether your work has triggered the need for other documentation updates (e.g. README.md)

# Other guidance
- In markdown lists, don't end each entry with a period

