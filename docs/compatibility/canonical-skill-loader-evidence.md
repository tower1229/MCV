# Canonical Skill loader evidence

Recorded on 2026-07-30 on macOS.

## Compatibility matrix

| Surface | Platform | Managed directory links | Evidence |
| --- | --- | --- | --- |
| Codex | macOS | enabled | `MCV_CODEX_LOADER_OK` via physical Store path |
| Claude Code | macOS | enabled | `MCV_CLAUDE_LOADER_OK` via per-Skill directory symlink |
| Gemini CLI | macOS | enabled | discovered via per-Skill directory symlink at `~/.gemini/skills/<skill>` |
| Antigravity | macOS | disabled (copy fallback) | no non-interactive loader smoke recorded yet |
| All Surfaces | Windows | disabled (copy fallback) | junctions are detected and grouped; MCV does not create or migrate them |

`deploy.useSymlinks` remains `false` by default in `mcv.yaml`. Enabling it on macOS only activates managed links for Surfaces with recorded loader evidence above.

## Layout under test

- Physical package: isolated `HOME/.agents/skills/mcv-loader-probe/SKILL.md`
- Claude Code projection: one directory symlink at
  `~/.claude/skills/mcv-loader-probe`
- Gemini CLI projection: one directory symlink at
  `~/.gemini/skills/mcv-loader-probe` pointing at a relocated physical package
  outside the Store root for the symlink-only case
- The complete Claude and Gemini Skills roots remained regular directories.

The Claude probe Skill required an exact loader-specific response and prohibited
tool use. Temporary projections were created only after confirming that the
paths did not exist and were removed immediately after each run.

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

## Gemini CLI

- Loader: `@google/gemini-cli 0.53.0`
- Invocation: authenticated `gemini skills list` against a temporary per-Skill
  directory symlink at `~/.gemini/skills/mcv-loader-probe`
- Result: the probe appeared as enabled with
  `Location: ~/.gemini/skills/mcv-loader-probe/SKILL.md`

This proves that this Gemini CLI version follows a directory symlink at
`~/.gemini/skills/<skill>` and discovers the projected Skill package. It does
not establish support for linking the complete Gemini Skills root, and it does
not speak for Antigravity.

## Antigravity

- Loader smoke: not recorded
- Reason: no non-interactive Antigravity / AGY CLI entrypoint was available to
  prove linked-Skill discovery for `~/.gemini/config/skills/<skill>`
- Policy: Antigravity remains on physical-copy projection until separate loader
  evidence is recorded. Gemini CLI managed links stay enabled independently.
