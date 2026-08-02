import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import * as pty from 'node-pty';
import { pathToFileURL } from 'url';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';

const cliPath = path.join(process.cwd(), 'dist', 'index.js');

describe.skipIf(process.platform !== 'win32')('packaged TUI Shell in Windows ConPTY', () => {
  let testRoot: string;
  let wrapperPath: string;
  let modeProbeRoot: string;
  let modeProbePath: string;

  beforeAll(() => {
    modeProbeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mcv-console-mode-'));
    modeProbePath = path.join(modeProbeRoot, 'McvConsoleMode.dll');
    const source = [
      'using System;',
      'using System.Runtime.InteropServices;',
      'namespace McvTest {',
      '  public static class ConsoleMode {',
      '    [DllImport("kernel32.dll", SetLastError = true)]',
      '    public static extern IntPtr GetStdHandle(int nStdHandle);',
      '    [DllImport("kernel32.dll", SetLastError = true)]',
      '    public static extern bool GetConsoleMode(IntPtr hConsoleHandle, out uint lpMode);',
      '  }',
      '}',
    ].join('\n');
    const compile = spawnSync('powershell.exe', [
      '-NoLogo',
      '-NoProfile',
      '-Command',
      `Add-Type -TypeDefinition ${quotePowerShell(source)} -OutputAssembly ${quotePowerShell(modeProbePath)}`,
    ], {
      encoding: 'utf8',
      timeout: 30_000,
    });
    if (compile.status !== 0) {
      throw new Error(
        `Could not compile the Windows console mode probe: ${compile.stderr}`,
      );
    }
  }, 45_000);

  afterAll(() => {
    fs.rmSync(modeProbeRoot, { recursive: true, force: true });
  });

  beforeEach(() => {
    testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mcv-tui-conpty-'));
    wrapperPath = path.join(testRoot, 'invoke-mcv.ps1');
    fs.writeFileSync(wrapperPath, [
      'param([string]$Node, [string]$Cli, [string]$Route, [string]$ModeProbe)',
      'Add-Type -Path $ModeProbe',
      '$inputHandle = [McvTest.ConsoleMode]::GetStdHandle(-10)',
      '[uint32]$before = 0',
      'if (-not [McvTest.ConsoleMode]::GetConsoleMode($inputHandle, [ref]$before)) { throw "GetConsoleMode before TUI failed" }',
      'if ($Route) { & $Node $Cli $Route } else { & $Node $Cli }',
      '$code = $LASTEXITCODE',
      '[uint32]$after = 0',
      'if (-not [McvTest.ConsoleMode]::GetConsoleMode($inputHandle, [ref]$after)) { throw "GetConsoleMode after TUI failed" }',
      'if ($before -eq $after) { Write-Output "INPUT_MODE:restored" } else { Write-Output "INPUT_MODE:changed" }',
      'Write-Output "EXIT_CODE:$code"',
      'exit $code',
      '',
    ].join('\r\n'));
  });

  afterEach(() => {
    fs.rmSync(testRoot, { recursive: true, force: true });
  });

  it('deep-links discover, handles Escape and q, and restores ConPTY', async () => {
    const outcome = await runConPty('discover', [
      { pattern: 'Gemini:', input: '\u001b' },
      { pattern: '● Loading: Overview...', input: 'q' },
    ]);

    expect(outcome.code).toBe(0);
    expectRestoredTerminal(outcome.output);
    expect(outcome.output).toContain('INPUT_MODE:restored');
    expect(outcome.output).not.toContain('INPUT_MODE:changed');
  }, 45_000);

  it('returns 130 on Ctrl+C and restores ConPTY input mode', async () => {
    const outcome = await runConPty('status', [{
      pattern: 'Repository',
      input: '\u0003',
      delay: 200,
    }]);

    expect(outcome.code).toBe(130);
    expectRestoredTerminal(outcome.output);
    expect(outcome.output).toContain('INPUT_MODE:restored');
    expect(outcome.output).not.toContain('INPUT_MODE:changed');
  }, 45_000);

  it('opens every primary destination with arrows while NO_COLOR preserves meaning', async () => {
    const repositoryPath = createDeployTreeRepository(testRoot);
    const before = snapshotTree(repositoryPath);
    const outcome = await runConPty('status', [
      { pattern: '› Overview', input: '\u001b[B' },
      { pattern: '› Capture', input: '\u001b[C' },
      { pattern: 'Capture · Select Changes', input: '\u001b[D' },
      { pattern: 'Status Overview', input: '\u001b[B' },
      { pattern: '› Deploy', input: '\u001b[C' },
      { pattern: 'Deploy · Select Changes', input: '\u001b[D' },
      { pattern: '› Deploy', input: '\u001b[B' },
      { pattern: '› Restore Latest Deployment', input: '\u001b[C' },
      { pattern: 'Restore Latest Deployment · Review', input: '\u001b[D' },
      { pattern: '› Restore Latest Deployment', input: '\u001b[B' },
      { pattern: '› Repository', input: '\u001b[C' },
      { pattern: 'Repository ID: deploy-tree-conpty', input: '\u001b[D' },
      { pattern: '› Repository', input: '\u001b[B' },
      { pattern: '› Help', input: '\r' },
      { pattern: 'Primary navigation:', input: '\u001b[D' },
      { pattern: '› Help', input: 'q' },
    ], {
      environment: { FORCE_COLOR: '0', NO_COLOR: '1' },
    });

    expect(outcome.code).toBe(0);
    expect(outcome.output).toContain('✓ Repository: Ready');
    expect(outcome.output).toContain('! Pending Deployment Changes: Review');
    expect(outcome.output).toContain('[x]');
    expectColorlessOutput(outcome.output);
    expect(snapshotTree(repositoryPath)).toEqual(before);
    expectRestoredTerminal(outcome.output);
    expect(outcome.output).toContain('INPUT_MODE:restored');
    expect(outcome.output).not.toContain('INPUT_MODE:changed');
  }, 60_000);

  it('pages through the packaged Deploy tree inside a bounded viewport', async () => {
    createDeployTreeRepository(testRoot);
    const outcome = await runConPty('deploy', [
      { pattern: 'Codex / Skills', input: '\u001b[C' },
      { pattern: 'hatch-pet · 20 files', input: '\u001b[C' },
      { pattern: '> [x] ▶ hatch-pet', input: '\u001b[C' },
      { pattern: '> [x] ▼ hatch-pet', input: '\u001b[B' },
      { pattern: 'file-0.md', input: '\u001b[6~' },
      { pattern: 'file-4.md', resize: { cols: 60, rows: 10 } },
      { pattern: '↑↓/Pg Move', input: 'q' },
    ]);

    expect(outcome.code).toBe(0);
    expect(outcome.output).toMatch(/… \d+ earlier/);
    expect(outcome.output).toContain('file-4.md');
    expect(outcome.output).toContain('Deploy closed without applying changes.');
    expectRestoredTerminal(outcome.output);
    expect(outcome.output).toContain('INPUT_MODE:restored');
  }, 45_000);

  it('ignores q and Ctrl+C during Restore Apply and completes the Result', async () => {
    const fixturePath = createRestoreApplyingFixture(testRoot);
    const outcome = await runConPty('restore', [
      { pattern: 'Restore Latest Deployment · Review', input: '\r' },
      { pattern: 'Restore Latest Deployment · Applying', input: 'q\u0003' },
      { pattern: 'Restore Latest Deployment · Result', input: 'q' },
    ], { cliPath: fixturePath });

    expect(outcome.code).toBe(0);
    expect(outcome.output).toContain('Restore succeeded.');
    expect(outcome.output).toContain('Written: 1 paths');
    expect(outcome.output).toContain('Deleted: 0 paths');
    expect(outcome.output).toContain('input is disabled during backup, Apply, and rollback');
    expect(outcome.output).toContain('OUTCOME:completed');
    expect(outcome.output).toContain('STATUS:succeeded');
    expectRestoredTerminal(outcome.output);
    expect(outcome.output).toContain('INPUT_MODE:restored');
    expect(outcome.output).not.toContain('INPUT_MODE:changed');
  }, 45_000);

  function runConPty(
    route: 'discover' | 'status' | 'deploy' | 'restore',
    steps: Array<{
      pattern: string;
      input?: string;
      delay?: number;
      resize?: { cols: number; rows: number };
    }>,
    options: {
      cliPath?: string;
      environment?: NodeJS.ProcessEnv;
    } = {},
  ): Promise<{ code: number; output: string }> {
    return new Promise((resolve, reject) => {
      const arguments_ = [
        '-NoLogo',
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        wrapperPath,
        '-Node',
        process.execPath,
        '-Cli',
        options.cliPath ?? cliPath,
        '-Route',
        route,
        '-ModeProbe',
        modeProbePath,
      ];
      const terminal = pty.spawn('powershell.exe', arguments_, {
        cols: 100,
        rows: route === 'deploy' ? 16 : 30,
        cwd: process.cwd(),
        env: {
          ...process.env,
          HOME: testRoot,
          USERPROFILE: testRoot,
          APPDATA: testRoot,
          ...options.environment,
        },
      });
      let output = '';
      let nextStep = 0;
      let searchStart = 0;
      const timeout = setTimeout(() => {
        terminal.kill();
        reject(new Error(`Timed out waiting for Windows TUI. Output: ${output}`));
      }, 30_000);

      terminal.onData((data) => {
        output += data;
        const step = steps[nextStep];
        if (!step || !output.slice(searchStart).includes(step.pattern)) return;
        nextStep += 1;
        searchStart = output.length;
        setTimeout(() => {
          if (step.resize) {
            terminal.resize(step.resize.cols, step.resize.rows);
          }
          if (step.input) terminal.write(step.input);
        }, step.delay ?? 0);
      });
      terminal.onExit(({ exitCode }) => {
        clearTimeout(timeout);
        if (nextStep !== steps.length) {
          reject(new Error(
            `Windows TUI exited before step ${nextStep + 1}/${steps.length}.`
            + ` Output: ${output}`,
          ));
          return;
        }
        resolve({ code: exitCode, output });
      });
    });
  }
});

