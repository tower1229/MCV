import * as crypto from 'crypto';
import { isUtf8 } from 'buffer';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { createAdapterDefinitions, type TargetId } from '../adapters/index.js';
import {
  CLAUDE_CODE_MCP_PATH,
  CODEX_MCP_PATH,
  GEMINI_MCP_PATH,
} from '../adapters/overlay-policies.js';
import type {
  ConfigurationCapability,
  DeployFile,
  DeviceContext,
  IdeId,
  SkillSurfaceId,
} from '../adapters/types.js';
import {
  deployContextFieldsFromRequest,
  type DeployContextFields,
  type DeployRequest,
} from '../assets/deploy-request.js';
import { buildSelectedRepositoryView } from '../assets/selected-repository-view.js';
import { GLOBAL_PROFILE_ID } from '../profiles/contracts.js';
import { resolveProfiles } from '../profiles/resolver.js';
import {
  atomicWriteFile,
  findSymbolicLinkAncestor,
  hashDirectoryTree,
  hashFile,
} from '../utils/files.js';
import { isRecord } from '../utils/objects.js';
import { readManifest, resolveBoundRepository } from '../utils/repository.js';
import {
  hashSkillPackageContent,
  resolveSkillPackageStorePath,
} from '../core/managed-skill-layout.js';
import {
  CURRENT_DEVICE_STATE_SCHEMA_VERSION,
  getStateFilePath,
  mapManagedInventoryToGlobalScope,
  readState,
  writeState,
  type McvState,
} from '../utils/state.js';
import {
  parseStructuredObject,
  stringifyStructuredObject,
  type StructuredFormat,
} from '../utils/structured-config.js';
import { resolveVariableDefinitions } from '../utils/variables.js';
import { findLegacyCodexSkillDuplicates } from '../utils/deploy-skills.js';
import {
  assertPathContainedInProjectRoot,
  validateProjectTargetRoot,
} from '../core/project-target.js';
import {
  CANONICAL_RULES_ASSET_ID,
  projectCanonicalRulesFile,
  type ProjectRulesFileName,
} from '../core/project-rules.js';
import {
  managedReceiptPath,
  readManagedReceipt,
  type ManagedReceipt,
} from '../core/managed-receipt.js';
import {
  classifyCanonicalSkillLinks,
  canonicalDeviceSkillStoreRoot,
  canonicalSkillTargetKey,
  canonicalSkillPackageName,
  deployPathExists,
  hashDeviceTopologyNode,
  isPathWithinRoot,
  planCanonicalSkillDeviceLayout,
  type CanonicalSkillIde,
  type CanonicalSkillLayoutFile,
  type CanonicalSkillLinkOutcome,
  type CanonicalSkillLinkFact,
  type CanonicalSkillTarget,
} from '../core/canonical-skill-device-layout.js';
import { ideForSkillSurface } from '../core/skill-surfaces.js';
import {
  OPERATION_SCHEMA_VERSION,
  type Issue,
  type McvError,
  type Plan,
  type Result,
} from './contracts.js';

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

export interface DeployLinkPreview {
  targetPath: string;
  kind: 'link';
  linkTarget: string;
}

export interface DeployPackagePreview {
  targetPath: string;
  kind: 'package';
  files: Array<DeployTextPreview | DeployBinaryPreview>;
}

export type DeployPreview = DeployTextPreview | DeployBinaryPreview | DeployLinkPreview | DeployPackagePreview;

export type DeployDeploymentKind =
  | 'ordinary-file'
  | 'physical-materialization'
  | 'managed-link-projection'
  | 'copy-projection'
  | 'topology-migration'
  | 'external-link-replacement';

export type DeployIde = CanonicalSkillIde;

type DeployChangeBase = {
  id: string;
  name: string;
  targetPath: string;
  change: DeployChangeKind;
  defaultSelected: boolean;
  group: 'standard' | 'advanced';
  strategy: DeployStrategy;
  deploymentKind?: DeployDeploymentKind;
  dependsOnChangeIds?: string[];
  preview: DeployPreview;
};

type DeployChangeTarget =
  | { owner: 'canonical-store'; capability: 'skills'; ide?: never; surface?: never }
  | { owner: 'ide'; capability: 'skills'; ide: IdeId; surface: SkillSurfaceId }
  | {
    owner: 'ide';
    capability: Exclude<ConfigurationCapability, 'skills'>;
    ide: IdeId;
    surface?: never;
  };

export type DeployChange = DeployChangeBase & DeployChangeTarget;

export type DeployLinkOutcome = CanonicalSkillLinkOutcome;

export interface DeployDecision {
  id: string;
  factId: string;
  kind: 'external-skill-divergence';
  packageNames: string[];
  linkPaths: string[];
  choices: ['preserve-external', 'replace-with-repository'];
  replacementChangeIds: string[];
}

export type DeployPlan = Plan<DeployChange> & DeployContextFields & {
  operation: 'deploy';
  linkOutcomes: DeployLinkOutcome[];
  linkFacts: CanonicalSkillLinkFact[];
  decisions: DeployDecision[];
};

export interface DeploySelection {
  changeIds: string[];
  confirmedIssueIds?: string[];
  decisions?: Record<string, 'preserve-external' | 'replace-with-repository'>;
}

export interface DeployApplyOptions {
  nonInteractive?: boolean;
  copyFile?: typeof fs.copyFileSync;
  createSymbolicLink?: (target: string, linkPath: string) => void;
  writeFile?: (targetPath: string, content: Buffer) => void;
  removeFile?: (targetPath: string) => void;
  restoreFile?: (targetPath: string, content: Buffer) => void;
  updateState?: (context: DeviceContext, state: McvState) => void;
}

export interface DeployResultData {
  appliedChangeIds: string[];
  writtenPaths: string[];
  deletedPaths: string[];
  backupPath?: string;
  projectionPaths?: string[];
}

export type DeployResult = Result<DeployResultData, DeployChange> & Partial<DeployContextFields> & {
  operation: 'deploy';
  linkOutcomes?: DeployLinkOutcome[];
  linkFacts?: CanonicalSkillLinkFact[];
};

/**
 * Skills/MCP project writers land in #55/#57. Rules project projection is active (#54).
 */
export const PROJECT_SKILL_PROJECTION_PENDING_CODE = 'deploy.projectSkillProjectionPending' as const;
export const PROJECT_MCP_PROJECTION_PENDING_CODE = 'deploy.projectMcpProjectionPending' as const;

export function buildDeployRequest(
  repositoryPath: string,
  input: {
    profileIds: readonly string[];
    scope: DeployRequest['scope'];
    targetRoot: string;
  },
): { request: DeployRequest; issues: Issue[] } | { error: McvError; issues: Issue[] } {
  const profileIds = input.profileIds.length > 0
    ? [...input.profileIds]
    : [GLOBAL_PROFILE_ID];
  const resolved = resolveProfiles(repositoryPath, profileIds, input.scope);
  if (resolved.status === 'failed') {
    return { error: resolved.error, issues: resolved.issues };
  }
  return {
    request: {
      scope: input.scope,
      targetRoot: input.targetRoot,
      profileIds,
      selection: resolved.selection,
    },
    issues: resolved.issues,
  };
}

type SourcedDeployFile = DeployFile & {
  capability: ConfigurationCapability;
  strategy: DeployStrategy;
  deploymentKind: DeployDeploymentKind;
} & CanonicalSkillTarget;

interface DeployMutation {
  content?: Buffer;
  linkTarget?: string;
  packageFiles?: Array<{ relativePath: string; content: Buffer }>;
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
  nodeKind?: 'file' | 'directory' | 'symlink';
  linkText?: string;
  layoutKind?: DeployDeploymentKind;
}

interface DeployBackupManifest {
  createdAt: string;
  status: 'pending' | 'complete' | 'failed';
  files: DeployBackupEntry[];
  scope?: DeployRequest['scope'];
  targetRoot?: string;
  completedAt?: string;
  failedAt?: string;
  error?: string;
}

interface PreparedDeployWrite {
  targetPath: string;
  change: 'write' | 'delete' | 'link' | 'migrate-link' | 'replace-directory';
  content?: Buffer;
  linkTarget?: string;
  packageFiles?: Array<{ relativePath: string; content: Buffer }>;
}

const activeDeployPlans = new WeakMap<DeployPlan, ActiveDeployPlan>();

