#requires -Version 7.0
#requires -RunAsAdministrator
[CmdletBinding(SupportsShouldProcess, ConfirmImpact = 'High')]
param(
    [Parameter(Mandatory)][switch]$Apply,
    [Parameter(Mandatory)][string]$TaskUser,
    [Parameter(Mandatory)][string]$RunnerPath,
    [Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{64}$')][string]$ExpectedRunnerSha256,
    [Parameter(Mandatory)][string]$JobPath,
    [Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{64}$')][string]$ExpectedJobSha256,
    [Parameter(Mandatory)][string]$TrainingPythonPath,
    [Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{64}$')][string]$ExpectedTrainingPythonSha256,
    [Parameter(Mandatory)][string]$GitPath,
    [Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{64}$')][string]$ExpectedGitSha256,
    [Parameter(Mandatory)][string]$WorkspaceRoot,
    [Parameter(Mandatory)][string]$StateRoot,
    [string]$TaskName = 'JotLuck-V2-Free-Training',
    [string]$PowerShellPath = (Get-Command pwsh.exe -ErrorAction Stop).Source,
    [switch]$EnableTailscaleUnattended,
    [switch]$AllowStartOnBattery
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

if (-not $Apply) {
    throw 'Refusing to change FX15: pass -Apply explicitly after reviewing Probe-Fx15.ps1 output.'
}

function Resolve-ExistingPath {
    param([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)][string]$Label)

    if ($Path.Contains('"')) { throw "$Label must not contain a quote." }
    return (Resolve-Path -LiteralPath $Path -ErrorAction Stop).Path
}

function Assert-PathWithinRoot {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][string]$Root,
        [Parameter(Mandatory)][string]$Label
    )

    $rootPrefix = $Root.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    if (-not $Path.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "$Label must be inside WorkspaceRoot."
    }
}

function Quote-TaskArgument {
    param([Parameter(Mandatory)][string]$Value)
    if ($Value.Contains('"')) { throw 'Scheduled-task arguments must not contain quotes.' }
    return '"' + $Value + '"'
}

$workspace = Resolve-ExistingPath -Path $WorkspaceRoot -Label 'WorkspaceRoot'
$state = Resolve-ExistingPath -Path $StateRoot -Label 'StateRoot'
$runner = Resolve-ExistingPath -Path $RunnerPath -Label 'RunnerPath'
$job = Resolve-ExistingPath -Path $JobPath -Label 'JobPath'
$trainingPython = Resolve-ExistingPath -Path $TrainingPythonPath -Label 'TrainingPythonPath'
$git = Resolve-ExistingPath -Path $GitPath -Label 'GitPath'
$pwsh = Resolve-ExistingPath -Path $PowerShellPath -Label 'PowerShellPath'
Assert-PathWithinRoot -Path $runner -Root $workspace -Label 'RunnerPath'
Assert-PathWithinRoot -Path $job -Root $workspace -Label 'JobPath'

$runnerSha256 = (Get-FileHash -LiteralPath $runner -Algorithm SHA256).Hash.ToLowerInvariant()
$jobSha256 = (Get-FileHash -LiteralPath $job -Algorithm SHA256).Hash.ToLowerInvariant()
$trainingPythonSha256 = (Get-FileHash -LiteralPath $trainingPython -Algorithm SHA256).Hash.ToLowerInvariant()
$gitSha256 = (Get-FileHash -LiteralPath $git -Algorithm SHA256).Hash.ToLowerInvariant()
if ($runnerSha256 -ne $ExpectedRunnerSha256) { throw 'Runner SHA-256 does not match.' }
if ($jobSha256 -ne $ExpectedJobSha256) { throw 'Job SHA-256 does not match.' }
if ($trainingPythonSha256 -ne $ExpectedTrainingPythonSha256) { throw 'Training Python SHA-256 does not match.' }
if ($gitSha256 -ne $ExpectedGitSha256) { throw 'Git SHA-256 does not match.' }
if ($null -ne (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue)) {
    throw "Scheduled task '$TaskName' already exists; this bootstrap refuses to overwrite it."
}

$arguments = @(
    '-NoLogo'
    '-NoProfile'
    '-NonInteractive'
    '-ExecutionPolicy'
    'AllSigned'
    '-File'
    (Quote-TaskArgument -Value $runner)
    '-JobPath'
    (Quote-TaskArgument -Value $job)
    '-ExpectedJobSha256'
    $ExpectedJobSha256
    '-TrainingPythonPath'
    (Quote-TaskArgument -Value $trainingPython)
    '-ExpectedTrainingPythonSha256'
    $ExpectedTrainingPythonSha256
    '-GitPath'
    (Quote-TaskArgument -Value $git)
    '-ExpectedGitSha256'
    $ExpectedGitSha256
    '-WorkspaceRoot'
    (Quote-TaskArgument -Value $workspace)
    '-StateRoot'
    (Quote-TaskArgument -Value $state)
) -join ' '

$action = New-ScheduledTaskAction -Execute $pwsh -Argument $arguments -WorkingDirectory $workspace
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId $TaskUser -LogonType S4U -RunLevel Limited
$settingsParameters = @{
    StartWhenAvailable = $true
    RestartCount = 3
    RestartInterval = (New-TimeSpan -Minutes 1)
    ExecutionTimeLimit = [TimeSpan]::Zero
    MultipleInstances = 'IgnoreNew'
}
if ($AllowStartOnBattery) {
    $settingsParameters.AllowStartIfOnBatteries = $true
    $settingsParameters.DontStopIfGoingOnBatteries = $true
}
$settings = New-ScheduledTaskSettingsSet @settingsParameters

if ($PSCmdlet.ShouldProcess($TaskName, 'Register limited S4U startup training task')) {
    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal `
        -Settings $settings -Description 'JotLuck V2 free decoder training; no embedded credentials.' | Out-Null
}

if ($EnableTailscaleUnattended) {
    $tailscale = Get-Command tailscale.exe -ErrorAction Stop
    if ($PSCmdlet.ShouldProcess('Tailscale Windows service', 'Enable unattended operation')) {
        & $tailscale.Source set --unattended=true
        if ($LASTEXITCODE -ne 0) { throw "tailscale set failed with exit code $LASTEXITCODE." }
    }
}

[ordered]@{
    taskName = $TaskName
    taskUser = $TaskUser
    runnerSha256 = $runnerSha256
    jobSha256 = $jobSha256
    trainingPythonSha256 = $trainingPythonSha256
    gitSha256 = $gitSha256
    stateRoot = $state
    tailscaleUnattendedRequested = [bool]$EnableTailscaleUnattended
} | ConvertTo-Json -Depth 4
