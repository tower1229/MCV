# ADR 0012: Deploy Scope is Independent from Profile, and Project is the Default

Status: Accepted

A Profile answers "which assets"; a Deploy Scope answers "where to". The two are fully decoupled: any Profile can be deployed to the current project (default) or to the device's global IDE locations (`--global`), and multiple Profiles are unioned ad hoc at Deploy time without persisting any composition. The built-in `global` Profile is an ordinary asset set under this rule — `mcv deploy global` targets the current project, while `mcv deploy --global` is exactly `mcv deploy global --global`.

In 0.2, bare `mcv deploy` meant a global deploy; in 0.3 the default scope is the current project, with `targetRoot` strictly equal to the working directory (no upward Git-root search) and `--target` explicit and mutually exclusive with `--global`. Because silently reinterpreting a bare `mcv deploy` would write to a destination the user did not choose, the no-argument command is a usage error (exit 2) that writes nothing — a deliberate, safety-motivated breaking change.

This decision forecloses several alternatives: no `install` command, no Profile inheritance or composition declarations, no tag queries, and no Project Binding — MCV stores no cross-device project paths, project lists, or project identity mapping anywhere.
