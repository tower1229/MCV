# Drop Cursor from target IDE list

Cursor natively detects and loads configuration from other IDEs' directories (`.agents/skills/`, `AGENTS.md`, Claude/Codex skills paths, etc.). This means deploying configuration for supported targets may also make it available in Cursor without a dedicated Cursor Adapter.

MCV exposes three targets: Codex, Claude Code, and Gemini. The Gemini Adapter contains two independently detected and deployed Surfaces, Gemini CLI and Antigravity; they are not separate user-facing targets. Cursor remains outside the supported target contract. If that compatibility stops being sufficient, adding a Cursor Adapter requires a new decision with loader evidence and tests.
