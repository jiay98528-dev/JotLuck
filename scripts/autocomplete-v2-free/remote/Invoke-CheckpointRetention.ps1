#requires -Version 7.0
[CmdletBinding(SupportsShouldProcess, ConfirmImpact = 'High')]
param(
    [Parameter(Mandatory)][switch]$Apply,
    [Parameter(Mandatory)][string]$CheckpointRoot,
    [Parameter(Mandatory)][string]$IndexPath,
    [Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{64}$')][string]$ExpectedIndexSha256,
    [ValidateSet('higher-is-better', 'lower-is-better')][string]$ScoreDirection = 'higher-is-better'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

if (-not $Apply) { throw 'Checkpoint deletion requires explicit -Apply.' }

function Resolve-CheckpointFile {
    param([Parameter(Mandatory)][string]$Root, [Parameter(Mandatory)][string]$RelativePath)
    if ([string]::IsNullOrWhiteSpace($RelativePath) -or $RelativePath.Contains([char]0) -or
        $RelativePath.Contains('\') -or $RelativePath.StartsWith('/') -or $RelativePath -match '^[A-Za-z]:') {
        throw "Unsafe checkpoint path: $RelativePath"
    }
    if (@($RelativePath.Split('/') | Where-Object { $_ -in @('', '.', '..') }).Count -gt 0) {
        throw "Unsafe checkpoint path: $RelativePath"
    }
    $rootFull = [IO.Path]::GetFullPath($Root).TrimEnd([IO.Path]::DirectorySeparatorChar)
    $candidate = [IO.Path]::GetFullPath([IO.Path]::Combine($rootFull, $RelativePath.Replace('/', [IO.Path]::DirectorySeparatorChar)))
    if (-not $candidate.StartsWith($rootFull + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Checkpoint path escaped its root: $RelativePath"
    }
    return $candidate
}

$root = (Resolve-Path -LiteralPath $CheckpointRoot -ErrorAction Stop).Path
$index = (Resolve-Path -LiteralPath $IndexPath -ErrorAction Stop).Path
$indexPrefix = $root.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
if (-not $index.StartsWith($indexPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Checkpoint index must be inside CheckpointRoot.'
}
$actualIndexSha256 = (Get-FileHash -LiteralPath $index -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actualIndexSha256 -ne $ExpectedIndexSha256) { throw 'Checkpoint index SHA-256 mismatch.' }
$records = @(Get-Content -Raw -Encoding utf8 -LiteralPath $index | ConvertFrom-Json -Depth 10)
if ($records.Count -eq 0) { throw 'Checkpoint index is empty.' }

$seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
foreach ($record in $records) {
    $relativePath = [string]$record.relativePath
    if (-not $seen.Add($relativePath)) { throw "Duplicate checkpoint path: $relativePath" }
    if ([int64]$record.step -lt 0 -or -not [double]::IsFinite([double]$record.score) -or
        [int64]$record.bytes -lt 1 -or [string]$record.sha256 -notmatch '^[a-f0-9]{64}$') {
        throw "Invalid checkpoint record: $relativePath"
    }
    $filePath = Resolve-CheckpointFile -Root $root -RelativePath $relativePath
    if (-not [IO.File]::Exists($filePath)) { throw "Checkpoint file is missing: $relativePath" }
    $fileInfo = Get-Item -LiteralPath $filePath
    if ($fileInfo.Attributes.HasFlag([IO.FileAttributes]::ReparsePoint) -or $fileInfo.Length -ne [int64]$record.bytes) {
        throw "Checkpoint file identity mismatch: $relativePath"
    }
    $actualSha256 = (Get-FileHash -LiteralPath $filePath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualSha256 -ne [string]$record.sha256) { throw "Checkpoint SHA-256 mismatch: $relativePath" }
}

$latest = @($records | Sort-Object @{ Expression = { [int64]$_.step }; Descending = $true }, `
    @{ Expression = { [DateTimeOffset]::Parse([string]$_.createdAt) }; Descending = $true } | Select-Object -First 2)
$best = if ($ScoreDirection -eq 'higher-is-better') {
    $records | Sort-Object @{ Expression = { [double]$_.score }; Descending = $true }, `
        @{ Expression = { [int64]$_.step }; Descending = $true } | Select-Object -First 1
} else {
    $records | Sort-Object @{ Expression = { [double]$_.score }; Descending = $false }, `
        @{ Expression = { [int64]$_.step }; Descending = $true } | Select-Object -First 1
}
$keep = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
foreach ($record in $latest) { [void]$keep.Add([string]$record.relativePath) }
[void]$keep.Add([string]$best.relativePath)

$deleted = @()
foreach ($record in $records) {
    $relativePath = [string]$record.relativePath
    if ($keep.Contains($relativePath)) { continue }
    $filePath = Resolve-CheckpointFile -Root $root -RelativePath $relativePath
    if ($PSCmdlet.ShouldProcess($filePath, 'Delete checkpoint outside last-two-plus-best retention')) {
        Remove-Item -LiteralPath $filePath -Force
        $deleted += $relativePath
    }
}

[ordered]@{
    policy = 'last-two-plus-best'
    kept = @($keep)
    deleted = $deleted
    indexSha256 = $actualIndexSha256
} | ConvertTo-Json -Depth 4