function quotePowerShell(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function createDeployTreeRepository(testRoot: string): string {
  const repositoryPath = path.join(testRoot, 'deploy-tree-repository');
  const skillPath = path.join(
    repositoryPath,
    'common',
    'skills',
    'hatch-pet',
  );
  fs.mkdirSync(skillPath, { recursive: true });
  fs.writeFileSync(path.join(repositoryPath, 'mcv.yaml'), [
    'schemaVersion: 2',
    'repositoryId: deploy-tree-conpty',
    'initializedAt: 2026-07-27T00:00:00.000Z',
    'security: { scanSecrets: true, allowPlaintextSecrets: false }',
    'capture: { preserveUnknownNativeFields: true }',
    'deploy: { backupBeforeWrite: true, useSymlinks: false }',
    'targets:',
    '  codex:',
    '    enabled: true',
    'variables: {}',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(skillPath, 'SKILL.md'), '# Hatch Pet\n');
  for (let index = 0; index < 19; index += 1) {
    fs.writeFileSync(
      path.join(skillPath, `file-${index}.md`),
      `# File ${index}\n`,
    );
  }
  const statePath = path.join(testRoot, 'mcv', 'config.json');
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, `${JSON.stringify({
    schemaVersion: 2,
    defaultRepositoryId: 'deploy-tree-conpty',
    repositoryPath,
  }, null, 2)}\n`);
  return repositoryPath;
}

function createRestoreRepository(
  testRoot: string,
): { targetPath: string } {
  const repositoryPath = path.join(testRoot, 'restore-repository');
  const targetPath = path.join(testRoot, 'target', 'settings.json');
  const backupDirectory = path.join(testRoot, 'mcv', 'backups', 'complete');
  const originalContent = 'before deploy\n';
  const deployedContent = 'after deploy\n';
  const digest = (content: string): string =>
    crypto.createHash('sha256').update(content).digest('hex');

  fs.mkdirSync(repositoryPath);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.mkdirSync(path.join(backupDirectory, 'files'), { recursive: true });
  fs.writeFileSync(path.join(repositoryPath, 'mcv.yaml'), [
    'schemaVersion: 2',
    'repositoryId: restore-conpty',
    'initializedAt: 2026-07-29T00:00:00.000Z',
    'security: { scanSecrets: true, allowPlaintextSecrets: false }',
    'capture: { preserveUnknownNativeFields: true }',
    'deploy: { backupBeforeWrite: true, useSymlinks: false }',
    'targets: {}',
    'variables: {}',
    '',
  ].join('\n'));
  fs.writeFileSync(
    path.join(testRoot, 'mcv', 'config.json'),
    `${JSON.stringify({
      schemaVersion: 2,
      defaultRepositoryId: 'restore-conpty',
      repositoryPath,
    }, null, 2)}\n`,
  );
  fs.writeFileSync(targetPath, deployedContent);
  fs.writeFileSync(
    path.join(backupDirectory, 'files', 'settings.json'),
    originalContent,
  );
  fs.writeFileSync(
    path.join(backupDirectory, 'manifest.json'),
    JSON.stringify({
      createdAt: '2026-07-29T08:30:00.000Z',
      status: 'complete',
      files: [{
        action: 'modify',
        originalPath: targetPath,
        backupPath: 'files/settings.json',
        beforeHash: digest(originalContent),
        afterHash: digest(deployedContent),
      }],
    }),
  );
  return { targetPath };
}

function createRestoreApplyingFixture(testRoot: string): string {
  const fixturePath = path.join(testRoot, 'restore-applying.mjs');
  const shellModuleUrl = pathToFileURL(
    path.join(process.cwd(), 'dist', 'tui', 'shell.js'),
  ).href;
  const repositoryPath = path.join(testRoot, 'restore-fixture-repository');
  const targetPath = path.join(testRoot, 'restore-fixture-target.json');
  const plan = {
    schemaVersion: 1,
    operation: 'restore',
    status: 'planned',
    readyToApply: true,
    operationId: 'restore-conpty',
    preconditions: {},
    repositoryPath,
    backup: {
      id: 'deploy-20260729',
      createdAt: '2026-07-29T08:30:00.000Z',
    },
    changes: [{
      id: 'restore-settings',
      action: 'restore',
      targetPath,
      nodeKind: 'file',
      layoutKind: 'ordinary-file',
    }],
    issues: [],
    nextActions: [],
  };
  const result = {
    schemaVersion: 1,
    operation: 'restore',
    status: 'succeeded',
    repositoryPath,
    changes: plan.changes,
    issues: [],
    nextActions: [],
    data: {
      appliedChangeIds: ['restore-settings'],
      restoredPaths: [targetPath],
      deletedPaths: [],
      backupPath: path.join(testRoot, 'restore-backups', 'before-restore'),
    },
  };
  const repositoryReport = {
    schemaVersion: 1,
    operation: 'repository',
    status: 'reported',
    ready: true,
    repositoryPath,
    repositoryId: 'restore-conpty',
    repositorySchemaVersion: 2,
    valid: true,
    changes: [],
    issues: [],
    nextActions: [],
  };
  fs.writeFileSync(fixturePath, [
    `import { runTuiShell } from ${JSON.stringify(shellModuleUrl)};`,
    `const plan = ${JSON.stringify(plan)};`,
    `const result = ${JSON.stringify(result)};`,
    'const outcome = await runTuiShell(',
    "  { homeDir: process.env.HOME, platform: process.platform, env: process.env },",
    "  'restore',",
    '  {',
    `    inspectRepository: () => (${JSON.stringify(repositoryReport)}),`,
    '    createRestorePlan: () => plan,',
    '    applyRestorePlan: async () => {',
    '      await new Promise((resolve) => setTimeout(resolve, 500));',
    '      return result;',
    '    },',
    '  },',
    ');',
    "process.stdout.write(`OUTCOME:${outcome.reason}\\n`);",
    "process.stdout.write(`STATUS:${outcome.operationStatus}\\n`);",
    '',
  ].join('\n'));
  return fixturePath;
}

function snapshotTree(root: string): Record<string, string> {
  const snapshot: Record<string, string> = {};
  const visit = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      const relativePath = path.relative(root, absolutePath);
      if (entry.isDirectory()) {
        snapshot[`${relativePath}/`] = 'directory';
        visit(absolutePath);
      } else {
        snapshot[relativePath] = crypto
          .createHash('sha256')
          .update(fs.readFileSync(absolutePath))
          .digest('hex');
      }
    }
  };
  visit(root);
  return snapshot;
}

function expectColorlessOutput(output: string): void {
  const alternateScreenStart = output.indexOf('\u001b[?1049h');
  const applicationOutput = alternateScreenStart === -1
    ? output
    : output.slice(alternateScreenStart);
  const colorParameters = [...applicationOutput.matchAll(/\u001b\[([0-9;:]*)m/g)]
    .flatMap((match) => match[1]?.split(/[;:]/) ?? [])
    .map((value) => Number.parseInt(value, 10))
    .filter((value) =>
      (value >= 30 && value <= 49)
      || (value >= 90 && value <= 107));
  expect(colorParameters).toEqual([]);
}

function expectRestoredTerminal(output: string): void {
  expect(output).toContain('\u001b[?1049h');
  expect(output).toContain('\u001b[?1049l');
  expect(output).toContain('\u001b[?25h');
}
