# Single IdeAdapter interface with internal composition

Each IDE exposes one `IdeAdapter` interface (detect, discoverFiles, capture, deploy, validate). Internally, every adapter composes two separated concerns: a `CanonicalTransformer` (semantic conversion of rules, Skills, MCP between MCV's unified format and the IDE's format) and a `NativeFileHandler` (path discovery, file read/write, secret filtering, variable substitution). The interface stays unified so downstream consumers never deal with two objects per IDE; the implementation stays separated so Canonical schema changes don't force edits to file-handling code and vice versa.

## Considered Options

- **B) Two separate interfaces per IDE** — cleaner separation but doubles the surface area consumers must manage, and forces CLI/core to know which object to call for each operation.
- **C) One mixed class, refactor later** — simpler now but creates a refactoring cliff once Canonical schemas start evolving independently from IDE file layouts.
