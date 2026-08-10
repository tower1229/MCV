**实现状态（2026-08-10）：已实现。** 当前产品界面由 plain-text Overview、一次性 Command/Report、专用 Profile Ink TUI 和本地 stdio MCP 组成。旧的全局 Ink Shell、业务命令 deep-link、默认 alternate-screen 首页和 Init 后自动进入 Capture 的流程已经移除；本文只描述当前契约。

## Problem Statement

MCV 的 Capture、Deploy、Restore 和 Repository 生命周期包含高风险文件写入，必须让人类、脚本和 Agent 复用同一套可审阅、可验证的 Operation Modules，同时避免把大量 Diff、路径和可能含明文配置的技术细节长期留在终端滚动历史中。

Profile 维护需要集中浏览和选择大量 Asset，适合专用全屏界面；其他操作更适合可组合、可退出、能直接用于自动化的一次性命令。

## Solution

- 裸 `mcv` 与 `mcv status` 打印同一份只读 Overview 后退出，TTY 与非 TTY 行为一致。
- Capture、Deploy、Restore、Init、Bind、Unbind 和 Migration 通过一次性 Plan/Apply 命令执行；默认人类输出在需要时确认，`--dry-run`、`--yes` 和 `--json` 提供显式协议。
- Discover、Status、Repository 和 Profile 查询直接输出 Report。
- 只有 `mcv profile` 与没有 mutation flag 的 `mcv profile edit <id>` 在 TTY 中打开专用 Ink TUI。
- `mcv mcp` 是隐藏于日常顶层帮助的本地 stdio 集成入口，复用相同 Profile、Asset 和 Deploy 服务。
- 人类可读的复杂详情通过短期本地 Review Artifact 提供；JSON 与 MCP 保持完整结构化输出且不创建 Artifact。

## User Stories

1. As an MCV user, I want bare `mcv` to print a concise Overview and exit, so that it works identically in terminals, pipes, and probes.
2. As an MCV user, I want every mutating operation to show a Plan before Apply, so that the approved selection matches the eventual write.
3. As an automation user, I want JSON stdout to contain exactly one versioned document, so that scripts never parse prompts or human prose.
4. As an automation user, I want `--yes` to reject warnings, decisions, deletions, and topology migrations, so that unattended execution stays conservative.
5. As an MCV user, I want complete review details available without flooding terminal history, so that paths, hashes, Diffs, and plaintext configuration remain reviewable.
6. As an MCV user, I want `--verbose` to print those details inline as well, so that I can deliberately keep a terminal transcript.
7. As an MCV user, I want Review Artifact failure to fall back to terminal output, so that Apply never proceeds without reviewable details.
8. As an MCV user, I want Profile maintenance in a dedicated searchable TUI, so that large Asset sets remain practical without turning every command into a full-screen application.
9. As an MCV user, I want all success, failure, interruption, and exception paths from Profile TUI to restore my terminal.
10. As an MCV user, I want Git to remain optional and never mutated by MCV.

## Interface Contract

### Routing

- `mcv`: plain Overview; never help or alternate screen solely because of TTY state.
- `mcv status`: compatibility alias for the same Overview Report; supports `--plain`, `--json`, and `--verbose`.
- `mcv discover`: Environment Report; supports `--plain`, `--json`, and `--verbose`.
- `mcv capture`, `mcv deploy`, `mcv restore`: one-shot Plan/confirm/Apply; support `--dry-run`, `--yes`, `--json`, and `--verbose`.
- `mcv init`, `mcv bind`, `mcv unbind`: one-shot Repository Plan/Apply; they never chain into Discover or Capture.
- `mcv migrate`: one-shot Migration Plan/Apply; supports `--verbose` for oversized human output.
- `mcv profile`: Profile TUI in a TTY; otherwise prints subcommand help.
- `mcv profile list/show`: one-shot Report with optional `--json` and `--verbose`.
- `mcv profile create/edit/delete`: one-shot mutation; flagless `profile edit <id>` opens the Profile TUI only in a TTY.

### Plan and Apply

- Operation Modules return structured Report, Plan, Result, Issue, and error objects without terminal I/O.
- Plan generation is read-only. Apply is the only Repository, target, backup, Managed Receipt, Baseline Snapshot, or device-state write boundary.
- Plans are immutable in-process snapshots, not persisted or replayable authorization.
- Apply revalidates operation ID, selected IDs, Repository source hashes, target precondition hashes, and topology identity.
- Deletions are unselected by default. `--yes` rejects warnings, unresolved decisions, deletions, topology changes, and project/global prune candidates before the first write.
- Modified paths are backed up and verified before first write; failure rolls back only the attempted transaction scope and reports incomplete recovery material explicitly.

