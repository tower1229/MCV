export function restoreLayoutLabel(layoutKind, nodeKind) {
    switch (layoutKind) {
        case 'physical-package': return 'Physical package';
        case 'managed-link-projection': return 'Managed-link projection';
        case 'copy-projection': return 'Copy projection';
        default: return nodeKind === 'directory' ? 'Directory' : 'Ordinary file';
    }
}
