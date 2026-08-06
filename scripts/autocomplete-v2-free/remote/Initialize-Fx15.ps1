#requires -Version 7.0
#requires -RunAsAdministrator
[CmdletBinding(SupportsShouldProcess, ConfirmImpact = 'High')]
param(
    [switch]$Apply,
    [PSCredential]$TrainingCredential,
    [string]$PublicKeyPath,
    [string]$Fx15TailscaleIPv4,
    [string]$ControlTailscaleIPv4,
    [string]$TrainingRoot = 'C:\JotLuckTraining',
    [switch]$InstallPackages,
    [switch]$EnableTailscaleUnattended,
    [switch]$InstallTrainingEnvironment,
    [switch]$ApprovePythonPackageSource,
    [switch]$ApprovePyTorchDownloadSource,
    [string]$BasePythonPath,
    [switch]$ConfigureAcPowerPolicy
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$TRAINING_USER = 'jotluck-train'
$OPENSSH_CAPABILITY = 'OpenSSH.Server~~~~0.0.1.0'
$PYTHON_WINGET_ID = 'Python.Python.3.12'
$TAILSCALE_WINGET_ID = 'Tailscale.Tailscale'
$PYTHON_REQUIRED_PREFIX = '3.12.'
$NUMPY_VERSION = '2.1.3'
$SENTENCEPIECE_VERSION = '0.2.1'
$PYTORCH_VERSION = '2.8.0'
$PYTORCH_CUDA_VERSION = '12.6'
$PYTHON_INDEX_URL = 'https://pypi.org/simple'
$PYTORCH_INDEX_URL = 'https://download.pytorch.org/whl/cu126'
$FIREWALL_RULE_NAME = 'JotLuck-FX15-Tailscale-SSH-In'
$AUTHORIZED_KEYS_NAME = 'jotluck-train_authorized_keys'

function Invoke-NativeChecked {
    param(
        [Parameter(Mandatory)][string]$FilePath,
        [Parameter(Mandatory)][string[]]$Arguments,
        [Parameter(Mandatory)][string]$Label
    )
    $output = @(& $FilePath @Arguments 2>&1)
    if ($LASTEXITCODE -ne 0) { throw "$Label failed with exit code $LASTEXITCODE`: $($output -join ' ')" }
    return $output
}

function ConvertTo-TailscaleIPv4 {
    param([Parameter(Mandatory)][string]$Value, [Parameter(Mandatory)][string]$Label)
    $address = $null
    if (-not [Net.IPAddress]::TryParse($Value, [ref]$address) -or
        $address.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork) {
        throw "$Label must be an IPv4 address."
    }
    $bytes = $address.GetAddressBytes()
    if ($bytes[0] -ne 100 -or $bytes[1] -lt 64 -or $bytes[1] -gt 127) {
        throw "$Label must be inside the Tailscale 100.64.0.0/10 range."
    }
    return $address.ToString()
}

function Get-PublicKeyLine {
    param([Parameter(Mandatory)][string]$Path)
    $resolved = (Resolve-Path -LiteralPath $Path -ErrorAction Stop).Path
    $item = Get-Item -LiteralPath $resolved
    if ($item.PSIsContainer -or $item.Attributes.HasFlag([IO.FileAttributes]::ReparsePoint)) {
        throw 'PublicKeyPath must be a regular file.'
    }
    $text = [IO.File]::ReadAllText($resolved, [Text.Encoding]::UTF8).Trim()
    if ($text -match 'PRIVATE KEY' -or $text.Contains([char]0)) {
        throw 'PublicKeyPath must contain public key material only.'
    }
    $lines = @($text -split '\r?\n' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    if ($lines.Count -ne 1 -or $lines[0] -notmatch '^(ssh-ed25519|ecdsa-sha2-nistp(?:256|384|521)|ssh-rsa) [A-Za-z0-9+/]+={0,3}(?:\s+[^\r\n]+)?$') {
        throw 'PublicKeyPath must contain exactly one supported OpenSSH public key.'
    }
    return $lines[0]
}

function Assert-TrainingCredential {
    param([Parameter(Mandatory)][PSCredential]$Credential)
    $leafName = $Credential.UserName.Split('\')[-1]
    if ($leafName -ne $TRAINING_USER) {
        throw "TrainingCredential must identify the fixed local account '$TRAINING_USER'."
    }
    if ($Credential.Password.Length -lt 20) {
        throw 'TrainingCredential password must contain at least 20 characters.'
    }
}

function Set-DirectoryAcl {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][ValidateSet('ReadExecute', 'Modify', 'AdminOnly')][string]$TrainingAccess
    )
    [IO.Directory]::CreateDirectory($Path) | Out-Null
    $grants = @('*S-1-5-18:(OI)(CI)(F)', '*S-1-5-32-544:(OI)(CI)(F)')
    if ($TrainingAccess -eq 'ReadExecute') { $grants += "$TRAINING_USER`:(OI)(CI)(RX)" }
    if ($TrainingAccess -eq 'Modify') { $grants += "$TRAINING_USER`:(OI)(CI)(M)" }
    $arguments = @($Path, '/inheritance:r', '/grant:r') + $grants
    [void](Invoke-NativeChecked -FilePath 'icacls.exe' -Arguments $arguments -Label "ACL for $Path")
}

function Write-AtomicUtf8Text {
    param([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)][string]$Content)
    $directory = [IO.Path]::GetDirectoryName($Path)
    [IO.Directory]::CreateDirectory($directory) | Out-Null
    $temporary = [IO.Path]::Combine($directory, ".$(Split-Path -Leaf $Path).$([Guid]::NewGuid().ToString('N')).tmp")
    [IO.File]::WriteAllText($temporary, $Content, [Text.UTF8Encoding]::new($false))
    [IO.File]::Move($temporary, $Path, $true)
}

