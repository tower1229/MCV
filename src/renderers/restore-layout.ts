import type { RestoreChange } from '../operations/restore.js';

export function restoreLayoutLabel(
  layoutKind: RestoreChange['layoutKind'],
  nodeKind: RestoreChange['nodeKind'],
): string {
  switch (layoutKind) {
    case 'physical-package': return 'Physical package';
    case 'managed-link-projection': return 'Managed-link projection';
    case 'copy-projection': return 'Copy projection';
    default: return nodeKind === 'directory' ? 'Directory' : 'Ordinary file';
  }
}
