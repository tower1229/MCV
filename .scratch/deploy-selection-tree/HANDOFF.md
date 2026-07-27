# Handoff: Deploy selection tree and dynamic viewport

## Objective

Validate a replacement interaction model for the unusable `Deploy · Select Changes`
screen without modifying the production TUI:

- present Deploy changes as a semantic tree;
- keep every underlying `DeployChange.id` as the Apply safety unit;
- fit the interactive frame inside the current terminal height;
- make every file distinguishable;
- support efficient keyboard browsing of a real, large Deploy Plan.

The prototype is throwaway. Its answer, not its shell, is intended to feed the
production implementation.

## Confirmed symptom

The current Deploy selection screen renders hundreds of rows with repeated labels
such as `hatch-pet`. At common terminal heights, the list is clipped. Mouse-wheel
input is translated by the terminal into cursor movement, but Deploy has no
cursor-following viewport, so the screen cannot be browsed reliably.

The screenshot supplied by the user is the `Deploy · Select Changes` page, not the
later warning confirmation page.

## Evidence from the real local Plan

Read-only command:

```powershell
mcv.cmd deploy --dry-run --json
```

Observed on 2026-07-27:

```text
TOTAL=586
STANDARD=293
ADVANCED=293
UNIQUE_IDS=586/586
UNIQUE_TARGET_KEYS=586/586
```

Large repeated display labels include:

```text
37 × Codex / Skills / baoyu-design
37 × Claude Code / Skills / baoyu-design
37 × Gemini / Skills / baoyu-design
14 × Codex / Skills / hatch-pet
14 × Claude Code / Skills / hatch-pet
14 × Gemini / Skills / hatch-pet
```

The Plan is not duplicating changes. Each file has a unique ID and target key.
The display layer collapses every file under a Skill package to the same package
name.

## Root cause

- `src/operations/deploy.ts` creates one immutable change per target file. This is
  the correct safety granularity.
- `displayName()` returns only the first directory after `skills`, so all files in
  a package receive the same visible name.
- `DeploySelection` maps every visible standard change directly into the rendered
  frame.
- `deployVisibleChanges()` filters only standard versus advanced changes; it does
  not implement a viewport.
- `moveDeployCursor()` changes the numeric cursor but does not maintain a visible
  window.
- Capture has a fixed twelve-row viewport; Deploy does not.
- Existing Deploy snapshots use only three changes and do not exercise large-list
  behavior.

## Product contract

Relevant requirements in `docs/prd/TUI-Spec.md`:

- Deploy selection is grouped by IDE and capability.
- detailed Diff remains available before Apply;
- Advanced Cleanup is isolated, collapsed, and unselected by default;
- selection sent to Apply contains only IDs from the immutable Plan;
- snapshots cover narrow layouts and large change counts;
- selection tests cover the IDE/capability/file hierarchy;
- mouse-first navigation is out of scope.

## Settled boundaries

- Do not merge or deduplicate Plan changes by display name.
- Do not change operation IDs, hashes, preconditions, backup, rollback, or Apply.
- Group nodes are TUI-only and expand into original leaf change IDs.
- Advanced deletion leaves remain unselected by default.
- The reliable contract is keyboard-first. Full terminal mouse tracking is not
  part of this prototype.
- The prototype must not call Apply or write configuration.

## Prototype question

Does the following state model remain understandable and operable with the real
586-change Plan in a 24x80 terminal?

1. top-level capability nodes such as `Codex / Skills`;
2. Skill package nodes such as `hatch-pet · 14 files`;
3. expandable file leaves showing package-relative paths;
4. three-state aggregate selection (`[x]`, `[-]`, `[ ]`);
5. a terminal-height-aware viewport that follows focus;
6. Up/Down, Left/Right, PageUp/PageDown, Home/End, Space, Diff detail, and
   Advanced Cleanup controls.

## Prototype acceptance

- One command starts the prototype and loads the real read-only Deploy Plan.
- No Apply or filesystem mutation path exists.
- The complete frame stays within `stdout.rows`.
- Focus remains visible after every navigation action and terminal resize.
- A user can reach the first and last visible tree node.
- Collapsed capability and Skill rows summarize leaf counts.
- Expanded Skill files have distinguishable relative paths.
- Aggregate selection maps exactly to the underlying leaf change IDs.
- Partial selection is visible as `[-]`.
- Advanced Cleanup starts collapsed and none of its deletion IDs are selected.
- The current focus, viewport range, expanded nodes, and selected leaf count are
  visible on every frame.

## Continue

Run:

```powershell
npm.cmd run prototype:deploy-selection
```

Drive the prototype in Windows Terminal, resize the terminal, and test both arrow
keys and the mouse wheel. Record the verdict in this handoff before production
implementation. Delete or move the prototype to a throwaway branch after it has
answered the question.

## Automated prototype evidence

The prototype was exercised against the real read-only Plan:

```text
planChanges: 586
topLevelNodes: 13
hatchFiles: 14
hatchUniqueLabels: 14
viewportRows: 13
viewportBudget: 13
focusedLastFileVisible: true
selection: [x] -> [ ] -> [-]
advancedExpandedByDefault: false
advancedSelected: 0
```

A Windows ConPTY probe also confirmed that the real Plan renders as thirteen
top-level capability nodes in an 80x24 frame with the controls still visible.
The piped automation host could not reliably return keystrokes to the child
ConPTY, so manual Windows Terminal validation remains required for arrow keys,
mouse-wheel translation, PageUp/PageDown, and live resize.

## Manual verdict

Accepted by the user on 2026-07-27.

The user exercised the throwaway prototype in their terminal and reported no
problems. The semantic hierarchy, distinguishable Skill files, aggregate
selection states, dynamic viewport, keyboard navigation, mouse-wheel behavior,
Advanced Cleanup defaults, and terminal resizing are approved as the production
interaction model.

The prototype question is answered. Do not continue polishing the prototype.
Capture it on a throwaway branch, reference that branch from Issue #26, then
implement the validated model test-first in the production Ink Shell.
