#!/usr/bin/env bash
# Opens a prepared pull request on the sample repository.
# Usage: scripts/walkthrough/open-pr.sh <scenario>
#
# The kit itself lives in the sample repository, so anyone with write access
# to that repository can run it from a clone. This forwards to it.
set -euo pipefail

REPO_DIR="${SAMPLE_REPO_DIR:-$(dirname "$0")/../../../fieldops-platform-sample}"
if [ ! -x "$REPO_DIR/walkthrough/open-pr.sh" ]; then
  echo "Sample repository not found at $REPO_DIR. Clone it there or set SAMPLE_REPO_DIR."
  exit 1
fi
exec "$REPO_DIR/walkthrough/open-pr.sh" "$@"
