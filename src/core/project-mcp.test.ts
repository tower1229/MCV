import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ManagedReceipt } from './managed-receipt.js';
import {
  hashProjectMcpServerValue,
  overlayProjectMcpFile,
  projectMcpDestinationTargets,
  projectMcpServer,
} from './project-mcp.js';

describe('project MCP key-level overlay', () => {
  let testRoot: string;
  let targetRoot: string;

  beforeEach(() => {
    testRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mcv-project-mcp-')));
    targetRoot = path.join(testRoot, 'project');
    fs.mkdirSync(targetRoot, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(testRoot, { recursive: true, force: true });
  });

  it('dedupes destinations: Codex, Claude, Gemini CLI — never Antigravity', () => {
    expect(projectMcpDestinationTargets({
      codex: true,
      claudeCode: true,
      geminiCli: true,
    }).map((target) => target.id)).toEqual(['codex', 'claude-code', 'gemini-cli']);

    expect(projectMcpDestinationTargets({
      codex: false,
      claudeCode: false,
      geminiCli: true,
    }).map((target) => target.id)).toEqual(['gemini-cli']);
  });

  it('preserves non-MCV servers and non-MCP fields while adding a selected key', () => {
    const relativePath = '.mcp.json';
    const existingPath = path.join(targetRoot, relativePath);
    fs.writeFileSync(existingPath, `${JSON.stringify({
      mcpServers: {
        team: { command: 'team-server' },
      },
      notes: 'keep-me',
    }, null, 2)}\n`);

    const desired = { command: 'docs-server' };
    const projection = projectMcpServer(
      targetRoot,
      projectMcpDestinationTargets({ codex: false, claudeCode: true, geminiCli: false })[0]!,
      { assetId: 'mcp:docs', name: 'docs', desired },
      undefined,
    );
    expect(projection.status).toBe('absent');
    expect(projection.receiptKey).toBe('.mcp.json#mcv:mcp:docs');

    const merged = overlayProjectMcpFile(
      fs.readFileSync(existingPath, 'utf8'),
      projection.target,
      { docs: desired },
    );
    expect(JSON.parse(merged)).toEqual({
      mcpServers: {
        team: { command: 'team-server' },
        docs: { command: 'docs-server' },
      },
      notes: 'keep-me',
    });
  });

  it('marks identical managed content as satisfied', () => {
    const target = projectMcpDestinationTargets({
      codex: false,
      claudeCode: true,
      geminiCli: false,
    })[0]!;
    const desired = { command: 'docs-server' };
    fs.writeFileSync(
      path.join(targetRoot, target.relativePath),
      `${JSON.stringify({ mcpServers: { docs: desired } }, null, 2)}\n`,
    );

    const projection = projectMcpServer(
      targetRoot,
      target,
      { assetId: 'mcp:docs', name: 'docs', desired },
      undefined,
    );
    expect(projection.status).toBe('identical');
    expect(projection.serverHash).toBe(hashProjectMcpServerValue(desired));
  });

  it('flags an unknown divergent server key as a conflict', () => {
    const target = projectMcpDestinationTargets({
      codex: true,
      claudeCode: false,
      geminiCli: false,
    })[0]!;
    fs.mkdirSync(path.join(targetRoot, '.codex'), { recursive: true });
    fs.writeFileSync(
      path.join(targetRoot, target.relativePath),
      '[mcp_servers.docs]\ncommand = "local-docs"\n',
    );

    const projection = projectMcpServer(
      targetRoot,
      target,
      { assetId: 'mcp:docs', name: 'docs', desired: { command: 'docs-server' } },
      undefined,
    );
    expect(projection.status).toBe('conflict');
  });

  it('allows a normal update when Receipt ownership still matches the local server', () => {
    const target = projectMcpDestinationTargets({
      codex: false,
      claudeCode: false,
      geminiCli: true,
    })[0]!;
    const deployed = { command: 'docs-server' };
    fs.mkdirSync(path.join(targetRoot, '.gemini'), { recursive: true });
    fs.writeFileSync(
      path.join(targetRoot, target.relativePath),
      `${JSON.stringify({ mcpServers: { docs: deployed }, theme: 'dark' }, null, 2)}\n`,
    );
    const receipt: ManagedReceipt = {
      schemaVersion: 1,
      repositoryId: 'repo',
      managed: {
        '.gemini/settings.json#mcv:mcp:docs': {
          assetId: 'mcp:docs',
          hash: hashProjectMcpServerValue(deployed),
        },
      },
    };

    const projection = projectMcpServer(
      targetRoot,
      target,
      { assetId: 'mcp:docs', name: 'docs', desired: { command: 'docs-server-v2' } },
      receipt,
    );
    expect(projection.status).toBe('update');
  });

  it('flags Receipt drift as a conflict even when Canonical changed', () => {
    const target = projectMcpDestinationTargets({
      codex: false,
      claudeCode: true,
      geminiCli: false,
    })[0]!;
    const deployed = { command: 'docs-server' };
    fs.writeFileSync(
      path.join(targetRoot, target.relativePath),
      `${JSON.stringify({ mcpServers: { docs: { command: 'edited-locally' } } }, null, 2)}\n`,
    );
    const receipt: ManagedReceipt = {
      schemaVersion: 1,
      repositoryId: 'repo',
      managed: {
        '.mcp.json#mcv:mcp:docs': {
          assetId: 'mcp:docs',
          hash: hashProjectMcpServerValue(deployed),
        },
      },
    };

    const projection = projectMcpServer(
      targetRoot,
      target,
      { assetId: 'mcp:docs', name: 'docs', desired: { command: 'docs-server-v2' } },
      receipt,
    );
    expect(projection.status).toBe('conflict');
  });
});
