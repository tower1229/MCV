const SKILL_SURFACES = {
    codex: { ide: 'codex', label: 'Codex' },
    'claude-code': { ide: 'claude-code', label: 'Claude Code' },
    'gemini-cli': { ide: 'gemini', label: 'Gemini CLI' },
    antigravity: { ide: 'gemini', label: 'Antigravity' },
};
export function isSkillSurfaceId(value) {
    return Object.hasOwn(SKILL_SURFACES, value);
}
export function ideForSkillSurface(surface) {
    return SKILL_SURFACES[surface].ide;
}
export function displaySkillSurface(surface) {
    if (surface === 'canonical-store')
        return 'Canonical Device Skill Store';
    return SKILL_SURFACES[surface].label;
}
