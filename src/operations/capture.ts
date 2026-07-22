import * as crypto from 'crypto';
import { isUtf8 } from 'buffer';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import * as yaml from 'yaml';
import { createAdapterDefinitions, type TargetId } from '../adapters';
import type {
  CaptureFile,
  ConfigurationCapability,
  DeviceContext,
} from '../adapters/types';
import {
  collectSkills,
  getSkillSources,
  type SkillPackage,
} from '../core/skills';
import { isRecord, mergeRecords } from '../utils/objects';
import { readManifest, resolveBoundRepository } from '../utils/repository';
import { scanTextForSecrets } from '../utils/sanitize';
import {
  deleteObjectPath,
  parseStructuredObject,
  stringifyStructuredObject,
  type StructuredFormat,
} from '../utils/structured-config';
import {
  OPERATION_SCHEMA_VERSION,
  type Issue,
  type McvError,
  type Plan,
  type Result,
} from './contracts';

export type CaptureItemType = 'file' | 'skill' | 'mcp';

export interface CaptureTextPreview {
  repositoryPath: string;
  kind: 'text';
  bytes: number;
  sha256: string;
  diff: string;
}

export interface CaptureBinaryPreview {
  repositoryPath: string;
  kind: 'binary';
  bytes: number;
  sha256: string;
}

export type CapturePreview = CaptureTextPreview | CaptureBinaryPreview;

export interface CaptureChange {
  id: string;
  ide: 'shared' | 'codex' | 'claude-code' | 'gemini';
  surface: string;
  itemType: CaptureItemType;
  capability: ConfigurationCapability;
  name: string;
  change: 'add' | 'modify' | 'delete' | 'conflict';
  defaultSelected: boolean;
  repositoryPaths: string[];
  previews: CapturePreview[];
  decisionGroupId?: string;
  decision?: 'candidate' | 'skip';
  sourceLabel?: string;
}

export interface CapturePlanSummary {
  sensitiveFieldCount: number;
  parameterizedPathCount: number;
  excludedFileCount: number;
}

export type CapturePlan = Plan<CaptureChange> & {
  operation: 'capture';
  summary: CapturePlanSummary;
};

export interface CaptureSelection {
  changeIds: string[];
  confirmedIssueCodes?: string[];
}

export interface CaptureApplyOptions {
  nonInteractive?: boolean;
  moveFile?: typeof fs.renameSync;
  restoreFile?: (targetPath: string, content: Buffer) => void;
}

export interface CaptureResultData {
  appliedChangeIds: string[];
  writtenPaths: string[];
  deletedPaths: string[];
}

export type CaptureResult = Result<CaptureResultData, CaptureChange> & {
  operation: 'capture';
};

interface CaptureMutation {
  writes: Array<{ repositoryPath: string; content: Buffer }>;
  deletes: string[];
  mcp?: { name: string; value?: Record<string, unknown> };
  sourceHash: string;
}

interface ActiveCapturePlan {
  operationId: string;
  mutations: Map<string, CaptureMutation>;
}

const activeCapturePlans = new WeakMap<CapturePlan, ActiveCapturePlan>();

interface SourcedCaptureFile extends CaptureFile {
  ide: CaptureChange['ide'];
  surface: string;
}

interface PlannedFile extends SourcedCaptureFile {
  finalContent: string | Buffer;
  existingContent?: Buffer;
}

interface McpCandidate {
  sourcePath: string;
  ide: CaptureChange['ide'];
  value: Record<string, unknown>;
}

const EMPTY_SUMMARY: CapturePlanSummary = {
  sensitiveFieldCount: 0,
  parameterizedPathCount: 0,
  excludedFileCount: 0,
};

export async function createCapturePlan(
  context: DeviceContext,
): Promise<CapturePlan> {
  const operationId = uuidv4();
  let repositoryPath: string | null = null;
  try {
    repositoryPath = resolveBoundRepository(context);
    const mutations = new Map<string, CaptureMutation>();
    const plan = await buildCapturePlan(context, repositoryPath, operationId, mutations);
    registerCapturePlan(plan, mutations);
    return plan;
  } catch {
    return {
      schemaVersion: OPERATION_SCHEMA_VERSION,
      operation: 'capture',
      status: 'failed',
      readyToApply: false,
      operationId,
      preconditions: {},
      repositoryPath,
      changes: [],
      issues: [{
        severity: 'error',
        code: 'capture.planFailed',
        message: 'The Capture Plan could not be generated safely.',
      }],
      nextActions: ['Fix the reported Repository or IDE configuration problem, then regenerate the Capture Plan.'],
      error: {
        code: 'capture.planFailed',
        message: 'The Capture Plan could not be generated safely.',
        nextActions: ['Fix the Repository or IDE configuration problem, then regenerate the Capture Plan.'],
      },
      summary: EMPTY_SUMMARY,
    };
  }
}