export async function createDeployPlan(
  context: DeviceContext,
  request: DeployRequest,
): Promise<DeployPlan> {
  const operationId = uuidv4();
  const contextFields = deployContextFieldsFromRequest(request);
  let repositoryPath: string | null = null;
  try {
    repositoryPath = resolveBoundRepository(context);
    const mutations = new Map<string, DeployMutation>();
    const plan = await buildDeployPlan(context, repositoryPath, operationId, mutations, request);
    registerDeployPlan(plan, mutations);
    return plan;
  } catch (error) {
    return freezeDeployPlan({
      schemaVersion: OPERATION_SCHEMA_VERSION,
      operation: 'deploy',
      status: 'failed',
      readyToApply: false,
      operationId,
      preconditions: {},
      repositoryPath,
      changes: [],
      linkOutcomes: [],
      linkFacts: [],
      decisions: [],
      issues: [{
        severity: 'error',
        code: 'deploy.planFailed',
        message: 'The Deploy Plan could not be generated safely.',
      }],
      nextActions: ['Fix the reported Repository or IDE configuration problem, then regenerate the Deploy Plan.'],
      error: {
        code: 'deploy.planFailed',
        message: 'The Deploy Plan could not be generated safely.',
        technicalDetails: errorMessage(error),
        nextActions: ['Fix the Repository or IDE configuration problem, then regenerate the Deploy Plan.'],
      },
      ...contextFields,
    });
  }
}

