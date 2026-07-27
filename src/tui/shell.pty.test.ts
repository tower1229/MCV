import * as fs from 'fs';
import * as crypto from 'crypto';
import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const expectPath = '/usr/bin/expect';
const cliPath = path.join(process.cwd(), 'dist', 'index.js');

describe.skipIf(!fs.existsSync(expectPath))('packaged TUI Shell in a real PTY', () => {
  let testRoot: string;

  beforeEach(() => {
    testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mcv-tui-pty-'));
  });

  afterEach(() => {
    fs.rmSync(testRoot, { recursive: true, force: true });
  });

  it('opens Repository onboarding in the alternate screen and restores cursor and input mode', async () => {
    const outcome = await runExpect([
      'set timeout 5',
      'log_user 1',
      'spawn /bin/zsh -f -c {stty rows 24 columns 80; before=$(stty -g); "$MCV_TEST_NODE" "$MCV_TEST_CLI"; code=$?; after=$(stty -g); if [[ "$before" == "$after" ]]; then mode=restored; else mode=changed; fi; print -r -- INPUT_MODE:$mode; print -r -- EXIT_CODE:$code; exit $code}',
      'expect -exact {Repository}',
      'after 200',
      'expect -exact {Initialize here}',
      'send "q"',
      'expect -exact {INPUT_MODE:restored}',
      'expect -exact {EXIT_CODE:0}',
      'expect eof',
      'set result [wait]',
      'exit [lindex $result 3]',
    ]);

    expect(outcome.code).toBe(0);
    expectRestoredTerminal(outcome.output);
  });

  it('shows only the six primary destinations and keeps Help in the same Shell', async () => {
    const repositoryPath = createCaptureRepository();
    writeBinding(repositoryPath, 'tui-capture-test');
    const outcome = await runExpect([
      'set timeout 5',
      'log_user 1',
      'spawn /bin/zsh -f -c {stty rows 30 columns 120; cd "$MCV_TEST_REPO"; "$MCV_TEST_NODE" "$MCV_TEST_CLI"; code=$?; print -r -- EXIT_CODE:$code; exit $code}',
      'expect -exact {Overview   Capture   Deploy   Restore Latest Deployment   Repository   Help}',
      'send "h"',
      'expect -exact {Primary navigation:}',
      'expect -exact {Direct commands open the same Shell when attached to a terminal.}',
      'send "\\033"',
      'expect -exact {Loading Overview...}',
      'send "q"',
      'expect -exact {EXIT_CODE:0}',
      'expect eof',
      'set result [wait]',
      'exit [lindex $result 3]',
    ], { MCV_TEST_REPO: repositoryPath });

    expect(outcome.code).toBe(0);
    expect(outcome.output).not.toContain('Environment Details   r Repository');
    expectRestoredTerminal(outcome.output);
  }, 10_000);

  it('deep-links every Repository business command into the persistent Shell', async () => {
    const emptyPath = path.join(testRoot, 'empty');
    fs.mkdirSync(emptyPath);
    const init = await runExpect([
      'set timeout 5',
      'log_user 1',
      'spawn /bin/zsh -f -c {cd "$MCV_TEST_REPO"; "$MCV_TEST_NODE" "$MCV_TEST_CLI" init; code=$?; print -r -- EXIT_CODE:$code; exit $code}',
      'expect -exact {Repository · Init Plan}',
      'send "q"',
      'expect -exact {Repository closed without changes.}',
      'expect -exact {Next: Return to Overview and choose the next workflow.}',
      'expect -exact {EXIT_CODE:0}',
      'expect eof',
      'set result [wait]',
      'exit [lindex $result 3]',
    ], { MCV_TEST_REPO: emptyPath });

    const repositoryPath = createCaptureRepository();
    const repository = await runExpect([
      'set timeout 5',
      'log_user 1',
      'spawn /bin/zsh -f -c {cd "$MCV_TEST_REPO"; "$MCV_TEST_NODE" "$MCV_TEST_CLI" repo; code=$?; print -r -- EXIT_CODE:$code; exit $code}',
      'expect -exact {Bind current repository}',
      'send "q"',
      'expect -exact {Repository: }',
      'expect -exact {Next: Return to Overview and choose the next workflow.}',
      'expect -exact {EXIT_CODE:0}',
      'expect eof',
      'set result [wait]',
      'exit [lindex $result 3]',
    ], { MCV_TEST_REPO: repositoryPath });

    const bind = await runExpect([
      'set timeout 5',
      'log_user 1',
      'spawn /bin/zsh -f -c {"$MCV_TEST_NODE" "$MCV_TEST_CLI" bind "$MCV_TEST_REPO"; code=$?; print -r -- EXIT_CODE:$code; exit $code}',
      'expect -exact {Repository · Bind Plan}',
      'send "\\r"',
      'expect -exact {Loading Overview...}',
      'expect -exact {Overview}',
      'send "r"',
      'expect -exact {Unbind this device}',
      'send "q"',
      'expect -exact {Bind succeeded for }',
      'expect -exact {Next: Review Overview before Capture, Deploy, or Restore.}',
      'expect -exact {EXIT_CODE:0}',
      'expect eof',
      'set result [wait]',
      'exit [lindex $result 3]',
    ], { MCV_TEST_REPO: repositoryPath });

    const unbind = await runExpect([
      'set timeout 5',
      'log_user 1',
      'spawn /bin/zsh -f -c {"$MCV_TEST_NODE" "$MCV_TEST_CLI" unbind; code=$?; print -r -- EXIT_CODE:$code; exit $code}',
      'expect -exact {Repository · Unbind Plan}',
      'send "q"',
      'expect -exact {EXIT_CODE:0}',
      'expect eof',
      'set result [wait]',
      'exit [lindex $result 3]',
    ]);

    const schemaOnePath = createSchemaOneRepository();
    writeBinding(schemaOnePath, 'tui-migration-test');
    const migrate = await runExpect([
      'set timeout 5',
      'log_user 1',
      'spawn /bin/zsh -f -c {"$MCV_TEST_NODE" "$MCV_TEST_CLI" migrate "$MCV_TEST_REPO"; code=$?; print -r -- EXIT_CODE:$code; exit $code}',
      'expect -exact {Repository · Migrate Plan}',
      'send "q"',
      'expect -exact {EXIT_CODE:0}',
      'expect eof',
      'set result [wait]',
      'exit [lindex $result 3]',
    ], { MCV_TEST_REPO: schemaOnePath });

    for (const outcome of [init, repository, bind, unbind, migrate]) {
      expect(outcome.code).toBe(0);
      expectRestoredTerminal(outcome.output);
    }
  }, 25_000);

  it('prints a Repository Plan error and next action after restoring the main screen', async () => {
    const invalidPath = path.join(testRoot, 'invalid-repository');
    fs.mkdirSync(invalidPath);
    const outcome = await runExpect([
      'set timeout 5',
      'log_user 1',
      'spawn /bin/zsh -f -c {"$MCV_TEST_NODE" "$MCV_TEST_CLI" bind "$MCV_TEST_REPO"; code=$?; print -r -- EXIT_CODE:$code; exit $code}',
      'expect -exact {Repository · Bind Plan}',
      'expect -exact {Apply disabled until the Repository selection is fixed.}',
      'send "q"',
      'expect -exact {Repository failed: The selected directory is not a valid MCV Repository.}',
      'expect -exact {Next: Choose a directory containing a valid mcv.yaml manifest.}',
      'expect -exact {EXIT_CODE:1}',
      'expect eof',
      'set result [wait]',
      'exit [lindex $result 3]',
    ], { MCV_TEST_REPO: invalidPath });

    expect(outcome.code).toBe(1);
    expectRestoredTerminal(outcome.output);
  });

  it('opens the same Capture workflow from Overview and the capture deep link', async () => {
    const repositoryPath = createCaptureRepository();
    const overview = await runExpect([
      'set timeout 5',
      'log_user 1',
      'spawn /bin/zsh -f -c {cd "$MCV_TEST_REPO"; "$MCV_TEST_NODE" "$MCV_TEST_CLI"; code=$?; print -r -- EXIT_CODE:$code; exit $code}',
      'expect -exact {Bind current repository}',
      'send "\\r"',
      'expect -exact {Repository · Bind Plan}',
      'send "\\r"',
      'expect -exact {Loading Overview...}',
      'expect -exact {Overview}',
      'send "c"',
      'expect -exact {Capture · Select Changes}',
      'send "q"',
      'expect -exact {EXIT_CODE:0}',
      'expect eof',
      'set result [wait]',
      'exit [lindex $result 3]',
    ], { MCV_TEST_REPO: repositoryPath });
    const deepLink = await runExpect([
      'set timeout 5',
      'log_user 1',
      'spawn /bin/zsh -f -c {cd "$MCV_TEST_REPO"; "$MCV_TEST_NODE" "$MCV_TEST_CLI" capture; code=$?; print -r -- EXIT_CODE:$code; exit $code}',
      'expect -exact {Capture · Select Changes}',
      'send "\\r"',
      'expect -exact {Capture · Confirm Apply}',
      'send "\\r"',
      'expect -exact {Capture · Result}',
      'send "\\r"',
      'expect -exact {Loading Overview...}',
      'expect -exact {Repository:}',
      'send "q"',
      'expect -exact {Captured 0 selected item(s)}',
      'expect -exact {EXIT_CODE:0}',
      'expect eof',
      'set result [wait]',
      'exit [lindex $result 3]',
    ], { MCV_TEST_REPO: repositoryPath });

    expect(overview.code).toBe(0);
    expect(deepLink.code).toBe(0);
    expectRestoredTerminal(overview.output);
    expectRestoredTerminal(deepLink.output);
  }, 15_000);

  it('initializes, discovers, enters Capture, and preserves the Repository when onboarding is cancelled', async () => {
    const repositoryPath = path.join(testRoot, 'new-repository');
    fs.mkdirSync(repositoryPath);

    const outcome = await runExpect([
      'set timeout 7',
      'log_user 1',
      'spawn /bin/zsh -f -c {cd "$MCV_TEST_REPO"; "$MCV_TEST_NODE" "$MCV_TEST_CLI"; code=$?; print -r -- EXIT_CODE:$code; exit $code}',
      'expect -exact {Initialize here}',
      'send "\\r"',
      'expect -exact {Repository · Init Plan}',
      'send "\\r"',
      'expect -exact {Environment Details}',
      'expect -exact {Enter Continue to Capture}',
      'send "\\r"',
      'expect -exact {Capture · Select Changes}',
      'send "\\033"',
      'expect -exact {Loading Overview...}',
      'expect -exact {Overview}',
      'send "q"',
      'expect -exact {EXIT_CODE:0}',
      'expect eof',
      'set result [wait]',
      'exit [lindex $result 3]',
    ], { MCV_TEST_REPO: repositoryPath });

    expect(outcome.code).toBe(0);
    expect(fs.existsSync(path.join(repositoryPath, 'mcv.yaml'))).toBe(true);
    expect(readBinding()).toMatchObject({
      repositoryPath: fs.realpathSync(repositoryPath),
    });
    expect(outcome.output).not.toMatch(/git init|Git warning/i);
    expectRestoredTerminal(outcome.output);
  }, 10_000);

  it('rebinds a moved Repository with the same ID before allowing other writes', async () => {
    const movedRepository = createCaptureRepository();
    const missingPath = path.join(testRoot, 'old-location');
    writeBinding(missingPath, 'tui-capture-test');

    const outcome = await runExpect([
      'set timeout 7',
      'log_user 1',
      'spawn /bin/zsh -f -c {"$MCV_TEST_NODE" "$MCV_TEST_CLI" capture; code=$?; print -r -- EXIT_CODE:$code; exit $code}',
      'expect -exact {Repository writes are blocked}',
      'expect -exact {Rebind moved Repository}',
      'send "\\r"',
      'expect -exact {Enter the path to an existing MCV Repository:}',
      'send -- $env(MCV_TEST_REPO)',
      'after 200',
      'send "\\r"',
      'expect -exact {Repository · Bind Plan}',
      'send "\\r"',
      'expect -exact {Capture · Select Changes}',
      'send "\\033"',
      'expect -exact {Overview}',
      'send "q"',
      'expect -exact {EXIT_CODE:0}',
      'expect eof',
      'set result [wait]',
      'exit [lindex $result 3]',
    ], { MCV_TEST_REPO: movedRepository });

    expect(outcome.code).toBe(0);
    expect(readBinding()).toMatchObject({
      repositoryPath: movedRepository,
    });
    expectRestoredTerminal(outcome.output);
  }, 10_000);

  it('reviews Migration and Unbind Plans and changes only the intended state', async () => {
    const repositoryPath = createSchemaOneRepository();
    writeBinding(repositoryPath, 'tui-migration-test');

    const migration = await runExpect([
      'set timeout 7',
      'log_user 1',
      'spawn /bin/zsh -f -c {"$MCV_TEST_NODE" "$MCV_TEST_CLI" capture; code=$?; print -r -- EXIT_CODE:$code; exit $code}',
      'expect -exact {Review Migration Plan}',
      'send "\\r"',
      'expect -exact {Repository · Migrate Plan}',
      'send "\\r"',
      'expect -exact {Continue to Capture}',
      'send "\\r"',
      'expect -exact {Capture · Select Changes}',
      'send "\\033"',
      'expect -exact {Overview}',
      'send "r"',
      'expect -exact {Unbind this device}',
      'send "\\033\\[B"',
      'after 100',
      'send "\\033\\[B"',
      'after 100',
      'send "\\r"',
      'expect -exact {This removes only the local binding. Repository files will not be changed.}',
      'send "\\r"',
      'expect -exact {Initialize here}',
      'send "q"',
      'expect -exact {EXIT_CODE:0}',
      'expect eof',
      'set result [wait]',
      'exit [lindex $result 3]',
    ]);

    expect(migration.code).toBe(0);
    expect(fs.readFileSync(path.join(repositoryPath, 'mcv.yaml'), 'utf8'))
      .toContain('schemaVersion: 2');
    expect(fs.existsSync(path.join(repositoryPath, 'mcv.yaml'))).toBe(true);
    expect(readBinding()).not.toHaveProperty('repositoryPath');
    expectRestoredTerminal(migration.output);
  }, 10_000);

  it('opens the same Deploy workflow from Overview and the deploy deep link', async () => {
    const repositoryPath = createCaptureRepository();
    writeBinding(repositoryPath, 'tui-capture-test');
    const overview = await runExpect([
      'set timeout 5',
      'log_user 1',
      'spawn /bin/zsh -f -c {cd "$MCV_TEST_REPO"; "$MCV_TEST_NODE" "$MCV_TEST_CLI"; code=$?; print -r -- EXIT_CODE:$code; exit $code}',
      'expect -exact {Overview}',
      'send "d"',
      'expect -exact {Deploy · Select Changes}',
      'send "q"',
      'expect -exact {EXIT_CODE:0}',
      'expect eof',
      'set result [wait]',
      'exit [lindex $result 3]',
    ], { MCV_TEST_REPO: repositoryPath });
    const deepLink = await runExpect([
      'set timeout 5',
      'log_user 1',
      'spawn /bin/zsh -f -c {cd "$MCV_TEST_REPO"; "$MCV_TEST_NODE" "$MCV_TEST_CLI" deploy; code=$?; print -r -- EXIT_CODE:$code; exit $code}',
      'expect -exact {Deploy · Select Changes}',
      'send "\\r"',
      'expect -exact {Deploy · Confirm Apply}',
      'send "\\r"',
      'expect -exact {Deploy · Result}',
      'send "\\r"',
      'expect -exact {Loading Overview...}',
      'expect -exact {Repository:}',
      'send "q"',
      'expect -exact {Deployed 0 selected item(s)}',
      'expect -exact {EXIT_CODE:0}',
      'expect eof',
      'set result [wait]',
      'exit [lindex $result 3]',
    ], { MCV_TEST_REPO: repositoryPath });

    expect(overview.code).toBe(0);
    expect(deepLink.code).toBe(0);
    expectRestoredTerminal(overview.output);
    expectRestoredTerminal(deepLink.output);
  }, 10_000);

  it('keeps Deploy transactional while partial selection fails after warning review', async () => {
    const fixturePath = createDeployWorkflowFixture();
    const outcome = await runExpect([
      'set timeout 5',
      'log_user 1',
      'spawn /bin/zsh -f -c {"$MCV_TEST_NODE" "$MCV_TEST_SCRIPT"; code=$?; print -r -- EXIT_CODE:$code; exit $code}',
      'expect -exact {Deploy · Select Changes}',
      'send " "',
      'after 100',
      'send "\\r"',
      'expect -exact {Deploy · Confirm Apply}',
      'send " "',
      'after 100',
      'send "\\r"',
      'expect -exact {Deploy · Applying}',
      'send "q"',
      'send "\\003"',
      'expect -exact {Deploy · Result}',
      'expect -exact {Deploy failed: simulated transaction failure}',
      'send "q"',
      'expect -exact {SELECTED:deploy-second}',
      'expect -exact {OUTCOME:completed}',
      'expect -exact {STATUS:failed}',
      'expect -exact {EXIT_CODE:0}',
      'expect eof',
      'set result [wait]',
      'exit [lindex $result 3]',
    ], { MCV_TEST_SCRIPT: fixturePath });

    expect(outcome.code).toBe(0);
    expectRestoredTerminal(outcome.output);
  }, 10_000);

  it('opens the same Restore workflow from Overview and the restore deep link', async () => {
    const fixture = createRestoreRepository();
    const overview = await runExpect([
      'set timeout 5',
      'log_user 1',
      'spawn /bin/zsh -f -c {cd "$MCV_TEST_REPO"; "$MCV_TEST_NODE" "$MCV_TEST_CLI"; code=$?; print -r -- EXIT_CODE:$code; exit $code}',
      'expect -exact {Overview}',
      'send "s"',
      'expect -exact {Restore Latest Deployment · Review}',
      'expect -exact {Backup time: 2026-07-27T08:30:00.000Z}',
      'send "q"',
      'expect -exact {EXIT_CODE:0}',
      'expect eof',
      'set result [wait]',
      'exit [lindex $result 3]',
    ], { MCV_TEST_REPO: fixture.repositoryPath });
    const deepLink = await runExpect([
      'set timeout 5',
      'log_user 1',
      'spawn /bin/zsh -f -c {cd "$MCV_TEST_REPO"; "$MCV_TEST_NODE" "$MCV_TEST_CLI" restore; code=$?; print -r -- EXIT_CODE:$code; exit $code}',
      'expect -exact {Restore Latest Deployment · Review}',
      'expect -exact {Impact: 1 file(s) to write, 0 file(s) to delete}',
      'send "\\r"',
      'expect -exact {Restore Latest Deployment · Result}',
      'expect -exact {Restore succeeded.}',
      'send "\\r"',
      'expect -exact {Loading Overview...}',
      'expect -exact {Repository:}',
      'send "q"',
      'expect -exact {Restored 1 path(s) and deleted 0 path(s).}',
      'expect -exact {EXIT_CODE:0}',
      'expect eof',
      'set result [wait]',
      'exit [lindex $result 3]',
    ], { MCV_TEST_REPO: fixture.repositoryPath });

    expect(overview.code).toBe(0);
    expect(deepLink.code).toBe(0);
    expect(fs.readFileSync(fixture.targetPath, 'utf8')).toBe('before deploy\n');
    expectRestoredTerminal(overview.output);
    expectRestoredTerminal(deepLink.output);
  }, 10_000);

  it('keeps no-backup and Restore Conflict states blocked in the PTY', async () => {
    const noBackupRepository = createCaptureRepository();
    writeBinding(noBackupRepository, 'tui-capture-test');
    const noBackup = await runExpect([
      'set timeout 5',
      'log_user 1',
      'spawn /bin/zsh -f -c {cd "$MCV_TEST_REPO"; "$MCV_TEST_NODE" "$MCV_TEST_CLI" restore; code=$?; print -r -- EXIT_CODE:$code; exit $code}',
      'expect -exact {No complete and verified deployment backup is available.}',
      'expect -exact {Apply disabled}',
      'send "\\r"',
      'after 100',
      'expect -exact {Restore Latest Deployment · Review}',
      'send "q"',
      'expect -exact {EXIT_CODE:0}',
      'expect eof',
      'set result [wait]',
      'exit [lindex $result 3]',
    ], { MCV_TEST_REPO: noBackupRepository });

    const conflictFixture = createRestoreRepository(true);
    const conflict = await runExpect([
      'set timeout 5',
      'log_user 1',
      'spawn /bin/zsh -f -c {cd "$MCV_TEST_REPO"; "$MCV_TEST_NODE" "$MCV_TEST_CLI" restore; code=$?; print -r -- EXIT_CODE:$code; exit $code}',
      'expect -exact {Restore Conflict:}',
      'expect -exact {Apply disabled}',
      'send "\\r"',
      'after 100',
      'expect -exact {Restore Latest Deployment · Review}',
      'send "q"',
      'expect -exact {EXIT_CODE:0}',
      'expect eof',
      'set result [wait]',
      'exit [lindex $result 3]',
    ], { MCV_TEST_REPO: conflictFixture.repositoryPath });

    expect(noBackup.code).toBe(0);
    expect(conflict.code).toBe(0);
    expect(fs.readFileSync(conflictFixture.targetPath, 'utf8'))
      .toBe('changed after deploy\n');
    expect(conflict.output).not.toMatch(/force restore/i);
    expectRestoredTerminal(noBackup.output);
    expectRestoredTerminal(conflict.output);
  }, 15_000);

  it('ignores q and Ctrl+C while Restore reports a rollback failure', async () => {
    const fixturePath = createRestoreRollbackFixture();
    const outcome = await runExpect([
      'set timeout 5',
      'log_user 1',
      'spawn /bin/zsh -f -c {"$MCV_TEST_NODE" "$MCV_TEST_SCRIPT"; code=$?; print -r -- EXIT_CODE:$code; exit $code}',
      'expect -exact {Restore Latest Deployment · Review}',
      'send "\\r"',
      'expect -exact {Restore Latest Deployment · Applying}',
      'send "q"',
      'send "\\003"',
      'expect -exact {Restore Latest Deployment · Result}',
      'expect -exact {Error code: restore.rollbackFailed}',
      'send "q"',
      'expect -exact {OUTCOME:completed}',
      'expect -exact {STATUS:failed}',
      'expect -exact {EXIT_CODE:0}',
      'expect eof',
      'set result [wait]',
      'exit [lindex $result 3]',
    ], { MCV_TEST_SCRIPT: fixturePath });

    expect(outcome.code).toBe(0);
    expectRestoredTerminal(outcome.output);
  }, 10_000);

  it('deep-links discover, navigates back to Overview, and exits cleanly', async () => {
    const outcome = await runExpect([
      'set timeout 5',
      'log_user 1',
      'spawn /bin/zsh -f -c {stty rows 24 columns 80; before=$(stty -g); "$MCV_TEST_NODE" "$MCV_TEST_CLI" discover; code=$?; after=$(stty -g); if [[ "$before" == "$after" ]]; then mode=restored; else mode=changed; fi; print -r -- INPUT_MODE:$mode; print -r -- EXIT_CODE:$code; exit $code}',
      'expect -exact {Environment Details}',
      'expect -exact {Gemini:}',
      'send "\\033"',
      'after 200',
      'expect -exact {Repository}',
      'send "q"',
      'expect -exact {IDEs detected; 0 missing variables.}',
      'expect -exact {INPUT_MODE:restored}',
      'expect -exact {EXIT_CODE:0}',
      'expect eof',
      'set result [wait]',
      'exit [lindex $result 3]',
    ]);

    expect(outcome.code).toBe(0);
    expectRestoredTerminal(outcome.output);
  }, 10_000);

  it('returns 130 on Ctrl+C before any Apply and restores the terminal', async () => {
    const outcome = await runExpect([
      'set timeout 5',
      'log_user 1',
      'spawn /bin/zsh -f -c {stty rows 24 columns 80; before=$(stty -g); "$MCV_TEST_NODE" "$MCV_TEST_CLI" status; code=$?; after=$(stty -g); if [[ "$before" == "$after" ]]; then mode=restored; else mode=changed; fi; print -r -- INPUT_MODE:$mode; print -r -- EXIT_CODE:$code; exit $code}',
      'expect -exact {Ctrl+C Cancel}',
      'after 100',
      'send "\\003"',
      'expect -exact {MCV interrupted.}',
      'expect -exact {INPUT_MODE:restored}',
      'expect -exact {EXIT_CODE:130}',
      'expect eof',
      'set result [wait]',
      'exit [lindex $result 3]',
    ]);

    expect(outcome.code).toBe(130);
    expectRestoredTerminal(outcome.output);
  });

  it('keeps q and Ctrl+C available while a stale Capture Plan regenerates', async () => {
    const fixturePath = createRegeneratingCaptureFixture();
    for (const [input, reason] of [
      ['q', 'completed'],
      ['\\003', 'interrupted'],
    ] as const) {
      const outcome = await runExpect([
        'set timeout 5',
        'log_user 1',
        'spawn /bin/zsh -f -c {"$MCV_TEST_NODE" "$MCV_TEST_SCRIPT"; code=$?; print -r -- EXIT_CODE:$code; exit $code}',
        'expect -exact {Capture · Select Changes}',
        'send "\\r"',
        'expect -exact {Capture · Confirm Apply}',
        'send "\\r"',
        'expect -exact {Capture · Regenerating}',
        `send "${input}"`,
        `expect -exact {OUTCOME:${reason}}`,
        'expect -exact {EXIT_CODE:0}',
        'expect eof',
        'set result [wait]',
        'exit [lindex $result 3]',
      ], { MCV_TEST_SCRIPT: fixturePath });

      expect(outcome.code).toBe(0);
      expectRestoredTerminal(outcome.output);
    }
  }, 10_000);

  it('labels a direct-route failure with the page that actually failed', async () => {
    const fixturePath = createFailingOverviewFixture();
    const outcome = await runExpect([
      'set timeout 5',
      'log_user 1',
      'spawn /bin/zsh -f -c {"$MCV_TEST_NODE" "$MCV_TEST_SCRIPT"; code=$?; print -r -- EXIT_CODE:$code; exit $code}',
      'expect -exact {Failed: simulated Overview failure}',
      'send "q"',
      'expect -exact {OUTCOME:simulated Overview failure}',
      'expect -exact {EXIT_CODE:0}',
      'expect eof',
      'set result [wait]',
      'exit [lindex $result 3]',
    ], { MCV_TEST_SCRIPT: fixturePath });

    expect(outcome.output).toContain('Overview failed:');
    expect(outcome.output).not.toContain('Environment Details failed:');
    expectRestoredTerminal(outcome.output);
  });

  it('restores the terminal after an uncaught Shell exception', async () => {
    const fixturePath = path.join(testRoot, 'crash-shell.mjs');
    const shellModuleUrl = new URL(
      `file://${path.join(process.cwd(), 'dist', 'tui', 'shell.js')}`,
    ).href;
    fs.writeFileSync(fixturePath, [
      `import { runTuiShell } from ${JSON.stringify(shellModuleUrl)};`,
      'await runTuiShell(',
      "  { homeDir: process.env.HOME, platform: process.platform, env: process.env },",
      "  'overview',",
      '  {',
      `    inspectRepository: () => (${JSON.stringify(validRepositoryReport())}),`,
      "    inspectOverview: () => { throw new Error('simulated uncaught TUI failure'); },",
      '  },',
      ');',
      '',
    ].join('\n'));

    const outcome = await runExpect([
      'set timeout 5',
      'log_user 1',
      'spawn /bin/zsh -f -c {stty rows 24 columns 80; before=$(stty -g); "$MCV_TEST_NODE" "$MCV_TEST_SCRIPT"; code=$?; after=$(stty -g); if [[ "$before" == "$after" ]]; then mode=restored; else mode=changed; fi; print -r -- INPUT_MODE:$mode; print -r -- EXIT_CODE:$code; exit $code}',
      'expect -exact {simulated uncaught TUI failure}',
      'expect -exact {INPUT_MODE:restored}',
      'expect -exact {EXIT_CODE:1}',
      'expect eof',
      'set result [wait]',
      'exit [lindex $result 3]',
    ], { MCV_TEST_SCRIPT: fixturePath });

    expect(outcome.code).toBe(1);
    expectRestoredTerminal(outcome.output);
  });

  it('restores the terminal when the initial render throws', async () => {
    const fixturePath = path.join(testRoot, 'crash-initial-render.mjs');
    const shellModuleUrl = new URL(
      `file://${path.join(process.cwd(), 'dist', 'tui', 'shell.js')}`,
    ).href;
    fs.writeFileSync(fixturePath, [
      `import { runTuiShell } from ${JSON.stringify(shellModuleUrl)};`,
      'await runTuiShell(',
      "  { homeDir: process.env.HOME, platform: process.platform, env: process.env },",
      "  'overview',",
      '  {},',
      '  { render: () => {',
      "    process.stdout.write('\\u001b[?1049h\\u001b[?25l');",
      '    process.stdin.setRawMode?.(true);',
      "    throw new Error('simulated initial render failure');",
      '  } },',
      ');',
      '',
    ].join('\n'));

    const outcome = await runExpect([
      'set timeout 5',
      'log_user 1',
      'spawn /bin/zsh -f -c {stty rows 24 columns 80; before=$(stty -g); "$MCV_TEST_NODE" "$MCV_TEST_SCRIPT"; code=$?; after=$(stty -g); if [[ "$before" == "$after" ]]; then mode=restored; else mode=changed; fi; print -r -- INPUT_MODE:$mode; print -r -- EXIT_CODE:$code; exit $code}',
      'expect -exact {simulated initial render failure}',
      'expect -exact {INPUT_MODE:restored}',
      'expect -exact {EXIT_CODE:1}',
      'expect eof',
      'set result [wait]',
      'exit [lindex $result 3]',
    ], { MCV_TEST_SCRIPT: fixturePath });

    expect(outcome.output).toContain('EXIT_CODE:1');
    expectRestoredTerminal(outcome.output);
  });

  it('keeps explicit plain and JSON routes out of the alternate screen', async () => {
    const outcome = await runExpect([
      'set timeout 5',
      'log_user 1',
      'spawn /bin/zsh -f -c {"$MCV_TEST_NODE" "$MCV_TEST_CLI" discover --plain; plain=$?; "$MCV_TEST_NODE" "$MCV_TEST_CLI" discover --json; json=$?; print -r -- ROUTE_CODES:$plain,$json; exit $((plain || json))}',
      'expect -exact {ROUTE_CODES:0,0}',
      'expect eof',
      'set result [wait]',
      'exit [lindex $result 3]',
    ]);

    expect(outcome.code).toBe(0);
    expect(outcome.output).toContain('Codex:');
    expect(outcome.output).toContain('"operation": "discover"');
    expect(outcome.output).not.toContain('\u001b[?1049h');
    expect(outcome.output).not.toContain('\u001b[?1049l');
  });

  function runExpect(
    lines: string[],
    extraEnvironment: NodeJS.ProcessEnv = {},
  ): Promise<{ code: number | null; output: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn(expectPath, ['-c', lines.join('\n')], {
        env: {
          ...process.env,
          CI: 'false',
          HOME: testRoot,
          USERPROFILE: testRoot,
          APPDATA: testRoot,
          MCV_TEST_NODE: process.execPath,
          MCV_TEST_CLI: cliPath,
          ...extraEnvironment,
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let output = '';
      const timeout = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error(`Timed out waiting for TUI. Output: ${output}`));
      }, 7_000);
      const collect = (chunk: Buffer): void => {
        output += chunk.toString('utf8');
      };
      child.stdout.on('data', collect);
      child.stderr.on('data', collect);
      child.once('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.once('exit', (code) => {
        clearTimeout(timeout);
        resolve({ code, output });
      });
    });
  }

  function createCaptureRepository(): string {
    const repositoryPath = path.join(testRoot, 'repository');
    fs.mkdirSync(repositoryPath);
    fs.writeFileSync(path.join(repositoryPath, 'mcv.yaml'), [
      'schemaVersion: 2',
      'repositoryId: tui-capture-test',
      'initializedAt: 2026-07-27T00:00:00.000Z',
      'security: { scanSecrets: true, allowPlaintextSecrets: false }',
      'capture: { preserveUnknownNativeFields: true }',
      'deploy: { backupBeforeWrite: true, useSymlinks: false }',
      'targets: {}',
      'variables: {}',
      '',
    ].join('\n'));
    return repositoryPath;
  }

  function createSchemaOneRepository(): string {
    const repositoryPath = path.join(testRoot, 'schema-one-repository');
    fs.mkdirSync(repositoryPath);
    fs.writeFileSync(path.join(repositoryPath, 'mcv.yaml'), [
      'schemaVersion: 1',
      'repositoryId: tui-migration-test',
      'initializedAt: 2026-07-27T00:00:00.000Z',
      'targets: {}',
      '',
    ].join('\n'));
    return repositoryPath;
  }

  function statePath(): string {
    if (process.platform === 'darwin') {
      return path.join(
        testRoot,
        'Library',
        'Application Support',
        'mcv',
        'config.json',
      );
    }
    if (process.platform === 'win32') {
      return path.join(testRoot, 'mcv', 'config.json');
    }
    return path.join(testRoot, '.config', 'mcv', 'config.json');
  }

  function writeBinding(repositoryPath: string, repositoryId: string): void {
    fs.mkdirSync(path.dirname(statePath()), { recursive: true });
    fs.writeFileSync(statePath(), `${JSON.stringify({
      schemaVersion: 2,
      repositoryPath,
      defaultRepositoryId: repositoryId,
    }, null, 2)}\n`);
  }

  function readBinding(): Record<string, unknown> {
    return JSON.parse(fs.readFileSync(statePath(), 'utf8')) as Record<string, unknown>;
  }

  function createRestoreRepository(conflict = false): {
    repositoryPath: string;
    targetPath: string;
  } {
    const repositoryPath = path.join(
      testRoot,
      conflict ? 'conflict-repository' : 'restore-repository',
    );
    fs.mkdirSync(repositoryPath);
    fs.writeFileSync(path.join(repositoryPath, 'mcv.yaml'), [
      'schemaVersion: 2',
      'repositoryId: tui-restore-test',
      'initializedAt: 2026-07-27T00:00:00.000Z',
      'security: { scanSecrets: true, allowPlaintextSecrets: false }',
      'capture: { preserveUnknownNativeFields: true }',
      'deploy: { backupBeforeWrite: true, useSymlinks: false }',
      'targets: {}',
      'variables: {}',
      '',
    ].join('\n'));
    writeBinding(repositoryPath, 'tui-restore-test');
    const targetPath = path.join(testRoot, conflict ? 'conflict.json' : 'settings.json');
    const beforeContent = 'before deploy\n';
    const deployedContent = 'after deploy\n';
    fs.writeFileSync(
      targetPath,
      conflict ? 'changed after deploy\n' : deployedContent,
    );
    const backupDirectory = path.join(
      path.dirname(statePath()),
      'backups',
      'deploy-20260727',
    );
    fs.mkdirSync(path.join(backupDirectory, 'files'), { recursive: true });
    fs.writeFileSync(path.join(backupDirectory, 'files', 'settings.json'), beforeContent);
    fs.writeFileSync(path.join(backupDirectory, 'manifest.json'), `${JSON.stringify({
      createdAt: '2026-07-27T08:30:00.000Z',
      status: 'complete',
      files: [{
        action: 'modify',
        originalPath: targetPath,
        backupPath: 'files/settings.json',
        beforeHash: digest(beforeContent),
        afterHash: digest(deployedContent),
      }],
    }, null, 2)}\n`);
    return { repositoryPath, targetPath };
  }

  function createRestoreRollbackFixture(): string {
    const fixturePath = path.join(testRoot, 'restore-rollback.mjs');
    const shellModuleUrl = new URL(
      `file://${path.join(process.cwd(), 'dist', 'tui', 'shell.js')}`,
    ).href;
    const plan = {
      schemaVersion: 1,
      operation: 'restore',
      status: 'planned',
      readyToApply: true,
      operationId: 'restore-pty',
      preconditions: {},
      repositoryPath: '/tmp/mcv',
      backup: {
        id: 'deploy-20260727',
        createdAt: '2026-07-27T08:30:00.000Z',
      },
      changes: [{
        id: 'restore-settings',
        action: 'restore',
        targetPath: '/tmp/settings.json',
      }],
      issues: [],
      nextActions: [],
    };
    const failed = {
      schemaVersion: 1,
      operation: 'restore',
      status: 'failed',
      repositoryPath: '/tmp/mcv',
      changes: [],
      issues: [],
      nextActions: ['Recover from the pre-restore backup.'],
      error: {
        code: 'restore.rollbackFailed',
        message: 'simulated rollback failure',
        nextActions: ['Recover from the pre-restore backup.'],
      },
    };
    fs.writeFileSync(fixturePath, [
      `import { runTuiShell } from ${JSON.stringify(shellModuleUrl)};`,
      `const plan = ${JSON.stringify(plan)};`,
      `const failed = ${JSON.stringify(failed)};`,
      'const outcome = await runTuiShell(',
      "  { homeDir: process.env.HOME, platform: process.platform, env: process.env },",
      "  'restore',",
      '  {',
      `    inspectRepository: () => (${JSON.stringify(validRepositoryReport())}),`,
      '    createRestorePlan: () => plan,',
      '    applyRestorePlan: async () => {',
      '      await new Promise((resolve) => setTimeout(resolve, 300));',
      '      return failed;',
      '    },',
      '  },',
      ');',
      "process.stdout.write(`OUTCOME:${outcome.reason}\\n`);",
      "process.stdout.write(`STATUS:${outcome.operationStatus}\\n`);",
      '',
    ].join('\n'));
    return fixturePath;
  }

  function createRegeneratingCaptureFixture(): string {
    const fixturePath = path.join(testRoot, 'regenerating-capture.mjs');
    const shellModuleUrl = new URL(
      `file://${path.join(process.cwd(), 'dist', 'tui', 'shell.js')}`,
    ).href;
    fs.writeFileSync(fixturePath, [
      `import { runTuiShell } from ${JSON.stringify(shellModuleUrl)};`,
      `const plan = ${JSON.stringify({
        schemaVersion: 1,
        operation: 'capture',
        status: 'planned',
        readyToApply: true,
        operationId: 'regeneration-test',
        preconditions: {},
        repositoryPath: '/tmp/mcv',
        changes: [],
        issues: [],
        nextActions: [],
        summary: {
          sensitiveFieldCount: 0,
          parameterizedPathCount: 0,
          excludedFileCount: 0,
        },
      })};`,
      `const stale = ${JSON.stringify({
        schemaVersion: 1,
        operation: 'capture',
        status: 'failed',
        repositoryPath: '/tmp/mcv',
        changes: [],
        issues: [],
        nextActions: ['Regenerate.'],
        error: {
          code: 'operation.stalePlan',
          message: 'Plan stale.',
          nextActions: ['Regenerate.'],
        },
      })};`,
      'let loadCount = 0;',
      'const outcome = await runTuiShell(',
      "  { homeDir: process.env.HOME, platform: process.platform, env: process.env },",
      "  'capture',",
      '  {',
      `    inspectRepository: () => (${JSON.stringify(validRepositoryReport())}),`,
      '    createCapturePlan: async () => {',
      '      loadCount += 1;',
      '      return loadCount === 1 ? plan : new Promise(() => {});',
      '    },',
      '    applyCapturePlan: async () => stale,',
      '  },',
      ');',
      "process.stdout.write(`OUTCOME:${outcome.reason}\\n`);",
      '',
    ].join('\n'));
    return fixturePath;
  }

  function createFailingOverviewFixture(): string {
    const fixturePath = path.join(testRoot, 'failing-overview.mjs');
    const shellModuleUrl = new URL(
      `file://${path.join(process.cwd(), 'dist', 'tui', 'shell.js')}`,
    ).href;
    fs.writeFileSync(fixturePath, [
      `import { runTuiShell } from ${JSON.stringify(shellModuleUrl)};`,
      'const outcome = await runTuiShell(',
      "  { homeDir: process.env.HOME, platform: process.platform, env: process.env },",
      "  'overview',",
      '  {',
      `    inspectRepository: () => (${JSON.stringify(validRepositoryReport())}),`,
      "    inspectOverview: async () => { throw new Error('simulated Overview failure'); },",
      '  },',
      ');',
      "process.stdout.write(`Overview failed: ${outcome.failureMessage}\\n`);",
      "process.stdout.write(`OUTCOME:${outcome.failureMessage}\\n`);",
      '',
    ].join('\n'));
    return fixturePath;
  }

  function validRepositoryReport(): Record<string, unknown> {
    return {
      schemaVersion: 1,
      operation: 'repository',
      status: 'reported',
      ready: true,
      repositoryPath: '/tmp/mcv',
      repositoryId: 'test-repository',
      repositorySchemaVersion: 2,
      valid: true,
      changes: [],
      issues: [],
      nextActions: [],
    };
  }

  function createDeployWorkflowFixture(): string {
    const fixturePath = path.join(testRoot, 'deploy-workflow.mjs');
    const shellModuleUrl = new URL(
      `file://${path.join(process.cwd(), 'dist', 'tui', 'shell.js')}`,
    ).href;
    const plan = {
      schemaVersion: 1,
      operation: 'deploy',
      status: 'planned',
      readyToApply: true,
      operationId: 'deploy-pty',
      preconditions: {},
      repositoryPath: '/tmp/mcv',
      changes: [
        {
          id: 'deploy-first',
          ide: 'codex',
          capability: 'rules',
          name: 'Shared Rules',
          targetPath: '/tmp/AGENTS.md',
          change: 'modify',
          defaultSelected: true,
          group: 'standard',
          strategy: 'replace-entire-file',
          preview: {
            targetPath: '/tmp/AGENTS.md',
            kind: 'text',
            bytes: 10,
            sha256: 'a'.repeat(64),
            diff: '- old\\n+ new',
          },
        },
        {
          id: 'deploy-second',
          ide: 'codex',
          capability: 'mcp',
          name: 'MCP',
          targetPath: '/tmp/config.toml',
          change: 'modify',
          defaultSelected: true,
          group: 'standard',
          strategy: 'managed-merge',
          preview: {
            targetPath: '/tmp/config.toml',
            kind: 'text',
            bytes: 10,
            sha256: 'b'.repeat(64),
            diff: '- old\\n+ new',
          },
        },
      ],
      issues: [{
        severity: 'warning',
        code: 'deploy.warning',
        message: 'Review the target before Apply.',
      }],
      nextActions: [],
    };
    const failed = {
      schemaVersion: 1,
      operation: 'deploy',
      status: 'failed',
      repositoryPath: '/tmp/mcv',
      changes: [],
      issues: [],
      nextActions: ['Generate a new Deploy Plan.'],
      error: {
        code: 'deploy.transactionFailed',
        message: 'simulated transaction failure',
        nextActions: ['Generate a new Deploy Plan.'],
      },
    };
    fs.writeFileSync(fixturePath, [
      `import { runTuiShell } from ${JSON.stringify(shellModuleUrl)};`,
      `const plan = ${JSON.stringify(plan)};`,
      `const failed = ${JSON.stringify(failed)};`,
      'let selected = [];',
      'const outcome = await runTuiShell(',
      "  { homeDir: process.env.HOME, platform: process.platform, env: process.env },",
      "  'deploy',",
      '  {',
      '    inspectRepository: () => ({ valid: true }),',
      '    createDeployPlan: async () => plan,',
      '    applyDeployPlan: async (_context, _plan, selection) => {',
      '      selected = selection.changeIds;',
      '      await new Promise((resolve) => setTimeout(resolve, 300));',
      '      return failed;',
      '    },',
      '  },',
      ');',
      "process.stdout.write(`SELECTED:${selected.join(',')}\\n`);",
      "process.stdout.write(`OUTCOME:${outcome.reason}\\n`);",
      "process.stdout.write(`STATUS:${outcome.operationStatus}\\n`);",
      '',
    ].join('\n'));
    return fixturePath;
  }
});

function digest(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function expectRestoredTerminal(output: string): void {
  expect(output).toContain('\u001b[?1049h');
  expect(output).toContain('\u001b[?1049l');
  expect(output).toContain('\u001b[?25l');
  expect(output).toContain('\u001b[?25h');
}