async function buildCapturePlan(
  context: DeviceContext,
  repositoryPath: string,
  operationId: string,
  mutations: Map<string, CaptureMutation>,
): Promise<CapturePlan> {
  const manifest = readManifest(repositoryPath);
  const definitions = createAdapterDefinitions().filter(
    ({ targetId }) => manifest.targets[targetId]?.enabled === true,
  );
  if (definitions.length === 0) {
    return {
      schemaVersion: OPERATION_SCHEMA_VERSION,
      operation: 'capture',
      status: 'planned',
      readyToApply: true,
      operationId,
      preconditions: {},
      repositoryPath,
      changes: [],
      issues: [{
        severity: 'notice',
        code: 'capture.noEnabledTargets',
        message: 'No IDE targets are enabled in this Repository.',
      }],
      nextActions: ['Enable at least one IDE target in mcv.yaml before capturing configuration.'],
      summary: EMPTY_SUMMARY,
    };
  }
  const captureContext: DeviceContext = {
    ...context,
    variables: resolveManifestVariables(manifest.variables, context),
  };
  const captured = await Promise.all(definitions.map(async (definition) => {
    const discovered = await definition.adapter.discoverFiles(captureContext);
    const result = await definition.adapter.capture(discovered, captureContext);
    return { definition, discovered, result };
  }));
  const issues: Issue[] = captured.flatMap(({ result }, resultIndex) =>
    result.warnings.map((_warning, warningIndex) => ({
      severity: 'warning' as const,
      code: `capture.sourceSkipped.${resultIndex + 1}.${warningIndex + 1}`,
      message: 'A source item was skipped because it could not be processed safely.',
    })),
  );
  const sourcedFiles: SourcedCaptureFile[] = captured.flatMap(({ definition, result }) =>
    result.files.map((file) => ({
      ...file,
      ide: ideName(definition.targetId),
      surface: surfaceName(file.repositoryPath, definition.targetId),
    })),
  );

  const skills = collectSkills(getSkillSources(captureContext, {
    codex: manifest.targets.codex?.enabled === true,
    claudeCode: manifest.targets.claudeCode?.enabled === true,
    gemini: manifest.targets.gemini?.enabled === true,
  }));
  for (let index = 0; index < skills.warnings.length; index += 1) {
    issues.push({
      severity: 'warning',
      code: `capture.skillSkipped.${index + 1}`,
      message: 'A Skill source item was skipped because it could not be processed safely.',
    });
  }

  const summary = captured.reduce<CapturePlanSummary>((total, { result }) => ({
    sensitiveFieldCount: total.sensitiveFieldCount + result.summary.sensitiveFieldCount,
    parameterizedPathCount: total.parameterizedPathCount + result.summary.parameterizedPathCount,
    excludedFileCount: total.excludedFileCount + result.summary.excludedFileCount,
  }), {
    ...EMPTY_SUMMARY,
    excludedFileCount: skills.excludedFileCount,
  });

  const changes: CaptureChange[] = [];
  const plannedRepositoryPaths = new Set<string>();
  addRulesChange(repositoryPath, sourcedFiles, changes, issues, plannedRepositoryPaths, mutations);
  addMcpChanges(repositoryPath, sourcedFiles, changes, issues, plannedRepositoryPaths, mutations);
  addFileChanges(repositoryPath, sourcedFiles, changes, issues, plannedRepositoryPaths, mutations);
  addSkillChanges(repositoryPath, skills.packages, changes, issues, plannedRepositoryPaths, mutations);
  addRepositoryDeletionChanges(
    repositoryPath,
    definitions.map(({ targetId }) => targetId),
    sourcedFiles,
    skills.packages,
    changes,
    issues,
    plannedRepositoryPaths,
    mutations,
  );

  const rawSourceHash = hashSourcePaths([
    ...captured.flatMap(({ discovered }) => discovered.map((file) => file.path)),
    ...[...skills.packages.values()].flatMap((copies) => copies.flatMap((skill) =>
      skill.files.map((file) => path.join(skill.directory, file.relativePath)))),
  ]);
  for (const mutation of mutations.values()) mutation.sourceHash = rawSourceHash;

  changes.sort(compareChanges);
  const preconditions = {
    sourceSnapshot: rawSourceHash,
    ...Object.fromEntries(changes.flatMap((change) => [
      [`source:${change.id}`, mutations.get(change.id)?.sourceHash ?? hashText('<missing>')],
      [`target:${change.id}`, hashRepositoryPaths(repositoryPath, change.repositoryPaths)],
    ])),
  };
  const blocked = issues.some((issue) =>
    issue.severity === 'decisionRequired' || issue.severity === 'error');

  return {
    schemaVersion: OPERATION_SCHEMA_VERSION,
    operation: 'capture',
    status: 'planned',
    readyToApply: !blocked,
    operationId,
    preconditions,
    repositoryPath,
    changes,
    issues,
    nextActions: blocked
      ? ['Resolve every decisionRequired or error Issue, then regenerate the Capture Plan.']
      : [],
    summary,
  };
}

export async function applyCapturePlan(
  context: DeviceContext,
  plan: CapturePlan,
  selection: CaptureSelection,
  options: CaptureApplyOptions = {},
): Promise<CaptureResult> {
  if (plan.status === 'failed') return failedCaptureResult(plan.repositoryPath, plan.error, plan.issues);
  const active = activeCapturePlans.get(plan);
  if (!active || active.operationId !== plan.operationId) {
    return failedCaptureResult(plan.repositoryPath, invalidPlanError());
  }

  const selectedIds = [...new Set(selection.changeIds)];
  const knownIds = new Set(plan.changes.map((change) => change.id));
  if (selectedIds.some((id) => !knownIds.has(id))) {
    return failedCaptureResult(plan.repositoryPath, {
      code: 'capture.invalidSelection',
      message: 'The Capture selection contains an ID that is not in the active Plan.',
      nextActions: ['Choose only change IDs from the current Capture Plan.'],
    });
  }

  const selected = new Set(selectedIds);
  const blocking = captureBlockingIssues(plan, selected, selection, options);
  if (blocking.length > 0) {
    return blockedCaptureResult(plan, blocking);
  }

  if (!plan.repositoryPath || resolveBoundRepository(context) !== plan.repositoryPath) {
    activeCapturePlans.delete(plan);
    return failedCaptureResult(plan.repositoryPath, stalePlanError());
  }

  let freshPlan: CapturePlan;
  try {
    freshPlan = await buildCapturePlan(
      context,
      plan.repositoryPath,
      plan.operationId,
      new Map<string, CaptureMutation>(),
    );
  } catch {
    activeCapturePlans.delete(plan);
    return failedCaptureResult(plan.repositoryPath, stalePlanError());
  }
  if (!sameCaptureSnapshot(plan, freshPlan)) {
    activeCapturePlans.delete(plan);
    return failedCaptureResult(plan.repositoryPath, stalePlanError());
  }

  const selectedChanges = plan.changes.filter((change) => selected.has(change.id));
  const selectedMutations = selectedChanges.map((change) => active.mutations.get(change.id));
  if (selectedMutations.some((mutation) => mutation === undefined)) {
    return blockedCaptureResult(plan, [{
      severity: 'decisionRequired',
      code: 'capture.unresolvedDecision',
      message: 'The Capture selection does not resolve every required decision.',
    }]);
  }

  try {
    const applied = applyCaptureTransaction(
      plan.repositoryPath,
      selectedMutations as CaptureMutation[],
      options.moveFile ?? fs.renameSync,
      options.restoreFile ?? ((targetPath, content) => fs.writeFileSync(targetPath, content)),
    );
    activeCapturePlans.delete(plan);
    return {
      schemaVersion: OPERATION_SCHEMA_VERSION,
      operation: 'capture',
      status: 'succeeded',
      repositoryPath: plan.repositoryPath,
      changes: selectedChanges,
      issues: [],
      nextActions: [],
      data: {
        appliedChangeIds: selectedIds,
        writtenPaths: applied.writtenPaths,
        deletedPaths: applied.deletedPaths,
      },
    };
  } catch (error) {
    activeCapturePlans.delete(plan);
    if (error instanceof CaptureRollbackError) {
      return failedCaptureResult(plan.repositoryPath, {
        code: 'capture.rollbackFailed',
        message: 'Capture failed and could not fully restore the Repository automatically.',
        technicalDetails: error.message,
        nextActions: [`Restore the affected files from ${error.recoveryPath}, then generate a new Capture Plan.`],
      });
    }
    return failedCaptureResult(plan.repositoryPath, {
      code: 'capture.transactionFailed',
      message: 'Capture could not commit the selected changes and restored the Repository.',
      technicalDetails: error instanceof Error ? error.message : String(error),
      nextActions: ['Check Repository permissions, then generate and review a new Capture Plan.'],
    });
  }
}

