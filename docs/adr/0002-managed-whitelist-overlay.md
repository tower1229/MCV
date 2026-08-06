# Managed-whitelist overlay strategy

When a single supported config file contains both MCV-managed and IDE-native fields, only `managedPaths` are explicitly declared in the Adapter source code. Every undeclared field defaults to Native ownership and is preserved untouched during deploy and eligible for capture. A small `localPaths` exclusion list filters out known device-bound fields (for example a device-specific terminal preference). This means new fields added by IDE updates are preserved by default: MCV will not overwrite them and does not require an Adapter change merely to tolerate them.

## Considered Options

- **Explicit triple declaration (managedPaths + nativePaths + localPaths)** — more precise, but requires Adapter updates every time an IDE adds a new field, which contradicts the "preserve unknown fields" principle.
- **User-maintained path declarations in repository metadata** — maximum flexibility, but ordinary users will never touch these, and misconfiguration risks data loss.
