#requires -Version 5.1
#requires -RunAsAdministrator
[CmdletBinding(SupportsShouldProcess, ConfirmImpact = 'High')]
param(
    [switch]$Apply,
    [string]$TrainingRoot = 'D:\JotLuckTraining'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$POWERSHELL_VERSION = '7.6.4'
$POWERSHELL_ARCHIVE_SHA256 = '80832551c52809301e6071c8bac977beb5a2f1ec953eb4db9f94deb953333793'
$PYTHON_VERSION = '3.12.10'
$GIT_VERSION = '2.54.0'
$GIT_TAG = 'v2.54.0.windows.1'
$GIT_ASSET = "MinGit-$GIT_VERSION-64-bit.zip"

function Assert-DedicatedRoot {
    param([Parameter(Mandatory)][string]$Path)

    if (-not [IO.Path]::IsPathRooted($Path)) {
        throw 'TrainingRoot must be an absolute path.'
    }
    $full = [IO.Path]::GetFullPath($Path).TrimEnd([IO.Path]::DirectorySeparatorChar)
    if ($full -eq [IO.Path]::GetPathRoot($full)) {
        throw 'TrainingRoot must be a dedicated absolute directory, not a drive root.'
    }
    return $full
}

function Get-Sha256 {
    param([Parameter(Mandatory)][string]$Path)

    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Download-Atomic {
    param(
        [Parameter(Mandatory)][Uri]$Uri,
        [Parameter(Mandatory)][string]$Destination,
        [hashtable]$Headers = @{}
    )

    if ([IO.File]::Exists($Destination)) { return }
    $temporary = $Destination + '.download'
    if ([IO.File]::Exists($temporary)) {
        throw "Incomplete download already exists and must be reviewed: $temporary"
    }
    Invoke-WebRequest -UseBasicParsing -Uri $Uri -Headers $Headers -OutFile $temporary
    if (-not [IO.File]::Exists($temporary) -or (Get-Item -LiteralPath $temporary).Length -lt 1) {
        throw "Download produced no bytes: $Uri"
    }
    [IO.File]::Move($temporary, $Destination)
}

function Expand-ZipAtomic {
    param(
        [Parameter(Mandatory)][string]$Archive,
        [Parameter(Mandatory)][string]$Destination,
        [Parameter(Mandatory)][string]$RequiredRelativePath
    )

    if ([IO.Directory]::Exists($Destination)) { return }
    $staging = $Destination + '.extracting'
    if ([IO.Directory]::Exists($staging)) {
        throw "Incomplete extraction already exists and must be reviewed: $staging"
    }
    Expand-Archive -LiteralPath $Archive -DestinationPath $staging
    if (-not [IO.File]::Exists([IO.Path]::Combine($staging, $RequiredRelativePath))) {
        throw "Archive is missing required file: $RequiredRelativePath"
    }
    [IO.Directory]::Move($staging, $Destination)
}

function Get-PinnedGitAsset {
    $headers = @{ Accept = 'application/vnd.github+json'; 'User-Agent' = 'JotLuck-V2-Training-Bootstrap' }
    $releaseUri = "https://api.github.com/repos/git-for-windows/git/releases/tags/$GIT_TAG"
    $release = Invoke-RestMethod -UseBasicParsing -Uri $releaseUri -Headers $headers
    if ([string]$release.tag_name -ne $GIT_TAG -or [bool]$release.draft -or [bool]$release.prerelease) {
        throw 'Git for Windows release identity is invalid.'
    }
    $assets = @($release.assets | Where-Object { [string]$_.name -eq $GIT_ASSET })
    if ($assets.Count -ne 1) { throw "Expected exactly one Git asset named $GIT_ASSET." }
    $asset = $assets[0]
    if ([string]$asset.digest -notmatch '^sha256:[a-f0-9]{64}$') {
        throw 'Git release asset does not expose a SHA-256 digest.'
    }
    return [ordered]@{
        uri = [Uri]$asset.browser_download_url
        sha256 = ([string]$asset.digest).Substring(7)
        headers = $headers
    }
}

$root = Assert-DedicatedRoot -Path $TrainingRoot
$incoming = [IO.Path]::Combine($root, 'incoming', 'bootstrap')
$tools = [IO.Path]::Combine($root, 'tools')
$pwshArchive = [IO.Path]::Combine($incoming, "PowerShell-$POWERSHELL_VERSION-win-x64.zip")
$pwshRoot = [IO.Path]::Combine($tools, "pwsh-$POWERSHELL_VERSION")
$pwshPath = [IO.Path]::Combine($pwshRoot, 'pwsh.exe')
$pythonInstaller = [IO.Path]::Combine($incoming, "python-$PYTHON_VERSION-amd64.exe")
$pythonRoot = [IO.Path]::Combine($tools, 'Python312')
$pythonPath = [IO.Path]::Combine($pythonRoot, 'python.exe')
$gitArchive = [IO.Path]::Combine($incoming, $GIT_ASSET)
$gitRoot = [IO.Path]::Combine($tools, "MinGit-$GIT_VERSION")
$gitPath = [IO.Path]::Combine($gitRoot, 'cmd', 'git.exe')

$plan = [ordered]@{
    schema = 'jotluck.autocomplete.v2-free.fx15-tool-installation-plan.v1'
    applyRequested = [bool]$Apply
    trainingRoot = $root
    powershell = [ordered]@{
        version = $POWERSHELL_VERSION
        uri = "https://github.com/PowerShell/PowerShell/releases/download/v$POWERSHELL_VERSION/PowerShell-$POWERSHELL_VERSION-win-x64.zip"
        archiveSha256 = $POWERSHELL_ARCHIVE_SHA256
        target = $pwshPath
    }
    python = [ordered]@{
        version = $PYTHON_VERSION
        uri = "https://www.python.org/ftp/python/$PYTHON_VERSION/python-$PYTHON_VERSION-amd64.exe"
        verification = 'valid Authenticode signature issued to Python Software Foundation'
        target = $pythonPath
    }
    git = [ordered]@{
        version = "$GIT_VERSION.windows.1"
        releaseTag = $GIT_TAG
        asset = $GIT_ASSET
        verification = 'GitHub release asset SHA-256 digest'
        target = $gitPath
    }
    willNot = @('modify PATH', 'change SSH or firewall', 'create accounts', 'restart Windows', 'overwrite existing tool directories')
}

if (-not $Apply -or $WhatIfPreference) {
    $plan | ConvertTo-Json -Depth 6
    return
}
if (-not $PSCmdlet.ShouldProcess($root, 'Install pinned PowerShell, Python, and MinGit training tools')) {
    return
}

[IO.Directory]::CreateDirectory($incoming) | Out-Null
[IO.Directory]::CreateDirectory($tools) | Out-Null

$pwshUri = [Uri]$plan.powershell.uri
Download-Atomic -Uri $pwshUri -Destination $pwshArchive
if ((Get-Sha256 -Path $pwshArchive) -ne $POWERSHELL_ARCHIVE_SHA256) {
    throw 'PowerShell archive SHA-256 mismatch.'
}
Expand-ZipAtomic -Archive $pwshArchive -Destination $pwshRoot -RequiredRelativePath 'pwsh.exe'
$pwshIdentity = @(& $pwshPath -NoProfile -NonInteractive -Command '$PSVersionTable.PSVersion.ToString()')[-1].Trim()
if ($pwshIdentity -ne $POWERSHELL_VERSION) { throw "Unexpected PowerShell identity: $pwshIdentity" }

$pythonUri = [Uri]$plan.python.uri
Download-Atomic -Uri $pythonUri -Destination $pythonInstaller
$pythonSignature = Get-AuthenticodeSignature -LiteralPath $pythonInstaller
if ($pythonSignature.Status -ne 'Valid' -or
    $null -eq $pythonSignature.SignerCertificate -or
    $pythonSignature.SignerCertificate.Subject -notlike '*Python Software Foundation*') {
    throw "Python installer Authenticode validation failed: $($pythonSignature.Status)"
}
if (-not [IO.File]::Exists($pythonPath)) {
    if ([IO.Directory]::Exists($pythonRoot)) { throw 'Python target exists without python.exe.' }
    $arguments = @(
        '/quiet'
        'InstallAllUsers=1'
        "TargetDir=$pythonRoot"
        'Include_pip=1'
        'Include_launcher=1'
        'InstallLauncherAllUsers=1'
        'Include_test=0'
        'Include_doc=0'
        'Include_tcltk=0'
        'Shortcuts=0'
        'PrependPath=0'
    )
    $pythonInstall = Start-Process -FilePath $pythonInstaller -ArgumentList $arguments -Wait -PassThru -WindowStyle Hidden
    if ($pythonInstall.ExitCode -notin @(0, 3010)) {
        throw "Python installer failed with exit code $($pythonInstall.ExitCode)."
    }
}
if (-not [IO.File]::Exists($pythonPath)) { throw 'Python executable is missing after installation.' }
$pythonIdentity = @(& $pythonPath -c 'import platform; print(platform.python_version())')[-1].Trim()
if ($pythonIdentity -ne $PYTHON_VERSION) { throw "Unexpected Python identity: $pythonIdentity" }

$gitAsset = Get-PinnedGitAsset
Download-Atomic -Uri $gitAsset.uri -Destination $gitArchive -Headers $gitAsset.headers
if ((Get-Sha256 -Path $gitArchive) -ne $gitAsset.sha256) { throw 'MinGit archive SHA-256 mismatch.' }
Expand-ZipAtomic -Archive $gitArchive -Destination $gitRoot -RequiredRelativePath 'cmd\git.exe'
$gitIdentity = @(& $gitPath --version)[-1].Trim()
if ($gitIdentity -ne "git version $GIT_VERSION.windows.1") { throw "Unexpected Git identity: $gitIdentity" }

[ordered]@{
    schema = 'jotluck.autocomplete.v2-free.fx15-tool-installation-result.v1'
    completedAt = [DateTimeOffset]::UtcNow.ToString('o')
    trainingRoot = $root
    powershell = [ordered]@{ version = $pwshIdentity; path = $pwshPath; sha256 = Get-Sha256 -Path $pwshPath }
    python = [ordered]@{
        version = $pythonIdentity
        path = $pythonPath
        sha256 = Get-Sha256 -Path $pythonPath
        installerSha256 = Get-Sha256 -Path $pythonInstaller
        signer = $pythonSignature.SignerCertificate.Subject
    }
    git = [ordered]@{ version = $gitIdentity; path = $gitPath; sha256 = Get-Sha256 -Path $gitPath; archiveSha256 = $gitAsset.sha256 }
    restartNeeded = $false
} | ConvertTo-Json -Depth 6
