import * as crypto from 'crypto';
import { isUtf8 } from 'buffer';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { createAdapterDefinitions, type TargetId } from '../adapters';
import {
  CLAUDE_CODE_MCP_PATH,
  CODEX_MCP_PATH,
  GEMINI_MCP_PATH,
} from '../adapters/overlay-policies';
import type { ConfigurationCapability, DeployFile, DeviceContext } from '../adapters/types';
import { atomicWriteFile, findSymbolicLinkAncestor, hashFile } from '../utils/files';
import { isRecord } from '../utils/objects';
import { readManifest, resolveBoundRepository } from '../utils/repository';
import { scanTextForSecrets } from '../utils/sanitize';
import { getStateFilePath, readState, writeState } from '../utils/state';
import {
  parseStructuredObject,
  stringifyStructuredObject,
  type StructuredFormat,
} from '../utils/structured-config';
import { resolveVariableDefinitions } from '../utils/variables';
import { findLegacyCodexSkillDuplicates } from '../utils/deploy-skills';
import {
  OPERATION_SCHEMA_VERSION,
  type Issue,
  type McvError,
  type Plan,
  type Result,
} from './contracts';

export type DeployChangeKind = 'add' | 'modify' | 'delete';
export type DeployStrategy = 'managed-merge' | 'replace-entire-file';

export interface DeployTextPreview {
  targetPath: string;
  kind: 'text';
  bytes: number;
  sha256: string;
  diff: string;
}

export interface DeployBinaryPreview {
  targetPath: string;
  kind: 'binary';
  bytes: number;
  sha256: string;
}

export type DeployPreview = DeployTextPreview | DeployBinaryPreview;

export interface DeployChange {
  id: string;
  ide: 'codex' | 'claude-code' | 'gemini';
  capability: ConfigurationCapability;
  name: string;
  targetPath: string;
  change: DeployChangeKind;
  defaultSelected: boolean;
  group: 'standard' | 'advanced';
  strategy: DeployStrategy;
  preview: DeployPreview;
}

export type DeployPlan = Plan<DeployChange> & { operation: 'deploy' };

export interface DeploySelection {
  changeIds: string[];
  confirmedIssueCodes?: string[];
}

export interface DeployApplyOptions {
  nonInteractive?: boolean;
  copyFile?: typeof fs.copyFileSync;
  writeFile?: (targetPath: string, content: Buffer) => void;
  removeFile?: (targetPath: string) => void;
  restoreFile?: (targetPath: string, content: Buffer) => void;
}

export interface DeployResultData {
  appliedChangeIds: string[];
  writtenPaths: string[];
  deletedPaths: string[];
  backupPath?: string;
}

export type DeployResult = Result<DeployResultData, DeployChange> & {
  operation: 'deploy';
};

interface SourcedDeployFile extends DeployFile {
  ide: DeployChange['ide'];
  capability: ConfigurationCapability;
  strategy: DeployStrategy;
}

interface DeployMutation {
  content?: Buffer;
}

interface ActiveDeployPlan {
  operationId: string;
  mutations: Map<string, DeployMutation>;
}

interface DeployBackupEntry {
  changeId: string;
  action: DeployChangeKind;
  originalPath: string;
  backupPath?: string;
  beforeHash?: string;
  afterHash?: string;
}

interface DeployBackupManifest {
  createdAt: string;
  status: 'pending' | 'complete' | 'failed';
  files: DeployBackupEntry[];
  completedAt?: string;
  failedAt?: string;
  error?: string;
}

interface PreparedDeployWrite {
  targetPath: string;
  change: 'write' | 'delete';
  content?: Buffer;
}

const activeDeployPlans = new WeakMap<DeployPlan, ActiveDeployPlan>();

export async function createDeployPlan(context: DeviceContext): Promise<DeployPlan> {
  const operationId = uuidv4();
  let repositoryPath: string | null = null;
  try {
    repositoryPath = resolveBoundRepository(context);
    const mutations = new Map<string, DeployMutation>();
    const plan = await buildDeployPlan(context, repositoryPath, operationId, mutations);
    registerDeployPlan(plan, mutations);
    return plan;
  } catch {
    return freezeDeployPlan({
      schemaVersion: OPERATION_SCHEMA_VERSION,
      operation: 'deploy',
      status: 'failed',
      readyToApply: false,
      operationId,
      preconditions: {},
      repositoryPath,
      changes: [],
      issues: [{
        severity: 'error',
        code: 'deploy.planFailed',
        message: 'The Deploy Plan could not be generated safely.',
      }],
      nextActions: ['Fix the reported Repository or IDE configuration problem, then regenerate the Deploy Plan.'],
      error: {
        code: 'deploy.planFailed',
        message: 'The Deploy Plan could not be generated safely.',
        nextActions: ['Fix the Repository or IDE configuration problem, then regenerate the Deploy Plan.'],
      },
    });
  }
}

