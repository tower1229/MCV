# Canonical Device Skill Store is an MCV resource layout

On macOS, `deploy.useSymlinks: true` materializes each selected Canonical Skill package once in the Canonical Device Skill Store and projects that package to verified IDE Skill surfaces. The Store currently resolves to the ecosystem-standard `~/.agents/skills/` path, which is also Codex's conventional Agent Skills location, but Codex does not own the Store lifecycle. Materialization remains required while any enabled verified Surface needs the package.

IDE Adapters declare their native Skill destination and whether real loader evidence permits managed directory links on the current platform. The centralized Deploy layout policy decides physical materialization, per-package projection, copy fallback, ordering, preconditions, backup, and rollback. No Adapter links an entire Skills root or absorbs unowned or IDE-exclusive packages.

The public Deploy Plan/Apply contract remains the safety seam. Plan and Result distinguish physical materialization, managed-link projection, copy projection, and an already satisfied projection. Apply regenerates the Plan, revalidates content and link topology, verifies materialized bytes before activating a projection, and rolls attempted content and link mutations back in reverse order after failure.

When links are disabled or loader support is unverified, MCV uses physical copies. An already correct link is preserved rather than replaced with a directory. Windows remains copy-only in this decision.