function Install-WingetPackage {
    param([Parameter(Mandatory)][string]$PackageId)
    $winget = (Get-Command winget.exe -ErrorAction Stop).Source
    [void](Invoke-NativeChecked -FilePath $winget -Arguments @(
        'show', '--id', $PackageId, '--exact', '--source', 'winget'
    ) -Label "Review winget source for $PackageId")
    [void](Invoke-NativeChecked -FilePath $winget -Arguments @(
        'install', '--id', $PackageId, '--exact', '--source', 'winget', '--scope', 'machine',
        '--accept-package-agreements', '--accept-source-agreements', '--disable-interactivity'
    ) -Label "Install $PackageId")
}

$capability = Get-WindowsCapability -Online -Name $OPENSSH_CAPABILITY -ErrorAction Stop
$existingUser = Get-LocalUser -Name $TRAINING_USER -ErrorAction SilentlyContinue
$sshdService = Get-Service -Name 'sshd' -ErrorAction SilentlyContinue
$tailscaleService = Get-Service -Name 'Tailscale' -ErrorAction SilentlyContinue
$trainingRootFull = [IO.Path]::GetFullPath($TrainingRoot).TrimEnd([IO.Path]::DirectorySeparatorChar)
if (-not [IO.Path]::IsPathFullyQualified($trainingRootFull) -or
    $trainingRootFull -eq [IO.Path]::GetPathRoot($trainingRootFull)) {
    throw 'TrainingRoot must be a dedicated absolute directory, not a drive root.'
}

$plan = [ordered]@{
    schema = 'jotluck.autocomplete.v2-free.fx15-initialization-plan.v1'
    observedAt = [DateTimeOffset]::UtcNow.ToString('o')
    applyRequested = [bool]$Apply
    fixedTrainingUser = $TRAINING_USER
    trainingRoot = $trainingRootFull
    fx15TailscaleIPv4 = $Fx15TailscaleIPv4
    controlTailscaleIPv4 = $ControlTailscaleIPv4
    observed = [ordered]@{
        openSshCapabilityState = $capability.State.ToString()
        trainingUserExists = $null -ne $existingUser
        sshdStatus = if ($null -ne $sshdService) { $sshdService.Status.ToString() } else { $null }
        tailscaleStatus = if ($null -ne $tailscaleService) { $tailscaleService.Status.ToString() } else { $null }
        wingetAvailable = $null -ne (Get-Command winget.exe -ErrorAction SilentlyContinue)
        pythonLauncherAvailable = $null -ne (Get-Command py.exe -ErrorAction SilentlyContinue)
    }
    optionalActions = [ordered]@{
        installPackages = [bool]$InstallPackages
        enableTailscaleUnattended = [bool]$EnableTailscaleUnattended
        installTrainingEnvironment = [bool]$InstallTrainingEnvironment
        approvedPythonSource = [bool]$ApprovePythonPackageSource
        approvedPyTorchSource = [bool]$ApprovePyTorchDownloadSource
        configureAcPowerPolicy = [bool]$ConfigureAcPowerPolicy
    }
    fixedVersions = [ordered]@{
        python = $PYTHON_REQUIRED_PREFIX + 'x'
        numpy = $NUMPY_VERSION
        sentencepiece = $SENTENCEPIECE_VERSION
        pytorch = $PYTORCH_VERSION
        cuda = $PYTORCH_CUDA_VERSION
        pythonIndex = $PYTHON_INDEX_URL
        pytorchIndex = $PYTORCH_INDEX_URL
    }
    willNot = @('accept private keys', 'accept auth keys or VPS tokens', 'open public SSH', 'configure public ports', 'restart Windows')
}

