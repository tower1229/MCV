## Problem Statement

MCV 已经具备 Capture、Deploy、Status、Restore、Repository Binding 和 schema Migration 的基本安全闭环，但当前交互仍是数字菜单和逐行询问。计划生成、终端输出、用户选择和文件副作用混在命令函数中，导致 TUI、文本 CLI、JSON 协议和自动测试无法共用一套可靠的核心流程。

对用户而言，这意味着他们需要记住命令和参数，无法在一个统一控制台中查看数据仓库、本机变化、待部署变化和安全问题；脚本、CI 和 Agent 则无法信任当前可能混合 JSON、普通文本、询问和副作用的输出。

## Solution

保留 TypeScript/Node.js 和现有命令名，首先把 Repository、Capture、Deploy、Restore、Status 和 Environment 提取为只接收数据、返回结构化 Plan/Report/Result 的 Operation Modules，再在同一操作层之上建立 Ink TUI、英文文本 Renderer 和 JSON Renderer。

TTY 中执行 `mcv` 打开首页；执行任一业务子命令则作为深链接进入同一 TUI Shell 的对应页面。`--dry-run`、`--yes`、`--json`、只读命令的 `--plain` 和非 TTY 环境继续使用一次性协议，不启动 TUI。TUI 使用 alternate screen，但必须在所有退出路径恢复终端，并在需要时将简洁结果留在主屏历史中。

## User Stories

