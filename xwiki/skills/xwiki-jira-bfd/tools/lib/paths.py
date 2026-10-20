"""Where the pipeline keeps its state.

The tools may live in a read-only, shared plugin install, so nothing they produce is written
next to them unless asked: `BFD_RESULTS_DIR` names the run's directory (the xwiki-jira-bfd
skill sets it to a directory under the work directory). Without it — a checkout used for
development — results go to `tools/results/`, which is git-ignored.
"""

import os

TOOLS_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RESULTS_DIR = os.environ.get("BFD_RESULTS_DIR") or os.path.join(TOOLS_DIR, "results")
