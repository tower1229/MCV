# Single-file Canonical rules named AGENTS.md

Canonical rules are stored as a single Markdown file at `common/AGENTS.md` in the Repository. The CanonicalTransformer renames and places this file as needed for each IDE (e.g. copies as-is for IDEs that support `AGENTS.md`, transforms to `CLAUDE.md` for Claude Code). No multi-file concatenation logic is needed in v0.1. The name `AGENTS.md` was chosen because it is already the mainstream convention across multiple AI IDEs, minimizing cognitive overhead.

## Considered Options

- **Multiple rule files (`common/rules/coding.md`, `architecture.md`, etc.)** — better granularity, but adds concatenation order logic, separator handling, and per-file metadata with no clear user benefit in v0.1.
- **Custom name like `rules.md`** — neutral but introduces yet another name the user must learn; `AGENTS.md` is already widely recognized.
