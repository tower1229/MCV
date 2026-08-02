import { describe, expect, it } from 'vitest';
import {
  displaySkillSurface,
  ideForSkillSurface,
  isSkillSurfaceId,
} from './skill-surfaces.js';

describe('Skill Surface registry', () => {
  it.each([
    ['codex', 'codex', 'Codex'],
    ['claude-code', 'claude-code', 'Claude Code'],
    ['gemini-cli', 'gemini', 'Gemini CLI'],
    ['antigravity', 'gemini', 'Antigravity'],
  ] as const)('maps %s to its IDE and display label', (surface, ide, label) => {
    expect(isSkillSurfaceId(surface)).toBe(true);
    expect(ideForSkillSurface(surface)).toBe(ide);
    expect(displaySkillSurface(surface)).toBe(label);
  });

  it('rejects adapter IDs that are not Skill Surfaces', () => {
    expect(isSkillSurfaceId('gemini')).toBe(false);
    expect(displaySkillSurface('canonical-store')).toBe('Canonical Device Skill Store');
  });
});