async function buildDeployPlan(
  context: DeviceContext,
  repositoryPath: string,
  operationId: string,
  mutations: Map<string, DeployMutation>,
  request: DeployRequest,
): Promise<DeployPlan> {
  const contextFields = deployContextFieldsFromRequest(request);
  const resolved = resolveProfiles(repositoryPath, request.profileIds, request.scope);
  if (resolved.status === 'failed') {
    return {
      schemaVersion: OPERATION_SCHEMA_VERSION,
      operation: 'deploy',
      status: 'failed',
      readyToApply: false,
      operationId,
      preconditions: {},
      repositoryPath,
      changes: [],
      linkOutcomes: [],
      linkFacts: [],
      decisions: [],
      issues: [{
        severity: 'error',
        code: resolved.error.code,
        message: resolved.error.message,
      }],
      nextActions: resolved.error.nextActions,
      error: resolved.error,
      ...contextFields,
    };
  }

  const selectionIssues = [...resolved.issues];
  // Prefer freshly resolved selection (revisions recomputed) over the caller's copy.
  const activeRequest: DeployRequest = {
    ...request,
    selection: resolved.selection,
    profileIds: [...resolved.selection.profileIds],
  };
  const activeFields = deployContextFieldsFromRequest(activeRequest);

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
      linkOutcomes: [],
      linkFacts: [],
      decisions: [],
      issues: [
        ...selectionIssues,
        {
          severity: 'notice',
          code: 'deploy.noEnabledTargets',
          message: 'No IDE targets are enabled in this Repository.',
        },
      ],
      nextActions: ['Enable at least one IDE target in mcv.yaml before deploying configuration.'],
      ...activeFields,
    };
  }

  const deployContext: DeviceContext = {
    ...context,
    variables: resolveManifestVariables(manifest.variables, context, repositoryPath),
  };

  let desired: SourcedDeployFile[] = [];
  const receiptEntries = new Map<string, { assetId: string; hash: string }>();
  if (activeRequest.scope === 'project') {
    const validated = validateProjectTargetRoot(activeRequest.targetRoot, context, {
      boundRepositoryPath: repositoryPath,
    });
    if (!validated.ok) {
      return {
        schemaVersion: OPERATION_SCHEMA_VERSION,
        operation: 'deploy',
        status: 'failed',
        readyToApply: false,
        operationId,
        preconditions: {},
        repositoryPath,
        changes: [],
        linkOutcomes: [],
        linkFacts: [],
        decisions: [],
        issues: [{
          severity: 'error',
          code: validated.error.code,
          message: validated.error.message,
        }],
        nextActions: validated.error.nextActions,
        error: validated.error,
        ...activeFields,
      };
    }
    activeRequest.targetRoot = validated.targetRoot;
    Object.assign(activeFields, deployContextFieldsFromRequest(activeRequest));

    const selectedView = buildSelectedRepositoryView(
      repositoryPath,
      activeRequest.selection,
      deployContext,
    );
    const assetIds = activeRequest.selection.assetIds;
    if (assetIds.some((id) => id.startsWith('skill:'))) {
      selectionIssues.push({
        severity: 'notice',
        code: PROJECT_SKILL_PROJECTION_PENDING_CODE,
        message: 'Project-scope Skill projection is not active yet; selected Skills were skipped.',
      });
    }
    if (assetIds.some((id) => id.startsWith('mcp:'))) {
      selectionIssues.push({
        severity: 'notice',
        code: PROJECT_MCP_PROJECTION_PENDING_CODE,
        message: 'Project-scope MCP projection is not active yet; selected MCP servers were skipped.',
      });
    }

    const receipt = readManagedReceipt(activeRequest.targetRoot);
    desired = (await Promise.all(definitions.map(async (definition) => {
      const operation = await definition.adapter.project(
        selectedView,
        activeRequest,
        deployContext,
      );
      return operation.files.flatMap((file): SourcedDeployFile[] => {
        try {
          assertPathContainedInProjectRoot(activeRequest.targetRoot, file.targetPath);
        } catch (error) {
          selectionIssues.push({
            severity: 'error',
            code: 'deploy.containmentFailed',
            message: errorMessage(error),
          });
          return [];
        }
        const relative = path.relative(activeRequest.targetRoot, file.targetPath);
        const rulesName = asProjectRulesFileName(relative);
        if (rulesName && selectedView.rules) {
          const projection = projectCanonicalRulesFile(
            activeRequest.targetRoot,
            rulesName,
            selectedView.rules.content,
            receipt,
          );
          if (projection.drifted) {
            selectionIssues.push({
              severity: 'decisionRequired',
              code: 'deploy.managedBlockDrift',
              message: `Managed Block Drift blocks silent overwrite: ${projection.targetPath}`,
              details: 'Local edits inside the mcv:begin/mcv:end block must be resolved before Deploy can update that block.',
            });
            return [];
          }
          if (projection.unchanged) {
            receiptEntries.set(projection.receiptKey, {
              assetId: CANONICAL_RULES_ASSET_ID,
              hash: projection.bodyHash,
            });
            return [];
          }
          receiptEntries.set(projection.receiptKey, {
            assetId: CANONICAL_RULES_ASSET_ID,
            hash: projection.bodyHash,
          });
          return [{
            targetPath: projection.targetPath,
            content: projection.content,
            owner: 'ide' as const,
            ide: ideName(definition.targetId),
            capability: 'rules' as const,
            strategy: 'replace-entire-file' as const,
            deploymentKind: 'ordinary-file' as const,
          }];
        }
        const semantics = inferDeploymentSemantics(
          file.targetPath,
          definition.targetId,
          repositoryPath,
          context,
        );
        return semantics.capabilities.map((capability) => ({
          ...file,
          owner: 'ide' as const,
          ide: ideName(definition.targetId),
          capability,
          strategy: semantics.strategy,
          deploymentKind: capability === 'skills' ? 'copy-projection' as const : 'ordinary-file' as const,
        }));
      });
    }))).flat();

    if (selectionIssues.some((issue) => issue.severity === 'error')) {
      const errorIssue = selectionIssues.find((issue) => issue.severity === 'error')!;
      return {
        schemaVersion: OPERATION_SCHEMA_VERSION,
        operation: 'deploy',
        status: 'failed',
        readyToApply: false,
        operationId,
        preconditions: {},
        repositoryPath,
        changes: [],
        linkOutcomes: [],
        linkFacts: [],
        decisions: [],
        issues: selectionIssues,
        nextActions: ['Fix the reported project target problem, then regenerate the Deploy Plan.'],
        error: {
          code: errorIssue.code,
          message: errorIssue.message,
          nextActions: ['Fix the reported project target problem, then regenerate the Deploy Plan.'],
        },
        ...activeFields,
      };
    }
  } else {
    const selectedView = buildSelectedRepositoryView(
      repositoryPath,
      activeRequest.selection,
      deployContext,
    );
    desired = (await Promise.all(definitions.map(async (definition) => {
      const operation = await definition.adapter.project(
        selectedView,
        activeRequest,
        deployContext,
      );
      return operation.files.flatMap((file): SourcedDeployFile[] => {
        const semantics = inferDeploymentSemantics(
          file.targetPath,
          definition.targetId,
          repositoryPath,
          context,
        );
        return semantics.capabilities.map((capability) => ({
          ...file,
          owner: 'ide' as const,
          ide: ideName(definition.targetId),
          capability,
          strategy: semantics.strategy,
          deploymentKind: capability === 'skills' ? 'copy-projection' : 'ordinary-file',
        }));
      });
    }))).flat();
  }

  const issues: Issue[] = [...selectionIssues];
  const linkOutcomes: DeployLinkOutcome[] = [];
  const linkFacts: CanonicalSkillLinkFact[] = [];
  const layout = planCanonicalSkillLayout(
    desired,
    context,
    manifest.deploy.useSymlinks,
    mutations,
    issues,
    definitions,
  );
  const safeDesired = layout.desired.filter((file) => {
    const linkPath = findSymbolicLinkAncestor(file.targetPath);
    if (!linkPath) return true;
    if (file.capability === 'skills') return false;
    issues.push({
      severity: 'warning',
      code: 'deploy.symbolicLinkSkipped',
      confirmationId: `deploy-warning-${hashText(`symbolic-link\0${file.targetPath}\0${linkPath}`).slice(0, 16)}`,
      message: `A target beneath a symbolic link was excluded: ${file.targetPath}.`,
      details: `Symbolic link ancestor: ${linkPath}`,
    });
    return false;
  });
  const inventory = readState(context).managedInventory ?? {};
  const linkedSkills = classifyCanonicalSkillLinks(
    layout.desiredForLinkClassification,
    (linkPath) => inventory[linkPath]?.hash === hashDeviceTopologyNode(linkPath),
  );
  linkOutcomes.push(...linkedSkills.outcomes);
  linkFacts.push(...linkedSkills.facts);
  issues.push(...linkedSkills.issues);

  const changes = safeDesired.flatMap((file): DeployChange[] => {
    const previous = fs.existsSync(file.targetPath) ? fs.readFileSync(file.targetPath) : undefined;
    const next = toBuffer(file.content);
    if (previous?.equals(next)) return [];
    const filePreview = preview(
      file.targetPath,
      canonicalSkillTargetKey(file),
      file.capability,
      next,
      previous,
      issues,
    );
    if (filePreview.kind === 'text' && filePreview.diff.length === 0) return [];
    const change = previous === undefined ? 'add' as const : 'modify' as const;
    const id = selectionId(canonicalSkillTargetKey(file), file.capability, file.targetPath);
    mutations.set(id, { content: next });
    const changeTarget = deployChangeTarget(file, file.capability);
    return [{
      id,
      ...changeTarget,
      name: displayName(file.targetPath, file.capability),
      targetPath: file.targetPath,
      change,
      defaultSelected: true,
      group: 'standard',
      strategy: file.strategy,
      deploymentKind: file.deploymentKind,
      preview: filePreview,
    }];
  });
  changes.push(...layout.projectionChanges);
  const decisions = addExternalLinkReplacementDecisions(
    linkedSkills.facts,
    linkedSkills.outcomes,
    layout.desiredForExternalReplacement,
    manifest.deploy.useSymlinks,
    context,
    changes,
    mutations,
    issues,
  );

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
        owner: 'ide',
        ide: 'codex',
        surface: 'codex',
        capability: 'skills',
        name: displayName(targetPath, 'skills'),
        targetPath,
        change: 'delete',
        defaultSelected: false,
        group: 'advanced',
        strategy: 'replace-entire-file',
        deploymentKind: 'copy-projection',
        preview: preview(targetPath, 'codex', 'skills', Buffer.alloc(0), fs.readFileSync(targetPath), issues),
      });
      mutations.set(selectionId('codex', 'skills', targetPath), {});
    }
  }

  const sourcePreconditions = new Map<string, string>();
  const desiredPaths = new Set(safeDesired.map((file) => path.resolve(file.targetPath)));
  for (const change of layout.projectionChanges) {
    desiredPaths.add(path.resolve(change.targetPath));
  }
  for (const outcome of linkedSkills.outcomes) {
    if (outcome.status !== 'satisfied-via-link' || outcome.ownership !== 'managed') continue;
    for (const linkPath of outcome.linkPaths) desiredPaths.add(path.resolve(linkPath));
  }
  const managedInventory = readState(context).managedInventory ?? {};
  const managedSkillLayout = readState(context).managedSkillLayout;
  const managedStorePaths = Object.keys(managedSkillLayout?.packages ?? {})
    .map((storePath) => path.resolve(storePath));
  for (const [targetPath, inventoryEntry] of Object.entries(managedInventory)) {
    const resolvedTarget = path.resolve(targetPath);
    const containsDesiredPath = [...desiredPaths].some((desiredPath) =>
      isPathWithinRoot(resolvedTarget, desiredPath));
    if (containsDesiredPath || !deployPathExists(targetPath)) continue;
    if (isPathUnderAnyRoot(resolvedTarget, managedStorePaths)) continue;
    const linkAncestor = findSymbolicLinkAncestor(targetPath);
    const projection = managedSkillLayout?.projections[targetPath]
      ?? managedSkillLayout?.projections[resolvedTarget];
    const isManagedProjection = Boolean(projection);
    const isSelfSymlink = linkAncestor !== undefined
      && path.resolve(linkAncestor) === resolvedTarget;
    const hasSymlinkParent = linkAncestor !== undefined && !isSelfSymlink;
    if (hasSymlinkParent) continue;
    if (isSelfSymlink && !isManagedProjection) continue;
    const target = inferDeployTarget(targetPath, context);
    if (!target) continue;
    const targetKey = canonicalSkillTargetKey(target);
    const semantics = target.owner === 'canonical-store'
      ? { capabilities: ['skills'] as ConfigurationCapability[], strategy: 'replace-entire-file' as const }
      : inferDeploymentSemantics(targetPath, targetIdForIde(target.ide), repositoryPath, context);
    const capability = semantics.capabilities[0];
    if (semantics.strategy !== 'replace-entire-file' || !capability) continue;
    const deploymentKind: DeployDeploymentKind = projection
      ? 'managed-link-projection'
      : target.owner === 'canonical-store'
        ? 'physical-materialization'
        : capability === 'skills' ? 'copy-projection' : 'ordinary-file';
    const changeTarget = deployChangeTarget(target, capability);
    const deletion: DeployChange = {
      id: selectionId(targetKey, capability, targetPath),
      ...changeTarget,
      name: projection?.packageName ?? displayName(targetPath, capability),
      targetPath,
      change: 'delete',
      defaultSelected: false,
      group: 'advanced',
      strategy: semantics.strategy,
      deploymentKind,
      preview: projection
        ? {
          targetPath,
          kind: 'link',
          linkTarget: projection.expectedLinkTarget,
        }
        : preview(
          targetPath,
          targetKey,
          capability,
          Buffer.alloc(0),
          fs.readFileSync(targetPath),
          issues,
        ),
    };
    changes.push(deletion);
    mutations.set(deletion.id, {});
    sourcePreconditions.set(deletion.id, hashText(stableValue(inventoryEntry)));
  }

  for (const pkg of Object.values(managedSkillLayout?.packages ?? {})) {
    const storePath = path.resolve(pkg.storePath);
    if (!deployPathExists(storePath)) continue;
    if (desiredPaths.has(storePath) || [...desiredPaths].some((desired) => isPathUnderRoot(desired, storePath))) continue;
    const stillRequired = Object.values(managedSkillLayout?.projections ?? {}).some((projection) => {
      if (path.resolve(projection.expectedLinkTarget) !== storePath
        && projection.packageName !== pkg.packageName) return false;
      return desiredPaths.has(path.resolve(projection.projectionPath));
    });
    if (stillRequired) continue;
    try {
      const storeStat = fs.lstatSync(storePath);
      if (storeStat.isSymbolicLink() || !storeStat.isDirectory()) continue;
    } catch {
      continue;
    }
    const id = selectionId('canonical-store', 'skills', storePath);
    if (changes.some((change) => change.id === id)) continue;
    const deletion: DeployChange = {
      id,
      owner: 'canonical-store',
      capability: 'skills',
      name: pkg.packageName,
      targetPath: storePath,
      change: 'delete',
      defaultSelected: false,
      group: 'advanced',
      strategy: 'replace-entire-file',
      deploymentKind: 'physical-materialization',
      preview: {
        targetPath: storePath,
        kind: 'text',
        bytes: 0,
        sha256: hashText(`remove-package:${pkg.packageName}`),
        diff: `Remove MCV-owned Canonical Skill package ${pkg.packageName}`,
      },
    };
    changes.push(deletion);
    mutations.set(deletion.id, {});
    sourcePreconditions.set(deletion.id, hashText(stableValue(pkg)));
  }

  changes.sort(compareChanges);
  appendManagedReceiptChange(
    activeRequest,
    manifest.repositoryId,
    receiptEntries,
    changes,
    mutations,
    issues,
  );
  const repositorySourceHash = hashRepositoryInputs(repositoryPath);
  const preconditions = Object.fromEntries(changes.flatMap((change) => {
    return [
      [`source:${change.id}`, sourcePreconditions.get(change.id) ?? repositorySourceHash],
      [`target:${change.id}`, hashDeviceTopologyNode(change.targetPath)],
    ];
  }).concat(layout.externalStorePackages.map(({ storePath }) => [
    `external-store:${path.resolve(storePath)}`,
    hashExternalStorePackage(storePath),
  ])));
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
    linkOutcomes,
    linkFacts,
    decisions,
    issues,
    nextActions: blocked
      ? ['Resolve every decisionRequired or error Issue, then regenerate the Deploy Plan.']
      : [],
    ...activeFields,
  };
}

