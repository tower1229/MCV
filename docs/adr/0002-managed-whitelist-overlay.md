# Managed-whitelist overlay strategy

When a single config file contains both MCV-managed and IDE-native fields (e.g. Cursor's `settings.json`), only `managedPaths` are explicitly declared in the Adapter source code. Every undeclared field defaults to Native ownership and is preserved untouched during deploy and eligible for capture. A small `localPaths` exclusion list filters out known device-bound fields (e.g. `$.preferredTerminal`). This means new fields added by IDE updates are automatically safe — MCV won't overwrite them and won't require Adapter changes to accommodate them.

## Considered Options

- **Explicit triple declaration (managedPaths + nativePaths + localPaths)** — more precise, but requires Adapter updates every time an IDE adds a new field, which contradicts the "preserve unknown fields" principle.
- **User-maintained path declarations in repository metadata** — maximum flexibility, but ordinary users will never touch these, and misconfiguration risks data loss.