if (-not $Apply -or $WhatIfPreference) {
    $plan | ConvertTo-Json -Depth 8
    return
}
if ($null -eq $TrainingCredential) { throw '-Apply requires TrainingCredential as PSCredential.' }
if ([string]::IsNullOrWhiteSpace($PublicKeyPath)) { throw '-Apply requires PublicKeyPath.' }
if ([string]::IsNullOrWhiteSpace($Fx15TailscaleIPv4) -or [string]::IsNullOrWhiteSpace($ControlTailscaleIPv4)) {
    throw '-Apply requires both Tailscale IPv4 addresses.'
}
Assert-TrainingCredential -Credential $TrainingCredential
$publicKey = Get-PublicKeyLine -Path $PublicKeyPath
$fx15Address = ConvertTo-TailscaleIPv4 -Value $Fx15TailscaleIPv4 -Label 'Fx15TailscaleIPv4'
$controlAddress = ConvertTo-TailscaleIPv4 -Value $ControlTailscaleIPv4 -Label 'ControlTailscaleIPv4'
if ($fx15Address -eq $controlAddress) { throw 'FX15 and control Tailscale addresses must differ.' }
if ($InstallTrainingEnvironment -and (-not $ApprovePythonPackageSource -or -not $ApprovePyTorchDownloadSource)) {
    throw '-InstallTrainingEnvironment requires both approved fixed Python and PyTorch package sources.'
}
if (-not $PSCmdlet.ShouldProcess([Environment]::MachineName, 'Apply one-time FX15 training initialization')) {
    return
}

$administrators = Get-LocalGroup -SID 'S-1-5-32-544' -ErrorAction Stop
if ($null -ne $existingUser) {
    $adminMembers = @(Get-LocalGroupMember -Group $administrators -ErrorAction Stop)
    if (@($adminMembers | Where-Object { $_.SID -eq $existingUser.SID }).Count -gt 0) {
        throw "Existing $TRAINING_USER account is an administrator; initialization refuses to modify it."
    }
}
if ($null -ne (Get-NetFirewallRule -Name $FIREWALL_RULE_NAME -ErrorAction SilentlyContinue)) {
    throw "Firewall rule $FIREWALL_RULE_NAME already exists; initialization refuses to overwrite it."
}

$restartNeeded = $false
$userCreated = $null -eq $existingUser
if ($InstallPackages) {
    if ($null -eq $tailscaleService) { Install-WingetPackage -PackageId $TAILSCALE_WINGET_ID }
    $pythonProbe = Get-Command py.exe -ErrorAction SilentlyContinue
    if ($null -eq $pythonProbe) { Install-WingetPackage -PackageId $PYTHON_WINGET_ID }
}

if ($capability.State -ne 'Installed') {
    $capabilityResult = Add-WindowsCapability -Online -Name $OPENSSH_CAPABILITY -ErrorAction Stop
    $restartNeeded = $capabilityResult.RestartNeeded
}
$sshdExecutable = Join-Path $env:SystemRoot 'System32\OpenSSH\sshd.exe'
if (-not [IO.File]::Exists($sshdExecutable)) {
    throw 'OpenSSH capability installation did not materialize sshd.exe; reboot manually and rerun the plan.'
}

