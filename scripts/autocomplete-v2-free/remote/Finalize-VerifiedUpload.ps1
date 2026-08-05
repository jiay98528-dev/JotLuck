#requires -Version 7.0
[CmdletBinding(SupportsShouldProcess, ConfirmImpact = 'High')]
param(
    [Parameter(Mandatory)][string]$TargetRoot,
    [Parameter(Mandatory)][string]$IncomingDirectory,
    [Parameter(Mandatory)][ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$')][string]$FinalDirectoryName,
    [Parameter(Mandatory)][ValidatePattern('^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$')][string]$TransferId,
    [Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{64}$')][string]$ExpectedManifestFileSha256,
    [Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{64}$')][string]$ExpectedBundleSha256
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

function Test-SafeRelativePath {
    param([Parameter(Mandatory)][string]$Path)
    if ([string]::IsNullOrWhiteSpace($Path) -or $Path.Contains([char]0) -or $Path.Contains('\')) { return $false }
    if ($Path.StartsWith('/') -or $Path -match '^[A-Za-z]:') { return $false }
    return @($Path.Split('/') | Where-Object { $_ -in @('', '.', '..') }).Count -eq 0
}

function Resolve-BundleChild {
    param([Parameter(Mandatory)][string]$Root, [Parameter(Mandatory)][string]$RelativePath)
    if (-not (Test-SafeRelativePath -Path $RelativePath)) { throw "Unsafe bundle path: $RelativePath" }
    $rootFull = [IO.Path]::GetFullPath($Root).TrimEnd([IO.Path]::DirectorySeparatorChar)
    $candidate = [IO.Path]::GetFullPath([IO.Path]::Combine($rootFull, $RelativePath.Replace('/', [IO.Path]::DirectorySeparatorChar)))
    if (-not $candidate.StartsWith($rootFull + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Bundle path escaped its root: $RelativePath"
    }
    return $candidate
}

$target = (Resolve-Path -LiteralPath $TargetRoot -ErrorAction Stop).Path.TrimEnd([IO.Path]::DirectorySeparatorChar)
$incoming = (Resolve-Path -LiteralPath $IncomingDirectory -ErrorAction Stop).Path
$incomingItem = Get-Item -LiteralPath $incoming
if (-not $incomingItem.PSIsContainer -or $incomingItem.Attributes.HasFlag([IO.FileAttributes]::ReparsePoint)) {
    throw 'Incoming upload must be a real directory, not a file, junction, or symbolic link.'
}
$expectedTemporaryName = ".$FinalDirectoryName.upload-$TransferId.tmp"
if ($incomingItem.Name -ne $expectedTemporaryName) { throw "Incoming directory must be named $expectedTemporaryName." }
if ([IO.Path]::GetDirectoryName($incoming) -ne $target) {
    throw 'Incoming and final directories must share TargetRoot so rename stays on one volume.'
}
$final = [IO.Path]::Combine($target, $FinalDirectoryName)
if ([IO.Directory]::Exists($final) -or [IO.File]::Exists($final)) { throw 'Final upload target already exists.' }

$allDirectories = @(Get-ChildItem -LiteralPath $incoming -Directory -Force -Recurse)
if (@($allDirectories | Where-Object { $_.Attributes.HasFlag([IO.FileAttributes]::ReparsePoint) }).Count -gt 0) {
    throw 'Incoming upload contains a junction or symbolic link.'
}
$manifestPath = [IO.Path]::Combine($incoming, 'manifest.json')
if (-not [IO.File]::Exists($manifestPath)) { throw 'Incoming upload has no manifest.json.' }
$manifestFileSha256 = (Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($manifestFileSha256 -ne $ExpectedManifestFileSha256) { throw 'Manifest file SHA-256 mismatch.' }
$manifest = Get-Content -Raw -Encoding utf8 -LiteralPath $manifestPath | ConvertFrom-Json -Depth 20
if ($manifest.schema -ne 'jotluck.autocomplete.v2-free.remote-bundle.v1' -or
    [string]$manifest.bundleSha256 -ne $ExpectedBundleSha256 -or
    [string]$manifest.sourceJobSha256 -notmatch '^[a-f0-9]{64}$') {
    throw 'Bundle manifest identity is invalid.'
}

$listedPaths = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
$totalBytes = [int64]0
foreach ($fileReference in @($manifest.files)) {
    $relativePath = [string]$fileReference.relativePath
    if (-not $listedPaths.Add($relativePath)) { throw "Duplicate manifest path: $relativePath" }
    if ([string]$fileReference.sha256 -notmatch '^[a-f0-9]{64}$' -or [int64]$fileReference.bytes -lt 1) {
        throw "Invalid manifest file record: $relativePath"
    }
    $filePath = Resolve-BundleChild -Root $incoming -RelativePath $relativePath
    if (-not [IO.File]::Exists($filePath)) { throw "Manifest file is missing: $relativePath" }
    $fileInfo = Get-Item -LiteralPath $filePath
    if ($fileInfo.Attributes.HasFlag([IO.FileAttributes]::ReparsePoint)) { throw "Manifest file is a link: $relativePath" }
    if ($fileInfo.Length -ne [int64]$fileReference.bytes) { throw "Byte count mismatch: $relativePath" }
    $actualSha256 = (Get-FileHash -LiteralPath $filePath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualSha256 -ne [string]$fileReference.sha256) { throw "SHA-256 mismatch: $relativePath" }
    $totalBytes += $fileInfo.Length
}
if ($listedPaths.Count -eq 0 -or $totalBytes -ne [int64]$manifest.totalBytes) {
    throw 'Bundle file list or total byte count is invalid.'
}

$actualRelativeFiles = @(Get-ChildItem -LiteralPath $incoming -File -Force -Recurse | ForEach-Object {
    [IO.Path]::GetRelativePath($incoming, $_.FullName).Replace('\', '/')
})
$unexpectedFiles = @($actualRelativeFiles | Where-Object { $_ -ne 'manifest.json' -and -not $listedPaths.Contains($_) })
if ($unexpectedFiles.Count -gt 0) { throw "Bundle contains unexpected files: $($unexpectedFiles -join ', ')" }

if ($PSCmdlet.ShouldProcess($final, 'Atomically rename verified temporary upload')) {
    [IO.Directory]::Move($incoming, $final)
}

[ordered]@{
    finalDirectory = $final
    manifestFileSha256 = $manifestFileSha256
    bundleSha256 = $ExpectedBundleSha256
    totalBytes = $totalBytes
    fileCount = $listedPaths.Count
} | ConvertTo-Json -Depth 4
