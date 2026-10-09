#Requires -RunAsAdministrator
<#
.SYNOPSIS
Installs or updates the wall helper, which lets the wall dashboard control Sonos.

.DESCRIPTION
Downloads the latest helper release from GitHub and runs it as a Windows service
(using WinSW): it starts at boot without anyone signed in, restarts if it crashes,
and keeps rotating log files. Adds a firewall rule so it can find the Sonos speakers.

Re-running the script is the update process. Settings are kept between runs; pass a
setting again only to change it.

.PARAMETER DashboardUrl
The wall dashboard's address. Required the first time. Only this site may use the helper.

.PARAMETER MaxVolume
Highest volume the wall may set on any speaker (default 85).

.PARAMETER SpeakerLimits
Lower limits for particular speakers, by their Sonos name: "Kitchen=60, Lobby=50".

.PARAMETER SonosHosts
Speaker IP addresses to try before searching the network (optional, comma separated).

.PARAMETER WeeklyUpdate
Also add a scheduled task that re-runs this script every Sunday at 3am.

.EXAMPLE
.\install-helper.ps1 -DashboardUrl https://wall.example.com -SpeakerLimits "Kitchen=60"

.EXAMPLE
.\install-helper.ps1
Updates to the latest release, keeping the current settings.
#>
param(
    [string]$DashboardUrl,
    [int]$MaxVolume,
    [string]$SpeakerLimits,
    [string]$SonosHosts,
    [int]$Port = 5005,
    [switch]$WeeklyUpdate
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # Invoke-WebRequest is very slow with the progress bar
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$repo = 'TalkingSites/inspire9-wall'
$serviceId = 'inspire9-wall-helper'
$installDir = Join-Path $env:ProgramFiles 'Inspire9 Wall Helper'
$dataDir = Join-Path $env:ProgramData 'Inspire9 Wall Helper'
$configFile = Join-Path $dataDir 'config.json'
$exe = Join-Path $installDir 'inspire9-wall-helper.exe'
# WinSW runs the helper as a service. It reads the service settings from the .xml with its own name.
$winsw = Join-Path $installDir "$serviceId-service.exe"
$winswXml = Join-Path $installDir "$serviceId-service.xml"
$winswUrl = 'https://github.com/winsw/winsw/releases/download/v2.12.0/WinSW-x64.exe'
$winswSha256 = '05B82D46AD331CC16BDC00DE5C6332C1EF818DF8CEEFCD49C726553209B3A0DA'

function Step($message) { Write-Host "-> $message" -ForegroundColor Cyan }

New-Item -ItemType Directory -Force -Path $installDir, $dataDir, (Join-Path $dataDir 'logs') | Out-Null

# 1. Settings: keep what's there, change only what was passed.
Step 'Settings'
$config = if (Test-Path $configFile) { Get-Content $configFile -Raw | ConvertFrom-Json } else { New-Object psobject }
function Set-Setting($name, $value) { $config | Add-Member -NotePropertyName $name -NotePropertyValue $value -Force }

if ($DashboardUrl) { Set-Setting 'allowedOrigins' @(([Uri]$DashboardUrl).GetLeftPart([UriPartial]::Authority)) }
if (-not $config.allowedOrigins) { throw 'First install: pass -DashboardUrl with the wall dashboard''s address.' }
if ($MaxVolume) { Set-Setting 'maxVolume' $MaxVolume }
if ($PSBoundParameters.ContainsKey('SpeakerLimits')) {
    $limits = @{}
    foreach ($pair in ($SpeakerLimits -split ',')) {
        $name, $value = $pair -split '=', 2
        if ($name.Trim() -and $value) { $limits[$name.Trim()] = [int]$value }
    }
    Set-Setting 'speakerLimits' $limits
}
if ($PSBoundParameters.ContainsKey('SonosHosts')) {
    Set-Setting 'sonosHosts' @($SonosHosts -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
}
Set-Setting 'port' $Port
Set-Setting 'dataDir' $dataDir
# Written without a byte order mark, which PowerShell 5 adds otherwise.
[IO.File]::WriteAllText($configFile, ($config | ConvertTo-Json -Depth 4))
Write-Host "   for $($config.allowedOrigins -join ', ')"

# 2. Download the latest helper.
Step 'Downloading the latest helper'
$release = Invoke-RestMethod "https://api.github.com/repos/$repo/releases/latest" -Headers @{ 'User-Agent' = 'inspire9-wall-installer' }
$asset = $release.assets | Where-Object { $_.name -eq 'inspire9-wall-helper.exe' }
if (-not $asset) { throw "Release $($release.tag_name) has no inspire9-wall-helper.exe" }
$download = "$exe.download"
Invoke-WebRequest $asset.browser_download_url -OutFile $download -UseBasicParsing
Write-Host "   $($release.tag_name)"

# 3. WinSW, the service wrapper (checked against its known checksum).
if (-not (Test-Path $winsw) -or (Get-FileHash $winsw -Algorithm SHA256).Hash -ne $winswSha256) {
    Step 'Downloading WinSW'
    Invoke-WebRequest $winswUrl -OutFile "$winsw.download" -UseBasicParsing
    if ((Get-FileHash "$winsw.download" -Algorithm SHA256).Hash -ne $winswSha256) {
        Remove-Item "$winsw.download"
        throw 'WinSW download did not match its checksum'
    }
    Move-Item "$winsw.download" $winsw -Force
}

# 4. Service settings. Logs roll over at 1 MB and five files are kept, so they can't fill the disk.
Step 'Service'
$logDir = Join-Path $dataDir 'logs'
$xml = @"
<service>
  <id>$serviceId</id>
  <name>Inspire9 Wall Helper</name>
  <description>Lets the wall dashboard in the kiosk browser control the office Sonos speakers. Listens on 127.0.0.1 only.</description>
  <executable>$exe</executable>
  <env name="HELPER_CONFIG" value="$configFile"/>
  <workingdirectory>$dataDir</workingdirectory>
  <logpath>$logDir</logpath>
  <log mode="roll-by-size">
    <sizeThreshold>1024</sizeThreshold>
    <keepFiles>5</keepFiles>
  </log>
  <onfailure action="restart" delay="10 sec"/>
  <onfailure action="restart" delay="30 sec"/>
  <onfailure action="restart" delay="60 sec"/>
  <resetfailure>1 hour</resetfailure>
  <startmode>Automatic</startmode>
  <stoptimeout>10 sec</stoptimeout>
</service>
"@
[IO.File]::WriteAllText($winswXml, $xml)

$service = Get-Service $serviceId -ErrorAction SilentlyContinue
if ($service -and $service.Status -ne 'Stopped') {
    Stop-Service $serviceId -Force
    (Get-Service $serviceId).WaitForStatus('Stopped', [TimeSpan]::FromSeconds(20))
}
Move-Item $download $exe -Force
if (-not $service) {
    & $winsw install
    if ($LASTEXITCODE) { throw "WinSW couldn't install the service (exit $LASTEXITCODE)" }
} else {
    & $winsw refresh   # picks up any change to the service settings
}

# 5. Firewall: Sonos speakers answer the helper's search on the local network.
Step 'Firewall rule for finding the speakers'
$ruleName = 'Inspire9 Wall Helper (Sonos discovery)'
Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Program $exe -Protocol UDP -RemoteAddress LocalSubnet -Action Allow -Profile Any | Out-Null

# 6. Optional weekly update.
if ($WeeklyUpdate) {
    Step 'Weekly update task'
    $scriptCopy = Join-Path $dataDir 'install-helper.ps1'
    if ($PSCommandPath -ne $scriptCopy) { Copy-Item $PSCommandPath $scriptCopy -Force }
    $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$scriptCopy`""
    $trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At 3am
    $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
    Register-ScheduledTask -TaskName 'Inspire9 Wall Helper update' -Action $action -Trigger $trigger -Principal $principal -Force | Out-Null
}

# 7. Start it and check it answers.
Step 'Starting'
Start-Service $serviceId
$healthy = $false
for ($i = 0; $i -lt 15 -and -not $healthy; $i++) {
    Start-Sleep -Seconds 1
    try { $healthy = (Invoke-RestMethod "http://127.0.0.1:$Port/health").ok } catch { }
}
if ($healthy) {
    Write-Host "Done: the helper is running on http://127.0.0.1:$Port" -ForegroundColor Green
} else {
    Write-Warning "The service started but isn't answering yet. Its logs are in $logDir"
}
