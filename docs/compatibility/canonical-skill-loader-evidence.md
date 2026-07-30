# Canonical Skill loader evidence

Recorded on 2026-07-30 on macOS.

## Layout under test

- Physical package: isolated `HOME/.agents/skills/mcv-loader-probe/SKILL.md`
- Claude Code projection: one directory symlink at
  `~/.claude/skills/mcv-loader-probe`
- The complete Claude Skills root remained a regular directory.

The probe Skill required an exact loader-specific response and prohibited tool
use. The temporary Claude projection was created only after confirming that the
path did not exist and was removed immediately after the run.

## Codex

- Loader: `codex-cli 0.146.0-alpha.3.1`
- Invocation: isolated `HOME`, existing authenticated `CODEX_HOME`, read-only
  non-interactive `codex exec`
- Result: `MCV_CODEX_LOADER_OK`

This proves that Codex discovered the physical package through the conventional
Agent Skills location used by the Canonical Device Skill Store.

## Claude Code

- Loader: Claude Code `2.1.168`
- Invocation: authenticated non-interactive `claude -p` using a per-Skill
  projection to the isolated physical package
- Result: `MCV_CLAUDE_LOADER_OK`

This proves that this Claude Code version follows a directory symlink at
`~/.claude/skills/<skill>` and discovers the projected Skill package. It does
not establish support for linking the complete Claude Skills root.
