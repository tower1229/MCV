# Release checklist

Use this checklist for the current `0.3.0-beta.1` line and its Unreleased changes. Publishing and tagging are maintainer-confirmed actions; repository changes alone do not publish a package.

## Release candidate

- [ ] `package.json` and `package-lock.json` use `0.3.0-beta.1`.
- [ ] `CHANGELOG.md` describes user-visible changes, the breaking Deploy CLI change, every schema bump, Review Artifact behavior, security updates, and migration requirements.
- [ ] README, CONTEXT, PRD, TUI spec, ADRs 0011–0014, and maintainer instructions agree on the current product contract: bare `mcv` always prints Overview; project is the default Deploy scope; bare `mcv deploy` exits 2; only Profile uses a full-screen TUI.
- [ ] Human output tests cover Review Artifact path, permissions, atomic fallback, 40-line/8-KiB overflow, 24-hour best-effort expiry, 10-file/50-MiB targets with current-file protection, `--verbose`, and JSON/MCP zero-Artifact behavior.
- [ ] `npm audit` reports zero known vulnerabilities.
- [ ] `npm ci` completes with Node.js `>=22.12.0`.
- [ ] `npm run typecheck` passes.
- [ ] `npm test` passes.
- [ ] `npm run build` passes and committed `dist/` output matches `src/`.
- [ ] `node dist/index.js --help` and `node dist/index.js --version` return successfully.
- [ ] `npm pack --dry-run` contains only intended runtime files from `dist/` and `schemas/` plus npm metadata.
- [ ] GitHub `Release Gate / Verify (macos-latest)` passes.
- [ ] GitHub `Release Gate / Verify (windows-latest)` passes.

Profile TUI PTY notes: macOS Verify requires `/usr/bin/expect` and `/bin/zsh`; Windows Verify exercises ConPTY restoration for `mcv profile`.

## Repository settings

- [ ] Require both Release Gate jobs before merging to `master`.
- [ ] Set the repository description to: `User-owned AI IDE configuration capture, review, and cross-device deployment for Codex, Claude Code, and Gemini.`
- [ ] Add topics: `ai`, `agent-skills`, `codex`, `claude-code`, `gemini-cli`, `mcp`, `configuration-management`, `developer-tools`, `digital-sovereignty`, `typescript`.

## Maintainer-confirmed publication

- [ ] Merge the verified release candidate.
- [ ] Run `npm publish --tag beta` from a clean `master` checkout.
- [ ] Verify `npm view @tower1229/mcv@0.3.0-beta.1 version`.
- [ ] Create and push annotated tag `v0.3.0-beta.1`.
- [ ] Create a GitHub prerelease from the matching changelog entry.
- [ ] Install the published package in a clean environment and run `mcv --help`, `mcv --version`, and `mcv discover`.

Do not move the npm `latest` tag until beta feedback confirms migration, Profile Deploy scopes, terminal behavior, and cross-device deployment on both supported operating systems.
