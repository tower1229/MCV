# Target-owned IDE Instructions

Status: Accepted

MCV stores IDE Instructions as three independent Assets: `instruction:codex`, `instruction:claude-code`, and `instruction:gemini`. Their Repository files are `ide/codex/instructions.md`, `ide/claude-code/instructions.md`, and `ide/gemini/instructions.md`. Each Adapter captures and deploys only its target-owned Asset, mapping it to the IDE-native global or project filename. `common/` remains shared storage for Skills and MCP only.

MCV does not provide common Instructions, inheritance, overrides between IDEs, concatenation, Markdown section deduplication, or automatic synthesis. Different IDEs can require substantially different reasoning and operating guidance; silently composing them makes ownership, review, Drift, and rollback ambiguous. Long-term dual storage is also rejected because it creates two authorities for the same device file.

Repository schema v5 removes the runtime `rule:canonical` and `common/AGENTS.md` model. Migration from v4 copies the legacy base file and each platform override to all three target-owned paths, replaces every referenced `rule:canonical` Profile entry with the three new IDs, and deletes the old files only after the new files and Profiles verify. Existing targets block migration rather than being overwritten. v5 Capture, Catalog, and Deploy do not fall back to legacy paths.

Project Deploy writes target-specific Managed Blocks to `AGENTS.md`, `CLAUDE.md`, and `GEMINI.md`. A first v5 Deploy may migrate a legacy `rule:canonical` block only when its Managed Receipt hash verifies; Drift or a missing Receipt blocks the projection, and no long-term mixed-block mode exists. Profile schema and Managed Receipt schema remain v1; operation schema advances to v4.

## Considered Options

- Keep one shared file and merge IDE-specific fragments during Capture or Deploy — rejected because ordering, deduplication, and conflict resolution would invent cross-IDE semantics.
- Keep `common/AGENTS.md` as a fallback beside target files — rejected because two authorities would make selection, Drift, and cleanup nondeterministic.
- Add inheritance from a common base — deferred until there is validated demand and an explicit composition contract.
