#!/usr/bin/env bash
# Opens a pull request on the sample repository from a prepared scenario.
# Usage: scripts/walkthrough/open-pr.sh <scenario>
set -euo pipefail

KIT_DIR="$(cd "$(dirname "$0")" && pwd)"
SCENARIO="${1:-}"
SCENARIO_DIR="$KIT_DIR/scenarios/$SCENARIO"
REPO_DIR="${SAMPLE_REPO_DIR:-$KIT_DIR/../../../fieldops-platform-sample}"

if [ -z "$SCENARIO" ] || [ ! -d "$SCENARIO_DIR/change" ]; then
  echo "Usage: $0 <scenario>"
  echo "Scenarios: $(ls "$KIT_DIR/scenarios" | tr '\n' ' ')"
  exit 1
fi
if [ ! -d "$REPO_DIR/.git" ]; then
  echo "Sample repository not found at $REPO_DIR. Set SAMPLE_REPO_DIR."
  exit 1
fi

# A fresh branch name each time, so the scenario can be run again.
BRANCH="feature/$SCENARIO-$(date +%m%d-%H%M%S)"
TITLE="$(head -n 1 "$SCENARIO_DIR/title.txt")"

cd "$REPO_DIR"
git checkout -q main
if [ -z "${DRY_RUN:-}" ]; then
  git pull -q --ff-only
fi
git checkout -q -b "$BRANCH"
cp -R "$SCENARIO_DIR/change/." .
git add -A
git commit -q -m "$TITLE"

# Remembered for push-fix.sh. Kept inside .git so it is never committed.
echo "$BRANCH" > ".git/walkthrough-$SCENARIO"

if [ -n "${DRY_RUN:-}" ]; then
  echo "Dry run: committed on $BRANCH, nothing pushed."
  exit 0
fi

git push -q -u origin "$BRANCH"
gh pr create --base main --head "$BRANCH" --title "$TITLE" --body-file "$SCENARIO_DIR/body.md"
echo "Opened. Watch it at your Second Look dashboard."
