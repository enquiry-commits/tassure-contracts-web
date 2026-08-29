param(
  [string]$InputDir = "$PSScriptRoot\..\artifacts\visual-regression\documents",
  [string]$OutputDir = "$PSScriptRoot\..\artifacts\visual-regression\renders"
)

$ErrorActionPreference = 'Stop'
$inputRoot = [System.IO.Path]::GetFullPath($InputDir)
$outputRoot = [System.IO.Path]::GetFullPath($OutputDir)
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$allowedRoot = [System.IO.Path]::GetFullPath((Join-Path $projectRoot 'artifacts\visual-regression'))

if (-not $inputRoot.StartsWith($allowedRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "InputDir must stay within $allowedRoot"
}
if (-not $outputRoot.StartsWith($allowedRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "OutputDir must stay within $allowedRoot"
}
if (-not (Test-Path -LiteralPath $inputRoot)) { throw "Input directory not found: $inputRoot" }

$pdftoppmCommand = Get-Command pdftoppm.exe -ErrorAction SilentlyContinue
if (-not $pdftoppmCommand) { $pdftoppmCommand = Get-Command pdftoppm -ErrorAction SilentlyContinue }
if (-not $pdftoppmCommand) { throw 'pdftoppm was not found' }
$pdftoppm = $pdftoppmCommand.Source

$python = 'C:\Users\vincent\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
if (-not (Test-Path -LiteralPath $python)) {
  $pythonCommand = Get-Command python.exe -ErrorAction SilentlyContinue
  if (-not $pythonCommand) { throw 'Python runtime was not found' }
  $python = $pythonCommand.Source
}

New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null
function Export-DocxToPdf {
  param(
    [Parameter(Mandatory = $true)][string]$DocxPath,
    [Parameter(Mandatory = $true)][string]$PdfPath
  )

  # Isolate every render so one failed Word document cannot poison the rest
  # of the visual-regression batch through a leaked COM reference.
  $word = $null
  $documents = $null
  $document = $null
  try {
    $word = New-Object -ComObject Word.Application
    $word.Visible = $false
    $word.DisplayAlerts = 0
    $word.AutomationSecurity = 3
    $word.Options.UpdateLinksAtOpen = $false
    $word.Options.ConfirmConversions = $false
    $documents = $word.Documents
    $document = $documents.Open($DocxPath, $false, $true)

    # Format 17 is Word's native PDF output. SaveAs2 is more reliable than
    # ExportAsFixedFormat on this unattended Office installation.
    $document.SaveAs2($PdfPath, 17)
  } finally {
    if ($document) {
      $document.Close(0)
      [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($document)
    }
    if ($documents) {
      [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($documents)
    }
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
}

foreach ($file in Get-ChildItem -LiteralPath $inputRoot -Filter '*.docx' | Sort-Object Length, Name) {
    $scenarioDir = Join-Path $outputRoot $file.BaseName
    New-Item -ItemType Directory -Path $scenarioDir -Force | Out-Null
    Get-ChildItem -LiteralPath $scenarioDir -File -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -like 'page-*.png' -or $_.Extension -eq '.pdf' } |
      Remove-Item -Force

    $pdfPath = Join-Path $scenarioDir ($file.BaseName + '.pdf')
    Write-Output "$($file.BaseName): rendering with Microsoft Word"
    Export-DocxToPdf -DocxPath $file.FullName -PdfPath $pdfPath

    & $pdftoppm -png -r 144 $pdfPath (Join-Path $scenarioDir 'page')
    if ($LASTEXITCODE -ne 0) { throw "pdftoppm failed for $($file.Name)" }
    $pageCount = (Get-ChildItem -LiteralPath $scenarioDir -Filter 'page-*.png').Count
    if ($pageCount -eq 0) { throw "No PNG pages produced for $($file.Name)" }
    Write-Output "$($file.BaseName): $pageCount page(s)"
}

& $python (Join-Path $PSScriptRoot 'visual-contact-sheets.py') --renders $outputRoot
if ($LASTEXITCODE -ne 0) { throw 'Contact sheet generation failed' }
