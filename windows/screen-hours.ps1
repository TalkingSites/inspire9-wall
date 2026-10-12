<#
.SYNOPSIS
Keeps the display on during the day and turns it off in the evening.

.DESCRIPTION
Run in the kiosk account's session by the "Inspire9 Wall screen hours" task (set up by
setup-kiosk.ps1) every morning, which also wakes the PC if it ever sleeps, and at the kiosk
account's sign-in. Between -OnAt and -OffAt it turns the display on and keeps it on; at
-OffAt it turns the display off and exits. The PC and the dashboard keep running overnight,
and a touch wakes the display until the overnight display timeout turns it off again.
#>
param(
    [string]$OnAt = '7:30am',
    [string]$OffAt = '5pm'
)

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class Display {
    [DllImport("user32.dll")]
    public static extern bool PostMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern void mouse_event(uint flags, int dx, int dy, uint data, UIntPtr extra);

    [DllImport("kernel32.dll")]
    public static extern uint SetThreadExecutionState(uint flags);
}
'@

# SetThreadExecutionState flags: ES_CONTINUOUS (0x80000000), plus ES_SYSTEM_REQUIRED (1)
# and ES_DISPLAY_REQUIRED (2).
$continuous = [uint32]2147483648
$keepOn = [uint32]2147483651
$broadcast = [IntPtr]0xffff
$sysCommand = 0x0112
$monitorPower = [IntPtr]0xF170

# Today's times (a [datetime] cast of '7:30am' gives today at 7:30).
$on = [datetime]$OnAt
$off = [datetime]$OffAt
$now = Get-Date
if ($now -lt $on.AddMinutes(-5) -or $now -ge $off) { return }   # outside screen hours

# Turn the display on: broadcast "monitor on", then nudge the mouse by a pixel and back,
# which wakes displays that ignore the message.
[Display]::PostMessage($broadcast, $sysCommand, $monitorPower, [IntPtr](-1)) | Out-Null
[Display]::mouse_event(0x0001, 1, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 200
[Display]::mouse_event(0x0001, -1, 0, 0, [UIntPtr]::Zero)

# Keep the display and PC on until the evening, asking again every minute.
while ((Get-Date) -lt $off) {
    [Display]::SetThreadExecutionState($keepOn) | Out-Null
    Start-Sleep -Seconds 60
}

# Let go, and turn the display off ("monitor off" is 2).
[Display]::SetThreadExecutionState($continuous) | Out-Null
[Display]::PostMessage($broadcast, $sysCommand, $monitorPower, [IntPtr]2) | Out-Null
