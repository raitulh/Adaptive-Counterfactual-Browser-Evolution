#!/usr/bin/env bash
# Runs the full test suite. See docs/mvp_status.md for why this is
# unittest-based rather than pytest (zero required third-party deps).
set -euo pipefail
cd "$(dirname "$0")/.."
python3 -m unittest discover -s tests -v