1. As an MCV user, I want `mcv` to open a unified terminal dashboard, so that I can understand the current state without remembering commands.
2. As an MCV user, I want every business subcommand to deep-link into the same TUI, so that navigation and interaction remain consistent.
3. As an MCV user, I want the entire product interface to use English, so that help, prompts, errors, and results do not switch languages unexpectedly.
4. As an MCV user, I want the Repository to be any local directory I control, so that I can choose my own backup and transfer method.
5. As an MCV user, I want a non-Git Repository to be treated as normal, so that Git remains optional rather than a hidden requirement or warning source.
6. As an MCV user, I want Git status shown only when Git is detected, so that optional information does not become product policy.
7. As a first-time user, I want to initialize the current directory from the TUI, so that I can create and bind an MCV Repository without editing `mcv.yaml`.
8. As a user with an existing Repository, I want to bind the current directory or enter another path, so that I can reuse data transferred by any method.
9. As a user whose Repository moved, I want to update the binding after Repository ID validation, so that moving a directory does not break MCV permanently.
10. As an MCV user, I want Unbind to remove only local binding state, so that my Repository and IDE configuration are never deleted accidentally.
11. As an MCV user, I want old schemas detected and presented as a Migration Plan, so that migration is reviewed and backed up before other writes continue.
12. As a first-time user, I want a successful Init followed by environment discovery and Capture, so that onboarding reaches a useful Repository quickly.
13. As a first-time user, I want cancelling the post-Init Capture to preserve a valid empty Repository, so that cancellation does not undo initialization unexpectedly.
14. As an MCV user, I want Overview to distinguish Pending Deployment Changes from post-deploy local changes, so that Repository updates are not confused with Drift.
15. As an MCV user, I want Overview to calculate a read-only Deploy Plan asynchronously, so that I can see pending work without triggering Capture or writes.
16. As an MCV user, I want environment and IDE support shown on Overview, so that missing variables and unavailable surfaces are visible before deployment.
17. As an MCV user, I want Capture previews to contain only sanitized and parameterized content, so that previewing a change cannot expose raw secrets.
18. As an MCV user, I want Capture selection grouped by IDE and then by file, Skill, or MCP, so that I can accept only the configuration I intend to store.
19. As an MCV user, I want managed-source conflicts to require choosing an authoritative source or skipping the item, so that MCV never guesses which configuration is correct.
20. As an MCV user, I want Repository deletion candidates unselected by default, so that a device-side deletion is not silently propagated.
21. As an MCV user, I want Deploy selection grouped by IDE and capability, so that I can control Shared Rules, Skills, MCP, and IDE-specific Configuration independently.
22. As an MCV user, I want a detailed Diff before Apply, so that the content I approve matches the content MCV writes.
23. As an MCV user, I want whole-file replacement labeled explicitly, so that I can distinguish it from managed-field merge behavior.
24. As an MCV user, I want Native unmanaged fields and Local fields preserved unconditionally, so that a global overwrite switch cannot bypass ownership boundaries.
25. As an MCV user, I want deletion cleanup isolated in an advanced, collapsed section, so that destructive actions require deliberate selection.
26. As an MCV user, I want my last successful Deploy selection stored only on this device, so that I can reuse it without creating a Profile or shared Preset.
27. As an MCV user, I want Apply to reject a Plan when source or target preconditions changed, so that MCV cannot execute something different from the preview I approved.
28. As an MCV user, I want Issues classified as notice, warning, decision required, or error, so that I can tell what is informational, reviewable, or blocking.
29. As an automation user, I want `--yes` to reject warnings and unresolved decisions before any write, so that automation never returns a silent partial success.
30. As an MCV user, I want Deploy to back up and verify every selected change transactionally, so that failure either completes safely or rolls back.
31. As an MCV user, I want a successful partial selection to update Baseline Snapshot and managed inventory only for the applied scope, so that unselected files do not become falsely managed or current.
32. As an MCV user, I want Restore to preview the latest complete deployment backup, so that I know the time and files affected before restoring.
33. As an MCV user, I want a Restore Conflict to block restoration when files changed after deployment, so that a second confirmation cannot destroy newer work.
34. As an MCV user, I want Restore to preserve the current state before applying the backup, so that restoration itself remains recoverable.
35. As an MCV user, I want read-only pages to return to Overview with Escape and exit with `q`, so that inspection naturally leads to another task.
36. As an MCV user, I want write result pages to return to Overview with Enter or exit with `q`, so that I can choose between continuing and leaving immediately.
37. As an MCV user, I want Ctrl+C to exit with code 130 before Apply, so that interruption follows normal terminal conventions.
38. As an MCV user, I want cancellation ignored while a write transaction is committing or rolling back, so that interruption cannot leave half-written configuration.
39. As an MCV user, I want alternate screen, cursor state, and input mode restored after success, failure, interruption, or an uncaught exception, so that MCV never leaves my terminal damaged.
40. As a direct-subcommand user, I want a concise result or error summary printed after the TUI closes, so that important outcomes remain in shell history.
41. As a non-TTY user, I want no-argument `mcv` to print help and succeed, so that piping or probing the executable never hangs on interaction.
42. As a CLI user, I want existing `--dry-run` and `--yes` calls to remain one-shot English text operations, so that TUI adoption does not break established automation habits.
43. As a read-only CLI user, I want `status --plain` and `discover --plain`, so that I can force a one-shot text Report from a TTY.
44. As an automation user, I want `--json` to emit exactly one JSON document on stdout, so that parsers never receive prompts, progress, or human prose.
45. As an automation user, I want diagnostics and progress on stderr, so that stdout remains a stable payload channel.
46. As an automation user, I want structured status, readiness, Issues, error codes, and next actions, so that scripts do not parse localized prose.
47. As an automation user, I want distinct exit codes for success, execution failure, usage error, human decision, and interruption, so that callers can route each outcome correctly.
48. As an MCV user, I want colors detected automatically and `NO_COLOR` respected, so that output works with my terminal preferences without extra flags.
49. As an MCV user, I want every state represented by text or symbols as well as color, so that color is never the only source of meaning.
50. As an MCV user, I want clear English next actions on failure, so that errors lead to a concrete recovery step.
51. As an MCV user, I want `--help` and `--version` to remain immediate text output, so that basic CLI discovery never launches a full-screen interface.
52. As a contributor, I want TUI, text, JSON, and tests to reuse the same Operation Modules, so that safety rules cannot drift between interfaces.
53. As a contributor, I want Plan generation to be read-only and Apply to own all writes, so that safety and race checks have one enforceable boundary.
54. As a contributor, I want the packaged CLI tested through real process and PTY boundaries, so that routing and terminal recovery are verified as users experience them.

## Implementation Decisions

