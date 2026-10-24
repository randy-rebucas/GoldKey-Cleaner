// Installed-program list and uninstaller launcher.
const { spawn } = require('child_process');
const { runPSJson } = require('./ps');

const LIST_SCRIPT = String.raw`
$paths = 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
         'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*',
         'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*'
$apps = Get-ItemProperty $paths |
  Where-Object { $_.DisplayName -and $_.UninstallString -and -not $_.SystemComponent -and -not $_.ParentKeyName -and -not $_.ReleaseType } |
  Select-Object DisplayName, Publisher, DisplayVersion, EstimatedSize, InstallDate, UninstallString, QuietUninstallString |
  Sort-Object DisplayName -Unique
if (-not $apps) { '[]' } else { ConvertTo-Json -InputObject @($apps) -Compress }
`;

let lastList = [];

function parseDate(d) {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(d || '');
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

async function list() {
  const raw = await runPSJson(LIST_SCRIPT);
  lastList = raw.map((a, id) => ({
    id,
    name: a.DisplayName,
    publisher: a.Publisher || '',
    version: a.DisplayVersion || '',
    size: a.EstimatedSize ? a.EstimatedSize * 1024 : 0,
    installDate: parseDate(a.InstallDate),
    uninstallString: a.UninstallString,
  }));
  return lastList.map(({ uninstallString, ...rest }) => rest);
}

// Normalise an uninstall command so "start" can launch it (and trigger UAC when needed).
function toCommandLine(cmd) {
  cmd = cmd.trim();
  if (cmd.startsWith('"')) return cmd;
  const m = /^(.+?\.exe)(.*)$/i.exec(cmd);
  return m && m[1].includes(' ') ? `"${m[1]}"${m[2]}` : cmd;
}

function uninstall(id) {
  const app = lastList.find((a) => a.id === id);
  if (!app) throw new Error('Unknown program; refresh the list.');
  const child = spawn('cmd.exe', ['/d', '/s', '/c', `start "" ${toCommandLine(app.uninstallString)}`], {
    detached: true, windowsHide: true, windowsVerbatimArguments: true, stdio: 'ignore',
  });
  child.unref();
  return true;
}

module.exports = { list, uninstall };
