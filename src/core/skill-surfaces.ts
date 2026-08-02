import type { IdeId, SkillSurfaceId } from '../adapters/types.js';

const SKILL_SURFACES: Record<SkillSurfaceId, { ide: IdeId; label: string }> = {
  codex: { ide: 'codex', label: 'Codex' },
  'claude-code': { ide: 'claude-code', label: 'Claude Code' },
  'gemini-cli': { ide: 'gemini', label: 'Gemini CLI' },
  antigravity: { ide: 'gemini', label: 'Antigravity' },
};

export function isSkillSurfaceId(value: string): value is SkillSurfaceId {
  return Object.hasOwn(SKILL_SURFACES, value);
}

export function ideForSkillSurface(surface: SkillSurfaceId): IdeId {
  return SKILL_SURFACES[surface].ide;
}

export function displaySkillSurface(surface: SkillSurfaceId | 'canonical-store'): string {
  if (surface === 'canonical-store') return 'Canonical Device Skill Store';
  return SKILL_SURFACES[surface].label;
}