function planCanonicalSkillLayout(
  desired: SourcedDeployFile[],
  context: DeviceContext,
  useSymlinks: boolean,
  mutations: Map<string, DeployMutation>,
  issues: Issue[],
  definitions: ReturnType<typeof createAdapterDefinitions>,
): {
  desired: SourcedDeployFile[];
  desiredForLinkClassification: CanonicalSkillLayoutFile[];
  desiredForExternalReplacement: SourcedDeployFile[];
  projectionChanges: DeployChange[];
  externalStorePackages: Array<{ packageName: string; storePath: string }>;
} {
  const projectionSurfaces = definitions.flatMap(({ adapter }) =>
    adapter.skillSurfaces.map((surface) => ({
      ide: ideForSkillSurface(surface.id),
      surface: surface.id,
      root: surface.destinationRoot(context),
      supportsManagedLinks: surface.supportsManagedDirectoryLinks(context.platform),
    })));
  const managedStorePaths = new Set(Object.values(
    readState(context).managedSkillLayout?.packages ?? {},
  ).map((pkg) => path.resolve(pkg.storePath)));
  const annotatedDesired = desired.map((file) => annotateSkillSurface(file, projectionSurfaces));
  const managedLayout = planCanonicalSkillDeviceLayout({
    files: annotatedDesired,
    context,
    useManagedLinks: useSymlinks
      && projectionSurfaces.some((surface) => surface.supportsManagedLinks),
    projectionSurfaces,
    managedStorePaths,
  });
  for (const relative of managedLayout.conflicts) {
    issues.push({
      severity: 'error',
      code: 'deploy.skillsLayout.physicalTargetConflict',
      message: `Canonical Skill projections disagree about ${relative}.`,
    });
  }
  for (const unowned of managedLayout.unownedStorePackages) {
    issues.push({
      severity: 'error',
      code: 'deploy.skillsLayout.unownedStorePackage',
      message: `Unowned Canonical Device Skill Store package requires resolution: ${unowned.packageName}.`,
      details: `${unowned.storePath} differs from the complete Canonical package or has unsafe topology. Capture or otherwise resolve it before Deploy; MCV will not overwrite or claim it.`,
    });
  }
  const projectionChanges: DeployChange[] = [];
  for (const projection of managedLayout.missingProjections) {
    const id = selectionId(canonicalSkillTargetKey(projection), 'skills', projection.targetPath);
    projectionChanges.push({
      id,
      owner: 'ide',
      ide: projection.ide,
      surface: projection.surface,
      capability: 'skills',
      name: projection.packageName,
      targetPath: projection.targetPath,
      change: 'add',
      defaultSelected: true,
      group: 'standard',
      strategy: 'replace-entire-file',
      deploymentKind: 'managed-link-projection',
      dependsOnChangeIds: projection.materializationPaths.map((targetPath) =>
        selectionId('canonical-store', 'skills', targetPath)),
      preview: {
        targetPath: projection.targetPath,
        kind: 'link',
        linkTarget: projection.physicalTargetPath,
      },
    });
    mutations.set(id, { linkTarget: projection.physicalTargetPath });
  }
  for (const migration of managedLayout.topologyMigrations) {
    const id = selectionId(canonicalSkillTargetKey(migration), 'skills', migration.targetPath);
    projectionChanges.push({
      id,
      owner: 'ide',
      ide: migration.ide,
      surface: migration.surface,
      capability: 'skills',
      name: migration.packageName,
      targetPath: migration.targetPath,
      change: 'modify',
      defaultSelected: false,
      group: 'standard',
      strategy: 'replace-entire-file',
      deploymentKind: 'topology-migration',
      dependsOnChangeIds: migration.materializationPaths.map((targetPath) =>
        selectionId('canonical-store', 'skills', targetPath)),
      preview: {
        targetPath: migration.targetPath,
        kind: 'link',
        linkTarget: migration.physicalTargetPath,
      },
    });
    mutations.set(id, { linkTarget: migration.physicalTargetPath });
    issues.push({
      severity: 'warning',
      code: 'deploy.skillsTopology.migrationCandidate',
      confirmationId: `deploy-warning-${hashText(`topology-migration\0${migration.targetPath}`).slice(0, 16)}`,
      message: `Topology migration available: replace matching physical Skill copy ${migration.packageName} with a managed link.`,
      details: `${migration.targetPath} currently matches Canonical package content and can be replaced with a link to ${migration.physicalTargetPath}. Migration is destructive, never selected by default, and requires explicit interactive confirmation.`,
    });
  }
  for (const divergent of managedLayout.divergentPhysicalCopies) {
    issues.push({
      severity: 'warning',
      code: 'deploy.skillsTopology.divergentPhysicalCopy',
      confirmationId: `deploy-warning-${hashText(`divergent-copy\0${divergent.targetPath}`).slice(0, 16)}`,
      message: `Divergent physical Skill copy preserved: ${divergent.packageName}.`,
      details: `${divergent.targetPath} differs from the Canonical package. Capture or otherwise resolve the package before replacing it with a managed link.`,
    });
  }
  const materialized = managedLayout.materializations.map(({ source, targetPath }) => {
    const { ide: _ide, surface: _surface, ...withoutTarget } = source;
    return {
      ...withoutTarget,
      owner: 'canonical-store' as const,
      targetPath,
      deploymentKind: 'physical-materialization' as const,
    };
  });
  return {
    desired: [...managedLayout.filesOutsideLayout, ...materialized],
    desiredForLinkClassification: managedLayout.filesForLinkClassification,
    desiredForExternalReplacement: annotatedDesired,
    projectionChanges,
    externalStorePackages: managedLayout.externalStorePackages,
  };
}

function annotateSkillSurface(
  file: SourcedDeployFile,
  surfaces: Array<{ ide: CanonicalSkillIde; surface: SkillSurfaceId; root: string }>,
): SourcedDeployFile {
  if (file.capability !== 'skills' || file.owner !== 'ide') return file;
  const match = surfaces.find((surface) => isPathWithinRoot(surface.root, file.targetPath));
  return match ? { ...file, ide: match.ide, surface: match.surface } : file;
}

