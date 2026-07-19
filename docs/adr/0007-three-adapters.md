# Three adapters: Codex, Claude Code, Gemini

MCV v0.1 ships three Adapters, not five:

- **Codex** — targets `~/.codex/`
- **Claude Code** — targets `~/.claude/` and `~/.claude.json`
- **Gemini** — one user-visible target with two internal Surfaces: Gemini CLI and Antigravity

Cursor was dropped earlier (ADR-0004). Gemini CLI and Antigravity share the user-facing target and Canonical data, but discovery, Native files, Skills roots, MCP overrides, runtime filtering, deploy and status are Surface-specific. Sharing part of `~/.gemini/` is not evidence that they have one configuration surface.
