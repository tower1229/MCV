# ADR 0013: Project Managed Receipt, Not Project Binding

Status: Accepted

Safely updating or pruning previously deployed project assets requires knowing which project files MCV created. Recording nothing means either never cleaning up stale assets or risking deletion of user files; recording projects centrally violates the no-Project-Binding constraint (ADR 0012). The compromise is a minimal Managed Receipt inside the project itself: `<target>/.mcv/managed.json`, mapping MCV-owned paths to their Asset IDs and content hashes alongside the owning `repositoryId`.

The Receipt is not a Project Binding. MCV's global state holds no project list, names, or absolute paths; nothing is queried, recommended, or auto-deployed across projects; the record stays valid wherever the project directory moves; deleting it merely forfeits MCV's cleanup ownership and returns behavior to conservative mode. Backup entries may note `targetRoot` as a local operational fact, never as project identity.

The Receipt is committed last inside the Deploy transaction — a failed Receipt write rolls back the file mutations. Prune candidates (`--prune-managed`) must simultaneously appear in the Receipt, still match the recorded hash exactly, no longer be selected, and carry no unresolved Drift; deletion follows the existing Advanced Cleanup rules, unselected by default and blocked non-interactively. MCV never edits `.gitignore` and never commits the Receipt automatically.
