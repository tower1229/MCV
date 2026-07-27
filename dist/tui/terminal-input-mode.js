import { spawnSync, } from 'node:child_process';
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
export function preserveTerminalInputMode(platform, spawn = spawnSync) {
    if (platform !== 'win32')
        return () => undefined;
    const captured = runPowerShell(spawn, CAPTURE_MODE_SCRIPT);
    const mode = parseMode(captured);
    if (mode === undefined)
        return () => undefined;
    return () => {
        const restoreModeScript = [
            POWERSHELL_PREFIX,
            "$modeType = $type.GetNestedType('ConsoleModes', [Reflection.BindingFlags]::NonPublic)",
            `$modeValue = [Enum]::ToObject($modeType, [uint32]${mode})`,
            "$type.GetMethod('SetMode', $flags).Invoke($null, @($handle, $modeValue))",
        ].join('; ');
        runPowerShell(spawn, restoreModeScript);
    };
}
function runPowerShell(spawn, script) {
    return spawn('powershell.exe', [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        script,
    ], {
        encoding: 'utf8',
        timeout: 5_000,
        windowsHide: true,
    });
}
function parseMode(result) {
    if (result.status !== 0)
        return undefined;
    const value = Number.parseInt(result.stdout.trim(), 10);
    return Number.isInteger(value) && value >= 0 ? value : undefined;
}
