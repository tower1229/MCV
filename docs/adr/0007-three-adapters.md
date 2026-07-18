# Three adapters: Codex, Claude Code, Gemini

MCV v0.1 ships three Adapters, not five:

- **Codex** — targets `~/.codex/`
- **Claude Code** — targets `~/.claude/` and `~/.claude.json`
- **Gemini** — targets `~/.gemini/`, covering both Gemini CLI and Antigravity since they share the same directory and `GEMINI.md` file

Cursor was dropped earlier (ADR-0004) because it auto-detects other IDEs' configurations. Gemini CLI and Antigravity are merged because they share `~/.gemini/GEMINI.md` and the same MCP config surface. If their native config paths diverge significantly in the future, the Gemini adapter can be split.
