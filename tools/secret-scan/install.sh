#!/usr/bin/env bash
#
# Install the ScienceDash pre-commit secret guard into this repo's git hooks.
# Run once after cloning:  bash tools/secret-scan/install.sh

set -euo pipefail

REPO_ROOT=$(git rev-parse --show-toplevel)
SRC="$REPO_ROOT/tools/secret-scan/pre-commit"
DEST="$REPO_ROOT/.git/hooks/pre-commit"

cp "$SRC" "$DEST"
chmod +x "$DEST"

echo "✓ Installed pre-commit secret guard → $DEST"
echo "  (Optional but recommended: install gitleaks for deeper scanning —"
echo "   https://github.com/gitleaks/gitleaks)"
