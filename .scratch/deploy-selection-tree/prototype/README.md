# PROTOTYPE: Deploy selection tree

This throwaway terminal prototype answers one question:

> Does an IDE/capability/package/file tree plus a terminal-height-aware viewport
> make the real large Deploy Plan understandable and operable?

It invokes only:

```text
node dist/index.js deploy --dry-run --json
```

There is no Apply import, action, or write path.

Run from the repository root:

```powershell
npm.cmd run prototype:deploy-selection
```

Controls:

- Up/Down: move focus
- Left/Right: collapse or expand
- Space: toggle every underlying leaf ID in the focused subtree
- PageUp/PageDown: move by one visible page
- Home/End: first or last visible node
- `a`: toggle and focus Advanced Cleanup
- `q` or Ctrl+C: quit

Validate at several terminal heights, especially 24 rows, and resize while focused
inside an expanded Skill. The relevant verdict belongs in `../HANDOFF.md`; this
prototype shell must not be promoted directly into production.
