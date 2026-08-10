# Changelog

All notable changes to MCV are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Human-readable Capture, Deploy, and Restore Plans now store complete review details in a private short-lived local Review Artifact while retaining decision-critical summaries, destructive markers, Issues, and next actions in terminal history.
- `--verbose` for Capture, Deploy, Restore, Migration, Status, Discover, and Profile list/show prints complete human-readable details inline while preserving the Review Artifact where one is required.

### Changed

- Large human-readable Reports and failed Results move details to the same Review Artifact after a shared 40-line or 8-KiB budget. JSON and MCP output remain complete and never create Review Artifacts.
- Review Artifacts are created atomically under the per-user state directory, use POSIX `0700`/`0600` permissions where applicable, and may contain plaintext configuration. Creation best-effort removes `.txt` files older than 24 hours and prunes older files toward 10 files and 50 MiB while always retaining the newly created Artifact; a single oversized current file or failed cleanup may temporarily exceed those targets. Artifact creation failure falls back to complete terminal output.
- Bare `mcv` now prints the same read-only Overview in both TTY and non-TTY environments.

## [0.3.0-beta.1] - 2026-08-08

This prerelease adds Profiles, project-default Deploy, Managed Receipts, and local MCP Profile tools on top of the 0.2 transaction and Overlay contracts. Treat Repository files, backups, terminal previews, and JSON output as data that may contain plaintext credentials.

### Breaking

- Bare `mcv deploy` (and `mcv deploy --yes` without a Profile) is now a usage error: exit code 2, no writes. Project is the default Deploy scope; restore the previous “deploy everything globally” behavior with `mcv deploy --global` (equivalent to `mcv deploy global --global`).
- JSON Deploy operations use schema v3. Consumers must read `schemaVersion` and reject unknown versions rather than assuming a fixed shape.

### Added

- Repository schema v4 with root `profiles.yaml` (Profiles schema v1) and a built-in undeletable `global` Profile seeded with all Assets at migration.
- Device state schema v3 (managed inventory scoped as `global`) and project Managed Receipt v1 at `<target>/.mcv/managed.json`.
- Profile CLI (`mcv profile` list/show/create/edit/delete) and a dedicated Profile maintenance TUI (`mcv profile`, `mcv profile edit <id>`) with search, Asset-type and technical-compatibility filters, Revision conflict reporting, and macOS PTY / Windows ConPTY restoration gates.
- Project-scope Deploy overlays selected MCP servers at key granularity into Codex `.codex/config.toml`, Claude Code `.mcp.json`, and Gemini CLI `.gemini/settings.json`, preserving non-MCV servers and recording Managed Receipt ownership; unrecorded same-name conflicts require Preserve/Replace and are never cleared by `--yes`. Antigravity remains global-only with a `projectScopeUnsupported` notice.
- Project-scope `--prune-managed` offers Advanced Cleanup deletion candidates for Managed Receipt–owned assets that left the current selection, still match the receipt hash, and have no Drift — Rules strip unmodified Managed Blocks only; Skills/MCP remove owned packages or server keys; missing `managed.json` stays conservative with no cleanup. Ordinary Deploy never deletes; `--yes` still blocks prune candidates.
- MCP write tools `update_profiles` and `deploy_profiles`, plus the on-demand `mcv://guides/profile-classification` resource, so Agents can atomically mutate Profiles and invoke Deploy over the local stdio server without opening the TUI.
- Newly captured Assets land in Unassigned until a Profile references them; Unassigned Assets are never deployed.

### Changed

- Bare `mcv` prints a concise plain-text Overview and exits immediately; the persistent fullscreen Ink Shell, alternate-screen routing, and deep-link semantics are removed from the default path.
- Capture, Deploy, Restore, and Repository lifecycle commands always use the one-shot Plan/Report command layer with terminal confirmations where applicable.
- Daily entry points are `mcv`, `mcv capture`, `mcv deploy`, and `mcv profile`; `status` remains a compatibility alias for the Overview report.
- `mcv profile` in a TTY opens the Profile editor; flag-based `mcv profile edit` remains the non-interactive mutation path.

### Removed

- Global Shell routes, shell state, snapshots, and the former multi-route Shell PTY release gates. Profile maintenance keeps a dedicated fullscreen TUI.

### Upgrade notes

- Existing schema v3 repositories must review `mcv migrate --dry-run`, then run `mcv migrate` before Capture or Deploy. Migration creates `profiles.yaml` with `global` containing every then-existing Asset and upgrades the manifest to schema v4 without rewriting Canonical or Native content.
- Scripts that previously ran bare `mcv deploy` must pass `--global` (or an explicit Profile plus `--global`) for device-global writes, or pass one or more Profile IDs for project-scope Deploy.
- Scripts that consume JSON output must support operation schema v3 for Deploy and reject unknown `schemaVersion` values.

## [0.2.0-beta.1] - 2026-08-05

This prerelease replaces the stale public `0.1.0` package with the current repository contract. Treat Repository files, backups, terminal previews, and JSON output as data that may contain plaintext credentials.

### Added

- Unified Ink shell with Overview, Capture, Deploy, Restore, Repository, and Help workflows.
- Repository lifecycle commands: `repo`, `bind`, `unbind`, and `migrate`.
- Reviewable Plan/Apply contracts with operation IDs, selection IDs, stale-plan detection, explicit warnings, and transactional rollback.
- Schema v3 repositories and operation schema v2 reports.
- Gemini as one user-facing target with independent Gemini CLI and Antigravity surfaces.
- Canonical Skill storage, per-surface projections, topology-aware drift reporting, and verified restore behavior.
- Packaged real-terminal release gates for macOS PTY and Windows ConPTY behavior.

### Changed

- Configuration handling is data-neutral: supported plaintext values and `${env:*}` references are preserved exactly as reviewed.
- Git is optional; any valid local directory can be an MCV Repository.
- Canonical, Native, and Local/Runtime ownership boundaries are explicit.
- Capture, Deploy, and Restore use complete previews and require decisions before destructive or ambiguous changes.

### Security

- Updated `fast-uri` to 3.1.5 to address GHSA-7p8r-x3mc-p8w7.
- Updated `postcss` to 8.5.25; `npm audit` reports no known vulnerabilities at release preparation time.
- External links are not traversed or silently overwritten, package-internal links are rejected, and writes use verified backups and rollback.

### Upgrade notes

- Existing schema v1 or v2 repositories must first review `mcv migrate --dry-run`, then run `mcv migrate` before Capture or Deploy.
- Schema v3 removes the former `security` manifest field. Migration does not rewrite configuration values.
- Scripts that consume JSON output must support operation schema v2.

[0.3.0-beta.1]: https://github.com/tower1229/MCV/releases/tag/v0.3.0-beta.1
[0.2.0-beta.1]: https://github.com/tower1229/MCV/releases/tag/v0.2.0-beta.1
