param(
  [switch]$Once
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$workerEnvFile = Join-Path $repoRoot '.env.worker.local'
$defaultEnvFile = Join-Path $repoRoot '.env.local'
$envFile = if (Test-Path -LiteralPath $workerEnvFile) { $workerEnvFile } else { $defaultEnvFile }

if (-not (Test-Path -LiteralPath $envFile)) {
  throw "Missing $envFile"
}

foreach ($line in Get-Content -LiteralPath $envFile) {
  if ($line -match '^\s*#' -or $line -notmatch '=') { continue }
  $name, $value = $line -split '=', 2
  $name = $name.Trim()
  $value = $value.Trim().Trim('"').Trim("'")
  if ($name -in @('NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'QA_PYTHON_PATH', 'QA_POWERSHELL_PATH', 'QA_PDFTOPPM_PATH', 'QA_RENDER_TIMEOUT_MS')) {
    [Environment]::SetEnvironmentVariable($name, $value, 'Process')
  }
}

if (-not $env:NEXT_PUBLIC_SUPABASE_URL -or -not $env:SUPABASE_SERVICE_ROLE_KEY) {
  throw 'Supabase settings were not loaded from .env.local.'
}

$nodeCandidates = @(
  (Get-Command node.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -ErrorAction SilentlyContinue),
  (Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe')
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }

$node = $nodeCandidates | Select-Object -First 1
if (-not $node) { throw 'Node.js was not found.' }

$tsx = Join-Path $repoRoot 'node_modules\tsx\dist\cli.mjs'
$worker = Join-Path $repoRoot 'scripts\visual-qa-worker.ts'
if (-not (Test-Path -LiteralPath $tsx)) { throw 'Dependencies are missing. Run npm install first.' }

Set-Location -LiteralPath $repoRoot
$arguments = @($tsx, $worker)
if (-not $Once) { $arguments += '--watch' }
& $node @arguments
exit $LASTEXITCODE
