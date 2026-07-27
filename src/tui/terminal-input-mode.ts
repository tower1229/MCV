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
) => Pick<SpawnSyncReturns<string>, 'status' | 'stdout' | 'stderr'>;

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

export function preserveTerminalInputMode(
  platform: NodeJS.Platform,
  spawn: Spawn = spawnSync,
): () => void {
  if (platform !== 'win32') return () => undefined;

  const captured = runPowerShell(spawn, CAPTURE_MODE_SCRIPT);
  reportDiagnostics('capture', captured);
  const mode = parseMode(captured);
  if (mode === undefined) return () => undefined;

  return () => {
    const restoreModeScript = [
      POWERSHELL_PREFIX,
      "$modeType = $type.GetNestedType('ConsoleModes', [Reflection.BindingFlags]::NonPublic)",
      `$modeValue = [Enum]::ToObject($modeType, [uint32]${mode})`,
      "$type.GetMethod('SetMode', $flags).Invoke($null, @($handle, $modeValue))",
    ].join('; ');
    const restored = runPowerShell(spawn, restoreModeScript);
    reportDiagnostics('restore', restored);
  };
}

function runPowerShell(
  spawn: Spawn,
  script: string,
): Pick<SpawnSyncReturns<string>, 'status' | 'stdout' | 'stderr'> {
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

function reportDiagnostics(
  phase: 'capture' | 'restore',
  result: Pick<SpawnSyncReturns<string>, 'status' | 'stdout' | 'stderr'>,
): void {
  if (process.env.MCV_TEST_TERMINAL_MODE_DIAGNOSTICS !== 'true') return;
  process.stderr.write(
    `TERMINAL_MODE_${phase.toUpperCase()}:`
      + `${result.status}:${result.stdout.trim()}:${result.stderr.trim()}\n`,
  );
}