- Commander remains the command router. It chooses the Ink TUI, English text renderer, or JSON renderer; renderers do not implement business rules.
- Operation Modules become the shared application boundary. They accept data and return structured Report, Plan, Result, Issue, and error objects without writing terminal output or asking questions.
- Repository lifecycle is one deep module covering inspection, Init, Bind, Unbind, and Migration rather than several shallow command wrappers.
- Environment discovery is exposed through one environment Report; the existing `discover` command remains a route to that Report.
- Capture, Deploy, Restore, and Repository writes use separate Plan and Apply operations. Plan generation is read-only; Apply is the only write boundary.
- Plans are in-process immutable snapshots. They are not persisted, replayed, or treated as authorization credentials across invocations.
- Every Plan carries an opaque operation ID and source/target precondition hashes. Apply validates the operation ID, selection, and hashes and requires regeneration after any mismatch.
- Selection contains only IDs from the Plan. Interfaces cannot construct target paths or arbitrary write requests.
- Issues use four severities: `notice`, `warning`, `decisionRequired`, and `error`. Only `notice` is permitted in `--yes` execution.
- `--yes` performs Plan generation and Apply in one process and rejects incomplete, ambiguous, destructive, or unsafe execution before the first write.
- Deletions are never selected by default and are never applied by `--yes`.
- Capture Diff uses only processed, sanitized, parameterized content. Binary content is represented by metadata rather than dumped to the screen.
- Deploy never exposes a global overwrite switch. Overlay ownership remains authoritative: managed fields may change, Native undeclared fields are preserved, and Local fields remain excluded.
- Whole-file replacement is supported only for content fully owned by MCV and is labeled explicitly in the preview.
- Successful partial Deploy updates Baseline Snapshot and managed inventory only for selected and successfully applied items while preserving valid prior state for unselected items.
- The latest successful Deploy selection is stored in local device state at IDE/capability granularity. It is neither a Profile nor a Preset and is not stored in the Repository.
- Restore Conflict is distinct from Drift and blocks Restore in v0.1. There is no force-restore action.
- The Repository is a user-owned local directory. Git is an optional recommended versioning, backup, and transport method; non-Git state produces no Issue and MCV performs no Git mutations.
- TTY business commands deep-link into one persistent TUI Shell. Overview and read-only pages can navigate back to the home screen; write result pages can return home or exit.
- The TUI uses alternate screen. All success, failure, interrupt, and exception paths restore the main screen, cursor, and input mode.
- `--help` and `--version` never launch TUI.
- Existing write flags remain compact: `--dry-run` means one-shot English text Plan, `--yes` means one-shot English text Result, and combining either with `--json` selects JSON. Write commands do not add a redundant `--plain` flag.
- `status` and `discover` support `--plain` for one-shot English text and `--json` for a JSON Report. Those flags are mutually exclusive.
- `--dry-run` and `--yes` are mutually exclusive. Invalid combinations exit with usage code 2.
- JSON stdout contains exactly one document. Progress and diagnostics use stderr.
- JSON payloads include schema version, operation, status, readiness, Repository path, changes, Issues, and next actions. Structured codes are stable; human messages remain English.
- Exit codes are 0 for the requested result, 1 for execution/system failure, 2 for usage/input error, 3 for a non-interactive human-decision block, and 130 for user interruption. A successfully generated dry-run Plan exits 0 even when its payload is not ready to apply.
- Color is automatic and respects `NO_COLOR`; no additional color flag is introduced, and color is never the only indicator.
- All product UI text is English, including TUI, help, prompts, errors, progress, and result summaries. README remains Chinese. v0.1 does not introduce an i18n framework.
- MCV migrates the entire package from CommonJS to NodeNext/ESM before adding Ink 7. The project keeps a single ESM build and no TUI loading bridge or dual module output.
- The ESM migration is an independent verified change. Ink, React, and TUI work begin only after existing CLI, typecheck, tests, build, and npm bin behavior pass under ESM.
- Ink is the only interaction framework. Clack and Inquirer are not introduced alongside it.
- Delivery remains phased: structured Operations; stable text/JSON protocol; independent ESM migration; minimum TUI with terminal safety; then usability polish.
- The default TUI route is not enabled until reducer tests, renderer snapshots, alternate-screen restoration, and real PTY interruption tests pass.

## Testing Decisions

