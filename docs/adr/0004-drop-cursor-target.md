# Drop Cursor from target IDE list

Cursor natively detects and loads configuration from other IDEs' directories (`.agents/skills/`, `AGENTS.md`, Claude/Codex skills paths, etc.). This means deploying configuration for Claude Code or Antigravity automatically makes it available in Cursor without a dedicated Cursor adapter. MCV v0.1 targets four IDEs: Codex, Claude Code, Gemini CLI, and Antigravity. If Cursor ever breaks this cross-IDE compatibility, a thin adapter can be added later.