if ($null -eq $existingUser) {
    $existingUser = New-LocalUser -Name $TRAINING_USER -Password $TrainingCredential.Password `
        -Description 'JotLuck isolated V2 training account' -PasswordNeverExpires -UserMayNotChangePassword
} else {
    Set-LocalUser -Name $TRAINING_USER -Password $TrainingCredential.Password -PasswordNeverExpires $true
    Enable-LocalUser -Name $TRAINING_USER
}

Set-DirectoryAcl -Path $trainingRootFull -TrainingAccess ReadExecute
$directoryPolicies = [ordered]@{
    incoming = 'Modify'
    source = 'ReadExecute'
    inputs = 'ReadExecute'
    jobs = 'ReadExecute'
    output = 'Modify'
    checkpoints = 'Modify'
    state = 'Modify'
    logs = 'Modify'
    venv = 'Modify'
    'bootstrap-backups' = 'AdminOnly'
}
foreach ($entry in $directoryPolicies.GetEnumerator()) {
    Set-DirectoryAcl -Path ([IO.Path]::Combine($trainingRootFull, $entry.Key)) -TrainingAccess $entry.Value
}

$programDataSsh = Join-Path $env:ProgramData 'ssh'
[IO.Directory]::CreateDirectory($programDataSsh) | Out-Null
$authorizedKeysPath = Join-Path $programDataSsh $AUTHORIZED_KEYS_NAME
Write-AtomicUtf8Text -Path $authorizedKeysPath -Content ($publicKey + "`n")
[void](Invoke-NativeChecked -FilePath 'icacls.exe' -Arguments @(
    $authorizedKeysPath, '/inheritance:r', '/grant:r',
    '*S-1-5-18:(F)', '*S-1-5-32-544:(F)', "$TRAINING_USER`:(R)"
) -Label 'authorized_keys ACL')

$timestamp = [DateTimeOffset]::UtcNow.ToString('yyyyMMddTHHmmssZ')
$backupRoot = Join-Path $trainingRootFull "bootstrap-backups\$timestamp"
Set-DirectoryAcl -Path $backupRoot -TrainingAccess AdminOnly
$sshdConfigPath = Join-Path $programDataSsh 'sshd_config'
$sshdBackupPath = Join-Path $backupRoot 'sshd_config.before'
$hadSshdConfig = [IO.File]::Exists($sshdConfigPath)
if ($hadSshdConfig) { [IO.File]::Copy($sshdConfigPath, $sshdBackupPath, $false) }
$sshdConfiguration = @"
Port 22
AddressFamily inet
ListenAddress $fx15Address
PubkeyAuthentication yes
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitEmptyPasswords no
AllowUsers $TRAINING_USER
AuthorizedKeysFile __PROGRAMDATA__/ssh/$AUTHORIZED_KEYS_NAME
AllowAgentForwarding no
AllowTcpForwarding no
GatewayPorts no
PermitTunnel no
X11Forwarding no
Subsystem sftp sftp-server.exe
LogLevel INFO
"@ -replace "`r`n", "`n"
$sshdTemporaryPath = Join-Path $programDataSsh ".sshd_config.$([Guid]::NewGuid().ToString('N')).tmp"
[IO.File]::WriteAllText($sshdTemporaryPath, $sshdConfiguration, [Text.UTF8Encoding]::new($false))
[void](Invoke-NativeChecked -FilePath $sshdExecutable -Arguments @('-t', '-f', $sshdTemporaryPath) -Label 'Validate staged sshd_config')

try {
    [IO.File]::Move($sshdTemporaryPath, $sshdConfigPath, $true)
    [void](Invoke-NativeChecked -FilePath $sshdExecutable -Arguments @('-t', '-f', $sshdConfigPath) -Label 'Validate installed sshd_config')
    [void](Invoke-NativeChecked -FilePath 'icacls.exe' -Arguments @(
        $sshdConfigPath, '/inheritance:r', '/grant:r', '*S-1-5-18:(F)', '*S-1-5-32-544:(F)'
    ) -Label 'sshd_config ACL')
    $defaultOpenSshRules = @(Get-NetFirewallRule -PolicyStore ActiveStore -ErrorAction SilentlyContinue | Where-Object {
        $_.Name -ne $FIREWALL_RULE_NAME -and
        ($_.Name -like 'OpenSSH-Server-In-TCP*' -or $_.DisplayName -like '*OpenSSH*Server*')
    })
    Write-AtomicUtf8Text -Path (Join-Path $backupRoot 'disabled-default-openssh-rules.txt') `
        -Content ((@($defaultOpenSshRules | ForEach-Object { $_.Name }) -join "`n") + "`n")
    foreach ($rule in $defaultOpenSshRules) { Disable-NetFirewallRule -InputObject $rule | Out-Null }
    New-NetFirewallRule -Name $FIREWALL_RULE_NAME -DisplayName 'JotLuck FX15 SSH from control tailnet IP only' `
        -Direction Inbound -Action Allow -Enabled True -Profile Any -Protocol TCP -LocalPort 22 `
        -LocalAddress $fx15Address -RemoteAddress "$controlAddress/32" | Out-Null
    Set-Service -Name 'sshd' -StartupType Automatic
    $currentSshd = Get-Service -Name 'sshd' -ErrorAction Stop
    if ($currentSshd.Status -eq 'Running') { Restart-Service -Name 'sshd' -Force -ErrorAction Stop }
    else { Start-Service -Name 'sshd' -ErrorAction Stop }
}
catch {
    if ($hadSshdConfig) {
        $rollbackTemporary = Join-Path $programDataSsh ".sshd_config.rollback.$([Guid]::NewGuid().ToString('N')).tmp"
        [IO.File]::Copy($sshdBackupPath, $rollbackTemporary, $true)
        [IO.File]::Move($rollbackTemporary, $sshdConfigPath, $true)
    } elseif ([IO.File]::Exists($sshdConfigPath)) {
        Remove-Item -LiteralPath $sshdConfigPath -Force
    }
    if ([IO.File]::Exists($sshdConfigPath)) {
        [void](Invoke-NativeChecked -FilePath $sshdExecutable -Arguments @('-t', '-f', $sshdConfigPath) -Label 'Validate rolled-back sshd_config')
        Restart-Service -Name 'sshd' -Force -ErrorAction SilentlyContinue
    }
    throw
}

