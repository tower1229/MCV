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
import { parseAssetId } from '../assets/ids.js';
import { GLOBAL_PROFILE_ID } from '../profiles/contracts.js';
import { resolveProfiles } from '../profiles/resolver.js';
import {
  atomicWriteFile,
  findSymbolicLinkAncestor,
  hashDirectoryTree,
  hashFile,
} from '../utils/files.js';
import { isRecord } from '../utils/objects.js';
import {
  acquireOperationLock,
  deployOperationLockResource,
  OperationLockBusyError,
  releaseOperationLock,
  type OperationLockHandle,
} from '../utils/operation-lock.js';
import { readManifest, resolveBoundRepository, type McvManifest } from '../utils/repository.js';
import type { OperationProgressOptions, OperationProgressReporter } from './progress.js';
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
  LEGACY_RULES_ASSET_ID,
  projectIdeInstructionsFile,
  type ProjectInstructionsFileName,
} from '../core/project-rules.js';
import {
  extractManagedBlock,
  hashManagedBlockBody,
  managedReceiptKey,
  removeManagedBlock,
} from '../core/managed-block.js';
import {
  projectSkillDestinationRoots,
  projectSkillPackage,
  type ProjectSkillRelativeRoot,
} from '../core/project-skills.js';
import {
  hashProjectMcpServerValue,
  overlayProjectMcpFile,
  projectMcpDestinationTargets,
  projectMcpServer,
  removeProjectMcpServers,
  type ProjectMcpTarget,
} from '../core/project-mcp.js';
import { toNativeMcpServers } from '../core/mcp.js';
import {
  managedReceiptPath,
  parseManagedReceipt,
  readManagedReceipt,
  serializeManagedReceipt,
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
  | 'external-link-replacement'
  | 'project-skill-package'
  | 'project-mcp-overlay'
  | 'project-managed-prune';

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
  kind: 'external-skill-divergence' | 'project-skill-divergence' | 'project-mcp-divergence';
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
  pruneManaged?: boolean;
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
  onProgress?: OperationProgressReporter;
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

/** @deprecated Skills project projection is active; retained for older test imports. */
export const PROJECT_SKILL_PROJECTION_PENDING_CODE = 'deploy.projectSkillProjectionPending' as const;
export const PROJECT_SCOPE_UNSUPPORTED_CODE = 'deploy.projectScopeUnsupported' as const;

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
  mcpOverlay?: {
    target: ProjectMcpTarget;
    serversToWrite: Record<string, Record<string, unknown>>;
  };
  mcpPrune?: {
    target: ProjectMcpTarget;
    serverNames: string[];
  };
  receiptKey?: string;
  receiptEntry?: { assetId: string; hash: string };
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
  options: OperationProgressOptions = {},
): Promise<DeployPlan> {
  options.onProgress?.('inspecting-repository');
  const operationId = uuidv4();
  const contextFields = deployContextFieldsFromRequest(request);
  let repositoryPath: string | null = null;
  try {
    repositoryPath = resolveBoundRepository(context);
    options.onProgress?.('scanning-adapters');
    const mutations = new Map<string, DeployMutation>();
    options.onProgress?.('building-plan');
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
  for (const assetId of activeRequest.selection.assetIds) {
    const parsed = parseAssetId(assetId);
    if (parsed.type !== 'instruction') continue;
    const enabled = parsed.target === 'claude-code'
      ? manifest.targets.claudeCode.enabled
      : manifest.targets[parsed.target].enabled;
    if (!enabled) {
      selectionIssues.push({
        severity: 'notice',
        code: 'deploy.instructionTargetDisabled',
        message: `Asset ${assetId} was skipped because its IDE target is disabled.`,
      });
    }
  }
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
  const prunedReceiptKeys = new Set<string>();
  const projectSkillChanges: DeployChange[] = [];
  const projectSkillDecisions: DeployDecision[] = [];
  const projectMcpChanges: DeployChange[] = [];
  const projectMcpDecisions: DeployDecision[] = [];
  const projectPruneChanges: DeployChange[] = [];
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
        pruneManaged: activeRequest.pruneManaged === true,
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
        const instructionsName = asProjectInstructionsFileName(relative);
        const instructionIde = ideName(definition.targetId);
        const instructions = selectedView.instructions[instructionIde];
        if (instructionsName && instructions) {
          const projection = projectIdeInstructionsFile(
            activeRequest.targetRoot,
            instructionsName,
            instructions.id,
            instructions.content,
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
              assetId: instructions.id,
              hash: projection.bodyHash,
            });
            if (projection.migratedReceiptKey) prunedReceiptKeys.add(projection.migratedReceiptKey);
            return [];
          }
          receiptEntries.set(projection.receiptKey, {
            assetId: instructions.id,
            hash: projection.bodyHash,
          });
          if (projection.migratedReceiptKey) prunedReceiptKeys.add(projection.migratedReceiptKey);
          return [{
            targetPath: projection.targetPath,
            content: projection.content,
            owner: 'ide' as const,
            ide: ideName(definition.targetId),
            capability: 'instructions' as const,
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

    appendProjectSkillPlan(
      activeRequest.targetRoot,
      selectedView.skills,
      manifest,
      receipt,
      receiptEntries,
      projectSkillChanges,
      projectSkillDecisions,
      mutations,
      selectionIssues,
    );

    appendProjectMcpPlan(
      activeRequest.targetRoot,
      selectedView.mcpServers,
      selectedView.mcpOverrides,
      manifest,
      receipt,
      receiptEntries,
      projectMcpChanges,
      projectMcpDecisions,
      mutations,
      selectionIssues,
    );

    if (activeRequest.pruneManaged === true) {
      appendProjectManagedPrunePlan(
        activeRequest.targetRoot,
        receipt,
        receiptEntries,
        prunedReceiptKeys,
        projectPruneChanges,
        mutations,
        selectionIssues,
      );
    }

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
  const decisions = [
    ...addExternalLinkReplacementDecisions(
      linkedSkills.facts,
      linkedSkills.outcomes,
      layout.desiredForExternalReplacement,
      manifest.deploy.useSymlinks,
      context,
      changes,
      mutations,
      issues,
    ),
    ...projectSkillDecisions,
    ...projectMcpDecisions,
  ];
  changes.push(...projectSkillChanges);
  changes.push(...projectMcpChanges);
  changes.push(...projectPruneChanges);

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
    prunedReceiptKeys,
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
    pruneManaged: activeRequest.pruneManaged === true,
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
    const managedSelected = plan.changes.some((change) =>
      selected.has(change.id)
      && (asProjectInstructionsFileName(path.relative(plan.targetRoot, change.targetPath)) !== undefined
        || change.deploymentKind === 'project-skill-package'
        || change.deploymentKind === 'project-mcp-overlay'
        || change.deploymentKind === 'project-managed-prune'));
    if (receiptChange && managedSelected && !selected.has(receiptChange.id)) {
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
    if (decision.kind === 'project-mcp-divergence') {
      // Preserve may keep the file change selected so non-conflicting server keys still deploy.
      if (choice === 'replace-with-repository' && !replacementSelected) {
        return failedDeployResult(plan.repositoryPath, {
          code: 'deploy.invalidSelection',
          message: 'The selected project MCP decision does not match its replacement changes.',
          nextActions: ['Regenerate the Deploy Plan and choose Preserve or Replace again.'],
        });
      }
      continue;
    }
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
  const repositoryPath = plan.repositoryPath;

  let lock: OperationLockHandle;
  try {
    lock = acquireOperationLock(deployOperationLockResource(plan.scope, plan.targetRoot));
  } catch (error) {
    if (!(error instanceof OperationLockBusyError)) throw error;
    activeDeployPlans.delete(plan);
    return failedDeployResult(plan.repositoryPath, {
      code: 'deploy.targetBusy',
      message: 'Another MCV process is modifying this Deploy target; generate a new Deploy Plan and retry shortly.',
      nextActions: ['Wait for the other MCV operation to finish, then generate and review a new Deploy Plan.'],
    }, undefined, deployContextFromPlan(plan));
  }

  try {
    return await applyDeployPlanWhileLocked(
      context,
      plan,
      repositoryPath,
      selection,
      options,
      active,
      selected,
      selectedIds,
    );
  } finally {
    releaseOperationLock(lock);
  }
}

async function applyDeployPlanWhileLocked(
  context: DeviceContext,
  plan: DeployPlan,
  repositoryPath: string,
  selection: DeploySelection,
  options: DeployApplyOptions,
  active: ActiveDeployPlan,
  selected: Set<string>,
  selectedIds: string[],
): Promise<DeployResult> {
  let freshPlan: DeployPlan;
  try {
    freshPlan = await buildDeployPlan(
      context,
      repositoryPath,
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

  applyProjectSkillReceiptDecisions(plan, selection, selected, selectedIds, active.mutations);
  applyProjectMcpOverlayDecisions(plan, selection, selected, selectedIds, active.mutations);
  applyProjectPruneReceiptDecisions(plan, selected, selectedIds, active.mutations);
  const selectedChanges = plan.changes.filter((change) => selected.has(change.id));
  const prepared = prepareDeployWrites(selectedChanges, active.mutations);
  if (selectedChanges.length === 0) {
    try {
      if (plan.scope !== 'project') {
        updateDeployState(context, repositoryPath, selectedChanges, options.updateState);
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
      nextActions: ['Run `mcv status` to verify the deployed environment.'],
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
    options.onProgress?.('creating-verified-backup');
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
    options.onProgress?.('applying-selected-changes');
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
            repositoryPath,
            selectedChanges,
            options.updateState,
          );
        }
      },
    );
    activeDeployPlans.delete(plan);
    options.onProgress?.('verifying-result');
    return {
      schemaVersion: OPERATION_SCHEMA_VERSION,
      operation: 'deploy',
      status: 'succeeded',
      repositoryPath: plan.repositoryPath,
      changes: selectedChanges,
      issues: [],
      nextActions: ['Run `mcv status` to verify the deployed environment.'],
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
    options.onProgress?.('rolling-back');
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
        change.change === 'delete'
        || change.deploymentKind === 'topology-migration'
        || change.deploymentKind === 'project-managed-prune');
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
    pruneManaged: plan.pruneManaged === true,
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
    const mcpPruneChanges = targetChanges.filter((change) =>
      mutations.get(change.id)?.mcpPrune !== undefined);
    if (mcpPruneChanges.length > 0) {
      const serverNames = [...new Set(mcpPruneChanges.flatMap((change) =>
        mutations.get(change.id)?.mcpPrune?.serverNames ?? []))];
      const target = mutations.get(mcpPruneChanges[0].id)?.mcpPrune?.target;
      if (!target) throw new Error(`Missing active Deploy MCP prune mutation for ${targetPath}.`);
      const existing = fs.existsSync(targetPath) ? fs.readFileSync(targetPath, 'utf8') : '';
      return {
        targetPath,
        change: 'write' as const,
        content: Buffer.from(removeProjectMcpServers(existing, target, serverNames), 'utf8'),
      };
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
    if (targetChanges.some((change) =>
      change.deploymentKind === 'external-link-replacement'
      || change.deploymentKind === 'project-skill-package')) {
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
  if (next.length === 0 || capability === 'instructions' || capability === 'skills') {
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
    return { capabilities: ['instructions'], strategy: 'replace-entire-file' };
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
  if (capability === 'instructions') return `${instructionDisplayNameFromPath(targetPath)} Instructions`;
  if (capability === 'skills') {
    const segments = targetPath.replace(/\\/g, '/').split('/');
    const skillIndex = segments.lastIndexOf('skills');
    return segments[skillIndex + 1] ?? path.basename(targetPath);
  }
  if (capability === 'mcp') return 'MCP';
  return path.basename(targetPath);
}

function asProjectInstructionsFileName(relativePath: string): ProjectInstructionsFileName | undefined {
  const normalized = relativePath.split(path.sep).join('/');
  if (normalized === 'AGENTS.md' || normalized === 'CLAUDE.md' || normalized === 'GEMINI.md') {
    return normalized;
  }
  return undefined;
}

function ideForProjectInstructionsFile(
  fileName: ProjectInstructionsFileName,
): IdeId {
  if (fileName === 'CLAUDE.md') return 'claude-code';
  if (fileName === 'GEMINI.md') return 'gemini';
  return 'codex';
}

function instructionDisplayNameFromPath(targetPath: string): string {
  const name = path.basename(targetPath);
  if (name === 'CLAUDE.md') return 'Claude Code';
  if (name === 'GEMINI.md') return 'Gemini';
  return 'Codex';
}

function appendManagedReceiptChange(
  request: DeployRequest,
  repositoryId: string,
  receiptEntries: Map<string, { assetId: string; hash: string }>,
  prunedReceiptKeys: Set<string>,
  changes: DeployChange[],
  mutations: Map<string, DeployMutation>,
  issues: Issue[],
): void {
  if (request.scope !== 'project') return;
  if (receiptEntries.size === 0 && prunedReceiptKeys.size === 0) return;

  const existing = readManagedReceipt(request.targetRoot);
  const next: ManagedReceipt = {
    schemaVersion: 1,
    repositoryId,
    managed: { ...(existing?.managed ?? {}) },
  };
  for (const [key, entry] of receiptEntries) {
    next.managed[key] = entry;
  }
  for (const key of prunedReceiptKeys) {
    delete next.managed[key];
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
  const nextContent = Buffer.from(serializeManagedReceipt(next), 'utf8');
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

function appendProjectManagedPrunePlan(
  targetRoot: string,
  receipt: ManagedReceipt | undefined,
  receiptEntries: Map<string, { assetId: string; hash: string }>,
  prunedReceiptKeys: Set<string>,
  changes: DeployChange[],
  mutations: Map<string, DeployMutation>,
  issues: Issue[],
): void {
  if (!receipt) return;

  const mcpTargets = new Map(
    projectMcpDestinationTargets({
      codex: true,
      claudeCode: true,
      geminiCli: true,
    }).map((target) => [target.relativePath, target]),
  );

  for (const [key, entry] of Object.entries(receipt.managed)) {
    if (receiptEntries.has(key)) continue;
    const parsed = parseManagedReceiptKey(key);
    try {
      if (parsed.assetId === LEGACY_RULES_ASSET_ID
        || parsed.assetId?.startsWith('instruction:')) {
        const instructionsName = asProjectInstructionsFileName(parsed.relativePath);
        if (!instructionsName) continue;
        const targetPath = path.join(targetRoot, instructionsName);
        assertPathContainedInProjectRoot(targetRoot, targetPath);
        if (!fs.existsSync(targetPath)) continue;
        const previous = fs.readFileSync(targetPath, 'utf8');
        const blockAssetId = parsed.assetId;
        const body = extractManagedBlock(previous, blockAssetId);
        if (body === undefined || hashManagedBlockBody(body) !== entry.hash) continue;
        const nextContent = Buffer.from(removeManagedBlock(previous, blockAssetId), 'utf8');
        const instructionIde = ideForProjectInstructionsFile(instructionsName);
        const id = selectionId('project-prune', 'instructions', `${targetPath}\0${key}`);
        mutations.set(id, {
          content: nextContent,
          receiptKey: key,
          receiptEntry: entry,
        });
        changes.push({
          id,
          owner: 'ide',
          ide: instructionIde,
          capability: 'instructions',
          name: displayName(targetPath, 'instructions'),
          targetPath,
          change: 'modify',
          defaultSelected: false,
          group: 'advanced',
          strategy: 'replace-entire-file',
          deploymentKind: 'project-managed-prune',
          preview: preview(
            targetPath,
            instructionIde,
            'instructions',
            nextContent,
            Buffer.from(previous),
            issues,
          ),
        });
        prunedReceiptKeys.add(key);
        continue;
      }

      if (parsed.assetId?.startsWith('mcp:')) {
        const target = mcpTargets.get(parsed.relativePath);
        if (!target) continue;
        const serverName = parsed.assetId.slice('mcp:'.length);
        const targetPath = path.join(targetRoot, ...target.relativePath.split('/'));
        assertPathContainedInProjectRoot(targetRoot, targetPath);
        if (!fs.existsSync(targetPath)) continue;
        let document: Record<string, unknown>;
        try {
          document = parseStructuredObject(
            fs.readFileSync(targetPath, 'utf8'),
            target.format,
            targetPath,
          );
        } catch {
          continue;
        }
        const servers = isRecord(document[target.serversKey])
          ? document[target.serversKey] as Record<string, unknown>
          : undefined;
        if (!servers || !(serverName in servers)) continue;
        if (hashProjectMcpServerValue(servers[serverName]) !== entry.hash) continue;
        const id = selectionId('project-prune', 'mcp', `${targetPath}\0${key}`);
        mutations.set(id, {
          mcpPrune: { target, serverNames: [serverName] },
          receiptKey: key,
          receiptEntry: entry,
        });
        changes.push({
          id,
          owner: 'ide',
          ide: target.ide,
          capability: 'mcp',
          name: serverName,
          targetPath,
          change: 'modify',
          defaultSelected: false,
          group: 'advanced',
          strategy: 'replace-entire-file',
          deploymentKind: 'project-managed-prune',
          preview: {
            targetPath,
            kind: 'text',
            bytes: 0,
            sha256: hashText(`prune-mcp:${serverName}`),
            diff: `Remove MCV-owned MCP server ${serverName} from ${targetPath}`,
          },
        });
        prunedReceiptKeys.add(key);
        continue;
      }

      // Skill package keys are relative paths without an #mcv: suffix.
      if (parsed.assetId !== undefined) continue;
      const targetPath = path.join(targetRoot, ...parsed.relativePath.split('/'));
      assertPathContainedInProjectRoot(targetRoot, targetPath);
      if (!deployPathExists(targetPath)) continue;
      try {
        const stat = fs.lstatSync(targetPath);
        if (stat.isSymbolicLink() || !stat.isDirectory()) continue;
      } catch {
        continue;
      }
      if (hashSkillPackageContent(targetPath) !== entry.hash) continue;
      const id = selectionId('project-prune', 'skills', targetPath);
      mutations.set(id, {
        receiptKey: key,
        receiptEntry: entry,
      });
      changes.push({
        id,
        owner: 'ide',
        ide: parsed.relativePath.startsWith('.claude/') ? 'claude-code' : 'codex',
        surface: parsed.relativePath.startsWith('.claude/') ? 'claude-code' : 'codex',
        capability: 'skills',
        name: path.basename(targetPath),
        targetPath,
        change: 'delete',
        defaultSelected: false,
        group: 'advanced',
        strategy: 'replace-entire-file',
        deploymentKind: 'project-managed-prune',
        preview: {
          targetPath,
          kind: 'text',
          bytes: 0,
          sha256: hashText(`prune-skill:${parsed.relativePath}`),
          diff: `Remove MCV-owned Skill package at ${targetPath}`,
        },
      });
      prunedReceiptKeys.add(key);
    } catch (error) {
      issues.push({
        severity: 'error',
        code: 'deploy.containmentFailed',
        message: errorMessage(error),
      });
    }
  }
}

function parseManagedReceiptKey(key: string): { relativePath: string; assetId?: string } {
  const marker = '#mcv:';
  const index = key.indexOf(marker);
  if (index < 0) return { relativePath: key };
  return {
    relativePath: key.slice(0, index),
    assetId: key.slice(index + marker.length),
  };
}

function updateSelectedManagedReceipt(
  plan: DeployPlan,
  selected: Set<string>,
  selectedIds: string[],
  mutations: Map<string, DeployMutation>,
  update: (receipt: ManagedReceipt) => boolean,
): void {
  if (plan.scope !== 'project') return;
  const receiptChange = plan.changes.find((change) =>
    change.name === 'Managed Receipt'
    && change.targetPath === managedReceiptPath(plan.targetRoot));
  if (!receiptChange) return;
  const receiptMutation = mutations.get(receiptChange.id);
  if (!receiptMutation?.content) return;

  let receipt: ManagedReceipt | undefined;
  try {
    receipt = parseManagedReceipt(JSON.parse(receiptMutation.content.toString('utf8')) as unknown);
  } catch {
    return;
  }
  if (!receipt || !update(receipt)) return;

  const nextContent = Buffer.from(serializeManagedReceipt(receipt), 'utf8');
  const previous = fs.existsSync(receiptChange.targetPath)
    ? fs.readFileSync(receiptChange.targetPath)
    : undefined;
  if (previous?.equals(nextContent)) {
    selected.delete(receiptChange.id);
    const index = selectedIds.indexOf(receiptChange.id);
    if (index >= 0) selectedIds.splice(index, 1);
    return;
  }
  selected.add(receiptChange.id);
  if (!selectedIds.includes(receiptChange.id)) selectedIds.push(receiptChange.id);
  mutations.set(receiptChange.id, { content: nextContent });
}

function applyProjectPruneReceiptDecisions(
  plan: DeployPlan,
  selected: Set<string>,
  selectedIds: string[],
  mutations: Map<string, DeployMutation>,
): void {
  updateSelectedManagedReceipt(plan, selected, selectedIds, mutations, (receipt) => {
    let changed = false;
    for (const change of plan.changes) {
      if (change.deploymentKind !== 'project-managed-prune') continue;
      const mutation = mutations.get(change.id);
      if (!mutation?.receiptKey || !mutation.receiptEntry || selected.has(change.id)) continue;
      receipt.managed[mutation.receiptKey] = mutation.receiptEntry;
      changed = true;
    }
    return changed;
  });
}

function appendProjectSkillPlan(
  targetRoot: string,
  skills: Array<{ id: string; name: string; files: Array<{ relativePath: string; content: Buffer }> }>,
  manifest: McvManifest,
  receipt: ManagedReceipt | undefined,
  receiptEntries: Map<string, { assetId: string; hash: string }>,
  changes: DeployChange[],
  decisions: DeployDecision[],
  mutations: Map<string, DeployMutation>,
  issues: Issue[],
): void {
  if (skills.length === 0) return;
  const roots = projectSkillDestinationRoots({
    codex: manifest.targets.codex.enabled,
    claudeCode: manifest.targets.claudeCode.enabled,
    geminiCli: manifest.targets.gemini.enabled
      && manifest.targets.gemini.surfaces.geminiCli !== false,
  });
  if (roots.length === 0) return;

  for (const skill of skills) {
    for (const relativeRoot of roots) {
      let projection;
      try {
        projection = projectSkillPackage(targetRoot, relativeRoot, skill, receipt);
      } catch (error) {
        issues.push({
          severity: 'error',
          code: 'deploy.containmentFailed',
          message: errorMessage(error),
        });
        continue;
      }

      receiptEntries.set(projection.receiptKey, {
        assetId: projection.assetId,
        hash: projection.packageHash,
      });

      if (projection.status === 'identical') continue;

      const owner = projectSkillOwner(relativeRoot, manifest);
      const id = selectionId(canonicalSkillTargetKey(owner), 'skills', projection.targetPath);
      const packageFiles = projection.files.map((file) => ({
        relativePath: file.relativePath,
        content: file.content,
      }));
      const packageChange: DeployChange = {
        id,
        ...owner,
        capability: 'skills',
        name: skill.name,
        targetPath: projection.targetPath,
        change: projection.status === 'absent' ? 'add' : 'modify',
        defaultSelected: projection.status !== 'conflict',
        group: 'standard',
        strategy: 'replace-entire-file',
        deploymentKind: 'project-skill-package',
        preview: {
          targetPath: projection.targetPath,
          kind: 'package',
          files: packageFiles.map((file) => {
            const filePath = path.join(projection.targetPath, file.relativePath);
            const previous = fs.existsSync(filePath) ? fs.readFileSync(filePath) : undefined;
            const item = preview(
              filePath,
              canonicalSkillTargetKey(owner),
              'skills',
              file.content,
              previous,
              issues,
            );
            return item.kind === 'text' || item.kind === 'binary'
              ? item
              : {
                targetPath: filePath,
                kind: 'binary' as const,
                bytes: file.content.byteLength,
                sha256: hashBuffer(file.content),
              };
          }),
        },
      };

      if (projection.status === 'conflict') {
        const decisionId = selectionId(
          canonicalSkillTargetKey(owner),
          'skills',
          `${projection.targetPath}\0project-skill-divergence`,
        );
        decisions.push({
          id: decisionId,
          factId: decisionId,
          kind: 'project-skill-divergence',
          packageNames: [skill.name],
          linkPaths: [projection.targetPath],
          choices: ['preserve-external', 'replace-with-repository'],
          replacementChangeIds: [id],
        });
        issues.push({
          severity: 'decisionRequired',
          code: 'deploy.projectSkillDivergence',
          decisionId,
          message: `Unknown or divergent project Skill package blocks silent overwrite: ${projection.targetPath}`,
          details: 'Choose Preserve to keep the local package, or Replace to copy the Repository Skill package.',
        });
        mutations.set(id, { packageFiles });
        changes.push(packageChange);
        continue;
      }

      mutations.set(id, { packageFiles });
      changes.push(packageChange);
    }
  }
}

function appendProjectMcpPlan(
  targetRoot: string,
  mcpServers: Record<string, unknown>,
  mcpOverrides: Record<string, Record<string, unknown>>,
  manifest: McvManifest,
  receipt: ManagedReceipt | undefined,
  receiptEntries: Map<string, { assetId: string; hash: string }>,
  changes: DeployChange[],
  decisions: DeployDecision[],
  mutations: Map<string, DeployMutation>,
  issues: Issue[],
): void {
  const serverNames = Object.keys(mcpServers).sort((left, right) => left.localeCompare(right));
  if (serverNames.length === 0) return;

  if (manifest.targets.gemini.enabled
    && manifest.targets.gemini.surfaces.antigravity !== false) {
    issues.push({
      severity: 'notice',
      code: PROJECT_SCOPE_UNSUPPORTED_CODE,
      message: 'Antigravity does not support project-scope MCP; existing global projection is unchanged.',
    });
  }

  const targets = projectMcpDestinationTargets({
    codex: manifest.targets.codex.enabled,
    claudeCode: manifest.targets.claudeCode.enabled,
    geminiCli: manifest.targets.gemini.enabled
      && manifest.targets.gemini.surfaces.geminiCli !== false,
  });
  if (targets.length === 0) return;

  for (const target of targets) {
    const serversToWrite: Record<string, Record<string, unknown>> = {};
    const conflictNames: string[] = [];
    let fileExisted = false;
    const targetPath = path.join(targetRoot, ...target.relativePath.split('/'));

    for (const name of serverNames) {
      const native = toNativeMcpServers(
        { [name]: mcpServers[name] },
        target.surface,
        mcpOverrides[target.surface],
      );
      const desired = native[name];
      if (!isRecord(desired)) continue;

      let projection;
      try {
        projection = projectMcpServer(
          targetRoot,
          target,
          { assetId: `mcp:${name}`, name, desired },
          receipt,
        );
      } catch (error) {
        issues.push({
          severity: 'error',
          code: 'deploy.containmentFailed',
          message: errorMessage(error),
        });
        continue;
      }

      receiptEntries.set(projection.receiptKey, {
        assetId: projection.assetId,
        hash: projection.serverHash,
      });
      if (projection.status === 'identical') continue;
      serversToWrite[name] = desired;
      if (projection.status === 'conflict') conflictNames.push(name);
    }

    if (Object.keys(serversToWrite).length === 0) continue;

    try {
      assertPathContainedInProjectRoot(targetRoot, targetPath);
    } catch (error) {
      issues.push({
        severity: 'error',
        code: 'deploy.containmentFailed',
        message: errorMessage(error),
      });
      continue;
    }

    fileExisted = fs.existsSync(targetPath);
    const previous = fileExisted ? fs.readFileSync(targetPath) : undefined;
    const nextContent = Buffer.from(
      overlayProjectMcpFile(
        previous?.toString('utf8'),
        target,
        serversToWrite,
      ),
      'utf8',
    );
    if (previous?.equals(nextContent)) continue;

    const id = selectionId(target.ide, 'mcp', targetPath);
    const mcpChange: DeployChange = {
      id,
      owner: 'ide',
      ide: target.ide,
      capability: 'mcp',
      name: displayName(targetPath, 'mcp'),
      targetPath,
      change: fileExisted ? 'modify' : 'add',
      defaultSelected: conflictNames.length === 0
        || Object.keys(serversToWrite).some((name) => !conflictNames.includes(name)),
      group: 'standard',
      strategy: 'replace-entire-file',
      deploymentKind: 'project-mcp-overlay',
      preview: preview(targetPath, target.ide, 'mcp', nextContent, previous, issues),
    };
    mutations.set(id, {
      content: nextContent,
      mcpOverlay: { target, serversToWrite },
    });
    changes.push(mcpChange);

    for (const name of conflictNames) {
      const decisionId = selectionId(target.ide, 'mcp', `${targetPath}\0mcp:${name}`);
      decisions.push({
        id: decisionId,
        factId: decisionId,
        kind: 'project-mcp-divergence',
        packageNames: [name],
        linkPaths: [targetPath],
        choices: ['preserve-external', 'replace-with-repository'],
        replacementChangeIds: [id],
      });
      issues.push({
        severity: 'decisionRequired',
        code: 'deploy.projectMcpDivergence',
        decisionId,
        message: `Unknown or divergent project MCP server "${name}" blocks silent overwrite: ${targetPath}`,
        details: 'Choose Preserve to keep the local server definition, or Replace to write the Repository definition.',
      });
    }
  }
}

function projectSkillOwner(
  relativeRoot: ProjectSkillRelativeRoot,
  manifest: McvManifest,
): { owner: 'ide'; ide: IdeId; surface: SkillSurfaceId } {
  if (relativeRoot === '.claude/skills') {
    return { owner: 'ide', ide: 'claude-code', surface: 'claude-code' };
  }
  if (manifest.targets.codex.enabled) {
    return { owner: 'ide', ide: 'codex', surface: 'codex' };
  }
  return { owner: 'ide', ide: 'gemini', surface: 'gemini-cli' };
}

function applyProjectSkillReceiptDecisions(
  plan: DeployPlan,
  selection: DeploySelection,
  selected: Set<string>,
  selectedIds: string[],
  mutations: Map<string, DeployMutation>,
): void {
  const preservedKeys = new Set<string>();
  for (const decision of plan.decisions) {
    if (decision.kind !== 'project-skill-divergence') continue;
    const choice = selection.decisions?.[decision.id];
    if (choice === 'preserve-external') {
      for (const linkPath of decision.linkPaths) {
        preservedKeys.add(path.relative(plan.targetRoot, linkPath).split(path.sep).join('/'));
      }
    }
  }
  if (preservedKeys.size === 0) return;
  updateSelectedManagedReceipt(plan, selected, selectedIds, mutations, (receipt) => {
    for (const key of preservedKeys) delete receipt.managed[key];
    return true;
  });
}

function applyProjectMcpOverlayDecisions(
  plan: DeployPlan,
  selection: DeploySelection,
  selected: Set<string>,
  selectedIds: string[],
  mutations: Map<string, DeployMutation>,
): void {
  if (plan.scope !== 'project') return;

  const preservedByChange = new Map<string, Set<string>>();
  for (const decision of plan.decisions) {
    if (decision.kind !== 'project-mcp-divergence') continue;
    const choice = selection.decisions?.[decision.id];
    if (choice !== 'preserve-external') continue;
    for (const changeId of decision.replacementChangeIds) {
      const names = preservedByChange.get(changeId) ?? new Set<string>();
      for (const name of decision.packageNames) names.add(name);
      preservedByChange.set(changeId, names);
    }
  }
  if (preservedByChange.size === 0) return;

  for (const [changeId, preservedNames] of preservedByChange) {
    const mutation = mutations.get(changeId);
    if (!mutation?.mcpOverlay) continue;
    const { target, serversToWrite } = mutation.mcpOverlay;
    const nextServers = Object.fromEntries(
      Object.entries(serversToWrite).filter(([name]) => !preservedNames.has(name)),
    );
    const targetPath = plan.changes.find((change) => change.id === changeId)?.targetPath;
    if (!targetPath) continue;
    const previous = fs.existsSync(targetPath) ? fs.readFileSync(targetPath, 'utf8') : undefined;
    const nextContent = Buffer.from(overlayProjectMcpFile(previous, target, nextServers), 'utf8');
    mutations.set(changeId, {
      content: nextContent,
      mcpOverlay: { target, serversToWrite: nextServers },
    });
  }

  updateSelectedManagedReceipt(plan, selected, selectedIds, mutations, (receipt) => {
    let changed = false;
    for (const decision of plan.decisions) {
      if (decision.kind !== 'project-mcp-divergence') continue;
      if (selection.decisions?.[decision.id] !== 'preserve-external') continue;
      for (const targetPath of decision.linkPaths) {
        const relative = path.relative(plan.targetRoot, targetPath).split(path.sep).join('/');
        for (const name of decision.packageNames) {
          const key = managedReceiptKey(relative, `mcp:${name}`);
          if (key in receipt.managed) changed = true;
          delete receipt.managed[key];
        }
      }
    }
    return changed;
  });
}

function compareChanges(left: DeployChange, right: DeployChange): number {
  const groupOrder = { standard: 0, advanced: 1 } as const;
  const capabilityOrder: Record<ConfigurationCapability, number> = {
    instructions: 0, skills: 1, mcp: 2, native: 3,
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
