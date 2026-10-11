<#
.SYNOPSIS
Keeps the wall dashboard open in Edge kiosk mode for the kiosk account.

.DESCRIPTION
Started at sign-in by the "Inspire9 Wall kiosk browser" task (set up by setup-kiosk.ps1).
Opens the dashboard full screen in Edge kiosk mode and opens it again if Edge is closed
or crashes.
#>
param(
    [Parameter(Mandatory)][string]$Url
)

$edge = @(
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $edge) { throw 'Microsoft Edge not found' }

$session = (Get-Process -Id $PID).SessionId

while ($true) {
    $open = Get-CimInstance Win32_Process -Filter "Name = 'msedge.exe'" |
        Where-Object { $_.SessionId -eq $session -and $_.CommandLine -like '*--kiosk*' }
    if (-not $open) {
        Start-Process $edge -ArgumentList '--kiosk', $Url, '--edge-kiosk-type=fullscreen', '--no-first-run'
        Start-Sleep -Seconds 20   # give it time to start before checking again
    }
    Start-Sleep -Seconds 10
}
