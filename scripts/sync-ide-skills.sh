#!/usr/bin/env bash
set -euo pipefail

# Sync IDE agent skills from the single source (.agents/skills) to tool-specific dirs.
#
#   Source:  .agents/skills/          (commit to Git — the only directory to edit)
#   Targets: .claude/skills/          (Claude Code)
#           .cursor/skills/           (Cursor)
#
# Codex reads .agents/skills directly; Claude Code and Cursor need synced copies.
# Run after adding or editing skills: npm run sync:skills

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || true)"

if [ -z "${REPO_ROOT:-}" ]; then
  REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
fi

SRC="$REPO_ROOT/.agents/skills"

if [ ! -d "$SRC" ]; then
  echo "ERROR: source directory not found: $SRC" >&2
  exit 1
fi

mkdir -p "$REPO_ROOT/.claude/skills" "$REPO_ROOT/.cursor/skills"

mirror_skills() {
  local src="$1"
  local dest="$2"
  if command -v rsync >/dev/null 2>&1; then
    rsync -a --delete "$src"/ "$dest"/
  else
    rm -rf "$dest"
    mkdir -p "$dest"
    cp -a "$src"/. "$dest"/
  fi
}

echo "-- sync IDE skills from .agents/skills"
mirror_skills "$SRC" "$REPO_ROOT/.claude/skills"
mirror_skills "$SRC" "$REPO_ROOT/.cursor/skills"

echo "Done. Synced to .claude/skills and .cursor/skills"
