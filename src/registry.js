// Registry cleaner. Only scans per-user (HKCU) locations where an entry that points at a
// file which no longer exists is safe to remove. Every fix is preceded by a .reg backup.
const fs = require('fs');
const path = require('path');
const { runPSJson, psData, run } = require('./ps');

const SCAN_SCRIPT = String.raw`
$out = New-Object System.Collections.ArrayList
function Add-Issue($cat, $key, $value, $data, $reason) {
  [void]$out.Add([pscustomobject]@{ category=$cat; key=$key; value=$value; data=$data; reason=$reason })
}
function Get-ExePath([string]$cmd) {
  if (-not $cmd) { return $null }
  $cmd = [Environment]::ExpandEnvironmentVariables($cmd.Trim())
  if ($cmd.StartsWith('"')) { $end = $cmd.IndexOf('"', 1); if ($end -gt 1) { return $cmd.Substring(1, $end - 1) } }
  $m = [regex]::Match($cmd, '^(.+?\.(exe|com|bat|cmd|dll))', 'IgnoreCase')
  if ($m.Success) { return $m.Groups[1].Value }
  return $null
}
function Is-Missing([string]$p) {
  return $p -and ($p -match '^[A-Za-z]:\\') -and -not (Test-Path -LiteralPath $p)
}

# 1. MUI cache: friendly names cached for executables
$k = 'HKCU:\Software\Classes\Local Settings\Software\Microsoft\Windows\Shell\MuiCache'
if (Test-Path $k) {
  foreach ($n in (Get-Item -LiteralPath $k).Property) {
    $p = $n -replace '\.(FriendlyAppName|ApplicationCompany)$', ''
    if (Is-Missing $p) { Add-Issue 'Application cache' $k $n $p 'Program no longer exists' }
  }
}

# 2. Program Compatibility Assistant history
$k = 'HKCU:\Software\Microsoft\Windows NT\CurrentVersion\AppCompatFlags\Compatibility Assistant\Store'
if (Test-Path $k) {
  foreach ($n in (Get-Item -LiteralPath $k).Property) {
    if (Is-Missing $n) { Add-Issue 'Compatibility history' $k $n $n 'Program no longer exists' }
  }
}

# 3. Startup entries pointing to missing programs
$k = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
if (Test-Path $k) {
  $item = Get-ItemProperty -LiteralPath $k
  foreach ($n in (Get-Item -LiteralPath $k).Property) {
    $exe = Get-ExePath $item.$n
    if (Is-Missing $exe) { Add-Issue 'Startup' $k $n $item.$n 'Startup program not found' }
  }
}

# 4. App Paths registrations for missing programs
$k = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\App Paths'
if (Test-Path $k) {
  foreach ($sub in Get-ChildItem -LiteralPath $k) {
    $exe = Get-ExePath ($sub.GetValue(''))
    if (Is-Missing $exe) { Add-Issue 'Application paths' $sub.PSPath.Replace('Microsoft.PowerShell.Core\Registry::HKEY_CURRENT_USER', 'HKCU:') $null $exe 'Registered program not found' }
  }
}

# 5. Uninstall entries for programs that are gone
$k = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall'
if (Test-Path $k) {
  foreach ($sub in Get-ChildItem -LiteralPath $k) {
    $exe = Get-ExePath ($sub.GetValue('UninstallString'))
    $loc = $sub.GetValue('InstallLocation')
    if ((Is-Missing $exe) -and (-not $loc -or (Is-Missing $loc))) {
      $name = $sub.GetValue('DisplayName'); if (-not $name) { $name = $sub.PSChildName }
      Add-Issue 'Obsolete software' $sub.PSPath.Replace('Microsoft.PowerShell.Core\Registry::HKEY_CURRENT_USER', 'HKCU:') $null $name 'Uninstaller no longer exists'
    }
  }
}

if ($out.Count -eq 0) { '[]' } else { ConvertTo-Json -InputObject @($out) -Depth 3 -Compress }
`;

let lastIssues = [];

async function scan() {
  // Merge values that describe the same missing program in the same key (e.g. MUI cache
  // stores both "x.exe.FriendlyAppName" and "x.exe.ApplicationCompany").
  const merged = new Map();
  for (const i of await runPSJson(SCAN_SCRIPT)) {
    const k = `${i.key}|${i.data}`;
    if (!merged.has(k)) merged.set(k, { category: i.category, key: i.key, values: [], data: i.data, reason: i.reason });
    if (i.value) merged.get(k).values.push(i.value);
  }
  lastIssues = [...merged.values()].map((i, idx) => ({ id: idx, ...i }));
  return lastIssues;
}

function backupDir(app) {
  return path.join(app.getPath('userData'), 'registry-backups');
}

async function fix(ids, app) {
  const selected = lastIssues.filter((i) => ids.includes(i.id));
  if (!selected.length) return { fixed: 0, failed: 0, backup: null };

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.join(backupDir(app), stamp);
  fs.mkdirSync(dir, { recursive: true });

  // Back up each affected key once.
  const keys = [...new Set(selected.map((i) => i.key))];
  for (let n = 0; n < keys.length; n++) {
    const regKey = keys[n].replace(/^HKCU:\\/, 'HKCU\\');
    const r = await run('reg', ['export', regKey, path.join(dir, `${n + 1}.reg`), '/y']);
    if (r.code !== 0) throw new Error(`Could not back up ${regKey}; nothing was changed.`);
  }

  const result = await runPSJson(`
    $items = ${psData(selected.map(({ key, values }) => ({ key, values })))}
    $ok = 0; $bad = 0
    foreach ($i in $items) {
      try {
        if ($i.values.Count) { foreach ($v in $i.values) { Remove-ItemProperty -LiteralPath $i.key -Name $v -ErrorAction Stop } }
        else { Remove-Item -LiteralPath $i.key -Recurse -ErrorAction Stop }
        $ok++
      } catch { $bad++ }
    }
    @{ fixed = $ok; failed = $bad } | ConvertTo-Json -Compress
  `);
  lastIssues = lastIssues.filter((i) => !ids.includes(i.id));
  return { ...result[0], backup: dir };
}

function listBackups(app) {
  const dir = backupDir(app);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((d) => fs.statSync(path.join(dir, d)).isDirectory()).sort().reverse()
    .map((d) => ({ name: d, path: path.join(dir, d), files: fs.readdirSync(path.join(dir, d)).length }));
}

async function restore(backupPath, app) {
  // Only allow restoring from our own backup folder.
  const root = path.resolve(backupDir(app));
  const target = path.resolve(backupPath);
  if (!target.startsWith(root + path.sep)) throw new Error('Invalid backup path');
  let failed = 0;
  for (const f of fs.readdirSync(target).filter((f) => f.endsWith('.reg'))) {
    const r = await run('reg', ['import', path.join(target, f)]);
    if (r.code !== 0) failed++;
  }
  return { failed };
}

module.exports = { scan, fix, listBackups, restore, backupDir };