async function buildDeployPlan(
  context: DeviceContext,
  repositoryPath: string,
  operationId: string,
  mutations: Map<string, DeployMutation>,
): Promise<DeployPlan> {
  const manifest = readManifest(repositoryPath);
  const definitions = createAdapterDefinitions().filter(
    ({ targetId }) => manifest.targets[targetId]?.enabled === true,
  );
  if (definitions.length === 0) {
    return {
      schemaVersion: OPERATION_SCHEMA_VERSION,
      operation: 'deploy',
      status: 'planned',
      readyToApply: true,
      operationId,
      preconditions: {},
      repositoryPath,
      changes: [],
      issues: [{
        severity: 'notice',
        code: 'deploy.noEnabledTargets',
        message: 'No IDE targets are enabled in this Repository.',
      }],
      nextActions: ['Enable at least one IDE target in mcv.yaml before deploying configuration.'],
    };
  }

  const deployContext: DeviceContext = {
    ...context,
    variables: resolveManifestVariables(manifest.variables, context, repositoryPath),
  };
  const desired = (await Promise.all(definitions.map(async (definition) => {
    const operation = await definition.adapter.deploy(repositoryPath, deployContext);
    return operation.files.flatMap((file): SourcedDeployFile[] => {
      const semantics = inferDeploymentSemantics(
        file.targetPath,
        definition.targetId,
        repositoryPath,
        context,
      );
      return semantics.capabilities.map((capability) => ({
        ...file,
        ide: ideName(definition.targetId),
        capability,
        strategy: semantics.strategy,
      }));
    });
  }))).flat();

  const issues: Issue[] = [];
  const safeDesired = desired.filter((file) => {
    const linkPath = findSymbolicLinkAncestor(file.targetPath);
    if (!linkPath) return true;
    issues.push({
      severity: 'warning',
      code: `deploy.symbolicLinkSkipped.${issues.length + 1}`,
      message: `A target beneath a symbolic link was excluded: ${file.targetPath}.`,
      details: `Symbolic link ancestor: ${linkPath}`,
    });
    return false;
  });

  const changes = safeDesired.flatMap((file): DeployChange[] => {
    const previous = fs.existsSync(file.targetPath) ? fs.readFileSync(file.targetPath) : undefined;
    const next = toBuffer(file.content);
    if (previous?.equals(next)) return [];
    const filePreview = preview(file.targetPath, file.ide, file.capability, next, previous, issues);
    if (filePreview.kind === 'text' && filePreview.diff.length === 0) return [];
    const change = previous === undefined ? 'add' as const : 'modify' as const;
    const id = selectionId(file.ide, file.capability, file.targetPath);
    mutations.set(id, { content: next });
    return [{
      id,
      ide: file.ide,
      capability: file.capability,
      name: displayName(file.targetPath, file.capability),
      targetPath: file.targetPath,
      change,
      defaultSelected: true,
      group: 'standard',
      strategy: file.strategy,
      preview: filePreview,
    }];
  });

  const legacyDuplicates = findLegacyCodexSkillDuplicates(
    context,
    safeDesired,
    definitions.some(({ targetId }) => targetId === 'codex'),
  );
  if (legacyDuplicates.names.length > 0) {
    issues.push({
      severity: 'notice',
      code: 'deploy.legacyCodexSkillDuplicates',
      message: `[duplicate:codex-legacy] ${legacyDuplicates.names.join(', ')}; review the Advanced Cleanup candidates.`,
    });
    for (const targetPath of legacyDuplicates.files) {
      changes.push({
        id: selectionId('codex', 'skills', targetPath),
        ide: 'codex',
        capability: 'skills',
        name: displayName(targetPath, 'skills'),
        targetPath,
        change: 'delete',
        defaultSelected: false,
        group: 'advanced',
        strategy: 'replace-entire-file',
        preview: preview(targetPath, 'codex', 'skills', Buffer.alloc(0), fs.readFileSync(targetPath), issues),
      });
      mutations.set(selectionId('codex', 'skills', targetPath), {});
    }
  }

  const sourcePreconditions = new Map<string, string>();
  const desiredPaths = new Set(safeDesired.map((file) => path.resolve(file.targetPath)));
  const managedInventory = readState(context).managedInventory ?? {};
  for (const [targetPath, inventoryEntry] of Object.entries(managedInventory)) {
    if (desiredPaths.has(path.resolve(targetPath)) || !fs.existsSync(targetPath)) continue;
    const ide = inferIde(targetPath, context);
    if (!ide) continue;
    const semantics = inferDeploymentSemantics(targetPath, targetIdForIde(ide), repositoryPath, context);
    const capability = semantics.capabilities[0];
    if (semantics.strategy !== 'replace-entire-file' || !capability) continue;
    const deletion: DeployChange = {
      id: selectionId(ide, capability, targetPath),
      ide,
      capability,
      name: displayName(targetPath, capability),
      targetPath,
      change: 'delete',
      defaultSelected: false,
      group: 'advanced',
      strategy: semantics.strategy,
      preview: preview(targetPath, ide, capability, Buffer.alloc(0), fs.readFileSync(targetPath), issues),
    };
    changes.push(deletion);
    mutations.set(deletion.id, {});
    sourcePreconditions.set(deletion.id, hashText(stableValue(inventoryEntry)));
  }

  changes.sort(compareChanges);
  const repositorySourceHash = hashRepositoryInputs(repositoryPath);
  const preconditions = Object.fromEntries(changes.flatMap((change) => {
    return [
      [`source:${change.id}`, sourcePreconditions.get(change.id) ?? repositorySourceHash],
      [`target:${change.id}`, fs.existsSync(change.targetPath) ? hashFile(change.targetPath) : hashText('<missing>')],
    ];
  }));
  const blocked = issues.some((issue) =>
    issue.severity === 'decisionRequired' || issue.severity === 'error');
  return {
    schemaVersion: OPERATION_SCHEMA_VERSION,
    operation: 'deploy',
    status: 'planned',
    readyToApply: !blocked,
    operationId,
    preconditions,
    repositoryPath,
    changes,
    issues,
    nextActions: blocked
      ? ['Resolve every decisionRequired or error Issue, then regenerate the Deploy Plan.']
      : [],
  };
}