function registerCapturePlan(
  plan: CapturePlan,
  mutations: Map<string, CaptureMutation>,
): void {
  freezeCapturePlan(plan);
  activeCapturePlans.set(plan, { operationId: plan.operationId, mutations });
}

function freezeCapturePlan(plan: CapturePlan): void {
  for (const change of plan.changes) {
    for (const previewItem of change.previews) Object.freeze(previewItem);
    Object.freeze(change.previews);
    Object.freeze(change.repositoryPaths);
    Object.freeze(change);
  }
  Object.freeze(plan.changes);
  for (const issue of plan.issues) Object.freeze(issue);
  Object.freeze(plan.issues);
  Object.freeze(plan.nextActions);
  Object.freeze(plan.preconditions);
  if (plan.status === 'failed') {
    Object.freeze(plan.error.nextActions);
    Object.freeze(plan.error);
  }
  Object.freeze(plan.summary);
  Object.freeze(plan);
}

function captureBlockingIssues(
  plan: CapturePlan,
  selected: Set<string>,
  selection: CaptureSelection,
  options: CaptureApplyOptions,
): Issue[] {
  if (options.nonInteractive) {
    const unsafe = plan.issues.some((issue) => issue.severity !== 'notice')
      || plan.changes.some((change) => change.change === 'delete');
    return unsafe ? [{
      severity: 'decisionRequired',
      code: 'capture.nonInteractiveBlocked',
      message: 'Non-interactive Capture cannot apply warnings, decisions, errors, or deletions.',
    }] : [];
  }

  const confirmed = new Set(selection.confirmedIssueCodes ?? []);
  const unconfirmedWarnings = plan.issues.filter((issue) =>
    issue.severity === 'warning' && !confirmed.has(issue.code));
  if (unconfirmedWarnings.length > 0) return unconfirmedWarnings;
  const errors = plan.issues.filter((issue) => issue.severity === 'error');
  if (errors.length > 0) return errors;

  const conflictChanges = plan.changes.filter((change) => change.change === 'conflict');
  const groups = new Map<string, CaptureChange[]>();
  for (const change of conflictChanges) {
    if (!change.decisionGroupId) return plan.issues.filter((issue) => issue.severity === 'decisionRequired');
    groups.set(change.decisionGroupId, [...(groups.get(change.decisionGroupId) ?? []), change]);
  }
  if ([...groups.values()].some((choices) =>
    choices.filter((choice) => selected.has(choice.id)).length !== 1)) {
    return plan.issues.filter((issue) => issue.severity === 'decisionRequired');
  }
  return [];
}

function sameCaptureSnapshot(left: CapturePlan, right: CapturePlan): boolean {
  return left.repositoryPath === right.repositoryPath
    && stableValue(left.preconditions) === stableValue(right.preconditions)
    && stableValue(left.changes.map((change) => ({
      id: change.id,
      change: change.change,
      repositoryPaths: change.repositoryPaths,
    }))) === stableValue(right.changes.map((change) => ({
      id: change.id,
      change: change.change,
      repositoryPaths: change.repositoryPaths,
    })))
    && stableValue(left.issues.map((issue) => [issue.severity, issue.code]))
      === stableValue(right.issues.map((issue) => [issue.severity, issue.code]));
}

function applyCaptureTransaction(
  repositoryPath: string,
  mutations: CaptureMutation[],
  moveFile: typeof fs.renameSync,
  restoreFile: (targetPath: string, content: Buffer) => void,
): { writtenPaths: string[]; deletedPaths: string[] } {
  const writes = new Map<string, Buffer>();
  const deletes = new Set<string>();
  const mcpMutations = mutations.flatMap((mutation) => mutation.mcp ? [mutation.mcp] : []);
  for (const mutation of mutations) {
    for (const write of mutation.writes) writes.set(write.repositoryPath, write.content);
    for (const deleted of mutation.deletes) deletes.add(deleted);
  }
  if (mcpMutations.length > 0) {
    const registryPath = path.join(repositoryPath, 'common', 'mcp.yaml');
    const servers = readMcpServers(registryPath);
    for (const mutation of mcpMutations) {
      if (mutation.value === undefined) delete servers[mutation.name];
      else servers[mutation.name] = mutation.value;
    }
    writes.set('common/mcp.yaml', Buffer.from(yaml.stringify({ servers })));
    deletes.delete('common/mcp.yaml');
  }

  const affected = new Set([...writes.keys(), ...deletes]);
  const originals = new Map<string, Buffer | undefined>();
  const temporaryPaths: string[] = [];
  const createdDirectories: string[] = [];
  for (const repositoryFile of affected) {
    const target = repositoryTarget(repositoryPath, repositoryFile);
    originals.set(repositoryFile, fs.existsSync(target) ? fs.readFileSync(target) : undefined);
  }
  const recoveryPath = createRecoveryBackup(repositoryPath, originals);

  try {
    let sequence = 0;
    for (const [repositoryFile, content] of writes) {
      const target = repositoryTarget(repositoryPath, repositoryFile);
      createParentDirectories(path.dirname(target), repositoryPath, createdDirectories);
      const temporary = `${target}.mcv-${process.pid}-${sequence += 1}.tmp`;
      fs.writeFileSync(temporary, content);
      temporaryPaths.push(temporary);
    }
    for (let index = 0; index < temporaryPaths.length; index += 1) {
      const repositoryFile = [...writes.keys()][index];
      moveFile(temporaryPaths[index], repositoryTarget(repositoryPath, repositoryFile));
    }
    for (const repositoryFile of deletes) {
      fs.rmSync(repositoryTarget(repositoryPath, repositoryFile), { force: true });
    }
  } catch (error) {
    const rollbackErrors: string[] = [];
    for (const temporary of temporaryPaths) {
      try { fs.rmSync(temporary, { force: true }); }
      catch (rollbackError) { rollbackErrors.push(errorMessage(rollbackError)); }
    }
    for (const [repositoryFile, original] of originals) {
      const target = repositoryTarget(repositoryPath, repositoryFile);
      try {
        if (original === undefined) fs.rmSync(target, { force: true });
        else {
          fs.mkdirSync(path.dirname(target), { recursive: true });
          restoreFile(target, original);
        }
      } catch (rollbackError) {
        rollbackErrors.push(`${repositoryFile}: ${errorMessage(rollbackError)}`);
      }
    }
    for (const directory of createdDirectories.reverse()) {
      try { fs.rmdirSync(directory); } catch { /* directory is not empty */ }
    }
    if (rollbackErrors.length > 0) {
      throw new CaptureRollbackError(
        recoveryPath,
        `${errorMessage(error)} Rollback was incomplete: ${rollbackErrors.join('; ')}`,
      );
    }
    removeRecoveryBackup(recoveryPath);
    throw error;
  }

  removeRecoveryBackup(recoveryPath);
  return { writtenPaths: [...writes.keys()], deletedPaths: [...deletes] };
}

