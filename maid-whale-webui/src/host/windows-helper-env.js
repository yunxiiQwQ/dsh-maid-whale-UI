import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

// LABEL_SECURITY_INFORMATION reads only the mandatory label, without requesting
// the audit SACL privilege. SID aliases are independent of the Windows language.
// Keep executable paths in the environment, never in PowerShell source.
const inspectLabel = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class HelperIntegrity {
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode)]
  static extern uint GetNamedSecurityInfoW(string name, int type, uint info,
    out IntPtr owner, out IntPtr group, out IntPtr dacl, out IntPtr sacl, out IntPtr descriptor);
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool ConvertSecurityDescriptorToStringSecurityDescriptorW(
    IntPtr descriptor, uint revision, uint info, out IntPtr text, out uint length);
  [DllImport("kernel32.dll")]
  static extern IntPtr LocalFree(IntPtr memory);
  [DllImport("shell32.dll")]
  static extern int SHGetKnownFolderPath(ref Guid folder, uint flags, IntPtr token, out IntPtr path);
  public static string LowDirectory(string executable) {
    IntPtr owner, group, dacl, sacl, descriptor, text;
    uint status = GetNamedSecurityInfoW(executable, 1, 0x10, out owner, out group, out dacl, out sacl, out descriptor);
    if (status != 0) throw new Win32Exception((int)status);
    string label;
    try {
      uint length;
      if (!ConvertSecurityDescriptorToStringSecurityDescriptorW(descriptor, 1, 0x10, out text, out length))
        throw new Win32Exception(Marshal.GetLastWin32Error());
      try { label = Marshal.PtrToStringUni(text); }
      finally { LocalFree(text); }
    } finally { LocalFree(descriptor); }
    if (!label.Contains(";;;LW)")) return null;
    Guid folder = new Guid("A520A1A4-1780-4FF6-BD18-167343C5AF16");
    IntPtr path;
    Marshal.ThrowExceptionForHR(SHGetKnownFolderPath(ref folder, 0, IntPtr.Zero, out path));
    try { return Marshal.PtrToStringUni(path); }
    finally { Marshal.FreeCoTaskMem(path); }
  }
}
'@
[HelperIntegrity]::LowDirectory($env:DSH_HELPER_INSPECT_PATH) | ConvertTo-Json -Compress
`

export function lowIntegrityEnvironment(executable, env) {
  const output = execFileSync(
    join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', inspectLabel],
    {
      env: { ...process.env, DSH_HELPER_INSPECT_PATH: executable },
      encoding: 'utf8',
      windowsHide: true,
      timeout: 10000,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  ).trim()
  const localLow = output ? JSON.parse(output) : null
  if (!localLow) return undefined
  const directory = join(localLow, 'DSH', 'maid-whale-webui')
  const temp = join(directory, 'temp')
  mkdirSync(temp, { recursive: true })
  return {
    TMP: temp,
    TEMP: temp,
    DSH_DAFEIYU_LAYOUT_PATH: env.DSH_DAFEIYU_LAYOUT_PATH || join(directory, 'layout.json'),
  }
}
