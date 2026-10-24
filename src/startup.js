// Startup manager. Enabling/disabling uses the same StartupApproved flags as Task Manager,
// so changes are reversible and visible in Windows' own UI.
const { runPSJson, psData } = require('./ps');

const LIST_SCRIPT = String.raw`
$out = New-Object System.Collections.ArrayList
$approvedBase = 'Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved'
function Get-Enabled($approvedKey, $name) {
  $v = (Get-ItemProperty -LiteralPath $approvedKey -Name $name -ErrorAction SilentlyContinue).$name
  if ($v -is [byte[]] -and $v.Length -gt 0) { return ($v[0] % 2) -eq 0 }
  return $true
}
$runKeys = @(
  @{ path='HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'; approved="HKCU:\$approvedBase\Run"; scope='Current user' },
  @{ path='HKLM:\Software\Microsoft\Windows\CurrentVersion\Run'; approved="HKLM:\$approvedBase\Run"; scope='All users' },
  @{ path='HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Run'; approved="HKLM:\$approvedBase\Run32"; scope='All users (32-bit)' }
)
foreach ($rk in $runKeys) {
  if (-not (Test-Path $rk.path)) { continue }
  $props = Get-ItemProperty -LiteralPath $rk.path
  foreach ($n in (Get-Item -LiteralPath $rk.path).Property) {
    [void]$out.Add([pscustomobject]@{ name=$n; command=[string]$props.$n; scope=$rk.scope; source='Registry'; approved=$rk.approved; enabled=(Get-Enabled $rk.approved $n) })
  }
}
$folders = @(
  @{ path=[Environment]::GetFolderPath('Startup'); approved="HKCU:\$approvedBase\StartupFolder"; scope='Current user' },
  @{ path=[Environment]::GetFolderPath('CommonStartup'); approved="HKLM:\$approvedBase\StartupFolder"; scope='All users' }
)
foreach ($f in $folders) {
  if (-not (Test-Path -LiteralPath $f.path)) { continue }
  foreach ($file in Get-ChildItem -LiteralPath $f.path -File | Where-Object { $_.Name -ne 'desktop.ini' }) {
    [void]$out.Add([pscustomobject]@{ name=$file.Name; command=$file.FullName; scope=$f.scope; source='Startup folder'; approved=$f.approved; enabled=(Get-Enabled $f.approved $file.Name) })
  }
}
if ($out.Count -eq 0) { '[]' } else { ConvertTo-Json -InputObject @($out) -Compress }
`;

let lastList = [];

async function list() {
  lastList = (await runPSJson(LIST_SCRIPT)).map((e, id) => ({ id, ...e }));
  return lastList.map(({ approved, ...rest }) => rest);
}

async function setEnabled(id, enabled) {
  const entry = lastList.find((e) => e.id === id);
  if (!entry) throw new Error('Unknown startup entry; refresh the list.');
  const res = await runPSJson(`
    $e = ${psData({ approved: entry.approved, name: entry.name, enabled })}
    try {
      if (-not (Test-Path -LiteralPath $e.approved)) { New-Item -Path $e.approved -ErrorAction Stop | Out-Null }
      $first = if ($e.enabled) { 2 } else { 3 }
      $bytes = [byte[]](@($first) + (@(0) * 11))
      New-ItemProperty -LiteralPath $e.approved -Name $e.name -PropertyType Binary -Value $bytes -Force -ErrorAction Stop | Out-Null
      @{ ok = $true } | ConvertTo-Json -Compress
    } catch { @{ ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress }
  `);
  if (!res[0].ok) {
    const msg = /access|denied|unauthorized/i.test(res[0].error || '') ? 'Administrator rights are required for "All users" entries.' : res[0].error;
    throw new Error(msg);
  }
  entry.enabled = enabled;
  return true;
}

module.exports = { list, setEnabled };
