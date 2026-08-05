#requires -Version 7.0
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

function Get-CommandProbe {
    param([Parameter(Mandatory)][string]$Name)

    $command = Get-Command -Name $Name -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -eq $command) {
        return [ordered]@{ name = $Name; available = $false; source = $null; version = $null }
    }
    return [ordered]@{
        name = $Name
        available = $true
        source = $command.Source
        version = if ($null -ne $command.Version) { $command.Version.ToString() } else { $null }
    }
}

function Get-ServiceProbe {
    param([Parameter(Mandatory)][string]$Name)

    $service = Get-Service -Name $Name -ErrorAction SilentlyContinue
    return [ordered]@{
        name = $Name
        installed = $null -ne $service
        status = if ($null -ne $service) { $service.Status.ToString() } else { $null }
        startType = if ($null -ne $service) { $service.StartType.ToString() } else { $null }
    }
}

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
$systemDrive = [System.IO.Path]::GetPathRoot([Environment]::SystemDirectory)
$disk = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='$($systemDrive.TrimEnd('\'))'" |
    Select-Object -First 1
$gpus = @(Get-CimInstance Win32_VideoController -ErrorAction SilentlyContinue | ForEach-Object {
    [ordered]@{
        name = $_.Name
        driverVersion = $_.DriverVersion
        adapterRamBytes = $_.AdapterRAM
    }
})

$report = [ordered]@{
    schema = 'jotluck.autocomplete.v2-free.fx15-probe.v1'
    observedAt = [DateTimeOffset]::UtcNow.ToString('o')
    readOnly = $true
    computer = [ordered]@{
        name = [Environment]::MachineName
        os = (Get-CimInstance Win32_OperatingSystem | Select-Object -ExpandProperty Caption)
        osVersion = [Environment]::OSVersion.VersionString
        architecture = [Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()
        processorCount = [Environment]::ProcessorCount
        memoryBytes = (Get-CimInstance Win32_ComputerSystem | Select-Object -ExpandProperty TotalPhysicalMemory)
        gpu = $gpus
        systemDisk = [ordered]@{
            root = $systemDrive
            sizeBytes = if ($null -ne $disk) { $disk.Size } else { $null }
            freeBytes = if ($null -ne $disk) { $disk.FreeSpace } else { $null }
        }
    }
    identity = [ordered]@{
        name = $identity.Name
        elevatedAdministrator = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    }
    services = @(
        Get-ServiceProbe -Name 'sshd'
        Get-ServiceProbe -Name 'Tailscale'
        Get-ServiceProbe -Name 'WireGuardTunnel$JotLuckTraining'
    )
    commands = @(
        Get-CommandProbe -Name 'pwsh.exe'
        Get-CommandProbe -Name 'git.exe'
        Get-CommandProbe -Name 'node.exe'
        Get-CommandProbe -Name 'python.exe'
        Get-CommandProbe -Name 'nvidia-smi.exe'
        Get-CommandProbe -Name 'tailscale.exe'
        Get-CommandProbe -Name 'ssh.exe'
    )
    note = 'Observation only: no installation, service, firewall, account, task, or network state was changed.'
}

$report | ConvertTo-Json -Depth 8