function addExternalLinkReplacementDecisions(
  facts: CanonicalSkillLinkFact[],
  outcomes: CanonicalSkillLinkOutcome[],
  desired: SourcedDeployFile[],
  useSymlinks: boolean,
  context: DeviceContext,
  changes: DeployChange[],
  mutations: Map<string, DeployMutation>,
  issues: Issue[],
): DeployDecision[] {
  const decisions: DeployDecision[] = [];
  for (const fact of facts.filter((entry) => entry.severity === 'decisionRequired')) {
    const replacementChangeIds: string[] = [];
    for (const outcome of outcomes.filter((entry) => entry.factId === fact.id && entry.owner === 'ide')) {
      if (!outcome.ide || !outcome.surface) continue;
      for (const linkPath of outcome.linkPaths) {
        const packageFiles = desired.filter((file) =>
          file.capability === 'skills'
          && file.owner === 'ide'
          && file.ide === outcome.ide
          && file.surface === outcome.surface
          && findSymbolicLinkAncestor(file.targetPath) === linkPath);
        if (packageFiles.length === 0) continue;
        const packageName = canonicalSkillPackageName(packageFiles[0].targetPath);
        const id = selectionId(
          canonicalSkillTargetKey(outcome),
          'skills',
          `${linkPath}\0external-link-replacement`,
        );
        const materializationRoot = path.join(canonicalDeviceSkillStoreRoot(context), packageName);
        const dependsOnChangeIds = useSymlinks
          ? changes.filter((change) =>
            change.deploymentKind === 'physical-materialization'
            && isPathWithinRoot(materializationRoot, change.targetPath)).map((change) => change.id)
          : [];
        const packageMutation = packageFiles.map((file) => ({
          relativePath: path.relative(linkPath, file.targetPath),
          content: toBuffer(file.content),
        }));
        changes.push({
          id,
          owner: 'ide',
          ide: outcome.ide,
          surface: outcome.surface,
          capability: 'skills',
          name: packageName,
          targetPath: linkPath,
          change: 'modify',
          defaultSelected: false,
          group: 'standard',
          strategy: 'replace-entire-file',
          deploymentKind: 'external-link-replacement',
          ...(dependsOnChangeIds.length > 0 ? { dependsOnChangeIds } : {}),
          preview: useSymlinks
            ? { targetPath: linkPath, kind: 'link', linkTarget: materializationRoot }
            : {
                targetPath: linkPath,
                kind: 'package',
                files: packageFiles.map((file) => preview(
                  file.targetPath,
                  canonicalSkillTargetKey(outcome),
                  'skills',
                  toBuffer(file.content),
                  fs.existsSync(file.targetPath) ? fs.readFileSync(file.targetPath) : undefined,
                  issues,
                )).filter((item): item is DeployTextPreview | DeployBinaryPreview =>
                  item.kind === 'text' || item.kind === 'binary'),
              },
        });
        mutations.set(id, useSymlinks
          ? { linkTarget: materializationRoot }
          : { packageFiles: packageMutation });
        replacementChangeIds.push(id);
      }
    }
    if (replacementChangeIds.length > 0) {
      decisions.push({
        id: fact.id,
        factId: fact.id,
        kind: 'external-skill-divergence',
        packageNames: fact.packageNames,
        linkPaths: fact.linkPaths,
        choices: ['preserve-external', 'replace-with-repository'],
        replacementChangeIds,
      });
    }
  }
  return decisions;
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
  if (plan.scope === 'project') {
    const receiptChange = plan.changes.find((change) =>
      change.name === 'Managed Receipt'
      && change.targetPath === managedReceiptPath(plan.targetRoot));
    const rulesSelected = plan.changes.some((change) =>
      selected.has(change.id)
      && asProjectRulesFileName(path.relative(plan.targetRoot, change.targetPath)) !== undefined);
    if (receiptChange && rulesSelected && !selected.has(receiptChange.id)) {
      selected.add(receiptChange.id);
      selectedIds.push(receiptChange.id);
    }
  }
  const decisionChoices = selection.decisions ?? {};
  const knownDecisionIds = new Set(plan.decisions.map((decision) => decision.id));
  if (Object.keys(decisionChoices).some((id) => !knownDecisionIds.has(id))) {
    return failedDeployResult(plan.repositoryPath, {
      code: 'deploy.invalidSelection',
      message: 'The Deploy selection contains a decision that is not in the active Plan.',
      nextActions: ['Choose only decisions from the current Deploy Plan.'],
    });
  }
  for (const decision of plan.decisions) {
    const choice = decisionChoices[decision.id];
    if (!choice) continue;
    const replacementSelected = decision.replacementChangeIds.every((id) => selected.has(id));
    const replacementPartiallySelected = decision.replacementChangeIds.some((id) => selected.has(id));
    if ((choice === 'replace-with-repository' && !replacementSelected)
      || (choice === 'preserve-external' && replacementPartiallySelected)) {
      return failedDeployResult(plan.repositoryPath, {
        code: 'deploy.invalidSelection',
        message: 'The selected external Skill decision does not match its replacement changes.',
        nextActions: ['Regenerate the Deploy Plan and choose Preserve or Replace again.'],
      });
    }
  }
  const missingDependencies = plan.changes.flatMap((change) =>
    selected.has(change.id)
      ? (change.dependsOnChangeIds ?? []).filter(
        (dependencyId) => knownIds.has(dependencyId) && !selected.has(dependencyId),
      )
      : []);
  if (missingDependencies.length > 0) {
    return failedDeployResult(plan.repositoryPath, {
      code: 'deploy.invalidSelection',
      message: 'A managed Skill projection cannot be selected without its pending Store materialization.',
      technicalDetails: `Missing selected dependencies: ${[...new Set(missingDependencies)].join(', ')}`,
      nextActions: ['Select every pending physical materialization required by the managed projection.'],
    });
  }

  const blocking = deployBlockingIssues(plan, selection, options);
  if (blocking.length > 0) return blockedDeployResult(plan, blocking);

  if (!plan.repositoryPath || resolveBoundRepository(context) !== plan.repositoryPath) {
    activeDeployPlans.delete(plan);
    return failedDeployResult(plan.repositoryPath, stalePlanError(), undefined, deployContextFromPlan(plan));
  }

  let freshPlan: DeployPlan;
  try {
    freshPlan = await buildDeployPlan(
      context,
      plan.repositoryPath,
      plan.operationId,
      new Map<string, DeployMutation>(),
      deployRequestFromPlan(plan),
    );
  } catch {
    activeDeployPlans.delete(plan);
    return failedDeployResult(plan.repositoryPath, stalePlanError(), undefined, deployContextFromPlan(plan));
  }
  if (
    plan.profilesRevision !== freshPlan.profilesRevision
    || plan.catalogRevision !== freshPlan.catalogRevision
  ) {
    activeDeployPlans.delete(plan);
    return failedDeployResult(plan.repositoryPath, stalePlanError(), undefined, deployContextFromPlan(plan));
  }
  if (!sameDeploySnapshot(plan, freshPlan)) {
    activeDeployPlans.delete(plan);
    return failedDeployResult(plan.repositoryPath, stalePlanError(), undefined, deployContextFromPlan(plan));
  }

  const selectedChanges = plan.changes.filter((change) => selected.has(change.id));
  const prepared = prepareDeployWrites(selectedChanges, active.mutations);
  if (selectedChanges.length === 0) {
    try {
      if (plan.scope !== 'project') {
        updateDeployState(context, plan.repositoryPath, selectedChanges, options.updateState);
      }
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
      issues: plan.issues.filter((issue) => issue.severity === 'notice'),
      nextActions: [],
      data: { appliedChangeIds: [], writtenPaths: [], deletedPaths: [] },
      linkOutcomes: plan.linkOutcomes,
      linkFacts: plan.linkFacts,
      scope: plan.scope,
      targetRoot: plan.targetRoot,
      profileIds: plan.profileIds,
      profilesRevision: plan.profilesRevision,
      catalogRevision: plan.catalogRevision,
      assetIds: plan.assetIds,
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
      options.removeFile ?? ((targetPath) => fs.rmSync(targetPath, { recursive: true, force: true })),
      options.restoreFile ?? ((targetPath, content) => atomicWriteFile(targetPath, content)),
      options.createSymbolicLink ?? ((target, linkPath) => fs.symlinkSync(target, linkPath, 'dir')),
      () => {
        finalizeDeployBackup(backupPath as string);
        // Project ownership lives in the Managed Receipt, not device-global state.
        if (plan.scope !== 'project') {
          updateDeployState(
            context,
            plan.repositoryPath as string,
            selectedChanges,
            options.updateState,
          );
        }
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
        writtenPaths: prepared.filter((item) =>
          item.change === 'write' || item.change === 'replace-directory')
          .map((item) => item.targetPath),
        deletedPaths: prepared.filter((item) => item.change === 'delete').map((item) => item.targetPath),
        projectionPaths: prepared.filter((item) =>
          item.change === 'link' || item.change === 'migrate-link').map((item) => item.targetPath),
        backupPath,
      },
      linkOutcomes: plan.linkOutcomes,
      linkFacts: plan.linkFacts,
      scope: plan.scope,
      targetRoot: plan.targetRoot,
      profileIds: plan.profileIds,
      profilesRevision: plan.profilesRevision,
      catalogRevision: plan.catalogRevision,
      assetIds: plan.assetIds,
    };
  } catch (error) {
    activeDeployPlans.delete(plan);
    markDeployBackupFailed(backupPath, error);
    if (error instanceof StaleDeployPlanError) {
      return failedDeployResult(plan.repositoryPath, stalePlanError(error.message), undefined, deployContextFromPlan(plan));
    }
    if (error instanceof DeployRollbackError) {
      return failedDeployResult(plan.repositoryPath, {
        code: 'deploy.rollbackFailed',
        message: 'Deploy failed and could not fully restore the selected device configuration.',
        technicalDetails: error.message,
        nextActions: [`Restore the affected files from ${backupPath}, then generate a new Deploy Plan.`],
      }, undefined, deployContextFromPlan(plan));
    }
    return failedDeployResult(plan.repositoryPath, {
      code: 'deploy.transactionFailed',
      message: 'Deploy could not commit the selected changes and restored the device configuration.',
      technicalDetails: errorMessage(error),
      nextActions: ['Check target permissions, then generate and review a new Deploy Plan.'],
    }, undefined, deployContextFromPlan(plan));
  }
}

function deployBlockingIssues(
  plan: DeployPlan,
  selection: DeploySelection,
  options: DeployApplyOptions,
): Issue[] {
  if (options.nonInteractive) {
    const unsafe = plan.issues.some((issue) => issue.severity !== 'notice')
      || plan.changes.some((change) =>
        change.change === 'delete' || change.deploymentKind === 'topology-migration');
    return unsafe ? [{
      severity: 'decisionRequired',
      code: 'deploy.nonInteractiveBlocked',
      message: 'Non-interactive Deploy cannot apply warnings, decisions, errors, deletions, or topology migrations.',
    }] : [];
  }
  const confirmed = new Set(selection.confirmedIssueIds ?? []);
  const warnings = plan.issues.filter((issue) =>
    issue.severity === 'warning' && !confirmed.has(issue.confirmationId));
  if (warnings.length > 0) return warnings;
  const resolvedDecisions = new Set(Object.keys(selection.decisions ?? {}));
  return plan.issues.filter((issue) =>
    issue.severity === 'error'
    || (issue.severity === 'decisionRequired'
      && (!issue.decisionId || !resolvedDecisions.has(issue.decisionId))));
}