function registerDeployPlan(
  plan: DeployPlan,
  mutations: Map<string, DeployMutation>,
): void {
  freezeDeployPlan(plan);
  activeDeployPlans.set(plan, { operationId: plan.operationId, mutations });
}

export async function applyDeployPlan(
  context: DeviceContext,
  plan: DeployPlan,
  selection: DeploySelection,
  options: DeployApplyOptions = {},
): Promise<DeployResult> {
  if (plan.status === 'failed') return failedDeployResult(plan.repositoryPath, plan.error, plan.issues);
  const active = activeDeployPlans.get(plan);
  if (!active || active.operationId !== plan.operationId) {
    return failedDeployResult(plan.repositoryPath, invalidPlanError());
  }

  const selectedIds = [...new Set(selection.changeIds)];
  const knownIds = new Set(plan.changes.map((change) => change.id));
  if (selectedIds.some((id) => !knownIds.has(id))) {
    return failedDeployResult(plan.repositoryPath, {
      code: 'deploy.invalidSelection',
      message: 'The Deploy selection contains an ID that is not in the active Plan.',
      nextActions: ['Choose only change IDs from the current Deploy Plan.'],
    });
  }

  const selected = new Set(selectedIds);
  const blocking = deployBlockingIssues(plan, selection, options);
  if (blocking.length > 0) return blockedDeployResult(plan, blocking);

  if (!plan.repositoryPath || resolveBoundRepository(context) !== plan.repositoryPath) {
    activeDeployPlans.delete(plan);
    return failedDeployResult(plan.repositoryPath, stalePlanError());
  }

  let freshPlan: DeployPlan;
  try {
    freshPlan = await buildDeployPlan(
      context,
      plan.repositoryPath,
      plan.operationId,
      new Map<string, DeployMutation>(),
    );
  } catch {
    activeDeployPlans.delete(plan);
    return failedDeployResult(plan.repositoryPath, stalePlanError());
  }
  if (!sameDeploySnapshot(plan, freshPlan)) {
    activeDeployPlans.delete(plan);
    return failedDeployResult(plan.repositoryPath, stalePlanError());
  }

  const selectedChanges = plan.changes.filter((change) => selected.has(change.id));
  const prepared = prepareDeployWrites(selectedChanges, active.mutations);
  if (selectedChanges.length === 0) {
    try {
      updateDeployState(context, plan.repositoryPath, selectedChanges);
    } catch (error) {
      activeDeployPlans.delete(plan);
      return failedDeployResult(plan.repositoryPath, {
        code: 'deploy.stateUpdateFailed',
        message: 'Deploy could not record the successful empty selection in device state.',
        technicalDetails: errorMessage(error),
        nextActions: ['Check local state storage permissions, then generate a new Deploy Plan.'],
      });
    }
    activeDeployPlans.delete(plan);
    return {
      schemaVersion: OPERATION_SCHEMA_VERSION,
      operation: 'deploy',
      status: 'succeeded',
      repositoryPath: plan.repositoryPath,
      changes: [],
      issues: [],
      nextActions: [],
      data: { appliedChangeIds: [], writtenPaths: [], deletedPaths: [] },
    };
  }
  let backupPath: string | undefined;
  try {
    backupPath = createDeployBackup(
      context,
      plan,
      selectedChanges,
      options.copyFile ?? fs.copyFileSync,
    );
  } catch (error) {
    activeDeployPlans.delete(plan);
    if (error instanceof StaleDeployPlanError) {
      return failedDeployResult(plan.repositoryPath, stalePlanError(error.message));
    }
    return failedDeployResult(plan.repositoryPath, {
      code: 'deploy.backupFailed',
      message: 'Deploy could not create and verify every selected backup before writing.',
      technicalDetails: errorMessage(error),
      nextActions: ['Check local state storage and target file permissions, then generate a new Deploy Plan.'],
    });
  }

  try {
    assertSelectedPreconditions(context, plan, selectedChanges);
    applyPreparedDeployWrites(
      prepared,
      backupPath,
      options.writeFile ?? ((targetPath, content) => atomicWriteFile(targetPath, content)),
      options.removeFile ?? ((targetPath) => fs.rmSync(targetPath, { force: true })),
      options.restoreFile ?? ((targetPath, content) => atomicWriteFile(targetPath, content)),
      () => {
        finalizeDeployBackup(backupPath as string);
        updateDeployState(context, plan.repositoryPath as string, selectedChanges);
      },
    );
    activeDeployPlans.delete(plan);
    return {
      schemaVersion: OPERATION_SCHEMA_VERSION,
      operation: 'deploy',
      status: 'succeeded',
      repositoryPath: plan.repositoryPath,
      changes: selectedChanges,
      issues: [],
      nextActions: [],
      data: {
        appliedChangeIds: selectedIds,
        writtenPaths: prepared.filter((item) => item.change === 'write').map((item) => item.targetPath),
        deletedPaths: prepared.filter((item) => item.change === 'delete').map((item) => item.targetPath),
        backupPath,
      },
    };
  } catch (error) {
    activeDeployPlans.delete(plan);
    markDeployBackupFailed(backupPath, error);
    if (error instanceof StaleDeployPlanError) {
      return failedDeployResult(plan.repositoryPath, stalePlanError(error.message));
    }
    if (error instanceof DeployRollbackError) {
      return failedDeployResult(plan.repositoryPath, {
        code: 'deploy.rollbackFailed',
        message: 'Deploy failed and could not fully restore the selected device configuration.',
        technicalDetails: error.message,
        nextActions: [`Restore the affected files from ${backupPath}, then generate a new Deploy Plan.`],
      });
    }
    return failedDeployResult(plan.repositoryPath, {
      code: 'deploy.transactionFailed',
      message: 'Deploy could not commit the selected changes and restored the device configuration.',
      technicalDetails: errorMessage(error),
      nextActions: ['Check target permissions, then generate and review a new Deploy Plan.'],
    });
  }
}

