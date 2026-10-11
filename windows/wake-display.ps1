<#
.SYNOPSIS
Turns the display on after the PC wakes in the morning.

.DESCRIPTION
Run in the kiosk account's session by the "Inspire9 Wall morning wake" task (set up by
setup-kiosk.ps1), which also wakes the PC from sleep.
#>

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

# Ask Windows for the display, broadcast "monitor on", then nudge the mouse by a pixel and
# back, which wakes displays that ignore the message.
[Display]::SetThreadExecutionState(0x00000002) | Out-Null                       # ES_DISPLAY_REQUIRED
[Display]::PostMessage([IntPtr]0xffff, 0x0112, [IntPtr]0xF170, [IntPtr](-1)) | Out-Null  # SC_MONITORPOWER on
[Display]::mouse_event(0x0001, 1, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 200
[Display]::mouse_event(0x0001, -1, 0, 0, [UIntPtr]::Zero)