function sameDeploySnapshot(left: DeployPlan, right: DeployPlan): boolean {
  return left.repositoryPath === right.repositoryPath
    && left.scope === right.scope
    && left.targetRoot === right.targetRoot
    && stableValue(left.profileIds) === stableValue(right.profileIds)
    && left.profilesRevision === right.profilesRevision
    && left.catalogRevision === right.catalogRevision
    && stableValue(left.assetIds) === stableValue(right.assetIds)
    && stableValue(left.preconditions) === stableValue(right.preconditions)
    && stableValue(left.changes.map(deploySnapshotChange))
      === stableValue(right.changes.map(deploySnapshotChange))
    && stableValue(left.linkOutcomes) === stableValue(right.linkOutcomes)
    && stableValue(left.linkFacts) === stableValue(right.linkFacts)
    && stableValue(left.decisions) === stableValue(right.decisions)
    && stableValue(left.issues.map((issue) =>
      [issue.severity, issue.code, issue.confirmationId, issue.decisionId]))
      === stableValue(right.issues.map((issue) =>
        [issue.severity, issue.code, issue.confirmationId, issue.decisionId]));
}

function deployRequestFromPlan(plan: DeployPlan): DeployRequest {
  return {
    scope: plan.scope,
    targetRoot: plan.targetRoot,
    profileIds: [...plan.profileIds],
    selection: {
      profileIds: [...plan.profileIds],
      profilesRevision: plan.profilesRevision,
      catalogRevision: plan.catalogRevision,
      assetIds: [...plan.assetIds],
    },
  };
}

function deploySnapshotChange(change: DeployChange): unknown {
  return {
    id: change.id,
    change: change.change,
    capability: change.capability,
    deploymentKind: change.deploymentKind,
    dependsOnChangeIds: change.dependsOnChangeIds,
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
    if (targetChanges.some((change) => change.deploymentKind === 'topology-migration')) {
      if (!mutation?.linkTarget) {
        throw new Error(`Missing active Deploy link mutation for ${targetChanges[0].id}.`);
      }
      return {
        targetPath,
        change: 'migrate-link' as const,
        linkTarget: mutation.linkTarget,
      };
    }
    if (targetChanges.some((change) => change.deploymentKind === 'external-link-replacement')) {
      if (mutation?.linkTarget) {
        return { targetPath, change: 'migrate-link' as const, linkTarget: mutation.linkTarget };
      }
      if (!mutation?.packageFiles) {
        throw new Error(`Missing active Deploy package mutation for ${targetChanges[0].id}.`);
      }
      return {
        targetPath,
        change: 'replace-directory' as const,
        packageFiles: mutation.packageFiles,
      };
    }
    if (targetChanges.some((change) => change.deploymentKind === 'managed-link-projection')) {
      if (!mutation?.linkTarget) {
        throw new Error(`Missing active Deploy link mutation for ${targetChanges[0].id}.`);
      }
      return {
        targetPath,
        change: 'link' as const,
        linkTarget: mutation.linkTarget,
      };
    }
    if (!mutation?.content) throw new Error(`Missing active Deploy mutation for ${targetChanges[0].id}.`);
    return {
      targetPath,
      change: 'write' as const,
      content: composeSelectedContent(targetPath, targetChanges, mutation.content),
    };
  }).sort((left, right) => {
    const order = { write: 0, delete: 1, link: 2, 'migrate-link': 2, 'replace-directory': 2 } as const;
    return order[left.change] - order[right.change];
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
  if (changes[0].owner !== 'ide') {
    throw new Error('Canonical Store content cannot use managed structured merge.');
  }
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
      const layoutKind = change.deploymentKind;
      if (change.change === 'add') {
        if (deployPathExists(change.targetPath)) throw new StaleDeployPlanError('A selected add target appeared during backup.');
        return {
          changeId: change.id,
          action: change.change,
          originalPath: change.targetPath,
          layoutKind,
        };
      }
      const relativeBackupPath = path.join('files', `${index}-${path.basename(change.targetPath)}`);
      const copiedPath = path.join(backupPath, relativeBackupPath);
      const node = backupDeployNode(change.targetPath, copiedPath, copyFile);
      if (node.beforeHash === undefined
        || hashDeviceTopologyNode(change.targetPath) !== expected) {
        throw new StaleDeployPlanError('A selected target changed while its backup was being verified.');
      }
      if (node.nodeKind === 'file' && hashFile(copiedPath) !== node.beforeHash) {
        throw new StaleDeployPlanError('A selected target changed while its backup was being verified.');
      }
      if (node.nodeKind === 'directory'
        && hashDirectoryTree(copiedPath) !== hashDirectoryTree(change.targetPath)) {
        throw new StaleDeployPlanError('A selected target changed while its backup was being verified.');
      }
      return {
        changeId: change.id,
        action: change.change,
        originalPath: change.targetPath,
        backupPath: relativeBackupPath,
        beforeHash: node.beforeHash,
        nodeKind: node.nodeKind,
        layoutKind,
        ...(node.linkText !== undefined ? { linkText: node.linkText } : {}),
      };
    });
    const manifest: DeployBackupManifest = {
      createdAt: new Date().toISOString(),
      status: 'pending',
      files,
      scope: plan.scope,
      targetRoot: plan.targetRoot,
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
  for (const [key, expected] of Object.entries(plan.preconditions)) {
    if (!key.startsWith('external-store:')) continue;
    const storePath = key.slice('external-store:'.length);
    if (hashExternalStorePackage(storePath) !== expected) {
      throw new StaleDeployPlanError('An external Store package changed after the Plan was reviewed.');
    }
  }
  const repositoryHash = plan.repositoryPath ? hashRepositoryInputs(plan.repositoryPath) : undefined;
  const inventory = readState(context).managedInventory ?? {};
  for (const change of changes) {
    const targetHash = hashDeviceTopologyNode(change.targetPath);
    const sourceHash = change.change === 'delete' && inventory[change.targetPath] !== undefined
      ? hashText(stableValue(inventory[change.targetPath]))
      : repositoryHash;
    if (targetHash !== plan.preconditions[`target:${change.id}`]
      || sourceHash !== plan.preconditions[`source:${change.id}`]) {
      throw new StaleDeployPlanError('Deploy source or target state changed after the Plan was reviewed.');
    }
  }
}

function hashExternalStorePackage(storePath: string): string {
  if (!deployPathExists(storePath)) return hashText('<missing-external-store>');
  try {
    return hashText(stableValue([
      hashDeviceTopologyNode(storePath),
      hashDirectoryTree(storePath),
    ]));
  } catch {
    return hashText('<unreadable-external-store>');
  }
}

function applyPreparedDeployWrites(
  writes: PreparedDeployWrite[],
  backupPath: string,
  writeFile: (targetPath: string, content: Buffer) => void,
  removeFile: (targetPath: string) => void,
  restoreFile: (targetPath: string, content: Buffer) => void,
  createSymbolicLink: (target: string, linkPath: string) => void,
  commit: () => void,
): void {
  const attemptedPaths = new Set<string>();
  const createdDirectories = new Set<string>();
  try {
    for (const write of writes) {
      for (const directory of missingParentDirectories(write.targetPath)) {
        createdDirectories.add(directory);
      }
      if (write.change === 'delete') {
        attemptedPaths.add(write.targetPath);
        removeFile(write.targetPath);
      }
      else if (write.change === 'migrate-link') {
        attemptedPaths.add(write.targetPath);
        removeFile(write.targetPath);
        fs.mkdirSync(path.dirname(write.targetPath), { recursive: true });
        createSymbolicLink(write.linkTarget as string, write.targetPath);
        verifyManagedProjection(write.targetPath, write.linkTarget as string);
      }
      else if (write.change === 'link') {
        fs.mkdirSync(path.dirname(write.targetPath), { recursive: true });
        createSymbolicLink(write.linkTarget as string, write.targetPath);
        attemptedPaths.add(write.targetPath);
        verifyManagedProjection(write.targetPath, write.linkTarget as string);
      }
      else if (write.change === 'replace-directory') {
        attemptedPaths.add(write.targetPath);
        removeFile(write.targetPath);
        fs.mkdirSync(write.targetPath, { recursive: true });
        for (const file of write.packageFiles ?? []) {
          const targetPath = path.join(write.targetPath, file.relativePath);
          writeFile(targetPath, file.content);
          if (!fs.readFileSync(targetPath).equals(file.content)) {
            throw new Error(`Deploy package write verification failed for ${targetPath}.`);
          }
        }
      }
      else {
        attemptedPaths.add(write.targetPath);
        writeFile(write.targetPath, write.content as Buffer);
        if (!fs.readFileSync(write.targetPath).equals(write.content as Buffer)) {
          throw new Error(`Deploy write verification failed for ${write.targetPath}.`);
        }
      }
    }
    commit();
  } catch (error) {
    const rollbackErrors = rollbackDeployWrites(
      backupPath,
      attemptedPaths,
      createdDirectories,
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
  createdDirectories: Set<string>,
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
      else {
        const sourcePath = path.join(backupPath, entry.backupPath);
        if (entry.nodeKind === 'directory') {
          removeFile(entry.originalPath);
          fs.cpSync(sourcePath, entry.originalPath, { recursive: true, verbatimSymlinks: true });
        } else if (entry.nodeKind === 'symlink') {
          removeFile(entry.originalPath);
          fs.symlinkSync(entry.linkText as string, entry.originalPath, 'dir');
        } else {
          restoreFile(entry.originalPath, fs.readFileSync(sourcePath));
        }
      }
    } catch (error) {
      errors.push(`${entry.originalPath}: ${errorMessage(error)}`);
    }
  }
  for (const directory of [...createdDirectories].sort(
    (left, right) => right.length - left.length,
  )) {
    try {
      fs.rmdirSync(directory);
    } catch (error) {
      if (!isRecord(error) || !['ENOENT', 'ENOTEMPTY'].includes(String(error.code))) {
        errors.push(`${directory}: ${errorMessage(error)}`);
      }
    }
  }
  return errors;
}