function deployBlockingIssues(
  plan: DeployPlan,
  selection: DeploySelection,
  options: DeployApplyOptions,
): Issue[] {
  if (options.nonInteractive) {
    const unsafe = plan.issues.some((issue) => issue.severity !== 'notice')
      || plan.changes.some((change) => change.change === 'delete');
    return unsafe ? [{
      severity: 'decisionRequired',
      code: 'deploy.nonInteractiveBlocked',
      message: 'Non-interactive Deploy cannot apply warnings, decisions, errors, or deletions.',
    }] : [];
  }
  const confirmed = new Set(selection.confirmedIssueCodes ?? []);
  const warnings = plan.issues.filter((issue) =>
    issue.severity === 'warning' && !confirmed.has(issue.code));
  if (warnings.length > 0) return warnings;
  return plan.issues.filter((issue) =>
    issue.severity === 'decisionRequired' || issue.severity === 'error');
}

function sameDeploySnapshot(left: DeployPlan, right: DeployPlan): boolean {
  return left.repositoryPath === right.repositoryPath
    && stableValue(left.preconditions) === stableValue(right.preconditions)
    && stableValue(left.changes.map(deploySnapshotChange))
      === stableValue(right.changes.map(deploySnapshotChange))
    && stableValue(left.issues.map((issue) => [issue.severity, issue.code]))
      === stableValue(right.issues.map((issue) => [issue.severity, issue.code]));
}

function deploySnapshotChange(change: DeployChange): unknown {
  return {
    id: change.id,
    change: change.change,
    capability: change.capability,
    targetPath: change.targetPath,
    preview: change.preview,
  };
}

function prepareDeployWrites(
  changes: DeployChange[],
  mutations: Map<string, DeployMutation>,
): PreparedDeployWrite[] {
  const grouped = new Map<string, DeployChange[]>();
  for (const change of changes) {
    grouped.set(change.targetPath, [...(grouped.get(change.targetPath) ?? []), change]);
  }
  return [...grouped].map(([targetPath, targetChanges]) => {
    if (targetChanges.some((change) => change.change === 'delete')) {
      return { targetPath, change: 'delete' as const };
    }
    const mutation = mutations.get(targetChanges[0].id);
    if (!mutation?.content) throw new Error(`Missing active Deploy mutation for ${targetChanges[0].id}.`);
    return {
      targetPath,
      change: 'write' as const,
      content: composeSelectedContent(targetPath, targetChanges, mutation.content),
    };
  });
}

function composeSelectedContent(
  targetPath: string,
  changes: DeployChange[],
  desiredContent: Buffer,
): Buffer {
  if (changes.some((change) => change.strategy === 'replace-entire-file')) {
    return Buffer.from(desiredContent);
  }
  const format = structuredFormat(targetPath);
  if (!format) return Buffer.from(desiredContent);
  const current = fs.existsSync(targetPath)
    ? parseStructuredObject(fs.readFileSync(targetPath, 'utf8'), format, targetPath)
    : {};
  const desired = parseStructuredObject(desiredContent.toString('utf8'), format, targetPath);
  const selectedCapabilities = new Set(changes.map((change) => change.capability));
  const managedKey = managedTopLevelKey(changes[0].ide);
  const result: Record<string, unknown> = { ...current };
  if (selectedCapabilities.has('mcp')) copyStructuredKey(desired, result, managedKey);
  if (selectedCapabilities.has('native')) {
    for (const key of new Set([...Object.keys(current), ...Object.keys(desired)])) {
      if (key !== managedKey) copyStructuredKey(desired, result, key);
    }
  }
  return Buffer.from(stringifyStructuredObject(result, format));
}

function copyStructuredKey(
  source: Record<string, unknown>,
  target: Record<string, unknown>,
  key: string,
): void {
  if (key in source) target[key] = source[key];
  else delete target[key];
}

