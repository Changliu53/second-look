#!/usr/bin/env bash
# Pushes the fix for a pull request opened by open-pr.sh.
# Usage: scripts/walkthrough/push-fix.sh <scenario>
#
# The kit itself lives in the sample repository. This forwards to it.
set -euo pipefail

REPO_DIR="${SAMPLE_REPO_DIR:-$(dirname "$0")/../../../fieldops-platform-sample}"
if [ ! -x "$REPO_DIR/walkthrough/push-fix.sh" ]; then
  echo "Sample repository not found at $REPO_DIR. Clone it there or set SAMPLE_REPO_DIR."
  exit 1
fi
exec "$REPO_DIR/walkthrough/push-fix.sh" "$@"