if ($EnableTailscaleUnattended) {
    $tailscale = (Get-Command tailscale.exe -ErrorAction Stop).Source
    [void](Invoke-NativeChecked -FilePath $tailscale -Arguments @('set', '--unattended=true') -Label 'Enable Tailscale unattended mode')
}

$venvLockSha256 = $null
if ($InstallTrainingEnvironment) {
    if ($PYTHON_INDEX_URL -ne 'https://pypi.org/simple') { throw 'Unapproved Python package source.' }
    if ($PYTORCH_INDEX_URL -ne 'https://download.pytorch.org/whl/cu126') { throw 'Unapproved PyTorch download source.' }
    $pythonLauncher = $null
    $pythonArguments = @()
    if (-not [string]::IsNullOrWhiteSpace($BasePythonPath)) {
        $pythonLauncher = (Resolve-Path -LiteralPath $BasePythonPath -ErrorAction Stop).Path
    }
    else {
        $pythonLauncher = (Get-Command py.exe -ErrorAction Stop).Source
        $pythonArguments = @('-3.12')
    }
    $pythonVersion = (Invoke-NativeChecked -FilePath $pythonLauncher -Arguments ($pythonArguments + @('-c', 'import platform; print(platform.python_version())')) -Label 'Verify Python 3.12')[0].Trim()
    if (-not $pythonVersion.StartsWith($PYTHON_REQUIRED_PREFIX, [StringComparison]::Ordinal)) {
        throw "Expected Python $PYTHON_REQUIRED_PREFIX, received $pythonVersion."
    }
    $venvRoot = Join-Path $trainingRootFull 'venv\pytorch-2.8.0-cu126'
    if ([IO.Directory]::Exists($venvRoot)) { throw 'Pinned training venv already exists; refusing to overwrite it.' }
    [void](Invoke-NativeChecked -FilePath $pythonLauncher -Arguments ($pythonArguments + @('-m', 'venv', $venvRoot)) -Label 'Create pinned training venv')
    $venvPython = Join-Path $venvRoot 'Scripts\python.exe'
    [void](Invoke-NativeChecked -FilePath $venvPython -Arguments @(
        '-m', 'pip', 'install', '--only-binary=:all:', '--index-url', $PYTHON_INDEX_URL,
        "numpy==$NUMPY_VERSION", "sentencepiece==$SENTENCEPIECE_VERSION"
    ) -Label 'Install pinned tokenizer dependencies')
    [void](Invoke-NativeChecked -FilePath $venvPython -Arguments @(
        '-m', 'pip', 'install', '--only-binary=:all:', '--index-url', $PYTORCH_INDEX_URL,
        "torch==$PYTORCH_VERSION"
    ) -Label 'Install pinned PyTorch cu126')
    $torchIdentityJson = (Invoke-NativeChecked -FilePath $venvPython -Arguments @(
        '-c', 'import json, numpy, sentencepiece, torch; print(json.dumps({"numpy": numpy.__version__, "sentencepiece": sentencepiece.__version__, "torch": torch.__version__, "cuda": torch.version.cuda}))'
    ) -Label 'Verify PyTorch identity')[-1]
    $torchIdentity = $torchIdentityJson | ConvertFrom-Json
    if ([string]$torchIdentity.numpy -ne $NUMPY_VERSION -or
        [string]$torchIdentity.sentencepiece -ne $SENTENCEPIECE_VERSION -or
        -not ([string]$torchIdentity.torch).StartsWith($PYTORCH_VERSION, [StringComparison]::Ordinal) -or
        [string]$torchIdentity.cuda -ne $PYTORCH_CUDA_VERSION) {
        throw "Unexpected PyTorch identity: $torchIdentityJson"
    }
    $resolvedLock = (Invoke-NativeChecked -FilePath $venvPython -Arguments @('-m', 'pip', 'freeze', '--all') -Label 'Freeze training venv') -join "`n"
    $lockPath = Join-Path $venvRoot 'requirements.resolved.lock.txt'
    Write-AtomicUtf8Text -Path $lockPath -Content ($resolvedLock + "`n")
    $venvLockSha256 = (Get-FileHash -LiteralPath $lockPath -Algorithm SHA256).Hash.ToLowerInvariant()
    Set-DirectoryAcl -Path $venvRoot -TrainingAccess ReadExecute
}