function createDeployBackup(
  context: DeviceContext,
  plan: DeployPlan,
  changes: DeployChange[],
  copyFile: typeof fs.copyFileSync,
): string {
  assertSelectedPreconditions(context, plan, changes);
  const backupRoot = path.join(path.dirname(getStateFilePath(context)), 'backups');
  fs.mkdirSync(backupRoot, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = fs.mkdtempSync(path.join(backupRoot, `${timestamp}-`));
  const filesPath = path.join(backupPath, 'files');
  fs.mkdirSync(filesPath);
  try {
    const files = changes.map((change, index): DeployBackupEntry => {
      const expected = plan.preconditions[`target:${change.id}`];
      if (change.change === 'add') {
        if (fs.existsSync(change.targetPath)) throw new StaleDeployPlanError('A selected add target appeared during backup.');
        return { changeId: change.id, action: change.change, originalPath: change.targetPath };
      }
      const relativeBackupPath = path.join('files', `${index}-${path.basename(change.targetPath)}`);
      const copiedPath = path.join(backupPath, relativeBackupPath);
      copyFile(change.targetPath, copiedPath);
      if (hashFile(copiedPath) !== expected || hashFile(change.targetPath) !== expected) {
        throw new StaleDeployPlanError('A selected target changed while its backup was being verified.');
      }
      return {
        changeId: change.id,
        action: change.change,
        originalPath: change.targetPath,
        backupPath: relativeBackupPath,
        beforeHash: expected,
      };
    });
    const manifest: DeployBackupManifest = {
      createdAt: new Date().toISOString(),
      status: 'pending',
      files,
    };
    atomicWriteFile(
      path.join(backupPath, 'manifest.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
    return backupPath;
  } catch (error) {
    fs.rmSync(backupPath, { recursive: true, force: true });
    throw error;
  }
}

function assertSelectedPreconditions(
  context: DeviceContext,
  plan: DeployPlan,
  changes: DeployChange[],
): void {
  const repositoryHash = plan.repositoryPath ? hashRepositoryInputs(plan.repositoryPath) : undefined;
  const inventory = readState(context).managedInventory ?? {};
  for (const change of changes) {
    const targetHash = fs.existsSync(change.targetPath)
      ? hashFile(change.targetPath)
      : hashText('<missing>');
    const sourceHash = change.change === 'delete' && inventory[change.targetPath] !== undefined
      ? hashText(stableValue(inventory[change.targetPath]))
      : repositoryHash;
    if (targetHash !== plan.preconditions[`target:${change.id}`]
      || sourceHash !== plan.preconditions[`source:${change.id}`]) {
      throw new StaleDeployPlanError('Deploy source or target state changed after the Plan was reviewed.');
    }
  }
}

function applyPreparedDeployWrites(
  writes: PreparedDeployWrite[],
  backupPath: string,
  writeFile: (targetPath: string, content: Buffer) => void,
  removeFile: (targetPath: string) => void,
  restoreFile: (targetPath: string, content: Buffer) => void,
  commit: () => void,
): void {
  const attemptedPaths = new Set<string>();
  try {
    for (const write of writes) {
      attemptedPaths.add(write.targetPath);
      if (write.change === 'delete') removeFile(write.targetPath);
      else writeFile(write.targetPath, write.content as Buffer);
    }
    commit();
  } catch (error) {
    const rollbackErrors = rollbackDeployWrites(
      backupPath,
      attemptedPaths,
      removeFile,
      restoreFile,
    );
    if (rollbackErrors.length > 0) {
      throw new DeployRollbackError(
        `${errorMessage(error)} Rollback was incomplete: ${rollbackErrors.join('; ')}`,
      );
    }
    throw error;
  }
}

function rollbackDeployWrites(
  backupPath: string,
  attemptedPaths: Set<string>,
  removeFile: (targetPath: string) => void,
  restoreFile: (targetPath: string, content: Buffer) => void,
): string[] {
  const manifest = readDeployBackupManifest(backupPath);
  const entriesByPath = new Map<string, DeployBackupEntry>();
  for (const entry of manifest.files) {
    if (attemptedPaths.has(entry.originalPath) && !entriesByPath.has(entry.originalPath)) {
      entriesByPath.set(entry.originalPath, entry);
    }
  }
  const errors: string[] = [];
  for (const entry of [...entriesByPath.values()].reverse()) {
    try {
      if (!entry.backupPath) removeFile(entry.originalPath);
      else restoreFile(entry.originalPath, fs.readFileSync(path.join(backupPath, entry.backupPath)));
    } catch (error) {
      errors.push(`${entry.originalPath}: ${errorMessage(error)}`);
    }
  }
  return errors;
}

function finalizeDeployBackup(backupPath: string): void {
  const manifest = readDeployBackupManifest(backupPath);
  for (const entry of manifest.files) {
    if (fs.existsSync(entry.originalPath)) entry.afterHash = hashFile(entry.originalPath);
  }
  manifest.status = 'complete';
  manifest.completedAt = new Date().toISOString();
  atomicWriteFile(
    path.join(backupPath, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
}

function markDeployBackupFailed(backupPath: string, error: unknown): void {
  try {
    const manifest = readDeployBackupManifest(backupPath);
    manifest.status = 'failed';
    manifest.failedAt = new Date().toISOString();
    manifest.error = errorMessage(error);
    atomicWriteFile(
      path.join(backupPath, 'manifest.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
  } catch { /* Preserve the primary Deploy failure. */ }
}

function readDeployBackupManifest(backupPath: string): DeployBackupManifest {
  return JSON.parse(fs.readFileSync(path.join(backupPath, 'manifest.json'), 'utf8')) as DeployBackupManifest;
}

function updateDeployState(
  context: DeviceContext,
  repositoryPath: string,
  changes: DeployChange[],
): void {
  const state = readState(context);
  const baselineFiles = { ...(state.baselineSnapshot?.files ?? {}) };
  const managedInventory = { ...(state.managedInventory ?? {}) };
  for (const change of changes) {
    if (change.change === 'delete' || !fs.existsSync(change.targetPath)) {
      delete baselineFiles[change.targetPath];
      delete managedInventory[change.targetPath];
    } else {
      const hash = hashFile(change.targetPath);
      baselineFiles[change.targetPath] = hash;
      managedInventory[change.targetPath] = { source: repositoryPath, hash };
    }
  }
  const lastDeploySelection: NonNullable<typeof state.lastDeploySelection> = {};
  for (const change of changes) {
    const capabilities = lastDeploySelection[change.ide] ?? [];
    if (!capabilities.includes(change.capability)) capabilities.push(change.capability);
    lastDeploySelection[change.ide] = capabilities;
  }
  state.baselineSnapshot = { recordedAt: new Date().toISOString(), files: baselineFiles };
  state.managedInventory = managedInventory;
  state.lastDeploySelection = lastDeploySelection;
  state.lastOperation = { kind: 'deploy', time: new Date().toISOString(), success: true };
  writeState(context, state);
}

class StaleDeployPlanError extends Error {}

class DeployRollbackError extends Error {}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function invalidPlanError(): McvError {
  return {
    code: 'operation.invalidPlan',
    message: 'The Deploy Plan is not the active in-process Plan.',
    nextActions: ['Generate and review a new Deploy Plan.'],
  };
}

function stalePlanError(technicalDetails?: string): McvError {
  return {
    code: 'operation.stalePlan',
    message: 'Deploy source or target state changed after the Plan was generated.',
    technicalDetails,
    nextActions: ['Generate and review a new Deploy Plan.'],
  };
}

function failedDeployResult(
  repositoryPath: string | null,
  error: McvError,
  issues: Issue[] = [{ severity: 'error', code: error.code, message: error.message }],
): DeployResult {
  return {
    schemaVersion: OPERATION_SCHEMA_VERSION,
    operation: 'deploy',
    status: 'failed',
    repositoryPath,
    changes: [],
    issues,
    nextActions: error.nextActions,
    error,
  };
}

function blockedDeployResult(plan: DeployPlan, issues: Issue[]): DeployResult {
  return {
    schemaVersion: OPERATION_SCHEMA_VERSION,
    operation: 'deploy',
    status: 'blocked',
    repositoryPath: plan.repositoryPath,
    changes: [],
    issues,
    nextActions: issues.some((issue) => issue.severity === 'warning')
      ? ['Confirm every warning explicitly before applying the Deploy Plan.']
      : ['Review and resolve the Deploy Plan interactively before applying it.'],
  };
}

function freezeDeployPlan(plan: DeployPlan): DeployPlan {
  for (const change of plan.changes) {
    Object.freeze(change.preview);
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
  return Object.freeze(plan);
}

function preview(
  targetPath: string,
  ide: DeployChange['ide'],
  capability: ConfigurationCapability,
  next: Buffer,
  previous: Buffer | undefined,
  issues: Issue[],
): DeployPreview {
  const metadata = next.length === 0 && previous ? previous : next;
  if (!isText(next) || (previous !== undefined && !isText(previous))) {
    return { targetPath, kind: 'binary', bytes: metadata.length, sha256: hashBuffer(metadata) };
  }
  const diff = renderSafeDiff(
    targetPath,
    ide,
    capability,
    previous?.toString('utf8'),
    next.toString('utf8'),
  );
  if (scanTextForSecrets(diff).length > 0) {
    issues.push({
      severity: 'error',
      code: `deploy.unsafeDiffWithheld.${issues.length + 1}`,
      message: 'Unsafe plaintext content was withheld from the Deploy preview.',
    });
    return {
      targetPath,
      kind: 'text',
      bytes: metadata.length,
      sha256: hashBuffer(metadata),
      diff: '[unsafe text withheld]',
    };
  }
  return { targetPath, kind: 'text', bytes: metadata.length, sha256: hashBuffer(metadata), diff };
}

function renderSafeDiff(
  targetPath: string,
  ide: DeployChange['ide'],
  capability: ConfigurationCapability,
  previous: string | undefined,
  next: string,
): string {
  if (next.length === 0 || capability === 'rules' || capability === 'skills') {
    return renderChangedLines(previous, next);
  }
  const format = structuredFormat(targetPath);
  if (!format) return renderChangedLines(previous, next);
  try {
    const before = previous === undefined ? {} : parseStructuredObject(previous, format, targetPath);
    const after = parseStructuredObject(next, format, targetPath);
    const managedKey = managedTopLevelKey(ide);
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])]
      .filter((key) => capability === 'mcp' ? key === managedKey : key !== managedKey)
      .filter((key) => stableValue(before[key]) !== stableValue(after[key]))
      .sort();
    return keys.flatMap((key) => {
      const changed: string[] = [];
      if (key in before) changed.push(`- ${key}: ${stableValue(before[key])}`);
      if (key in after) changed.push(`+ ${key}: ${stableValue(after[key])}`);
      return changed;
    }).join('\n');
  } catch {
    return renderChangedLines(previous, next);
  }
}

function structuredFormat(targetPath: string): StructuredFormat | undefined {
  if (targetPath.endsWith('.json')) return 'json';
  if (targetPath.endsWith('.yaml') || targetPath.endsWith('.yml')) return 'yaml';
  if (targetPath.endsWith('.toml')) return 'toml';
  return undefined;
}

const MCP_PATH_BY_IDE: Record<DeployChange['ide'], string> = {
  codex: CODEX_MCP_PATH,
  'claude-code': CLAUDE_CODE_MCP_PATH,
  gemini: GEMINI_MCP_PATH,
};

function managedTopLevelKey(ide: DeployChange['ide']): string {
  return MCP_PATH_BY_IDE[ide].slice(2);
}

function stableValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableValue).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableValue(value[key])}`).join(',')}}`;
  }
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  return JSON.stringify(value);
}

function renderChangedLines(previous: string | undefined, next: string): string {
  const before = previous === undefined ? [] : lines(previous);
  const after = lines(next);
  if (previous === undefined) return after.map((line) => `+ ${line}`).join('\n');
  if (next.length === 0) return before.map((line) => `- ${line}`).join('\n');
  const lengths = Array.from({ length: before.length + 1 }, () => new Array<number>(after.length + 1).fill(0));
  for (let left = before.length - 1; left >= 0; left -= 1) {
    for (let right = after.length - 1; right >= 0; right -= 1) {
      lengths[left][right] = before[left] === after[right]
        ? lengths[left + 1][right + 1] + 1
        : Math.max(lengths[left + 1][right], lengths[left][right + 1]);
    }
  }
  const changed: string[] = [];
  let left = 0;
  let right = 0;
  while (left < before.length || right < after.length) {
    if (left < before.length && right < after.length && before[left] === after[right]) {
      left += 1;
      right += 1;
    } else if (right < after.length && (left === before.length || lengths[left][right + 1] >= lengths[left + 1][right])) {
      changed.push(`+ ${after[right]}`);
      right += 1;
    } else {
      changed.push(`- ${before[left]}`);
      left += 1;
    }
  }
  return changed.join('\n');
}

function inferDeploymentSemantics(
  targetPath: string,
  targetId: TargetId,
  repositoryPath: string,
  context: DeviceContext,
): { capabilities: ConfigurationCapability[]; strategy: DeployStrategy } {
  const normalized = targetPath.replace(/\\/g, '/');
  const base = path.basename(targetPath).toLowerCase();
  if (base === 'agents.md' || base === 'claude.md' || base === 'gemini.md') {
    return { capabilities: ['rules'], strategy: 'replace-entire-file' };
  }
  if (normalized.includes('/skills/')) {
    return { capabilities: ['skills'], strategy: 'replace-entire-file' };
  }
  if (base === 'keybindings.json') {
    return { capabilities: ['native'], strategy: 'replace-entire-file' };
  }
  const capabilities: ConfigurationCapability[] = [];
  if (nativeSourceExists(targetPath, targetId, repositoryPath, context)) capabilities.push('native');
  if (isMcpTarget(targetPath, targetId, context)) capabilities.push('mcp');
  return { capabilities: capabilities.length > 0 ? capabilities : ['native'], strategy: 'managed-merge' };
}

function nativeSourceExists(
  targetPath: string,
  targetId: TargetId,
  repositoryPath: string,
  context: DeviceContext,
): boolean {
  const candidate = nativeRepositoryPath(targetPath, targetId, context);
  if (!candidate) return false;
  const platform = context.platform === 'win32' ? 'windows' : 'macos';
  return fs.existsSync(path.join(repositoryPath, 'overrides', platform, ...candidate.split('/')))
    || fs.existsSync(path.join(repositoryPath, ...candidate.split('/')))
    || (targetId === 'gemini'
      && candidate === 'ide/gemini/native/gemini-cli/settings.json'
      && fs.existsSync(path.join(repositoryPath, 'ide', 'gemini', 'native', 'settings.json')));
}

function nativeRepositoryPath(
  targetPath: string,
  targetId: TargetId,
  context: DeviceContext,
): string | undefined {
  const resolved = path.resolve(targetPath);
  if (targetId === 'codex') return 'ide/codex/native/config.toml';
  if (targetId === 'claudeCode') {
    if (resolved === path.resolve(context.homeDir, '.claude.json')) return 'ide/claude-code/native/.claude.json';
    return 'ide/claude-code/native/settings.json';
  }
  const root = path.resolve(context.homeDir, '.gemini');
  const relative = path.relative(root, resolved).replace(/\\/g, '/');
  const mappings: Record<string, string> = {
    'settings.json': 'ide/gemini/native/gemini-cli/settings.json',
    'config/config.json': 'ide/gemini/native/antigravity/config.json',
    'config/mcp_config.json': 'ide/gemini/native/antigravity/mcp_config.json',
    'antigravity-cli/settings.json': 'ide/gemini/native/antigravity/cli-settings.json',
  };
  if (mappings[relative]) return mappings[relative];
  if (path.basename(resolved) === 'settings.json') return 'ide/gemini/native/antigravity/ide-settings.json';
  if (path.basename(resolved) === 'keybindings.json') return 'ide/gemini/native/antigravity/keybindings.json';
  return undefined;
}

function isMcpTarget(targetPath: string, targetId: TargetId, context: DeviceContext): boolean {
  if (targetId === 'codex') {
    return path.resolve(targetPath) === path.resolve(context.env.CODEX_HOME || path.join(context.homeDir, '.codex'), 'config.toml');
  }
  if (targetId === 'claudeCode') return path.basename(targetPath) === '.claude.json';
  return path.basename(targetPath) === 'mcp_config.json'
    || path.resolve(targetPath) === path.resolve(context.homeDir, '.gemini', 'settings.json');
}

function selectionId(ide: string, capability: string, targetPath: string): string {
  return `deploy-${hashText(`${ide}\0${capability}\0${path.resolve(targetPath)}`).slice(0, 16)}`;
}

function displayName(targetPath: string, capability: ConfigurationCapability): string {
  if (capability === 'rules') return 'Shared Rules';
  if (capability === 'skills') {
    const segments = targetPath.replace(/\\/g, '/').split('/');
    const skillIndex = segments.lastIndexOf('skills');
    return segments[skillIndex + 1] ?? path.basename(targetPath);
  }
  if (capability === 'mcp') return 'MCP';
  return path.basename(targetPath);
}

function compareChanges(left: DeployChange, right: DeployChange): number {
  const groupOrder = { standard: 0, advanced: 1 } as const;
  const capabilityOrder: Record<ConfigurationCapability, number> = {
    rules: 0, skills: 1, mcp: 2, native: 3,
  };
  return groupOrder[left.group] - groupOrder[right.group]
    || left.ide.localeCompare(right.ide)
    || capabilityOrder[left.capability] - capabilityOrder[right.capability]
    || left.targetPath.localeCompare(right.targetPath);
}

function ideName(targetId: TargetId): DeployChange['ide'] {
  if (targetId === 'claudeCode') return 'claude-code';
  return targetId;
}

function targetIdForIde(ide: DeployChange['ide']): TargetId {
  return ide === 'claude-code' ? 'claudeCode' : ide;
}

function inferIde(targetPath: string, context: DeviceContext): DeployChange['ide'] | undefined {
  const resolved = path.resolve(targetPath);
  const roots: Array<[DeployChange['ide'], string]> = [
    ['codex', path.resolve(context.env.CODEX_HOME || path.join(context.homeDir, '.codex'))],
    ['codex', path.resolve(context.homeDir, '.agents', 'skills')],
    ['claude-code', path.resolve(context.env.CLAUDE_CONFIG_DIR || path.join(context.homeDir, '.claude'))],
    ['claude-code', path.resolve(context.homeDir, '.claude.json')],
    ['gemini', path.resolve(context.homeDir, '.gemini')],
  ];
  return roots.find(([, root]) => resolved === root || resolved.startsWith(`${root}${path.sep}`))?.[0];
}

function resolveManifestVariables(
  declarations: Record<string, unknown> | undefined,
  context: DeviceContext,
  repositoryPath: string,
): Record<string, string> {
  const platformKey = context.platform === 'win32'
    ? 'windows'
    : context.platform === 'darwin'
      ? 'macos'
      : 'linux';
  const definitions: Record<string, string> = {};
  for (const [name, declaration] of Object.entries(declarations ?? {})) {
    const value = typeof declaration === 'string'
      ? declaration
      : isRecord(declaration) && typeof declaration[platformKey] === 'string'
        ? declaration[platformKey]
        : undefined;
    if (value !== undefined) definitions[name] = value;
  }
  return resolveVariableDefinitions(definitions, {
    ...context.variables,
    HOME: context.homeDir,
    MCV_REPO: repositoryPath,
  }, context.platform);
}

function toBuffer(value: string | Buffer): Buffer {
  return Buffer.isBuffer(value) ? Buffer.from(value) : Buffer.from(value);
}

function isText(value: Buffer): boolean {
  return value.length === 0 || (isUtf8(value) && !value.includes(0));
}

function lines(value: string): string[] {
  const result = value.replace(/\r\n?/g, '\n').split('\n');
  if (result.at(-1) === '') result.pop();
  return result;
}

function hashBuffer(value: Buffer): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function hashText(value: string): string {
  return hashBuffer(Buffer.from(value));
}

function hashRepositoryInputs(repositoryPath: string): string {
  const hash = crypto.createHash('sha256');
  const visit = (current: string): void => {
    const relative = path.relative(repositoryPath, current).replace(/\\/g, '/');
    if (!fs.existsSync(current)) {
      hash.update(`missing\0${relative}\0`);
      return;
    }
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) {
      hash.update(`symlink\0${relative}\0${fs.readlinkSync(current)}\0`);
      return;
    }
    if (stat.isDirectory()) {
      hash.update(`directory\0${relative}\0`);
      for (const entry of fs.readdirSync(current).sort()) visit(path.join(current, entry));
      return;
    }
    hash.update(`file\0${relative}\0`);
    hash.update(fs.readFileSync(current));
    hash.update('\0');
  };
  visit(path.join(repositoryPath, 'mcv.yaml'));
  visit(path.join(repositoryPath, 'common'));
  visit(path.join(repositoryPath, 'ide'));
  visit(path.join(repositoryPath, 'overrides'));
  return hash.digest('hex');
}
