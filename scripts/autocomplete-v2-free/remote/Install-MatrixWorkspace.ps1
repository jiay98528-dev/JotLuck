#requires -Version 7.0
[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidateSet('Extract', 'Finalize')][string]$Phase,
    [Parameter(Mandatory)][string]$StagingRoot,
    [Parameter(Mandatory)][string]$FinalWorkspaceRoot,
    [Parameter(Mandatory)][string]$SourceArchive,
    [Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{64}$')][string]$ExpectedSourceArchiveSha256,
    [Parameter(Mandatory)][string]$CorpusArchive,
    [Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{64}$')][string]$ExpectedCorpusArchiveSha256,
    [Parameter(Mandatory)][string]$SelectionRelativePath,
    [Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{64}$')][string]$ExpectedSelectionSha256,
    [Parameter(Mandatory)][string]$PlanRelativePath,
    [Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{64}$')][string]$ExpectedPlanSha256,
    [Parameter(Mandatory)][string]$StageReceiptRelativePath,
    [Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{64}$')][string]$ExpectedStageReceiptSha256,
    [Parameter(Mandatory)][string]$FingerprintAuditRelativePath,
    [Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{64}$')][string]$ExpectedFingerprintAuditSha256,
    [Parameter(Mandatory)][ValidatePattern('^(?:[a-f0-9]{40}|[a-f0-9]{64})$')][string]$ExpectedCommit,
    [Parameter(Mandatory)][ValidatePattern('^(?:[a-f0-9]{40}|[a-f0-9]{64})$')][string]$ExpectedTree,
    [Parameter(Mandatory)][string]$GitPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$extractReceiptName = '.jotluck-matrix-extract.json'
$installReceiptName = '.jotluck-matrix-install.json'

function Test-SafeRelativePath {
    param([Parameter(Mandatory)][string]$Value)
    $normalized = $Value.Replace('\', '/')
    if ([string]::IsNullOrWhiteSpace($normalized) -or $normalized.Contains([char]0) -or
        $normalized.StartsWith('/') -or $normalized -match '^[A-Za-z]:' -or
        @($normalized.Split('/') | Where-Object { $_ -in @('', '.', '..') }).Count -ne 0) {
        return $false
    }
    return $true
}

function Normalize-ArchivePath {
    param([Parameter(Mandatory)][string]$Value)
    $normalized = $Value.Replace('\', '/')
    while ($normalized.StartsWith('./')) { $normalized = $normalized.Substring(2) }
    return $normalized.TrimEnd('/')
}

function Resolve-SafeChild {
    param(
        [Parameter(Mandatory)][string]$Root,
        [Parameter(Mandatory)][string]$RelativePath,
        [switch]$MustExist
    )
    if (-not (Test-SafeRelativePath -Value $RelativePath)) { throw "Unsafe relative path: $RelativePath" }
    $rootFull = [IO.Path]::GetFullPath($Root).TrimEnd([IO.Path]::DirectorySeparatorChar)
    $candidate = [IO.Path]::GetFullPath([IO.Path]::Combine($rootFull, $RelativePath.Replace('/', [IO.Path]::DirectorySeparatorChar)))
    if (-not $candidate.StartsWith($rootFull + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Path escaped staging root: $RelativePath"
    }
    if ($MustExist -and -not [IO.File]::Exists($candidate)) { throw "Required file is missing: $RelativePath" }
    return $candidate
}

function Assert-FileHash {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][string]$Expected,
        [Parameter(Mandatory)][string]$Label
    )
    if (-not [IO.File]::Exists($Path)) { throw "$Label is missing." }
    $actual = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $Expected) { throw "$Label SHA-256 mismatch." }
}

function Get-SafeArchiveFiles {
    param([Parameter(Mandatory)][string]$Archive)
    $lines = @(& tar.exe -tzf $Archive)
    if ($LASTEXITCODE -ne 0 -or $lines.Count -eq 0) { throw "Cannot list archive: $Archive" }
    $files = [Collections.Generic.List[string]]::new()
    $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    foreach ($line in $lines) {
        $raw = [string]$line
        $isDirectory = $raw.EndsWith('/') -or $raw.EndsWith('\')
        $relative = Normalize-ArchivePath -Value $raw
        if ([string]::IsNullOrWhiteSpace($relative)) { continue }
        if (-not (Test-SafeRelativePath -Value $relative)) { throw "Archive contains unsafe path: $raw" }
        if (-not $seen.Add($relative)) { throw "Archive contains duplicate path: $relative" }
        if (-not $isDirectory) { $files.Add($relative) }
    }
    return @($files)
}

function Assert-NoReparsePoints {
    param([Parameter(Mandatory)][string]$Root)
    foreach ($entry in @(Get-ChildItem -LiteralPath $Root -Force -Recurse)) {
        if ($entry.Attributes.HasFlag([IO.FileAttributes]::ReparsePoint)) {
            throw "Extracted workspace contains a reparse point: $($entry.FullName)"
        }
    }
}

function Write-JsonExclusive {
    param([Parameter(Mandatory)]$Value, [Parameter(Mandatory)][string]$Path)
    $json = $Value | ConvertTo-Json -Depth 20
    $stream = [IO.File]::Open($Path, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try {
        $bytes = [Text.UTF8Encoding]::new($false).GetBytes($json + "`n")
        $stream.Write($bytes, 0, $bytes.Length)
        $stream.Flush($true)
    } finally { $stream.Dispose() }
}

$staging = [IO.Path]::GetFullPath($StagingRoot).TrimEnd([IO.Path]::DirectorySeparatorChar)
$final = [IO.Path]::GetFullPath($FinalWorkspaceRoot).TrimEnd([IO.Path]::DirectorySeparatorChar)
if ($staging -eq $final -or [IO.Directory]::Exists($final)) { throw 'Final workspace already exists or aliases staging.' }
Assert-FileHash -Path $SourceArchive -Expected $ExpectedSourceArchiveSha256 -Label 'Source archive'
Assert-FileHash -Path $CorpusArchive -Expected $ExpectedCorpusArchiveSha256 -Label 'Corpus archive'

if ($Phase -eq 'Extract') {
    if ([IO.Directory]::Exists($staging)) { throw 'Workspace staging directory already exists.' }
    $sourceFiles = Get-SafeArchiveFiles -Archive $SourceArchive
    $corpusFiles = Get-SafeArchiveFiles -Archive $CorpusArchive
    [IO.Directory]::CreateDirectory($staging) | Out-Null
    try {
        & tar.exe -xzf $SourceArchive -C $staging --no-same-owner --no-same-permissions
        if ($LASTEXITCODE -ne 0) { throw 'Source archive extraction failed.' }
        & tar.exe -xzf $CorpusArchive -C $staging --no-same-owner --no-same-permissions
        if ($LASTEXITCODE -ne 0) { throw 'Corpus archive extraction failed.' }
        Assert-NoReparsePoints -Root $staging
        $selectionPath = Resolve-SafeChild -Root $staging -RelativePath $SelectionRelativePath -MustExist
        Assert-FileHash -Path $selectionPath -Expected $ExpectedSelectionSha256 -Label 'Selection manifest'
        $selection = Get-Content -Raw -Encoding utf8 -LiteralPath $selectionPath | ConvertFrom-Json -Depth 30
        if ($selection.schema -ne 'jotluck.autocomplete.v2-free-licensed-corpus.v1' -or @($selection.documents).Count -eq 0) {
            throw 'Selection manifest is invalid.'
        }
        $expectedCorpusFiles = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
        if (-not $expectedCorpusFiles.Add($SelectionRelativePath)) { throw 'Selection path duplicated.' }
        [int64]$totalBytes = 0
        foreach ($document in @($selection.documents)) {
            $relative = [string]$document.relativePath
            if (-not (Test-SafeRelativePath -Value $relative) -or [string]$document.sha256 -notmatch '^[a-f0-9]{64}$' -or
                -not $expectedCorpusFiles.Add($relative)) { throw "Invalid or duplicate selection document: $relative" }
            $documentPath = Resolve-SafeChild -Root $staging -RelativePath $relative -MustExist
            $item = Get-Item -LiteralPath $documentPath
            if ($item.PSIsContainer -or $item.Attributes.HasFlag([IO.FileAttributes]::ReparsePoint)) { throw "Invalid corpus file: $relative" }
            Assert-FileHash -Path $documentPath -Expected ([string]$document.sha256) -Label "Corpus file $relative"
            $totalBytes += $item.Length
        }
        if ($totalBytes -ne [int64]$selection.selectedBytes) { throw 'Installed corpus byte total does not match selection.' }
        $actualCorpusFiles = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
        foreach ($relative in $corpusFiles) { if (-not $actualCorpusFiles.Add($relative)) { throw 'Corpus archive duplicates a file.' } }
        if (-not $actualCorpusFiles.SetEquals($expectedCorpusFiles)) { throw 'Corpus archive content does not exactly match the selection.' }
        $actualCommit = (& $GitPath -C $staging rev-parse 'HEAD^{commit}').Trim()
        if ($LASTEXITCODE -ne 0 -or $actualCommit -ne $ExpectedCommit) { throw 'Extracted source commit mismatch.' }
        $actualTree = (& $GitPath -C $staging rev-parse 'HEAD^{tree}').Trim()
        if ($LASTEXITCODE -ne 0 -or $actualTree -ne $ExpectedTree) { throw 'Extracted source tree mismatch.' }
        Write-JsonExclusive -Path ([IO.Path]::Combine($staging, $extractReceiptName)) -Value ([ordered]@{
            schema = 'jotluck.autocomplete.v2-free-matrix-extract.v1'
            sourceArchiveSha256 = $ExpectedSourceArchiveSha256
            corpusArchiveSha256 = $ExpectedCorpusArchiveSha256
            selectionSha256 = $ExpectedSelectionSha256
            sourceCommit = $ExpectedCommit
            sourceTree = $ExpectedTree
            corpusFiles = $corpusFiles.Count
            selectedBytes = $totalBytes
        })
        [ordered]@{ status = 'extracted'; stagingRoot = $staging; files = $corpusFiles.Count } | ConvertTo-Json -Compress
    } catch {
        if ([IO.Directory]::Exists($staging)) { Remove-Item -LiteralPath $staging -Recurse -Force }
        throw
    }
    exit 0
}

$extractReceiptPath = [IO.Path]::Combine($staging, $extractReceiptName)
if (-not [IO.File]::Exists($extractReceiptPath)) { throw 'Verified extraction receipt is missing.' }
$extractReceipt = Get-Content -Raw -Encoding utf8 -LiteralPath $extractReceiptPath | ConvertFrom-Json
if ($extractReceipt.schema -ne 'jotluck.autocomplete.v2-free-matrix-extract.v1' -or
    $extractReceipt.sourceArchiveSha256 -ne $ExpectedSourceArchiveSha256 -or
    $extractReceipt.corpusArchiveSha256 -ne $ExpectedCorpusArchiveSha256 -or
    $extractReceipt.selectionSha256 -ne $ExpectedSelectionSha256 -or
    $extractReceipt.sourceCommit -ne $ExpectedCommit -or $extractReceipt.sourceTree -ne $ExpectedTree) {
    throw 'Extraction receipt identity mismatch.'
}
$planPath = Resolve-SafeChild -Root $staging -RelativePath $PlanRelativePath -MustExist
Assert-FileHash -Path $planPath -Expected $ExpectedPlanSha256 -Label 'Matrix plan'
$stageReceiptPath = Resolve-SafeChild -Root $staging -RelativePath $StageReceiptRelativePath -MustExist
Assert-FileHash -Path $stageReceiptPath -Expected $ExpectedStageReceiptSha256 -Label 'Formal selection stage receipt'
$fingerprintAuditPath = Resolve-SafeChild -Root $staging -RelativePath $FingerprintAuditRelativePath -MustExist
Assert-FileHash -Path $fingerprintAuditPath -Expected $ExpectedFingerprintAuditSha256 -Label 'Formal fingerprint audit'
$plan = Get-Content -Raw -Encoding utf8 -LiteralPath $planPath | ConvertFrom-Json -Depth 30
if ($plan.schema -ne 'jotluck.autocomplete.v2-free.remote-matrix-plan.v1') { throw 'Matrix plan schema is invalid.' }
foreach ($file in @($plan.files)) {
    if ([string]$file.role -in @('source-bundle', 'training-corpus')) { continue }
    $filePath = Resolve-SafeChild -Root $staging -RelativePath ([string]$file.remoteRelativePath) -MustExist
    $item = Get-Item -LiteralPath $filePath
    if ($item.PSIsContainer -or $item.Length -ne [int64]$file.bytes) { throw "Matrix input byte mismatch: $($file.remoteRelativePath)" }
    Assert-FileHash -Path $filePath -Expected ([string]$file.sha256) -Label "Matrix input $($file.remoteRelativePath)"
}
Write-JsonExclusive -Path ([IO.Path]::Combine($staging, $installReceiptName)) -Value ([ordered]@{
    schema = 'jotluck.autocomplete.v2-free-matrix-install.v1'
    sourceArchiveSha256 = $ExpectedSourceArchiveSha256
    corpusArchiveSha256 = $ExpectedCorpusArchiveSha256
    selectionSha256 = $ExpectedSelectionSha256
    stageReceiptSha256 = $ExpectedStageReceiptSha256
    fingerprintAuditSha256 = $ExpectedFingerprintAuditSha256
    planSha256 = $ExpectedPlanSha256
    sourceCommit = $ExpectedCommit
    sourceTree = $ExpectedTree
})
Assert-NoReparsePoints -Root $staging
[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($final)) | Out-Null
[IO.Directory]::Move($staging, $final)
[ordered]@{ status = 'installed'; workspaceRoot = $final } | ConvertTo-Json -Compress
