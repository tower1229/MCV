# ADR 0010: Configuration Data Neutrality

Status: Accepted

MCV is a configuration transfer tool, not a secret manager or content-security boundary. For content already discovered by a supported Adapter or Skill Surface, Capture preserves values and files faithfully. MCV does not infer sensitivity from field names or filenames, replace values with `${env:*}`, scan for plaintext keys, mask Diff output, or block Apply because content resembles a credential.

Users remain free to store either plaintext values or environment references. Consequently, Repository files, transactional backups, terminal output, and JSON operation payloads may contain plaintext keys. Repository access control, encryption, backup policy, transport security, and disclosure risk are entirely the user's responsibility.

This decision does not broaden discovery to arbitrary HOME content. Adapters still define supported configuration paths, Local/Runtime ownership exclusions remain in force, package-internal symlinks remain rejected, and Deploy never writes through external links. Path parameterization remains a portability transform and is implemented independently from content handling.

Repository schema v3 removes the former `security` field. Migration from v2 changes only `schemaVersion` and removes that field; it does not transform configuration content. Operation schema v2 removes secret-related counters and withheld/blocked content codes.
