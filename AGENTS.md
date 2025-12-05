The following docs should exist in the repo.
└── docs
    ├── PRODUCT-VISION.md	    # [required] What are we building, what problem does it solve         
                                # [optional] what’s in & out of scope, primary user & JTBD
                                # [optional] functional & nonfunctional requirements
    ├── ARCHITECTURE.md   	    # [required] Architecture of the solution, important assumptions 
                                # [optional]] technology choices & rationale, integrations
    ├── AGENT-TOOLS.md		    # [required] Brief catalog of relevant, installed tools agents 
                                # should use to get work done efficiently
    └── CODING-PHILOSOPHY.md    # [optional] Crucial guidance & constraints for agents

# Rules
- If any of these files do not exist, get yourself thoroughly and carefully oriented by exploring the rest of the repo, and then WRITE THAT FILE (required content only), being succinct and clear.
- PRODUCT-VISION.md and ARCHITECTURE.md may describe MORE scope than currently implemented, which is OK; they can describe a future state. However, if your assigned coding task *conflicts* with PRODUCT-VISION.md or ARCHITECTURE.md, ask the user about updating those files as well, for consistency. Consistency between docs and implementation, and amongst the docs themselves, is important for this project.
- Also: check whether your work has triggered the need for other documentation updates (e.g. README.md)
