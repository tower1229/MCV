# Changelog

All notable changes to MCV are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- MCP write tools `update_profiles` and `deploy_profiles`, plus the on-demand `mcv://guides/profile-classification` resource, so Agents can atomically mutate Profiles and invoke Deploy over the local stdio server without opening the TUI.
- Dedicated Profile maintenance TUI (`mcv profile`, `mcv profile edit <id>`) with a three-pane Ink layout, search, Asset-type and technical-compatibility filters, ProfileService-backed save with Revision conflict reporting, and macOS PTY / Windows ConPTY restoration gates.
- Project-scope Deploy overlays selected MCP servers at key granularity into Codex `.codex/config.toml`, Claude Code `.mcp.json`, and Gemini CLI `.gemini/settings.json`, preserving non-MCV servers and recording Managed Receipt ownership; unrecorded same-name conflicts require Preserve/Replace and are never cleared by `--yes`. Antigravity remains global-only with a `projectScopeUnsupported` notice.
- Project-scope `--prune-managed` offers Advanced Cleanup deletion candidates for Managed Receipt–owned assets that left the current selection, still match the receipt hash, and have no Drift — Rules strip unmodified Managed Blocks only; Skills/MCP remove owned packages or server keys; missing `managed.json` stays conservative with no cleanup. Ordinary Deploy never deletes; `--yes` still blocks prune candidates.

### Changed

- Bare `mcv` prints a concise plain-text Overview in a TTY (help in a non-TTY) and exits immediately; the persistent fullscreen Ink Shell, alternate-screen routing, and deep-link semantics are removed from the default path.
- Capture, Deploy, Restore, and Repository lifecycle commands always use the one-shot Plan/Report command layer with terminal confirmations where applicable.
- Daily entry points are `mcv`, `mcv capture`, `mcv deploy`, and `mcv profile`; `status` remains a compatibility alias for the Overview report.
- `mcv profile` in a TTY opens the Profile editor; flag-based `mcv profile edit` remains the non-interactive mutation path.

### Removed

- Global Shell routes, shell state, snapshots, and the former multi-route Shell PTY release gates. Profile maintenance keeps a dedicated fullscreen TUI.

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

[0.2.0-beta.1]: https://github.com/tower1229/MCV/releases/tag/v0.2.0-beta.1
