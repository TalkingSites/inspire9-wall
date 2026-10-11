<#
.SYNOPSIS
Puts the kiosk account's session back on the screen after someone has used remote desktop.

.DESCRIPTION
When a colleague remote desktops into the PC under their own account, Windows moves the
kiosk account's session off the screen (it stays signed in, disconnected). When they're
done, this reconnects the kiosk session to the console with tscon, so the dashboard comes
back without anyone typing a password.

Runs as SYSTEM from the "Inspire9 Wall return to kiosk" scheduled task (set up by
setup-kiosk.ps1): whenever a session disconnects or signs out (Terminal Services events
23 and 24) and every 5 minutes as a safety net. It does nothing while a remote desktop
session is active, or while someone else is signed in at the PC itself.
#>
param(
    [string]$KioskUser = 'Calendar'
)

$ErrorActionPreference = 'Stop'
$logFile = Join-Path $env:ProgramData 'Inspire9 Wall Kiosk\return-kiosk.log'

function Log($message) {
    $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $message"
    # Keep the log small: start again once it passes 1 MB.
    if ((Test-Path $logFile) -and (Get-Item $logFile).Length -gt 1MB) { Remove-Item $logFile }
    Add-Content -Path $logFile -Value $line
}

# Windows' own list of sessions (more reliable than parsing `query session` output).
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public class WtsSession {
    public int Id;
    public string Station;
    public string User;
    public int State;
}

public static class Wts {
    [DllImport("wtsapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool WTSEnumerateSessions(IntPtr server, int reserved, int version, out IntPtr info, out int count);

    [DllImport("wtsapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool WTSQuerySessionInformation(IntPtr server, int sessionId, int infoClass, out IntPtr buffer, out int bytes);

    [DllImport("wtsapi32.dll")]
    static extern void WTSFreeMemory(IntPtr memory);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct SessionInfo {
        public int SessionId;
        public string WinStationName;
        public int State;
    }

    public static List<WtsSession> Sessions() {
        var list = new List<WtsSession>();
        IntPtr info;
        int count;
        if (!WTSEnumerateSessions(IntPtr.Zero, 0, 1, out info, out count)) return list;
        int size = Marshal.SizeOf(typeof(SessionInfo));
        for (int i = 0; i < count; i++) {
            var s = (SessionInfo)Marshal.PtrToStructure(new IntPtr(info.ToInt64() + i * size), typeof(SessionInfo));
            list.Add(new WtsSession { Id = s.SessionId, Station = s.WinStationName ?? "", State = s.State, User = UserName(s.SessionId) });
        }
        WTSFreeMemory(info);
        return list;
    }

    static string UserName(int sessionId) {
        IntPtr buffer;
        int bytes;
        if (!WTSQuerySessionInformation(IntPtr.Zero, sessionId, 5 /* WTSUserName */, out buffer, out bytes)) return "";
        string name = Marshal.PtrToStringUni(buffer);
        WTSFreeMemory(buffer);
        return name ?? "";
    }
}
'@

$active = 0
$disconnected = 4
$sessions = [Wts]::Sessions()

$kiosk = $sessions | Where-Object { $_.User -eq $KioskUser } | Select-Object -First 1
if (-not $kiosk) {
    Log "$KioskUser isn't signed in; nothing to bring back (it signs in again at the next restart)"
    return
}
if ($kiosk.State -ne $disconnected) { return }   # already on screen

$remote = $sessions | Where-Object { $_.State -eq $active -and $_.Station -like 'RDP-Tcp*' }
if ($remote) { return }   # someone is using remote desktop right now

$someoneAtPc = $sessions | Where-Object { $_.State -eq $active -and $_.Station -eq 'Console' -and $_.User -and $_.User -ne $KioskUser }
if ($someoneAtPc) { return }   # someone else is signed in at the PC itself

& "$env:SystemRoot\System32\tscon.exe" $kiosk.Id /dest:console
if ($LASTEXITCODE) { Log "tscon couldn't reconnect session $($kiosk.Id) (exit $LASTEXITCODE)" }
else { Log "brought $KioskUser (session $($kiosk.Id)) back to the screen" }