- The primary acceptance seam is the packaged `mcv` process. Tests invoke it as users do and assert routing, stdout, stderr, exit codes, visible text, keyboard navigation, filesystem effects, and terminal restoration rather than internal component structure.
- Real PTY tests cover TTY detection, alternate-screen entry and exit, Overview navigation, subcommand deep links, Enter/Escape/`q`, Ctrl+C, uncaught failures, and cursor/input-mode restoration on Windows and macOS.
- Non-PTY process tests cover `--dry-run`, `--yes`, `--plain`, `--json`, non-TTY help, mutually exclusive flags, stdout/stderr separation, and exit codes.
- Operation Modules are the focused safety seam for cases that are expensive or nondeterministic through a PTY: Plan precondition races, source/target hash changes, transaction rollback, backup failure, restore conflict, selection validation, Baseline Snapshot updates, and managed inventory updates.
- Existing command-level tests that invoke the Commander program are prior art for protocol assertions. Existing Capture, Deploy, Restore, Status, Init, migration, sanitization, Overlay, and adapter tests remain the prior art for filesystem and safety behavior.
- Tests assert external structured values and resulting files, not private helper calls, React component trees, hook implementation, or directory layout.
- TUI reducer tests cover state transitions independently of rendering: loading, ready, selection, warning confirmation, decision resolution, applying, success, failure, cancellation, and stale-plan regeneration.
- Renderer snapshots cover common Windows Terminal and macOS widths, narrow single-column layouts, long paths, Unicode paths, missing color, and large change counts. Snapshots must not contain raw secrets.
- JSON contract tests assert exactly one parseable stdout document, schema version, stable codes, readiness, Issues, next actions, and no ANSI sequences.
- Security tests verify that Capture Plan, Diff, errors, logs, snapshots, and JSON never contain source secret values.
- Selection tests verify IDE/capability/file hierarchy, default-safe choices, unselected deletions, conflict resolution, partial Apply, and last-successful Deploy selection reuse.
- Status tests separately verify Pending Deployment Changes against the current Repository and post-deploy local changes against Baseline Snapshot.
- Restore tests verify selection of the latest complete backup, ignoring failed backups, Restore Conflict blocking, current-state backup, deletion restoration, and transactional rollback.
- Repository tests verify Init in Git and non-Git directories without warnings, current-directory Bind, explicit-path Bind, Repository ID mismatch, moved Repository, Unbind scope, and migration gating.
- ESM migration tests run before Ink is installed and must preserve executable bin behavior, package contents, CLI help/version, typecheck, the full existing test suite, and build output.
- Good tests describe user-visible behavior, use deterministic temporary directories and injected device context, and fail for a broken contract rather than for harmless refactoring.

## Out of Scope

- Rewriting MCV in Go or another language.
- GUI, web UI, or background daemon behavior.
- Profile or named deployment Preset management.
- Cursor or additional IDE Adapters.
- Long-term operation history beyond the most recent operation state and existing backups.
- A Settings center or general-purpose `mcv.yaml` editor.
- Field-level selection or editing in Capture and Deploy.
- Standalone `diff` or `rollback` commands; Diff remains a Plan view and the user-facing restore action is Restore Latest Deployment.
- Force Restore when a Restore Conflict exists.
- Persisted, signed, replayable, or cross-process Plans.
- Command palette, mouse-first navigation, or automatic Git init/commit/push/pull.
- Git hosting integration or any required backup/transport provider.
- Credential storage, environment-variable value entry, or secret synchronization.
- Automatic IDE installation.
- Full internationalization or bilingual interface text in v0.1.
- CommonJS/ESM dual builds or a separate ESM-only TUI package.
- Adding multiple prompt frameworks alongside Ink.

## Further Notes

- The current verified baseline is 13 test files and 45 passing tests with TypeScript typecheck passing; implementation must preserve or strengthen this baseline at every phase.
- Domain language must distinguish Repository, Baseline Snapshot, Drift, Pending Deployment Change, and Restore Conflict. Internal terms such as Canonical, Adapter, Overlay, and Drift should be rendered as user-facing English such as Shared Configuration, IDE Support, Merge Behavior, and Local Managed Change.
- A non-Git Repository is a first-class valid state. Documentation may recommend Git, but product UI must not warn, prompt for `git init`, or imply degraded correctness.
- The ESM decision is recorded separately as an accepted architecture decision because it is a package-wide, difficult-to-reverse trade-off.
- Terminal recovery and basic PTY interruption coverage are release gates for the first default TUI, not optional polish.
