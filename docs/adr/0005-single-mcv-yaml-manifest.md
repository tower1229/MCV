# Single mcv.yaml as repository manifest

Repository identity (`repositoryId`, `schemaVersion`, `initializedAt`) and repository configuration (`targets`, `variables`, `security`, `capture`, `deploy`) are merged into a single `mcv.yaml` at the repository root. The `.mcv/repository.json` file described in early PRD drafts is eliminated. This means `mcv.yaml` is the sole file needed to identify a directory as an MCV repository, simplifying `mcv bind` validation to a single file check.

## Considered Options

- **Two files (`.mcv/repository.json` + `mcv.yaml`)** — separates identity from config, but creates redundant `schemaVersion` and `repositoryId` fields across files, and forces users and code to manage two sources of repository metadata.
