import * as path from 'path';
import type { DeviceContext, IdeId } from '../adapters/types.js';

export type InstructionAssetId = `instruction:${IdeId}`;
export type ProjectInstructionsFileName = 'AGENTS.md' | 'CLAUDE.md' | 'GEMINI.md';

export interface IdeInstructionDefinition {
  target: IdeId;
  assetId: InstructionAssetId;
  repositoryPath: string;
  projectFileName: ProjectInstructionsFileName;
  globalTargetPath(context: DeviceContext): string;
}

export const IDE_INSTRUCTION_DEFINITIONS: readonly IdeInstructionDefinition[] = [
  {
    target: 'codex',
    assetId: 'instruction:codex',
    repositoryPath: 'ide/codex/instructions.md',
    projectFileName: 'AGENTS.md',
    globalTargetPath: (context) => path.join(
      context.env.CODEX_HOME || path.join(context.homeDir, '.codex'),
      'AGENTS.md',
    ),
  },
  {
    target: 'claude-code',
    assetId: 'instruction:claude-code',
    repositoryPath: 'ide/claude-code/instructions.md',
    projectFileName: 'CLAUDE.md',
    globalTargetPath: (context) => path.join(
      context.env.CLAUDE_CONFIG_DIR || path.join(context.homeDir, '.claude'),
      'CLAUDE.md',
    ),
  },
  {
    target: 'gemini',
    assetId: 'instruction:gemini',
    repositoryPath: 'ide/gemini/instructions.md',
    projectFileName: 'GEMINI.md',
    globalTargetPath: (context) => path.join(context.homeDir, '.gemini', 'GEMINI.md'),
  },
];

export function instructionDefinition(target: IdeId): IdeInstructionDefinition {
  const definition = IDE_INSTRUCTION_DEFINITIONS.find((candidate) => candidate.target === target);
  if (!definition) throw new Error(`Unsupported IDE Instructions target: ${target}`);
  return definition;
}

export function instructionDefinitionByRepositoryPath(
  repositoryPath: string,
): IdeInstructionDefinition | undefined {
  return IDE_INSTRUCTION_DEFINITIONS.find((candidate) => candidate.repositoryPath === repositoryPath);
}