function removeRecoveryBackup(recoveryPath: string): void {
  try { fs.rmSync(recoveryPath, { recursive: true, force: true }); }
  catch { /* a complete backup is safe to leave for manual cleanup */ }
}

class CaptureRollbackError extends Error {
  constructor(
    readonly recoveryPath: string,
    message: string,
  ) {
    super(message);
    this.name = 'CaptureRollbackError';
  }
}

function createRecoveryBackup(
  repositoryPath: string,
  originals: Map<string, Buffer | undefined>,
): string {
  const recoveryPath = path.join(
    path.dirname(repositoryPath),
    `.${path.basename(repositoryPath)}.mcv-capture-${uuidv4()}`,
  );
  try {
    const filesPath = path.join(recoveryPath, 'files');
    fs.mkdirSync(filesPath, { recursive: true });
    const manifest = [...originals].map(([repositoryFile, original], index) => {
      const backupFile = original === undefined ? null : `${index}`;
      if (backupFile && original !== undefined) {
        fs.writeFileSync(path.join(filesPath, backupFile), original);
      }
      return { repositoryFile, backupFile };
    });
    fs.writeFileSync(
      path.join(recoveryPath, 'manifest.json'),
      `${JSON.stringify({ repositoryPath, files: manifest }, null, 2)}\n`,
    );
    return recoveryPath;
  } catch (error) {
    fs.rmSync(recoveryPath, { recursive: true, force: true });
    throw error;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createParentDirectories(directory: string, repositoryPath: string, created: string[]): void {
  if (fs.existsSync(directory) || directory === repositoryPath) return;
  createParentDirectories(path.dirname(directory), repositoryPath, created);
  fs.mkdirSync(directory);
  created.push(directory);
}

function repositoryTarget(repositoryPath: string, repositoryFile: string): string {
  return path.join(repositoryPath, ...repositoryFile.split('/'));
}

function writeMutation(
  repositoryPath: string,
  content: string | Buffer,
  sourcePaths: string[],
): CaptureMutation {
  return {
    writes: [{ repositoryPath, content: toBuffer(content) }],
    deletes: [],
    sourceHash: hashSourcePaths(sourcePaths),
  };
}

function deleteMutation(repositoryPaths: string[]): CaptureMutation {
  return { writes: [], deletes: [...repositoryPaths], sourceHash: hashText('<missing>') };
}

function emptyMutation(sourcePaths: string[]): CaptureMutation {
  return { writes: [], deletes: [], sourceHash: hashSourcePaths(sourcePaths) };
}

function mcpMutation(
  name: string,
  value: Record<string, unknown> | undefined,
  sourcePaths: string[],
): CaptureMutation {
  return { ...emptyMutation(sourcePaths), mcp: { name, value } };
}

function hashSourcePaths(sourcePaths: string[]): string {
  const hash = crypto.createHash('sha256');
  const unique = [...new Set(sourcePaths)].sort();
  if (unique.length === 0) hash.update('<missing>');
  for (const sourcePath of unique) {
    hash.update(sourcePath);
    hash.update(fs.existsSync(sourcePath) ? fs.readFileSync(sourcePath) : '<missing>');
  }
  return hash.digest('hex');
}

function invalidPlanError(): McvError {
  return {
    code: 'operation.invalidPlan',
    message: 'The Capture Plan is not the active in-process Plan.',
    nextActions: ['Generate and review a new Capture Plan.'],
  };
}

function stalePlanError(): McvError {
  return {
    code: 'operation.stalePlan',
    message: 'Capture source or Repository target state changed after the Plan was generated.',
    nextActions: ['Generate and review a new Capture Plan.'],
  };
}

function failedCaptureResult(
  repositoryPath: string | null,
  error: McvError,
  issues: Issue[] = [{ severity: 'error', code: error.code, message: error.message }],
): CaptureResult {
  return {
    schemaVersion: OPERATION_SCHEMA_VERSION,
    operation: 'capture',
    status: 'failed',
    repositoryPath,
    changes: [],
    issues,
    nextActions: error.nextActions,
    error,
  };
}

function blockedCaptureResult(plan: CapturePlan, issues: Issue[]): CaptureResult {
  return {
    schemaVersion: OPERATION_SCHEMA_VERSION,
    operation: 'capture',
    status: 'blocked',
    repositoryPath: plan.repositoryPath,
    changes: [],
    issues,
    nextActions: issues.some((issue) => issue.severity === 'warning')
      ? ['Confirm every warning explicitly before applying the Capture Plan.']
      : ['Review and resolve the Capture Plan interactively before applying it.'],
  };
}

function addRulesChange(
  repositoryPath: string,
  files: SourcedCaptureFile[],
  changes: CaptureChange[],
  issues: Issue[],
  plannedRepositoryPaths: Set<string>,
  mutations: Map<string, CaptureMutation>,
): void {
  const candidates = files.filter((file) => file.repositoryPath === 'common/AGENTS.md');
  if (candidates.length === 0) return;
  const targetPath = path.join(repositoryPath, 'common', 'AGENTS.md');
  const contents = [
    ...(fs.existsSync(targetPath) ? [fs.readFileSync(targetPath, 'utf8')] : []),
    ...candidates.flatMap((candidate) =>
      typeof candidate.content === 'string' ? [candidate.content] : []),
  ];
  const content = mergeCanonicalRules(contents);
  const planned = planFile(repositoryPath, {
    ...candidates[0],
    ide: 'shared',
    surface: 'shared',
    sourcePath: candidates.map((candidate) => candidate.sourcePath).join(', '),
    content,
  }, issues);
  if (!planned || sameOptionalContent(planned.existingContent, planned.finalContent)) return;
  const change = fileChange('shared', 'shared', 'file', 'rules', 'Shared Rules', planned, issues);
  changes.push(change);
  mutations.set(change.id, writeMutation(
    planned.repositoryPath,
    planned.finalContent,
    candidates.map((candidate) => candidate.sourcePath),
  ));
  plannedRepositoryPaths.add(planned.repositoryPath);
}

function addMcpChanges(
  repositoryPath: string,
  files: SourcedCaptureFile[],
  changes: CaptureChange[],
  issues: Issue[],
  plannedRepositoryPaths: Set<string>,
  mutations: Map<string, CaptureMutation>,
): void {
  const registryFiles = files.filter((file) =>
    file.repositoryPath === 'common/mcp.yaml' && typeof file.content === 'string');
  const candidatesByName = new Map<string, McpCandidate[]>();
  for (const file of registryFiles) {
    const parsed = yaml.parse(file.content as string) as unknown;
    if (!isRecord(parsed) || !isRecord(parsed.servers)) {
      issues.push({
        severity: 'error',
        code: 'capture.invalidMcpRegistry',
        message: 'An MCP source could not be represented as a safe registry.',
      });
      continue;
    }
    for (const [name, value] of Object.entries(parsed.servers)) {
      if (!isRecord(value)) continue;
      candidatesByName.set(name, [
        ...(candidatesByName.get(name) ?? []),
        { sourcePath: file.sourcePath, ide: file.ide, value },
      ]);
    }
  }
  const existingServers = readMcpServers(path.join(repositoryPath, 'common', 'mcp.yaml'));
  const names = new Set([...candidatesByName.keys(), ...Object.keys(existingServers)]);
  for (const name of [...names].sort()) {
    const deviceCandidates = uniqueMcpCandidates(candidatesByName.get(name) ?? []);
    const existing = isRecord(existingServers[name]) ? existingServers[name] : undefined;
    if (deviceCandidates.length === 0 && existing) {
      const content = yaml.stringify({ [name]: existing });
      const change: CaptureChange = {
        id: selectionId('mcp', 'shared', name),
        ide: 'shared',
        surface: 'shared',
        itemType: 'mcp',
        capability: 'mcp',
        name,
        change: 'delete',
        defaultSelected: false,
        repositoryPaths: [`common/mcp.yaml#${name}`],
        previews: [preview(`common/mcp.yaml#${name}`, '', content, issues)],
      };
      changes.push(change);
      mutations.set(change.id, mcpMutation(name, undefined, []));
      continue;
    }
    const allCandidates = uniqueMcpCandidates([
      ...(existing ? [{ sourcePath: 'Repository common/mcp.yaml', ide: 'shared' as const, value: existing }] : []),
      ...deviceCandidates,
    ]);
    const uniqueCore = new Set(allCandidates.map((candidate) => stableValue(withoutOverrides(candidate.value))));
    if (uniqueCore.size > 1) {
      const decisionGroupId = `capture-decision-${hashText(`mcp\0${name}`).slice(0, 16)}`;
      for (const candidate of allCandidates) {
        const candidateValue = stableValue(candidate.value);
        const change: CaptureChange = {
          id: selectionId('mcp', 'shared', `${name}\0${candidateValue}`),
          ide: 'shared',
          surface: 'shared',
          itemType: 'mcp',
          capability: 'mcp',
          name,
          change: 'conflict',
          defaultSelected: false,
          repositoryPaths: [`common/mcp.yaml#${name}`],
          previews: [preview(
            `common/mcp.yaml#${name}`,
            yaml.stringify({ [name]: candidate.value }),
            undefined,
            issues,
          )],
          decisionGroupId,
          decision: 'candidate',
          sourceLabel: sourceLabel(candidate.ide, candidate.sourcePath),
        };
        changes.push(change);
        mutations.set(change.id, mcpMutation(
          name,
          candidate.value,
          deviceCandidates.map((item) => item.sourcePath),
        ));
      }
      const skip: CaptureChange = {
        id: selectionId('mcp', 'shared', `${name}\0skip`),
        ide: 'shared',
        surface: 'shared',
        itemType: 'mcp',
        capability: 'mcp',
        name: `${name} (skip)`,
        change: 'conflict',
        defaultSelected: false,
        repositoryPaths: [`common/mcp.yaml#${name}`],
        previews: [],
        decisionGroupId,
        decision: 'skip',
        sourceLabel: 'Skip this item',
      };
      changes.push(skip);
      mutations.set(skip.id, emptyMutation(deviceCandidates.map((item) => item.sourcePath)));
      issues.push({
        severity: 'decisionRequired',
        code: 'capture.mcpCoreConflict',
        message: `MCP server ${safeLabel(name)} has conflicting core definitions.`,
      });
      continue;
    }
    const merged = mergeMcpCandidates(allCandidates);
    if (existing && stableValue(existing) === stableValue(merged)) continue;
    const before = existing ? yaml.stringify({ [name]: existing }) : undefined;
    const after = yaml.stringify({ [name]: merged });
    const change: CaptureChange = {
      id: selectionId('mcp', 'shared', name),
      ide: 'shared',
      surface: 'shared',
      itemType: 'mcp',
      capability: 'mcp',
      name,
      change: existing ? 'modify' : 'add',
      defaultSelected: true,
      repositoryPaths: [`common/mcp.yaml#${name}`],
      previews: [preview(`common/mcp.yaml#${name}`, after, before, issues)],
    };
    changes.push(change);
    mutations.set(change.id, mcpMutation(
      name,
      merged,
      deviceCandidates.map((item) => item.sourcePath),
    ));
  }
  if (names.size > 0) plannedRepositoryPaths.add('common/mcp.yaml');
}

function addFileChanges(
  repositoryPath: string,
  files: SourcedCaptureFile[],
  changes: CaptureChange[],
  issues: Issue[],
  plannedRepositoryPaths: Set<string>,
  mutations: Map<string, CaptureMutation>,
): void {
  const groups = new Map<string, SourcedCaptureFile[]>();
  for (const file of files) {
    if (file.repositoryPath === 'common/AGENTS.md' || file.repositoryPath === 'common/mcp.yaml') continue;
    groups.set(file.repositoryPath, [...(groups.get(file.repositoryPath) ?? []), file]);
  }
  for (const [repositoryFile, candidates] of groups) {
    plannedRepositoryPaths.add(repositoryFile);
    const unique = candidates.filter((candidate, index) =>
      candidates.findIndex((other) => sameContent(other.content, candidate.content)) === index);
    if (unique.length > 1) {
      issues.push({
        severity: 'decisionRequired',
        code: 'capture.managedSourceConflict',
        message: `Capture source ${safeLabel(repositoryFile)} has conflicting definitions.`,
      });
      const decisionGroupId = `capture-decision-${hashText(`file\0${repositoryFile}`).slice(0, 16)}`;
      for (const candidate of unique) {
        const planned = planFile(repositoryPath, candidate, issues);
        if (!planned) continue;
        const change: CaptureChange = {
          id: selectionId('file', candidate.ide, `${repositoryFile}\0${hashBuffer(toBuffer(candidate.content))}`),
          ide: candidate.ide,
          surface: candidate.surface,
          itemType: repositoryFile.includes('mcp-overrides') ? 'mcp' : 'file',
          capability: repositoryFile.includes('mcp-overrides') ? 'mcp' : 'native',
          name: path.posix.basename(repositoryFile),
          change: 'conflict',
          defaultSelected: false,
          repositoryPaths: [repositoryFile],
          previews: [preview(repositoryFile, planned.finalContent, planned.existingContent, issues)],
          decisionGroupId,
          decision: 'candidate',
          sourceLabel: sourceLabel(candidate.surface, candidate.sourcePath),
        };
        changes.push(change);
        mutations.set(change.id, writeMutation(
          repositoryFile,
          planned.finalContent,
          unique.map((item) => item.sourcePath),
        ));
      }
      const skip: CaptureChange = {
        id: selectionId('file', 'shared', `${repositoryFile}\0skip`),
        ide: unique[0].ide,
        surface: unique[0].surface,
        itemType: repositoryFile.includes('mcp-overrides') ? 'mcp' : 'file',
        capability: repositoryFile.includes('mcp-overrides') ? 'mcp' : 'native',
        name: `${path.posix.basename(repositoryFile)} (skip)`,
        change: 'conflict',
        defaultSelected: false,
        repositoryPaths: [repositoryFile],
        previews: [],
        decisionGroupId,
        decision: 'skip',
        sourceLabel: 'Skip this item',
      };
      changes.push(skip);
      mutations.set(skip.id, emptyMutation(unique.map((item) => item.sourcePath)));
      continue;
    }
    const planned = planFile(repositoryPath, unique[0], issues);
    if (!planned || sameOptionalContent(planned.existingContent, planned.finalContent)) continue;
    const mcpOverride = repositoryFile.includes('mcp-overrides');
    const change = fileChange(
      planned.ide,
      planned.surface,
      mcpOverride ? 'mcp' : 'file',
      mcpOverride ? 'mcp' : 'native',
      path.posix.basename(repositoryFile),
      planned,
      issues,
    );
    changes.push(change);
    mutations.set(change.id, writeMutation(
      planned.repositoryPath,
      planned.finalContent,
      candidates.map((candidate) => candidate.sourcePath),
    ));
  }
}

function addSkillChanges(
  repositoryPath: string,
  packages: Map<string, SkillPackage[]>,
  changes: CaptureChange[],
  issues: Issue[],
  plannedRepositoryPaths: Set<string>,
  mutations: Map<string, CaptureMutation>,
): void {
  for (const [name, copies] of packages) {
    const selected = newestSkillCopy(uniqueSkillCopies(copies));
    const previews: CapturePreview[] = [];
    const repositoryPaths: string[] = [];
    let changed = false;
    let added = true;
    const writes: CaptureMutation['writes'] = [];
    const deletes: string[] = [];
    for (const file of selected.files) {
      const repositoryFile = path.posix.join(
        'common', 'skills', name, file.relativePath.replace(/\\/g, '/'),
      );
      const targetPath = path.join(repositoryPath, ...repositoryFile.split('/'));
      const existing = fs.existsSync(targetPath) ? fs.readFileSync(targetPath) : undefined;
      if (existing) added = false;
      if (!existing?.equals(file.content)) changed = true;
      previews.push(preview(repositoryFile, file.content, existing, issues));
      repositoryPaths.push(repositoryFile);
      plannedRepositoryPaths.add(repositoryFile);
      writes.push({ repositoryPath: repositoryFile, content: Buffer.from(file.content) });
    }
    const repositorySkillRoot = path.join(repositoryPath, 'common', 'skills', name);
    for (const repositoryFile of listFiles(repositorySkillRoot)) {
      const relative = path.relative(repositoryPath, repositoryFile).replace(/\\/g, '/');
      if (repositoryPaths.includes(relative)) continue;
      const existing = fs.readFileSync(repositoryFile);
      changed = true;
      added = false;
      previews.push(preview(relative, '', existing, issues));
      repositoryPaths.push(relative);
      plannedRepositoryPaths.add(relative);
      deletes.push(relative);
    }
    if (!changed) continue;
    const change: CaptureChange = {
      id: selectionId('skill', 'shared', name),
      ide: 'shared',
      surface: selected.source.surface,
      itemType: 'skill',
      capability: 'skills',
      name,
      change: added ? 'add' : 'modify',
      defaultSelected: true,
      repositoryPaths: repositoryPaths.sort(),
      previews: previews.sort((left, right) => left.repositoryPath.localeCompare(right.repositoryPath)),
    };
    changes.push(change);
    mutations.set(change.id, {
      writes,
      deletes,
      sourceHash: hashSourcePaths(selected.files.map((file) =>
        path.join(selected.directory, file.relativePath))),
    });
  }
}

function addRepositoryDeletionChanges(
  repositoryPath: string,
  enabledTargets: TargetId[],
  sourcedFiles: SourcedCaptureFile[],
  packages: Map<string, SkillPackage[]>,
  changes: CaptureChange[],
  issues: Issue[],
  plannedRepositoryPaths: Set<string>,
  mutations: Map<string, CaptureMutation>,
): void {
  const repositoryRules = path.join(repositoryPath, 'common', 'AGENTS.md');
  if (
    fs.existsSync(repositoryRules)
    && !sourcedFiles.some((file) => file.repositoryPath === 'common/AGENTS.md')
  ) {
    const change = deletionFileChange(
      repositoryPath,
      'shared',
      'shared',
      'file',
      'rules',
      'Shared Rules',
      'common/AGENTS.md',
      issues,
    );
    changes.push(change);
    mutations.set(change.id, deleteMutation(change.repositoryPaths));
  }

  const skillsRoot = path.join(repositoryPath, 'common', 'skills');
  if (fs.existsSync(skillsRoot)) {
    for (const entry of fs.readdirSync(skillsRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || packages.has(entry.name)) continue;
      const repositoryPaths = listFiles(path.join(skillsRoot, entry.name))
        .map((file) => path.relative(repositoryPath, file).replace(/\\/g, '/'));
      const change: CaptureChange = {
        id: selectionId('skill', 'shared', entry.name),
        ide: 'shared',
        surface: 'shared',
        itemType: 'skill',
        capability: 'skills',
        name: entry.name,
        change: 'delete',
        defaultSelected: false,
        repositoryPaths,
        previews: repositoryPaths.map((repositoryFile) =>
          preview(repositoryFile, '', fs.readFileSync(path.join(repositoryPath, ...repositoryFile.split('/'))), issues)),
      };
      changes.push(change);
      mutations.set(change.id, deleteMutation(repositoryPaths));
    }
  }

  for (const targetId of enabledTargets) {
    const ide = ideName(targetId);
    const nativeRoot = path.join(repositoryPath, 'ide', ide, 'native');
    for (const repositoryFile of listFiles(nativeRoot)) {
      const relative = path.relative(repositoryPath, repositoryFile).replace(/\\/g, '/');
      if (plannedRepositoryPaths.has(relative)) continue;
      const change = deletionFileChange(
        repositoryPath,
        ide,
        surfaceName(relative, targetId),
        'file',
        'native',
        path.posix.basename(relative),
        relative,
        issues,
      );
      changes.push(change);
      mutations.set(change.id, deleteMutation(change.repositoryPaths));
    }
  }
}

function planFile(
  repositoryPath: string,
  file: SourcedCaptureFile,
  issues: Issue[],
): PlannedFile | undefined {
  const contentBuffer = toBuffer(file.content);
  if (isText(contentBuffer) && scanTextForSecrets(contentBuffer.toString('utf8')).length > 0) {
    issues.push({
      severity: 'error',
      code: 'capture.plaintextSecretBlocked',
      message: 'A Capture source contains a suspected plaintext secret and was blocked.',
    });
    return undefined;
  }
  const destinationPath = path.join(repositoryPath, ...file.repositoryPath.split('/'));
  const existingContent = fs.existsSync(destinationPath)
    ? fs.readFileSync(destinationPath)
    : undefined;
  const finalContent = mergeWithRepository(file, existingContent);
  return { ...file, existingContent, finalContent };
}

function fileChange(
  ide: CaptureChange['ide'],
  surface: string,
  itemType: CaptureItemType,
  capability: ConfigurationCapability,
  name: string,
  file: PlannedFile,
  issues: Issue[],
): CaptureChange {
  return {
    id: selectionId(itemType, ide, file.repositoryPath),
    ide,
    surface,
    itemType,
    capability,
    name,
    change: file.existingContent ? 'modify' : 'add',
    defaultSelected: true,
    repositoryPaths: [file.repositoryPath],
    previews: [preview(file.repositoryPath, file.finalContent, file.existingContent, issues)],
  };
}

function deletionFileChange(
  repositoryPath: string,
  ide: CaptureChange['ide'],
  surface: string,
  itemType: CaptureItemType,
  capability: ConfigurationCapability,
  name: string,
  repositoryFile: string,
  issues: Issue[],
): CaptureChange {
  const existing = fs.readFileSync(path.join(repositoryPath, ...repositoryFile.split('/')));
  return {
    id: selectionId(itemType, ide, repositoryFile),
    ide,
    surface,
    itemType,
    capability,
    name,
    change: 'delete',
    defaultSelected: false,
    repositoryPaths: [repositoryFile],
    previews: [preview(repositoryFile, '', existing, issues)],
  };
}

function preview(
  repositoryPath: string,
  next: string | Buffer,
  previous: string | Buffer | undefined,
  issues: Issue[],
): CapturePreview {
  const nextBuffer = toBuffer(next);
  const previousBuffer = previous === undefined ? undefined : toBuffer(previous);
  const binary = !isText(nextBuffer) || (previousBuffer !== undefined && !isText(previousBuffer));
  if (binary) {
    const metadataBuffer = nextBuffer.length === 0 && previousBuffer
      ? previousBuffer
      : nextBuffer;
    return {
      repositoryPath,
      kind: 'binary',
      bytes: metadataBuffer.length,
      sha256: hashBuffer(metadataBuffer),
    };
  }
  const nextText = nextBuffer.toString('utf8');
  const previousText = previousBuffer?.toString('utf8');
  if (
    scanTextForSecrets(nextText).length > 0
    || (previousText !== undefined && scanTextForSecrets(previousText).length > 0)
  ) {
    issues.push({
      severity: 'error',
      code: 'capture.plaintextSecretBlocked',
      message: 'Unsafe plaintext content was withheld from the Capture preview.',
    });
    return {
      repositoryPath,
      kind: 'text',
      bytes: nextBuffer.length,
      sha256: hashBuffer(nextBuffer),
      diff: '[unsafe text withheld]',
    };
  }
  return {
    repositoryPath,
    kind: 'text',
    bytes: nextBuffer.length,
    sha256: hashBuffer(nextBuffer),
    diff: renderDiff(previousText, nextText),
  };
}

function renderDiff(previous: string | undefined, next: string): string {
  if (previous === undefined) return lines(next).map((line) => `+ ${line}`).join('\n');
  if (next.length === 0) return lines(previous).map((line) => `- ${line}`).join('\n');
  return [
    ...lines(previous).map((line) => `- ${line}`),
    ...lines(next).map((line) => `+ ${line}`),
  ].join('\n');
}

function lines(value: string): string[] {
  const normalized = value.replace(/\r\n?/g, '\n');
  const result = normalized.split('\n');
  if (result.at(-1) === '') result.pop();
  return result;
}

function mergeWithRepository(
  file: CaptureFile,
  existingBuffer: Buffer | undefined,
): string | Buffer {
  if (!existingBuffer || Buffer.isBuffer(file.content)) return file.content;
  const format = structuredFormat(file.repositoryPath);
  if (file.ownership !== 'native' || !format) return file.content;
  const existing = parseStructuredObject(existingBuffer.toString('utf8'), format, file.repositoryPath);
  const captured = parseStructuredObject(file.content, format, file.repositoryPath);
  const merged = mergeRecords(existing, captured);
  for (const localPath of file.localPaths ?? []) deleteObjectPath(merged, localPath);
  return stringifyStructuredObject(merged, format);
}

function structuredFormat(repositoryPath: string): StructuredFormat | undefined {
  if (repositoryPath.endsWith('.json')) return 'json';
  if (repositoryPath.endsWith('.yaml') || repositoryPath.endsWith('.yml')) return 'yaml';
  if (repositoryPath.endsWith('.toml')) return 'toml';
  return undefined;
}

function readMcpServers(registryPath: string): Record<string, unknown> {
  if (!fs.existsSync(registryPath)) return {};
  const parsed = yaml.parse(fs.readFileSync(registryPath, 'utf8')) as unknown;
  return isRecord(parsed) && isRecord(parsed.servers) ? parsed.servers : {};
}

function uniqueMcpCandidates(candidates: McpCandidate[]): McpCandidate[] {
  return candidates.filter((candidate, index) =>
    candidates.findIndex((other) => stableValue(other.value) === stableValue(candidate.value)) === index);
}

function mergeMcpCandidates(candidates: McpCandidate[]): Record<string, unknown> {
  const sorted = [...candidates].sort((left, right) => left.sourcePath.localeCompare(right.sourcePath));
  const result = { ...withoutOverrides(sorted[0].value) };
  const overrides = sorted.reduce<Record<string, unknown>>((merged, candidate) =>
    isRecord(candidate.value.overrides)
      ? mergeRecords(merged, candidate.value.overrides)
      : merged, {});
  if (Object.keys(overrides).length > 0) result.overrides = overrides;
  return result;
}

function withoutOverrides(value: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...value };
  delete copy.overrides;
  return copy;
}

function mergeCanonicalRules(contents: string[]): string {
  const blocks: string[] = [];
  const seen = new Set<string>();
  for (const content of contents) {
    for (const block of content.replace(/\r\n?/g, '\n').trim().split(/\n{2,}/)) {
      const normalized = block.trim();
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      blocks.push(normalized);
    }
  }
  return `${blocks.join('\n\n')}\n`;
}

function uniqueSkillCopies(copies: SkillPackage[]): SkillPackage[] {
  const seen = new Set<string>();
  return copies.filter((copy) => !seen.has(copy.hash) && seen.add(copy.hash));
}

function newestSkillCopy(copies: SkillPackage[]): SkillPackage {
  return [...copies].sort((left, right) =>
    right.modifiedAtMs - left.modifiedAtMs
    || left.source.surface.localeCompare(right.source.surface)
    || left.directory.localeCompare(right.directory))[0];
}

function selectionId(itemType: CaptureItemType, ide: string, name: string): string {
  return `capture-${hashText(`${itemType}\0${ide}\0${name}`).slice(0, 16)}`;
}

function hashRepositoryPaths(repositoryPath: string, repositoryPaths: string[]): string {
  const hash = crypto.createHash('sha256');
  for (const repositoryFile of [...repositoryPaths].sort()) {
    const cleanPath = repositoryFile.split('#')[0];
    const target = path.join(repositoryPath, ...cleanPath.split('/'));
    hash.update(repositoryFile);
    hash.update(fs.existsSync(target) ? fs.readFileSync(target) : '<missing>');
  }
  return hash.digest('hex');
}

function hashText(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function hashBuffer(value: Buffer): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function stableValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableValue).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${stableValue(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function ideName(targetId: TargetId): CaptureChange['ide'] {
  return targetId === 'claudeCode' ? 'claude-code' : targetId;
}

function surfaceName(repositoryPath: string, targetId: TargetId): string {
  if (targetId !== 'gemini') return ideName(targetId);
  if (repositoryPath.includes('/antigravity/')) return 'antigravity';
  return 'gemini-cli';
}

function resolveManifestVariables(
  variables: Record<string, unknown> | undefined,
  context: DeviceContext,
): Record<string, string> {
  const platformKey = context.platform === 'win32'
    ? 'windows'
    : context.platform === 'darwin' ? 'macos' : 'linux';
  return Object.fromEntries(Object.entries(variables ?? {}).flatMap(([name, declaration]) => {
    const value = typeof declaration === 'string'
      ? declaration
      : isRecord(declaration) && typeof declaration[platformKey] === 'string'
        ? declaration[platformKey]
        : undefined;
    return value ? [[name, value.replace(/\$\{HOME\}/g, context.homeDir)]] : [];
  }));
}

function listFiles(directory: string): string[] {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? listFiles(target) : entry.isFile() ? [target] : [];
  }).sort();
}

function isText(content: Buffer): boolean {
  const sample = content.subarray(0, Math.min(content.length, 8_192));
  if (sample.includes(0) || !isUtf8(sample) || hasBinarySignature(sample)) return false;
  return !sample.some((byte) => byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d);
}

function hasBinarySignature(content: Buffer): boolean {
  const signatures = [
    Buffer.from('%PDF-'),
    Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    Buffer.from([0x1f, 0x8b]),
    Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    Buffer.from([0xff, 0xd8, 0xff]),
    Buffer.from('GIF87a'),
    Buffer.from('GIF89a'),
    Buffer.from([0x7f, 0x45, 0x4c, 0x46]),
    Buffer.from([0x00, 0x61, 0x73, 0x6d]),
  ];
  return signatures.some((signature) =>
    content.length >= signature.length
    && content.subarray(0, signature.length).equals(signature));
}

function toBuffer(content: string | Buffer): Buffer {
  return Buffer.isBuffer(content) ? content : Buffer.from(content);
}

function sameContent(left: string | Buffer, right: string | Buffer): boolean {
  return toBuffer(left).equals(toBuffer(right));
}

function sameOptionalContent(existing: Buffer | undefined, next: string | Buffer): boolean {
  return existing?.equals(toBuffer(next)) ?? false;
}

function compareChanges(left: CaptureChange, right: CaptureChange): number {
  return left.ide.localeCompare(right.ide)
    || left.itemType.localeCompare(right.itemType)
    || left.name.localeCompare(right.name)
    || left.id.localeCompare(right.id);
}

function safeLabel(value: string): string {
  return /^[a-zA-Z0-9._/-]+$/.test(value) ? value : '[redacted name]';
}

function sourceLabel(surface: string, sourcePath: string): string {
  if (surface === 'shared') return 'Repository';
  return `${surface} / ${safeLabel(path.basename(sourcePath))}`;
}
