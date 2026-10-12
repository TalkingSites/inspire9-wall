#Requires -RunAsAdministrator
<#
.SYNOPSIS
Sets up the PC as the wall kiosk. Safe to run again: it updates whatever is already there.

.DESCRIPTION
1. Kiosk account: a standard local account (no admin rights) that the screen runs under.
2. Edge settings: no first-run, restore or translation prompts, nothing running in the
   background, and the dashboard allowed to reach the helper on this PC without a prompt.
3. Kiosk browser: Edge opens the dashboard full screen at the kiosk account's sign-in,
   and again if it's closed or crashes.
4. Return to kiosk: after someone uses remote desktop, the kiosk session comes back to
   the screen by itself.
5. Power: display and PC stay on, wake timers allowed, the PC wakes and turns the display
   on every morning, and the lock screen keeps the display on for an hour.
6. Automatic sign-in for the kiosk account (with -EnableAutologon), using Microsoft's
   Sysinternals Autologon, which stores the password encrypted.
7. The Sonos helper (install-helper.ps1), unless -SkipHelper.

The helper scripts it needs come from the latest GitHub release, or from the same folder
when run from a copy of the repo.

.EXAMPLE
.\setup-kiosk.ps1 -DashboardUrl https://wall.example.com -SpeakerLimits "Kitchen=60" -EnableAutologon
#>
param(
    [Parameter(Mandatory)][string]$DashboardUrl,
    [string]$KioskUser = 'Calendar',
    [securestring]$KioskPassword,
    [switch]$EnableAutologon,
    [string]$WakeAt = '7:30am',
    [int]$MaxVolume,
    [string]$SpeakerLimits,
    [switch]$SkipHelper
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$repo = 'TalkingSites/inspire9-wall'
$dataDir = Join-Path $env:ProgramData 'Inspire9 Wall Kiosk'
$origin = ([Uri]$DashboardUrl).GetLeftPart([UriPartial]::Authority)
$kioskAccount = "$env:COMPUTERNAME\$KioskUser"

function Step($message) { Write-Host "`n== $message" -ForegroundColor Cyan }
function Done($message) { Write-Host "   $message" }

New-Item -ItemType Directory -Force -Path $dataDir | Out-Null

# Copies one of the kiosk scripts into $dataDir: from this folder if it's here, otherwise
# from the latest release.
function Get-KioskScript($name) {
    $target = Join-Path $dataDir $name
    $local = Join-Path $PSScriptRoot $name
    if ($PSScriptRoot -and (Test-Path $local)) {
        if ($local -ne $target) { Copy-Item $local $target -Force }
    } else {
        Invoke-WebRequest "https://github.com/$repo/releases/latest/download/$name" -OutFile $target -UseBasicParsing
    }
    return $target
}

function Plain([securestring]$secure) {
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

function Set-Policy($path, $name, $value) {
    if (-not (Test-Path $path)) { New-Item -Path $path -Force | Out-Null }
    $type = if ($value -is [int]) { 'DWord' } else { 'String' }
    New-ItemProperty -Path $path -Name $name -Value $value -PropertyType $type -Force | Out-Null
}

function Set-PolicyList($path, [string[]]$values) {
    if (Test-Path $path) { Remove-Item $path -Recurse -Force }
    New-Item -Path $path -Force | Out-Null
    for ($i = 0; $i -lt $values.Count; $i++) {
        New-ItemProperty -Path $path -Name ($i + 1) -Value $values[$i] -PropertyType String -Force | Out-Null
    }
}

# 1. Kiosk account ------------------------------------------------------------------------
Step "Kiosk account ($KioskUser)"
$user = Get-LocalUser -Name $KioskUser -ErrorAction SilentlyContinue
if (-not $user) {
    if (-not $KioskPassword) { $KioskPassword = Read-Host "Choose a password for $KioskUser" -AsSecureString }
    New-LocalUser -Name $KioskUser -Password $KioskPassword -FullName 'Wall kiosk' -Description 'Runs the wall dashboard' `
        -PasswordNeverExpires -AccountNeverExpires -UserMayNotChangePassword | Out-Null
    Add-LocalGroupMember -Group 'Users' -Member $KioskUser
    Done 'created (standard user)'
} else {
    Set-LocalUser -Name $KioskUser -PasswordNeverExpires $true
    Done 'already there'
}
if (Get-LocalGroupMember -Group 'Administrators' -Member $KioskUser -ErrorAction SilentlyContinue) {
    Write-Warning "$KioskUser is an administrator. The kiosk works, but a standard account is safer."
}

# 2. Windows and Edge settings --------------------------------------------------------------
Step 'Windows and Edge settings'
# No privacy questions or "Hi" animation the first time the kiosk account signs in.
Set-Policy 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\OOBE' 'DisablePrivacyExperience' 1
Set-Policy 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System' 'EnableFirstLogonAnimation' 0

$edgePolicies = 'HKLM:\SOFTWARE\Policies\Microsoft\Edge'
Set-Policy $edgePolicies 'HideFirstRunExperience' 1
Set-Policy $edgePolicies 'TranslateEnabled' 0
Set-Policy $edgePolicies 'DefaultBrowserSettingEnabled' 0
Set-Policy $edgePolicies 'ShowRecommendationsEnabled' 0
Set-Policy $edgePolicies 'BrowserSignin' 0
Set-Policy $edgePolicies 'PasswordManagerEnabled' 0
# Edge running in the background would make the kiosk window open as a normal one.
Set-Policy $edgePolicies 'StartupBoostEnabled' 0
Set-Policy $edgePolicies 'BackgroundModeEnabled' 0
# Let the dashboard reach the helper on this PC without asking (new and older policy names).
Set-PolicyList "$edgePolicies\LoopbackNetworkAllowedForUrls" @($origin)
Set-PolicyList "$edgePolicies\LocalNetworkAccessAllowedForUrls" @($origin)
Done "Edge prompts off; $origin may use the helper"

# 3. Kiosk browser --------------------------------------------------------------------------
Step 'Kiosk browser at sign-in'
$browserScript = Get-KioskScript 'kiosk-browser.ps1'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$browserScript`" -Url `"$DashboardUrl`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $kioskAccount
$principal = New-ScheduledTaskPrincipal -UserId $kioskAccount -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName 'Inspire9 Wall kiosk browser' -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
Done "Edge kiosk mode on $DashboardUrl"

# 4. Return to kiosk after remote desktop ---------------------------------------------------
Step 'Return to kiosk after remote desktop'
$returnScript = Get-KioskScript 'return-kiosk.ps1'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$returnScript`" -KioskUser `"$KioskUser`""
# When a session disconnects (24) or signs out (23), a few seconds later...
$eventClass = Get-CimClass -ClassName MSFT_TaskEventTrigger -Namespace Root/Microsoft/Windows/TaskScheduler
$onSessionEnd = New-CimInstance -CimClass $eventClass -ClientOnly
$onSessionEnd.Enabled = $true
$onSessionEnd.Delay = 'PT5S'
$onSessionEnd.Subscription = '<QueryList><Query Id="0" Path="Microsoft-Windows-TerminalServices-LocalSessionManager/Operational"><Select Path="Microsoft-Windows-TerminalServices-LocalSessionManager/Operational">*[System[(EventID=23 or EventID=24)]]</Select></Query></QueryList>'
# ...and every 5 minutes as a safety net.
$everyFive = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 5)
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 2) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName 'Inspire9 Wall return to kiosk' -Action $action -Trigger @($onSessionEnd, $everyFive) -Principal $principal -Settings $settings -Force | Out-Null
Done 'on remote desktop sign-out or disconnect, and every 5 minutes'

# 5. Power and morning wake -----------------------------------------------------------------
Step 'Power'
# On all the time for now: display, sleep and hibernate never time out on mains power.
powercfg /change monitor-timeout-ac 0
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
# Allow wake timers, so the morning wake task can wake the PC if it ever sleeps.
powercfg /setacvalueindex SCHEME_CURRENT SUB_SLEEP RTCWAKE 1
# "Console lock display off timeout" is hidden and turns the display off after a minute on
# the lock screen (for instance just after a remote desktop session). Show it and raise it.
$consoleLock = '8ec4b3a5-6868-48c2-be75-4f3044be88a7'
powercfg -attributes SUB_VIDEO $consoleLock -ATTRIB_HIDE
powercfg /setacvalueindex SCHEME_CURRENT SUB_VIDEO $consoleLock 3600
powercfg /setactive SCHEME_CURRENT
Done 'display and PC stay on; lock screen keeps the display on for an hour'

$wakeScript = Get-KioskScript 'wake-display.ps1'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$wakeScript`""
$trigger = New-ScheduledTaskTrigger -Daily -At $WakeAt
$principal = New-ScheduledTaskPrincipal -UserId $kioskAccount -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -WakeToRun -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 1) -StartWhenAvailable
Register-ScheduledTask -TaskName 'Inspire9 Wall morning wake' -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
Done "wakes and turns the display on daily at $WakeAt"

# 6. Automatic sign-in ----------------------------------------------------------------------
if ($EnableAutologon) {
    Step "Automatic sign-in for $KioskUser"
    if (-not $KioskPassword) { $KioskPassword = Read-Host "Password for $KioskUser" -AsSecureString }
    $zip = Join-Path $env:TEMP 'AutoLogon.zip'
    $folder = Join-Path $env:TEMP 'AutoLogon'
    Invoke-WebRequest 'https://download.sysinternals.com/files/AutoLogon.zip' -OutFile $zip -UseBasicParsing
    Expand-Archive $zip -DestinationPath $folder -Force
    $autologon = Join-Path $folder 'Autologon64.exe'
    $signature = Get-AuthenticodeSignature $autologon
    if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notlike '*O=Microsoft Corporation*') {
        throw 'Autologon download is not signed by Microsoft; not running it'
    }
    # Autologon is a GUI program, so PowerShell wouldn't wait for it without Start-Process -Wait
    $quotedPassword = '"{0}"' -f ((Plain $KioskPassword) -replace '"', '\"')
    Start-Process $autologon -ArgumentList $KioskUser, $env:COMPUTERNAME, $quotedPassword, '/accepteula' -Wait
    Remove-Item $zip, $folder -Recurse -Force -ErrorAction SilentlyContinue
    $winlogon = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon'
    if ($winlogon.AutoAdminLogon -ne '1' -or $winlogon.DefaultUserName -ne $KioskUser) {
        throw "Automatic sign-in wasn't set. Run this again, or run Autologon by hand."
    }
    Done 'on (password stored encrypted by Windows)'
}

# 7. Sonos helper ---------------------------------------------------------------------------
if (-not $SkipHelper) {
    Step 'Sonos helper'
    $helperScript = Get-KioskScript 'install-helper.ps1'
    $helperArgs = @{ DashboardUrl = $DashboardUrl; WeeklyUpdate = $true }
    if ($MaxVolume) { $helperArgs.MaxVolume = $MaxVolume }
    if ($PSBoundParameters.ContainsKey('SpeakerLimits')) { $helperArgs.SpeakerLimits = $SpeakerLimits }
    & $helperScript @helperArgs
}

Write-Host "`nAll set." -ForegroundColor Green
if (-not $EnableAutologon) {
    Write-Host "Automatic sign-in isn't on. Run this again with -EnableAutologon, or set it up with Sysinternals Autologon."
}
Write-Host "Restart the PC: it should sign in as $KioskUser and open the dashboard full screen."
