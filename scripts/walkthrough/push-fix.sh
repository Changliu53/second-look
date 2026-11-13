#!/usr/bin/env bash
# Pushes the author's fixes to the pull request opened by open-pr.sh.
# Usage: scripts/walkthrough/push-fix.sh <scenario>
set -euo pipefail

KIT_DIR="$(cd "$(dirname "$0")" && pwd)"
SCENARIO="${1:-}"
SCENARIO_DIR="$KIT_DIR/scenarios/$SCENARIO"
REPO_DIR="${SAMPLE_REPO_DIR:-$KIT_DIR/../../../fieldops-platform-sample}"
BRANCH_FILE="$REPO_DIR/.git/walkthrough-$SCENARIO"

if [ -z "$SCENARIO" ] || [ ! -d "$SCENARIO_DIR/fix" ]; then
  echo "Usage: $0 <scenario>"
  exit 1
fi
if [ ! -f "$BRANCH_FILE" ]; then
  echo "No open walkthrough for '$SCENARIO'. Run open-pr.sh $SCENARIO first."
  exit 1
fi

BRANCH="$(cat "$BRANCH_FILE")"
cd "$REPO_DIR"
git checkout -q "$BRANCH"
cp -R "$SCENARIO_DIR/fix/." .
git add -A
git commit -q -m "Address review comments"

if [ -n "${DRY_RUN:-}" ]; then
  echo "Dry run: fix committed on $BRANCH, nothing pushed."
  exit 0
fi

git push -q
echo "Pushed the fix to $BRANCH. A new review is starting."
