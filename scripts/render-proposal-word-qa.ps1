param(
  [Parameter(Mandatory = $true)][string]$DocxPath,
  [Parameter(Mandatory = $true)][string]$OutputDir,
  [Parameter(Mandatory = $true)][string]$ReportPath,
  [Parameter(Mandatory = $true)][string]$PythonPath,
  [Parameter(Mandatory = $true)][string]$PidPath
)

$ErrorActionPreference = 'Stop'
$docx = [System.IO.Path]::GetFullPath($DocxPath)
$output = [System.IO.Path]::GetFullPath($OutputDir)
$report = [System.IO.Path]::GetFullPath($ReportPath)
$pidFile = [System.IO.Path]::GetFullPath($PidPath)
$stageFile = [System.IO.Path]::ChangeExtension($pidFile, '.stage.txt')
[System.IO.File]::WriteAllText($stageFile, 'preflight')
if (-not (Test-Path -LiteralPath $docx)) { throw "DOCX not found: $docx" }
if (-not (Test-Path -LiteralPath $PythonPath)) { throw "Python not found: $PythonPath" }
New-Item -ItemType Directory -Path $output -Force | Out-Null

$bundledPdftoppm = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\native\poppler\Library\bin\pdftoppm.exe'
$pdftoppmCandidates = @(
  $env:QA_PDFTOPPM_PATH
  $bundledPdftoppm
  (Get-Command pdftoppm.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -ErrorAction SilentlyContinue)
  (Get-Command pdftoppm -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -ErrorAction SilentlyContinue)
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }
$pdftoppm = $pdftoppmCandidates | Select-Object -First 1
if (-not $pdftoppm) {
  throw 'pdftoppm was not found. Set QA_PDFTOPPM_PATH or install the bundled Codex Poppler runtime.'
}
[System.IO.File]::WriteAllText($stageFile, 'preflight-complete')

$pdf = Join-Path $output 'proposal.pdf'
$word = $null
$documents = $null
$document = $null
$safeWordProcess = $null
try {
  $registeredWinword = (Get-ItemProperty -LiteralPath 'Registry::HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\Winword.exe' -ErrorAction SilentlyContinue).'(default)'
  $winwordCandidates = @(
    $env:QA_WINWORD_PATH
    $registeredWinword
    'C:\Program Files\Microsoft Office\Root\Office16\WINWORD.EXE'
  ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }
  $winword = $winwordCandidates | Select-Object -First 1
  if (-not $winword) { throw 'Microsoft Word was not found. Set QA_WINWORD_PATH to WINWORD.EXE.' }

  $existingWordProcesses = @(Get-Process -Name WINWORD -ErrorAction SilentlyContinue)
  if ($existingWordProcesses.Count -gt 0) {
    throw 'Microsoft Word is currently in use. Close Word before the proposal QA retry.'
  }

  [System.IO.File]::WriteAllText($stageFile, 'starting-word-safe-mode')
  # Safe mode prevents third-party PDF add-ins from intercepting Word's native
  # PDF export. The worker already waits until no interactive Word process is
  # running, so this safe-mode instance can be bound without /x spawning a
  # second registration context.
  $safeWordProcess = Start-Process -FilePath $winword -ArgumentList @('/safe', '/q', '/n') -WindowStyle Hidden -PassThru
  # Word needs a short startup window before it registers the safe-mode COM
  # application. Calling GetObject earlier can create a second normal instance.
  Start-Sleep -Seconds 4
  Add-Type -AssemblyName Microsoft.VisualBasic
  $word = [Microsoft.VisualBasic.Interaction]::GetObject($null, 'Word.Application')
  $qaWordProcesses = @(Get-Process -Name WINWORD -ErrorAction SilentlyContinue | Sort-Object Id)
  if ($qaWordProcesses.Count -lt 1 -or $qaWordProcesses.Count -gt 2 -or $safeWordProcess.Id -notin $qaWordProcesses.Id) {
    throw 'Could not safely bind to the isolated Microsoft Word process'
  }
  [System.IO.File]::WriteAllLines($pidFile, @($qaWordProcesses | ForEach-Object { [string]$_.Id }))
  [System.IO.File]::WriteAllText($stageFile, 'word-created')

  $word.Visible = $false
  $word.DisplayAlerts = 0
  $word.AutomationSecurity = 3
  $word.Options.UpdateLinksAtOpen = $false
  $word.Options.ConfirmConversions = $false
  $documents = $word.Documents
  [System.IO.File]::WriteAllText($stageFile, 'opening-document')
  $document = $documents.Open($docx, $false, $true)
  [System.IO.File]::WriteAllText($stageFile, 'document-opened')
  [System.IO.File]::WriteAllText($stageFile, 'exporting-pdf')
  $document.ExportAsFixedFormat($pdf, 17)
  [System.IO.File]::WriteAllText($stageFile, 'pdf-exported')
} finally {
  if ($document) {
    $document.Close(0)
    [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($document)
  }
  if ($documents) { [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($documents) }
  if ($word) {
    $word.Quit()
    [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($word)
  }
  if ($safeWordProcess -and -not $safeWordProcess.HasExited) {
    Stop-Process -Id $safeWordProcess.Id -Force -ErrorAction SilentlyContinue
  }
  $document = $null
  $documents = $null
  $word = $null
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}

& $pdftoppm -png -r 144 $pdf (Join-Path $output 'page')
if ($LASTEXITCODE -ne 0) { throw 'pdftoppm failed' }

$analyzer = Join-Path $PSScriptRoot 'proposal-qa-analyze.py'
$contactSheet = Join-Path $output 'contact-sheet.png'
& $PythonPath $analyzer --pages $output --report $report --contact-sheet $contactSheet
if ($LASTEXITCODE -ne 0) { throw 'Proposal QA analyzer failed' }
[System.IO.File]::WriteAllText($stageFile, 'complete')
