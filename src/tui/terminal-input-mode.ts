import {
  spawnSync,
  type SpawnSyncReturns,
} from 'node:child_process';

type Spawn = (
  command: string,
  args: readonly string[],
  options: {
    encoding: 'utf8';
    stdio: ['inherit', 'pipe', 'pipe'];
    timeout: number;
    windowsHide: boolean;
  },
) => Pick<SpawnSyncReturns<string>, 'status' | 'stdout'>;

const POWERSHELL_PREFIX = [
  '$flags = [Reflection.BindingFlags]::Static -bor [Reflection.BindingFlags]::NonPublic',
  '$type = [AppDomain]::CurrentDomain.GetAssemblies()'
    + " | ForEach-Object { $_.GetType('Microsoft.PowerShell.ConsoleControl', $false) }"
    + ' | Where-Object { $null -ne $_ }'
    + ' | Select-Object -First 1',
  "if ($null -eq $type) { exit 1 }",
  "$handle = $type.GetMethod('GetConioDeviceHandle', $flags).Invoke($null, @())",
].join('; ');

const CAPTURE_MODE_SCRIPT = [
  POWERSHELL_PREFIX,
  "$mode = $type.GetMethod('GetMode', $flags).Invoke($null, @($handle))",
  'Write-Output ([uint32]$mode)',
].join('; ');

export interface RestorableStdin {
  isTTY?: boolean;
  ref?: () => unknown;
  resume?: () => unknown;
  pause?: () => unknown;
  read?: () => unknown;
}

export function restoreStdinKeepAlive(stdin: RestorableStdin = process.stdin): void {
  if (!stdin.isTTY || typeof stdin.ref !== 'function') return;
  stdin.ref();
  if (typeof stdin.read !== 'function' || typeof stdin.resume !== 'function') return;
  try {
    stdin.resume();
    while (stdin.read() !== null) {
      // Discard keys that arrived while the TUI still owned the terminal.
    }
    stdin.pause?.();
  } catch {
    // Test doubles and non-readable stdin cannot be drained.
  }
}

export function preserveTerminalInputMode(
  platform: NodeJS.Platform,
  spawn: Spawn = spawnSync,
): () => void {
  if (platform !== 'win32') return () => restoreStdinKeepAlive();

  const captured = runPowerShell(spawn, CAPTURE_MODE_SCRIPT);
  const mode = parseMode(captured);
  if (mode === undefined) {
    throw new Error('Could not capture the Windows console input mode.');
  }

  return () => {
    try {
      const restoreModeScript = [
        POWERSHELL_PREFIX,
        "$modeType = $type.GetNestedType('ConsoleModes', [Reflection.BindingFlags]::NonPublic)",
        `$modeValue = [Enum]::ToObject($modeType, [uint32]${mode})`,
        "$type.GetMethod('SetMode', $flags).Invoke($null, @($handle, $modeValue))",
      ].join('; ');
      const restored = runPowerShell(spawn, restoreModeScript);
      if (restored.status !== 0) {
        throw new Error('Could not restore the Windows console input mode.');
      }
    } finally {
      restoreStdinKeepAlive();
    }
  };
}

function runPowerShell(
  spawn: Spawn,
  script: string,
): Pick<SpawnSyncReturns<string>, 'status' | 'stdout'> {
  return spawn(
    'powershell.exe',
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      script,
    ],
    {
      encoding: 'utf8',
      stdio: ['inherit', 'pipe', 'pipe'],
      timeout: 5_000,
      windowsHide: true,
    },
  );
}

function parseMode(
  result: Pick<SpawnSyncReturns<string>, 'status' | 'stdout'>,
): number | undefined {
  if (result.status !== 0) return undefined;
  const value = Number.parseInt(result.stdout.trim(), 10);
  return Number.isInteger(value) && value >= 0 ? value : undefined;
}
