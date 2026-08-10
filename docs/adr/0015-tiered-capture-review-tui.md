# ADR 0015: Tiered Capture Review with a Dedicated TUI

Status: Accepted

Capture keeps its one-process Plan/Apply contract but gains two human review adapters. A simple Plan uses line-oriented prompts. A complex Plan — at least two items across resolvable decision groups, warnings, and deletion candidates — automatically opens a dedicated Ink Capture Review TUI when stdin and stdout are interactive and `TERM` is not `dumb`. `--tui` and `--no-tui` override automatic routing; `--verbose`, `--dry-run`, `--yes`, and `--json` stay one-shot.

The Capture TUI is not a revival of the former global Shell. It has no Overview or cross-command routes and calls the same immutable `createCapturePlan` / `applyCapturePlan` operation interface as the line adapter. A shared review module owns default selection, exactly-one decision choices, deletion defaults, warning authorization, and final selection construction. Apply remains the only Repository write seam and revalidates the active Plan before its transaction. A stale Plan discards every prior selection and authorization before review restarts.

Profile maintenance remains a separate dedicated TUI, and the local MCP decisions from ADR 0014 remain unchanged. Deploy, Restore, Repository lifecycle commands, reports, JSON, and MCP do not enter the Capture TUI. Capture review artifacts retain their private, short-lived, non-replayable contract and may contain plaintext configuration.
