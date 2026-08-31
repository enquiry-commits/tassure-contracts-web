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
if (-not (Test-Path -LiteralPath $docx)) { throw "DOCX not found: $docx" }
if (-not (Test-Path -LiteralPath $PythonPath)) { throw "Python not found: $PythonPath" }
New-Item -ItemType Directory -Path $output -Force | Out-Null

$pdftoppmCommand = Get-Command pdftoppm.exe -ErrorAction SilentlyContinue
if (-not $pdftoppmCommand) { $pdftoppmCommand = Get-Command pdftoppm -ErrorAction SilentlyContinue }
if (-not $pdftoppmCommand) { throw 'pdftoppm was not found' }

$pdf = Join-Path $output 'proposal.pdf'
$word = $null
$documents = $null
$document = $null
try {
  $wordIdsBefore = @(Get-Process -Name WINWORD -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)
  $word = New-Object -ComObject Word.Application
  $newWordProcesses = @(Get-Process -Name WINWORD -ErrorAction SilentlyContinue |
    Where-Object { $wordIdsBefore -notcontains $_.Id } |
    Sort-Object StartTime -Descending)
  if ($newWordProcesses.Count -ne 1) { throw 'Could not safely identify the isolated Microsoft Word process' }
  $wordProcessId = $newWordProcesses[0].Id
  [System.IO.File]::WriteAllText($pidFile, [string]$wordProcessId)
  [System.IO.File]::WriteAllText($stageFile, 'word-created')
  $word.Visible = $false
  $word.DisplayAlerts = 0
  $word.AutomationSecurity = 3
  $word.Options.UpdateLinksAtOpen = $false
  $word.Options.ConfirmConversions = $false
  $documents = $word.Documents
  [System.IO.File]::WriteAllText($stageFile, 'opening-document')
  $document = $documents.OpenNoRepairDialog($docx, $false, $true, $false)
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
  $document = $null
  $documents = $null
  $word = $null
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}

& $pdftoppmCommand.Source -png -r 144 $pdf (Join-Path $output 'page')
if ($LASTEXITCODE -ne 0) { throw 'pdftoppm failed' }

$analyzer = Join-Path $PSScriptRoot 'proposal-qa-analyze.py'
$contactSheet = Join-Path $output 'contact-sheet.png'
& $PythonPath $analyzer --pages $output --report $report --contact-sheet $contactSheet
if ($LASTEXITCODE -ne 0) { throw 'Proposal QA analyzer failed' }
[System.IO.File]::WriteAllText($stageFile, 'complete')