function missingParentDirectories(targetPath: string): string[] {
  const missing: string[] = [];
  let current = path.dirname(targetPath);
  while (!deployPathExists(current) && current !== path.dirname(current)) {
    missing.push(current);
    current = path.dirname(current);
  }
  return missing;
}

function finalizeDeployBackup(backupPath: string): void {
  const manifest = readDeployBackupManifest(backupPath);
  for (const entry of manifest.files) {
    if (!deployPathExists(entry.originalPath)) continue;
    const stat = fs.lstatSync(entry.originalPath);
    entry.afterHash = stat.isFile() && !stat.isSymbolicLink()
      ? hashFile(entry.originalPath)
      : hashDeviceTopologyNode(entry.originalPath);
  }
  manifest.status = 'complete';
  manifest.completedAt = new Date().toISOString();
  atomicWriteFile(
    path.join(backupPath, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
}

function backupDeployNode(
  targetPath: string,
  copiedPath: string,
  copyFile: typeof fs.copyFileSync,
): { beforeHash: string; nodeKind: NonNullable<DeployBackupEntry['nodeKind']>; linkText?: string } {
  const stat = fs.lstatSync(targetPath);
  if (stat.isSymbolicLink()) {
    const linkText = fs.readlinkSync(targetPath);
    fs.symlinkSync(linkText, copiedPath, 'dir');
    return {
      beforeHash: hashDeviceTopologyNode(targetPath),
      nodeKind: 'symlink',
      linkText,
    };
  }
  if (stat.isDirectory()) {
    fs.cpSync(targetPath, copiedPath, { recursive: true, verbatimSymlinks: true });
    return {
      beforeHash: hashDirectoryTree(targetPath),
      nodeKind: 'directory',
    };
  }
  copyFile(targetPath, copiedPath);
  return {
    beforeHash: hashFile(targetPath),
    nodeKind: 'file',
  };
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
  updateState: (context: DeviceContext, state: McvState) => void = writeState,
): void {
  const state = readState(context);
  const baselineFiles = { ...(state.baselineSnapshot?.files ?? {}) };
  const managedInventory = {
    ...(mapManagedInventoryToGlobalScope(state.managedInventory) ?? {}),
  };
  const managedSkillLayout = {
    packages: { ...(state.managedSkillLayout?.packages ?? {}) },
    projections: { ...(state.managedSkillLayout?.projections ?? {}) },
  };
  const touchedPackages = new Set<string>();
  for (const change of changes) {
    if (change.change === 'delete' || !deployPathExists(change.targetPath)) {
      delete baselineFiles[change.targetPath];
      delete managedInventory[change.targetPath];
      if (change.deploymentKind === 'managed-link-projection'
        || change.deploymentKind === 'topology-migration') {
        delete managedSkillLayout.projections[change.targetPath];
      }
      if (change.deploymentKind === 'physical-materialization') {
        const storePath = resolveSkillPackageStorePath(change.targetPath);
        touchedPackages.add(storePath);
        for (const inventoryPath of Object.keys(managedInventory)) {
          if (isPathUnderRoot(inventoryPath, storePath)) delete managedInventory[inventoryPath];
        }
        for (const baselinePath of Object.keys(baselineFiles)) {
          if (isPathUnderRoot(baselinePath, storePath)) delete baselineFiles[baselinePath];
        }
        if (!deployPathExists(storePath)) delete managedSkillLayout.packages[storePath];
      }
    } else {
      const hash = hashDeviceTopologyNode(change.targetPath);
      baselineFiles[change.targetPath] = hash;
      managedInventory[change.targetPath] = { source: repositoryPath, hash, scope: 'global' };
      if (change.deploymentKind === 'physical-materialization') {
        touchedPackages.add(resolveSkillPackageStorePath(change.targetPath));
      }
      if ((change.deploymentKind === 'managed-link-projection'
        || change.deploymentKind === 'topology-migration'
        || change.deploymentKind === 'external-link-replacement')
        && change.owner === 'ide'
        && change.preview.kind === 'link') {
        managedSkillLayout.projections[change.targetPath] = {
          packageName: change.name,
          projectionPath: change.targetPath,
          ide: change.ide,
          surface: change.surface!,
          expectedLinkTarget: change.preview.linkTarget,
          topologyHash: hash,
          source: repositoryPath,
        };
      }
    }
  }
  for (const storePath of touchedPackages) {
    if (!deployPathExists(storePath)) {
      delete managedSkillLayout.packages[storePath];
      continue;
    }
    managedSkillLayout.packages[storePath] = {
      packageName: canonicalSkillPackageName(storePath),
      storePath,
      contentHash: hashSkillPackageContent(storePath),
      topologyHash: hashDeviceTopologyNode(storePath),
      source: repositoryPath,
    };
  }
  const lastDeploySelection: NonNullable<typeof state.lastDeploySelection> = {};
  for (const change of changes) {
    if (change.owner === 'canonical-store') continue;
    const selectionIde = deploySelectionIde(change.ide);
    const capabilities = lastDeploySelection[selectionIde] ?? [];
    if (!capabilities.includes(change.capability)) capabilities.push(change.capability);
    lastDeploySelection[selectionIde] = capabilities;
  }
  state.baselineSnapshot = { recordedAt: new Date().toISOString(), files: baselineFiles };
  state.managedInventory = managedInventory;
  state.schemaVersion = CURRENT_DEVICE_STATE_SCHEMA_VERSION;
  if (Object.keys(managedSkillLayout.packages).length > 0
    || Object.keys(managedSkillLayout.projections).length > 0) {
    state.managedSkillLayout = managedSkillLayout;
  } else {
    delete state.managedSkillLayout;
  }
  state.lastDeploySelection = lastDeploySelection;
  state.lastOperation = { kind: 'deploy', time: new Date().toISOString(), success: true };
  updateState(context, state);
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

function deployContextFromPlan(plan: DeployPlan): Partial<DeployContextFields> {
  return deployContextFieldsFromRequest(deployRequestFromPlan(plan));
}

function failedDeployResult(
  repositoryPath: string | null,
  error: McvError,
  issues: Issue[] = [{ severity: 'error', code: error.code, message: error.message }],
  context?: Partial<DeployContextFields>,
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
    ...context,
  };
}

function blockedDeployResult(plan: DeployPlan, issues: Issue[]): DeployResult {
  return {
    schemaVersion: OPERATION_SCHEMA_VERSION,
    operation: 'deploy',
    status: 'blocked',
    repositoryPath: plan.repositoryPath,
    changes: [],
    linkOutcomes: plan.linkOutcomes,
    linkFacts: plan.linkFacts,
    issues,
    nextActions: issues.some((issue) => issue.severity === 'warning')
      ? ['Confirm every warning explicitly before applying the Deploy Plan.']
      : ['Review and resolve the Deploy Plan interactively before applying it.'],
    scope: plan.scope,
    targetRoot: plan.targetRoot,
    profileIds: plan.profileIds,
    profilesRevision: plan.profilesRevision,
    catalogRevision: plan.catalogRevision,
    assetIds: plan.assetIds,
  };
}

function freezeDeployPlan(plan: DeployPlan): DeployPlan {
  for (const change of plan.changes) {
    Object.freeze(change.preview);
    Object.freeze(change);
  }
  Object.freeze(plan.changes);
  for (const outcome of plan.linkOutcomes) {
    Object.freeze(outcome.packageNames);
    Object.freeze(outcome.linkPaths);
    if (outcome.resolvedPaths) Object.freeze(outcome.resolvedPaths);
    Object.freeze(outcome);
  }
  Object.freeze(plan.linkOutcomes);
  for (const fact of plan.linkFacts) {
    Object.freeze(fact.packageNames);
    Object.freeze(fact.linkPaths);
    if (fact.resolvedPaths) Object.freeze(fact.resolvedPaths);
    Object.freeze(fact.surfaces);
    Object.freeze(fact);
  }
  Object.freeze(plan.linkFacts);
  for (const decision of plan.decisions) {
    Object.freeze(decision.packageNames);
    Object.freeze(decision.linkPaths);
    Object.freeze(decision.choices);
    Object.freeze(decision.replacementChangeIds);
    Object.freeze(decision);
  }
  Object.freeze(plan.decisions);
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
  ide: string,
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
  return { targetPath, kind: 'text', bytes: metadata.length, sha256: hashBuffer(metadata), diff };
}

function renderSafeDiff(
  targetPath: string,
  ide: string,
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

const MCP_PATH_BY_IDE: Partial<Record<DeployIde, string>> = {
  codex: CODEX_MCP_PATH,
  'claude-code': CLAUDE_CODE_MCP_PATH,
  gemini: GEMINI_MCP_PATH,
};

function managedTopLevelKey(ide: string): string {
  const managedPath = MCP_PATH_BY_IDE[ide as DeployIde];
  if (!managedPath) throw new Error(`${ide} does not have a managed structured path.`);
  return managedPath.slice(2);
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
  if (normalized.includes('/skills/')) {
    return { capabilities: ['skills'], strategy: 'replace-entire-file' };
  }
  if (base === 'agents.md' || base === 'claude.md' || base === 'gemini.md') {
    return { capabilities: ['rules'], strategy: 'replace-entire-file' };
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

function deployChangeTarget(
  target: CanonicalSkillTarget,
  capability: ConfigurationCapability,
): DeployChangeTarget {
  if (target.owner === 'canonical-store') {
    if (capability !== 'skills') {
      throw new Error('Canonical Store changes must use the Skills capability.');
    }
    return { owner: 'canonical-store', capability: 'skills' };
  }
  if (capability === 'skills') {
    if (!target.surface) throw new Error(`Skill change for ${target.ide} is missing its Surface.`);
    return { owner: 'ide', ide: target.ide, surface: target.surface, capability: 'skills' };
  }
  return { owner: 'ide', ide: target.ide, capability };
}

function verifyManagedProjection(linkPath: string, expectedTarget: string): void {
  const stat = fs.lstatSync(linkPath);
  if (!stat.isSymbolicLink()) {
    throw new Error(`Deploy link verification failed: ${linkPath} is not a symbolic link.`);
  }
  const rawTarget = fs.readlinkSync(linkPath);
  const resolvedRawTarget = path.resolve(path.dirname(linkPath), rawTarget);
  if (resolvedRawTarget !== path.resolve(expectedTarget)) {
    throw new Error(`Deploy link verification failed: ${linkPath} targets ${rawTarget}, expected ${expectedTarget}.`);
  }
  if (fs.realpathSync(linkPath) !== fs.realpathSync(expectedTarget)) {
    throw new Error(`Deploy link verification failed: ${linkPath} does not resolve to ${expectedTarget}.`);
  }
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

function asProjectRulesFileName(relativePath: string): ProjectRulesFileName | undefined {
  const normalized = relativePath.split(path.sep).join('/');
  if (normalized === 'AGENTS.md' || normalized === 'CLAUDE.md' || normalized === 'GEMINI.md') {
    return normalized;
  }
  return undefined;
}

function appendManagedReceiptChange(
  request: DeployRequest,
  repositoryId: string,
  receiptEntries: Map<string, { assetId: string; hash: string }>,
  changes: DeployChange[],
  mutations: Map<string, DeployMutation>,
  issues: Issue[],
): void {
  if (request.scope !== 'project' || receiptEntries.size === 0) return;
  const rulesWritten = changes.some((change) =>
    asProjectRulesFileName(path.relative(request.targetRoot, change.targetPath)) !== undefined);
  if (!rulesWritten) return;

  const existing = readManagedReceipt(request.targetRoot);
  const next: ManagedReceipt = {
    schemaVersion: 1,
    repositoryId,
    managed: { ...(existing?.managed ?? {}) },
  };
  for (const [key, entry] of receiptEntries) {
    next.managed[key] = entry;
  }
  const receiptPath = managedReceiptPath(request.targetRoot);
  try {
    assertPathContainedInProjectRoot(request.targetRoot, receiptPath);
  } catch (error) {
    issues.push({
      severity: 'error',
      code: 'deploy.containmentFailed',
      message: errorMessage(error),
    });
    return;
  }
  const nextContent = Buffer.from(`${JSON.stringify(next, null, 2)}\n`, 'utf8');
  const previous = fs.existsSync(receiptPath) ? fs.readFileSync(receiptPath) : undefined;
  if (previous?.equals(nextContent)) return;

  const id = selectionId('project', 'native', receiptPath);
  mutations.set(id, { content: nextContent });
  changes.push({
    id,
    owner: 'ide',
    ide: 'codex',
    capability: 'native',
    name: 'Managed Receipt',
    targetPath: receiptPath,
    change: previous === undefined ? 'add' : 'modify',
    defaultSelected: true,
    group: 'standard',
    strategy: 'replace-entire-file',
    deploymentKind: 'ordinary-file',
    preview: {
      targetPath: receiptPath,
      kind: 'text',
      bytes: nextContent.byteLength,
      sha256: hashBuffer(nextContent),
      diff: previous === undefined
        ? `--- /dev/null\n+++ ${receiptPath}\n${nextContent.toString('utf8')}`
        : `Update Managed Receipt at ${receiptPath}`,
    },
  });
}

function compareChanges(left: DeployChange, right: DeployChange): number {
  const groupOrder = { standard: 0, advanced: 1 } as const;
  const capabilityOrder: Record<ConfigurationCapability, number> = {
    rules: 0, skills: 1, mcp: 2, native: 3,
  };
  return groupOrder[left.group] - groupOrder[right.group]
    || canonicalSkillTargetKey(left).localeCompare(canonicalSkillTargetKey(right))
    || capabilityOrder[left.capability] - capabilityOrder[right.capability]
    || left.targetPath.localeCompare(right.targetPath);
}

function ideName(targetId: TargetId): IdeId {
  if (targetId === 'claudeCode') return 'claude-code';
  return targetId;
}

function targetIdForIde(
  ide: IdeId,
): TargetId {
  if (ide === 'claude-code') return 'claudeCode';
  return ide;
}

function deploySelectionIde(
  ide: IdeId,
): IdeId {
  return ide;
}

function inferDeployTarget(
  targetPath: string,
  context: DeviceContext,
): CanonicalSkillTarget | undefined {
  const resolved = path.resolve(targetPath);
  const roots: Array<[CanonicalSkillTarget, string]> = [
    [{ owner: 'ide', ide: 'codex', surface: 'codex' }, path.resolve(context.env.CODEX_HOME || path.join(context.homeDir, '.codex'), 'skills')],
    [{ owner: 'ide', ide: 'codex' }, path.resolve(context.env.CODEX_HOME || path.join(context.homeDir, '.codex'))],
    [{ owner: 'canonical-store' }, path.resolve(context.homeDir, '.agents', 'skills')],
    [{ owner: 'ide', ide: 'claude-code', surface: 'claude-code' }, path.resolve(context.env.CLAUDE_CONFIG_DIR || path.join(context.homeDir, '.claude'), 'skills')],
    [{ owner: 'ide', ide: 'claude-code' }, path.resolve(context.env.CLAUDE_CONFIG_DIR || path.join(context.homeDir, '.claude'))],
    [{ owner: 'ide', ide: 'claude-code' }, path.resolve(context.homeDir, '.claude.json')],
    [{ owner: 'ide', ide: 'gemini', surface: 'gemini-cli' }, path.resolve(context.homeDir, '.gemini', 'skills')],
    [{ owner: 'ide', ide: 'gemini', surface: 'antigravity' }, path.resolve(context.homeDir, '.gemini', 'config', 'skills')],
    [{ owner: 'ide', ide: 'gemini' }, path.resolve(context.homeDir, '.gemini')],
  ];
  return roots.find(([, root]) => resolved === root || resolved.startsWith(`${root}${path.sep}`))?.[0];
}

function isPathUnderRoot(candidate: string, root: string): boolean {
  const resolvedCandidate = path.resolve(candidate);
  const resolvedRoot = path.resolve(root);
  if (resolvedCandidate === resolvedRoot) return true;
  const relative = path.relative(resolvedRoot, resolvedCandidate);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function isPathUnderAnyRoot(candidate: string, roots: string[]): boolean {
  return roots.some((root) => isPathUnderRoot(candidate, root));
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
