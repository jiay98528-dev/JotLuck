#requires -Version 7.0
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$JobPath,
    [Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{64}$')][string]$ExpectedJobSha256,
    [Parameter(Mandatory)][string]$TrainingPythonPath,
    [Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{64}$')][string]$ExpectedTrainingPythonSha256,
    [Parameter(Mandatory)][string]$GitPath,
    [Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{64}$')][string]$ExpectedGitSha256,
    [Parameter(Mandatory)][string]$WorkspaceRoot,
    [Parameter(Mandatory)][string]$StateRoot,
    [ValidateRange(5, 300)][int]$HeartbeatSeconds = 15
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

function Test-SafeRelativePath {
    param([Parameter(Mandatory)][string]$Path)
    if ([string]::IsNullOrWhiteSpace($Path) -or $Path.Contains([char]0) -or $Path.Contains('\')) { return $false }
    if ($Path.StartsWith('/') -or $Path -match '^[A-Za-z]:') { return $false }
    foreach ($part in $Path.Split('/')) {
        if ($part -in @('', '.', '..')) { return $false }
    }
    return $true
}

function Resolve-ChildPath {
    param(
        [Parameter(Mandatory)][string]$Root,
        [Parameter(Mandatory)][string]$RelativePath,
        [switch]$MustExist
    )
    if (-not (Test-SafeRelativePath -Path $RelativePath)) { throw "Unsafe relative path: $RelativePath" }
    $rootFull = [IO.Path]::GetFullPath($Root).TrimEnd([IO.Path]::DirectorySeparatorChar)
    $candidate = [IO.Path]::GetFullPath([IO.Path]::Combine($rootFull, $RelativePath.Replace('/', [IO.Path]::DirectorySeparatorChar)))
    $prefix = $rootFull + [IO.Path]::DirectorySeparatorChar
    if (-not $candidate.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Path escaped its root: $RelativePath"
    }
    if ($MustExist -and -not (Test-Path -LiteralPath $candidate)) { throw "Required path is missing: $RelativePath" }
    return $candidate
}

function Assert-Sha256 {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][string]$ExpectedSha256,
        [Parameter(Mandatory)][string]$Label
    )
    if ($ExpectedSha256 -notmatch '^[a-f0-9]{64}$') { throw "$Label has an invalid SHA-256." }
    $actual = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $ExpectedSha256) { throw "$Label SHA-256 mismatch." }
}

function Write-AtomicUtf8Json {
    param(
        [Parameter(Mandatory)]$Value,
        [Parameter(Mandatory)][string]$Path
    )
    $directory = [IO.Path]::GetDirectoryName($Path)
    if (-not [IO.Directory]::Exists($directory)) { [IO.Directory]::CreateDirectory($directory) | Out-Null }
    $temporary = [IO.Path]::Combine($directory, ".$(Split-Path -Leaf $Path).$([Guid]::NewGuid().ToString('N')).tmp")
    $json = $Value | ConvertTo-Json -Depth 12
    [IO.File]::WriteAllText($temporary, $json + "`n", [Text.UTF8Encoding]::new($false))
    [IO.File]::Move($temporary, $Path, $true)
}

function New-ResultState {
    param([Parameter(Mandatory)][string]$Status)
    $now = [DateTimeOffset]::UtcNow.ToString('o')
    return [ordered]@{
        schema = 'jotluck.autocomplete.v2-free.remote-training-result.v1'
        jobId = $script:job.jobId
        jobFileSha256 = $ExpectedJobSha256
        status = $Status
        createdAt = $script:createdAt
        heartbeatAt = $now
    }
}

function Write-StateAndHeartbeat {
    param([Parameter(Mandatory)]$State)
    $State.heartbeatAt = [DateTimeOffset]::UtcNow.ToString('o')
    Write-AtomicUtf8Json -Value $State -Path $script:statusPath
    Write-AtomicUtf8Json -Value ([ordered]@{
        schema = 'jotluck.autocomplete.v2-free.remote-heartbeat.v1'
        jobId = $script:job.jobId
        status = $State.status
        heartbeatAt = $State.heartbeatAt
    }) -Path $script:heartbeatPath
}

function Quote-ProcessArgument {
    param([Parameter(Mandatory)][string]$Value)
    if ($Value.Contains([char]0) -or $Value.Contains('"')) {
        throw 'Recipe arguments must not contain NUL or a double quote.'
    }
    return '"' + $Value + '"'
}

$workspace = (Resolve-Path -LiteralPath $WorkspaceRoot -ErrorAction Stop).Path
$stateRootResolved = (Resolve-Path -LiteralPath $StateRoot -ErrorAction Stop).Path
$jobFile = (Resolve-Path -LiteralPath $JobPath -ErrorAction Stop).Path
$trainingPythonExecutable = (Resolve-Path -LiteralPath $TrainingPythonPath -ErrorAction Stop).Path
$gitExecutable = (Resolve-Path -LiteralPath $GitPath -ErrorAction Stop).Path
Assert-Sha256 -Path $jobFile -ExpectedSha256 $ExpectedJobSha256 -Label 'Training job file'
Assert-Sha256 -Path $trainingPythonExecutable -ExpectedSha256 $ExpectedTrainingPythonSha256 -Label 'Training Python executable'
Assert-Sha256 -Path $gitExecutable -ExpectedSha256 $ExpectedGitSha256 -Label 'Git executable'
$script:job = Get-Content -Raw -Encoding utf8 -LiteralPath $jobFile | ConvertFrom-Json -Depth 20
if ($job.schema -ne 'jotluck.autocomplete.v2-free.remote-training-job.v1') { throw 'Unsupported job schema.' }
if ($job.jobId -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$') { throw 'Invalid job ID.' }
if ($job.model.engine -ne 'public-v2-free-decoder-v1' -or $job.model.format -ne 'JLFDQ02') {
    throw 'Job is not a V2 free decoder job.'
}
$trainingSelections = @{
    '16m-q4' = [ordered]@{ parameterCount = 16000000; candidates = @('16m-q4', '16m-q8') }
    '24m-q4' = [ordered]@{ parameterCount = 24000000; candidates = @('24m-q4') }
    '32m-q4' = [ordered]@{ parameterCount = 32000000; candidates = @('32m-q4') }
}
$trainingMatrixId = [string]$job.selection.matrixId
if (-not $trainingSelections.ContainsKey($trainingMatrixId)) {
    throw 'Training selection must be 16m-q4, 24m-q4, or 32m-q4; standalone 16m-q8 is forbidden.'
}
$expectedSelection = $trainingSelections[$trainingMatrixId]
$actualCandidates = @($job.selection.candidateMatrixIds | ForEach-Object { [string]$_ })
if ([int64]$job.selection.parameterCount -ne [int64]$expectedSelection.parameterCount -or
    [string]$job.selection.quantization -ne 'q4' -or
    $actualCandidates.Count -ne $expectedSelection.candidates.Count -or
    (Compare-Object -ReferenceObject $expectedSelection.candidates -DifferenceObject $actualCandidates -SyncWindow 0).Count -ne 0) {
    throw 'Training selection outputs do not match the fixed recipe matrix.'
}

$script:statusPath = Resolve-ChildPath -Root $stateRootResolved -RelativePath ([string]$job.output.statusPath)
$script:heartbeatPath = Resolve-ChildPath -Root $stateRootResolved -RelativePath ([string]$job.output.heartbeatPath)
if ($statusPath -eq $heartbeatPath) { throw 'Status and heartbeat paths must differ.' }
$script:createdAt = [DateTimeOffset]::UtcNow.ToString('o')
$queued = New-ResultState -Status 'queued'
Write-StateAndHeartbeat -State $queued

$process = $null
$running = $null
try {
    $deadline = [DateTimeOffset]::Parse(
        [string]$job.deadlineAt,
        [Globalization.CultureInfo]::InvariantCulture,
        [Globalization.DateTimeStyles]::AdjustToUniversal
    )
    if ([DateTimeOffset]::UtcNow -ge $deadline) { throw 'Job deadline has already passed.' }

    $recipePath = Resolve-ChildPath -Root $workspace -RelativePath ([string]$job.recipe.relativePath) -MustExist
    Assert-Sha256 -Path $recipePath -ExpectedSha256 ([string]$job.recipe.sha256) -Label 'Training recipe'
    foreach ($inputReference in @($job.inputs)) {
        $inputPath = Resolve-ChildPath -Root $workspace -RelativePath ([string]$inputReference.relativePath) -MustExist
        $inputFile = Get-Item -LiteralPath $inputPath
        if ($inputFile.PSIsContainer -or $inputFile.Length -ne [int64]$inputReference.bytes) {
            throw "Input byte count mismatch: $($inputReference.id)"
        }
        Assert-Sha256 -Path $inputPath -ExpectedSha256 ([string]$inputReference.sha256) -Label "Input $($inputReference.id)"
    }

    $actualCommit = (& $gitExecutable -C $workspace rev-parse 'HEAD^{commit}').Trim()
    if ($LASTEXITCODE -ne 0 -or $actualCommit -ne $job.sourceTree.commit) { throw 'Source commit mismatch.' }
    $actualTree = (& $gitExecutable -C $workspace rev-parse 'HEAD^{tree}').Trim()
    if ($LASTEXITCODE -ne 0 -or $actualTree -ne $job.sourceTree.tree) { throw 'Source tree mismatch.' }

    $outputRoot = Resolve-ChildPath -Root $workspace -RelativePath ([string]$job.output.rootDirectory)
    [IO.Directory]::CreateDirectory($outputRoot) | Out-Null
    $checkpointRoot = Resolve-ChildPath -Root $workspace -RelativePath ([string]$job.resume.checkpointDirectory)
    [IO.Directory]::CreateDirectory($checkpointRoot) | Out-Null
    $checkpointBundle = [IO.Path]::Combine($checkpointRoot, 'checkpoint-bundle.json')
    if ($job.resume.mode -eq 'required' -and -not [IO.File]::Exists($checkpointBundle)) {
        throw 'Required checkpoint bundle is missing.'
    }
    $hasCheckpointBundleSha256 = $job.resume.PSObject.Properties.Name -contains 'checkpointBundleSha256'
    if ($hasCheckpointBundleSha256) {
        if (-not [IO.File]::Exists($checkpointBundle)) { throw 'Declared checkpoint bundle is missing.' }
        Assert-Sha256 -Path $checkpointBundle -ExpectedSha256 ([string]$job.resume.checkpointBundleSha256) -Label 'Checkpoint bundle'
    }

    $extension = [IO.Path]::GetExtension($recipePath).ToLowerInvariant()
    $trainingHost = switch ($extension) {
        '.ps1' { (Get-Command pwsh.exe -ErrorAction Stop).Source }
        '.py' { $trainingPythonExecutable }
        { $_ -in @('.js', '.mjs', '.cjs') } { (Get-Command node.exe -ErrorAction Stop).Source }
        '.exe' { $recipePath }
        default { throw "Unsupported recipe extension: $extension" }
    }
    $processArguments = @()
    if ($extension -ne '.exe') {
        if ($extension -eq '.ps1') { $processArguments += @('-NoProfile', '-NonInteractive', '-File') }
        $processArguments += $recipePath
    }
    $processArguments += @($job.recipe.arguments | ForEach-Object { [string]$_ })

    $env:JOTLUCK_REMOTE_JOB_ID = [string]$job.jobId
    $env:JOTLUCK_REMOTE_JOB_SHA256 = $ExpectedJobSha256
    $env:JOTLUCK_REMOTE_MODEL_SELECTION = [string]$job.selection.matrixId
    $env:JOTLUCK_REMOTE_CANDIDATE_MATRIX_IDS = $actualCandidates -join ','
    $env:JOTLUCK_REMOTE_SEED = [string]$job.seed
    $env:JOTLUCK_REMOTE_OUTPUT_ROOT = $outputRoot
    $env:JOTLUCK_REMOTE_CHECKPOINT_ROOT = $checkpointRoot
    $env:JOTLUCK_REMOTE_RESUME_MODE = [string]$job.resume.mode

    $stdoutPath = [IO.Path]::Combine($outputRoot, 'training.stdout.log')
    $stderrPath = [IO.Path]::Combine($outputRoot, 'training.stderr.log')
    $running = New-ResultState -Status 'running'
    $running.startedAt = [DateTimeOffset]::UtcNow.ToString('o')
    Write-StateAndHeartbeat -State $running
    $quotedArguments = @($processArguments | ForEach-Object { Quote-ProcessArgument -Value ([string]$_) }) -join ' '
    $process = Start-Process -FilePath $trainingHost -ArgumentList $quotedArguments -WorkingDirectory $workspace `
        -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -WindowStyle Hidden -PassThru

    while (-not $process.HasExited) {
        if ([DateTimeOffset]::UtcNow -ge $deadline) {
            Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
            throw 'Job deadline exceeded.'
        }
        Write-StateAndHeartbeat -State $running
        Start-Sleep -Seconds $HeartbeatSeconds
        $process.Refresh()
    }
    if ($process.ExitCode -ne 0) { throw "Training process exited with code $($process.ExitCode)." }

    $bundleRelativePath = ([string]$job.output.rootDirectory).TrimEnd('/') + '/' + ([string]$job.output.bundleName)
    $bundleRoot = Resolve-ChildPath -Root $workspace -RelativePath $bundleRelativePath -MustExist
    $manifestPath = [IO.Path]::Combine($bundleRoot, 'manifest.json')
    if (-not [IO.File]::Exists($manifestPath)) { throw 'Training output manifest is missing.' }
    $manifest = Get-Content -Raw -Encoding utf8 -LiteralPath $manifestPath | ConvertFrom-Json -Depth 20
    if ($manifest.schema -ne 'jotluck.autocomplete.v2-free.remote-bundle.v1' -or
        $manifest.jobId -ne $job.jobId -or $manifest.sourceJobSha256 -ne $ExpectedJobSha256 -or
        [string]$manifest.bundleSha256 -notmatch '^[a-f0-9]{64}$') {
        throw 'Training output manifest identity is invalid.'
    }
    $verifiedBytes = [int64]0
    foreach ($fileReference in @($manifest.files)) {
        $filePath = Resolve-ChildPath -Root $bundleRoot -RelativePath ([string]$fileReference.relativePath) -MustExist
        $fileInfo = Get-Item -LiteralPath $filePath
        if ($fileInfo.PSIsContainer -or $fileInfo.Attributes.HasFlag([IO.FileAttributes]::ReparsePoint)) {
            throw "Bundle contains an invalid file: $($fileReference.relativePath)"
        }
        if ($fileInfo.Length -ne [int64]$fileReference.bytes) { throw 'Bundle file byte count mismatch.' }
        Assert-Sha256 -Path $filePath -ExpectedSha256 ([string]$fileReference.sha256) -Label 'Bundle file'
        $verifiedBytes += $fileInfo.Length
    }
    if ($verifiedBytes -ne [int64]$manifest.totalBytes) { throw 'Bundle total byte count mismatch.' }

    $completed = New-ResultState -Status 'completed'
    $completed.startedAt = $running.startedAt
    $completed.finishedAt = [DateTimeOffset]::UtcNow.ToString('o')
    $completed.outputBundle = [ordered]@{
        manifestPath = $bundleRelativePath + '/manifest.json'
        bytes = $verifiedBytes
        sha256 = [string]$manifest.bundleSha256
    }
    Write-StateAndHeartbeat -State $completed
}
catch {
    if ($null -ne $process -and -not $process.HasExited) {
        Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    }
    $message = [string]$_.Exception.Message
    if ($message.Length -gt 2000) { $message = $message.Substring(0, 2000) }
    $failed = New-ResultState -Status 'failed'
    if ($null -ne $running) { $failed.startedAt = $running.startedAt }
    else { $failed.startedAt = [DateTimeOffset]::UtcNow.ToString('o') }
    $failed.finishedAt = [DateTimeOffset]::UtcNow.ToString('o')
    $failed.failure = [ordered]@{ code = 'training-runner-failed'; message = $message; retryable = $false }
    Write-StateAndHeartbeat -State $failed
    throw
}
