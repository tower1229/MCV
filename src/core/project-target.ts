import * as fs from 'fs';
import * as path from 'path';
import type { DeviceContext } from '../adapters/types.js';
import type { McvError } from '../operations/contracts.js';
import { findSymbolicLinkAncestor } from '../utils/files.js';
import { isPathWithinRoot } from './canonical-skill-device-layout.js';

export type ProjectTargetValidation =
  | { ok: true; targetRoot: string }
  | { ok: false; error: McvError };

export interface ProjectTargetOptions {
  boundRepositoryPath?: string;
}

export function validateProjectTargetRoot(
  rawPath: string | undefined,
  context: DeviceContext,
  options: ProjectTargetOptions = {},
): ProjectTargetValidation {
  if (typeof rawPath !== 'string' || rawPath.trim().length === 0) {
    return invalidTargetRoot(
      'Project Deploy requires an explicit target directory path.',
      'Pass --target <path>, or run from the intended project directory.',
    );
  }

  let resolved: string;
  try {
    resolved = path.resolve(rawPath);
  } catch {
    return invalidTargetRoot(
      'Project Deploy could not resolve the target directory path.',
      'Pass an absolute or relative filesystem path with --target.',
    );
  }

  let realTarget: string;
  try {
    const stats = fs.lstatSync(resolved);
    if (stats.isSymbolicLink()) {
      return invalidTargetRoot(
        'Project Deploy refuses a targetRoot that is a symbolic link, junction, or reparse point.',
        'Pass a real project directory path that does not traverse links.',
      );
    }
    if (!stats.isDirectory()) {
      return invalidTargetRoot(
        'Project Deploy targetRoot must be an existing directory.',
        'Create the project directory first, then pass it with --target.',
      );
    }
    realTarget = fs.realpathSync(resolved);
  } catch {
    return invalidTargetRoot(
      'Project Deploy targetRoot must exist and be a directory.',
      'Create the project directory first, then pass it with --target.',
    );
  }

  const homeReal = safeRealpath(context.homeDir);
  if (homeReal !== undefined && pathsEqual(realTarget, homeReal)) {
    return invalidTargetRoot(
      'Project Deploy refuses to use HOME as targetRoot.',
      'Pass a project directory with --target, or use --global for device-global Deploy.',
    );
  }

  const filesystemRoot = path.parse(realTarget).root;
  if (pathsEqual(realTarget, filesystemRoot)) {
    return invalidTargetRoot(
      'Project Deploy refuses to use a filesystem root as targetRoot.',
      'Pass a project subdirectory with --target.',
    );
  }

  const bound = options.boundRepositoryPath
    ? safeRealpath(options.boundRepositoryPath)
    : undefined;
  if (bound !== undefined && pathsEqual(realTarget, bound)) {
    return invalidTargetRoot(
      'Project Deploy refuses to use a bound MCV Repository as targetRoot.',
      'Pass a project directory that is not the MCV Repository.',
    );
  }

  return { ok: true, targetRoot: realTarget };
}

export function assertPathContainedInProjectRoot(
  targetRoot: string,
  outputPath: string,
): void {
  const realRoot = fs.realpathSync(targetRoot);
  const resolvedOutput = path.resolve(outputPath);
  if (!isPathWithinRoot(realRoot, resolvedOutput)) {
    throw new Error(
      `Project Deploy containment failed: ${resolvedOutput} is outside targetRoot ${realRoot}.`,
    );
  }

  const linkAncestor = findSymbolicLinkAncestor(resolvedOutput);
  if (linkAncestor === undefined) return;
  // Allow the targetRoot itself only when it is not a link (validated earlier).
  // Any symlink/junction/reparse ancestor at or beneath targetRoot blocks writes.
  if (isPathWithinRoot(realRoot, linkAncestor)) {
    throw new Error(
      `Project Deploy refuses writes through a symlink, junction, or reparse-point ancestor: ${linkAncestor}.`,
    );
  }
}

function invalidTargetRoot(message: string, nextAction: string): ProjectTargetValidation {
  return {
    ok: false,
    error: {
      code: 'deploy.invalidTargetRoot',
      message,
      nextActions: [nextAction],
    },
  };
}

function safeRealpath(candidate: string): string | undefined {
  try {
    return fs.realpathSync(path.resolve(candidate));
  } catch {
    return undefined;
  }
}

function pathsEqual(left: string, right: string): boolean {
  return path.resolve(left) === path.resolve(right);
}
