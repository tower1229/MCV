# ADR 0011: Single profiles.yaml and Derived Asset Catalog

Status: Accepted

MCV 0.3 introduces Profiles — named sets of Asset IDs — and needs both a place to store them and a way to enumerate the Assets they reference. All Profiles live in one root-level `profiles.yaml` (schema v1), separate from the `mcv.yaml` runtime manifest; the Asset Catalog is deterministically derived from Repository content on every read and is never persisted as a user-maintained index.

Agents routinely reorganize many Profiles in one pass, and a single file lets any batch — creates, updates, and deletes across several Profiles — commit as one atomic replacement validated by one JSON Schema that can express the global-must-exist invariant. Per-Profile files would need multi-file transactions with half-completed states, and a maintained `assets.yaml` could silently disagree with the Repository content it indexes, while a derived Catalog cannot. Revision tracking, optimistic concurrency, and Git diffs all stay single-file simple. At the expected scale of tens of Profiles, file size is irrelevant.

Serialization is normalization, not preference: `global` first, remaining Profile IDs lexicographic, assets deduplicated and sorted, no volatile fields such as `updatedAt`. Profile IDs are immutable lowercase slugs; changing a display name edits `title`, and changing an ID means create-plus-delete. The `global` Profile must exist and delete operations must refuse it. The Profiles Revision (SHA-256 of the normalized document) and the Catalog Revision (SHA-256 of sorted Asset IDs, content hashes, and Adapter capability declarations) are the concurrency tokens every writer — CLI, TUI, or MCP — must present.