### Human output and Review Artifacts

- Plain Capture, Deploy, and Restore Plans always keep decision-critical summaries, destructive markers, Issues, and next actions in the terminal. When review details exist, the complete Diff, paths, hashes, and technical details go to a Review Artifact.
- Overview/Status, Discover, Profile list/show, Migration, and failed Results stay inline unless details exceed 40 lines or 8 KiB; overflowing details use the same Artifact path.
- `--verbose` preserves the Artifact and additionally prints complete details inline. If Artifact creation fails, complete details are printed inline regardless of `--verbose`.
- The presenter prints both a standard `file://` URL and the absolute path.
- macOS stores Artifacts under `~/Library/Application Support/mcv/reviews/`; Windows uses `%LOCALAPPDATA%\mcv\reviews\`; Linux uses `${XDG_STATE_HOME:-~/.local/state}/mcv/reviews/`.
- Writes are atomic. POSIX directory/file permissions are `0700`/`0600`; Windows inherits the per-user `%LOCALAPPDATA%` ACL.
- Each Artifact creation best-effort removes `.txt` files older than 24 hours and prunes older files toward 10 files and 50 MiB while always retaining the newly created Artifact. A single oversized current file or failed deletion may temporarily exceed those targets. There is no background cleanup after MCV exits.
- Artifacts may contain plaintext configuration. They are Local/Runtime presentation data, cannot be replayed, and do not modify Repository, deployment target, Managed Receipt, backup, Baseline Snapshot, or device operation state.
- JSON and MCP never create Review Artifacts and retain the complete structured contract.

### Output protocol

- `--dry-run` and `--yes` are mutually exclusive. JSON for write commands requires one of them.
- `status --plain --json` and `discover --plain --json` are usage errors.
- Bare `mcv deploy` without a Profile or `--global` is a usage error and writes nothing.
- JSON stdout contains exactly one document; progress and diagnostics use stderr.
- Consumers must inspect `schemaVersion` and reject unknown versions. Deploy uses operation schema v3; other operations use their own schema versions.
- Exit codes: `0` requested result produced, `1` execution/system failure, `2` usage/input error, `3` non-interactive human-decision block, `130` interruption.
- UI, help, prompts, errors, progress, and summaries are English. README remains Chinese. Color is automatic, respects `NO_COLOR`, and is never the only state indicator.

### Profile TUI

- Ink is used only for Profile maintenance; Clack and Inquirer are not added alongside it.
- The TUI supports Profile selection, search, Asset-type and compatibility filters, add/remove selection, save/cancel, Revision conflict handling, and initial focus on `profile edit <id>`.
- Alternate screen, cursor state, and terminal input mode are restored after success, failure, Escape/`q`, Ctrl+C, and uncaught exceptions.
- Profile, Asset, Revision, and Deploy Request types live below the TUI layer. The TUI calls `ProfileService` and never writes YAML directly.

## Testing Decisions

- The primary public seam is the packaged `dist/index.js` process. Tests assert routing, stdout/stderr, exit codes, filesystem effects, and no accidental writes.
- Process tests cover bare `mcv` in TTY and non-TTY conditions, help/version, output-mode conflicts, JSON single-document behavior, bare Deploy usage errors, and Review Artifact creation/fallback.
- Review Artifact tests cover exact detail preservation, `--verbose`, 40-line/8-KiB overflow, POSIX permissions, atomic creation, best-effort expiry, count/byte targets, and protection of the current file.
- Real macOS PTY and Windows ConPTY tests are required only for Profile TUI keyboard behavior and terminal restoration.
- Operation tests cover stale Plans, source/target races, topology changes, transactional backup/rollback, Restore Conflict, partial selection, Baseline Snapshot, managed inventory, and Managed Receipt updates.
- Tests assert user-visible contracts and resulting files rather than private helper calls or React component structure.
- No fixed test count is part of the product contract; the full current suite, typecheck, build, packaged help, and npm pack gate must pass for release work.

## Out of Scope

- A global multi-route TUI Shell or business-command deep links.
- GUI, web UI, background daemon, or background Artifact cleanup.
- Persisted, signed, replayable, or cross-process Plans and Review Artifacts.
- Force Restore when a Restore Conflict exists.
- Automatic Git init/commit/pull/push or required hosting provider.
- Credential management, masking, secret scanning, or environment-variable value entry.
- Automatic IDE installation, full dotfiles management, Cursor, or additional IDE Adapters.
- Profile inheritance, tags, conditional expressions, or project binding.
- CommonJS/ESM dual builds or multiple terminal interaction frameworks.