$powerBackupScheme = $null
if ($ConfigureAcPowerPolicy) {
    $query = Invoke-NativeChecked -FilePath 'powercfg.exe' -Arguments @('/query') -Label 'Capture power configuration'
    Write-AtomicUtf8Text -Path (Join-Path $backupRoot 'powercfg-query.before.txt') -Content (($query -join "`n") + "`n")
    $activeScheme = (Invoke-NativeChecked -FilePath 'powercfg.exe' -Arguments @('/getactivescheme') -Label 'Read active power scheme') -join ' '
    $activeMatch = [regex]::Match($activeScheme, '[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}')
    if (-not $activeMatch.Success) { throw 'Could not resolve the active power scheme GUID.' }
    $duplicate = (Invoke-NativeChecked -FilePath 'powercfg.exe' -Arguments @('/duplicatescheme', $activeMatch.Value) -Label 'Snapshot active power scheme') -join ' '
    $duplicateMatch = [regex]::Match($duplicate, '[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}')
    if (-not $duplicateMatch.Success) { throw 'Could not resolve the backup power scheme GUID.' }
    $powerBackupScheme = $duplicateMatch.Value
    Write-AtomicUtf8Text -Path (Join-Path $backupRoot 'powercfg-backup-scheme.txt') -Content ($powerBackupScheme + "`n")
    [void](Invoke-NativeChecked -FilePath 'powercfg.exe' -Arguments @('/change', 'standby-timeout-ac', '0') -Label 'Disable AC sleep timeout')
    [void](Invoke-NativeChecked -FilePath 'powercfg.exe' -Arguments @('/change', 'hibernate-timeout-ac', '0') -Label 'Disable AC hibernate timeout')
    [void](Invoke-NativeChecked -FilePath 'powercfg.exe' -Arguments @('-setacvalueindex', 'SCHEME_CURRENT', 'SUB_BUTTONS', 'LIDACTION', '0') -Label 'Keep AC training active with lid closed')
    [void](Invoke-NativeChecked -FilePath 'powercfg.exe' -Arguments @('-setactive', 'SCHEME_CURRENT') -Label 'Activate adjusted AC power policy')
}

[ordered]@{
    schema = 'jotluck.autocomplete.v2-free.fx15-initialization-result.v1'
    completedAt = [DateTimeOffset]::UtcNow.ToString('o')
    trainingUser = $TRAINING_USER
    trainingUserCreated = [bool]$userCreated
    trainingRoot = $trainingRootFull
    authorizedKeysPath = $authorizedKeysPath
    sshListenAddress = $fx15Address
    sshAllowedRemoteAddress = "$controlAddress/32"
    firewallRule = $FIREWALL_RULE_NAME
    backupRoot = $backupRoot
    venvLockSha256 = $venvLockSha256
    trainingPythonPath = if ($InstallTrainingEnvironment) { $venvPython } else { $null }
    powerBackupScheme = $powerBackupScheme
    restartNeeded = [bool]$restartNeeded
    automaticRestartPerformed = $false
} | ConvertTo-Json -Depth 6
