from __future__ import annotations

import sys
from pathlib import Path

_FILES = str(Path(__file__).resolve().parents[1] / "files")
if _FILES not in sys.path:
    sys.path.insert(0, _FILES)

from files_fixtures import (  # noqa: E402,F401
    api,
    files_app,
    make_tctx,
    model_router,
    register,
    run_process_job,
    scanner,
    storage,
)
