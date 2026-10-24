// System information, drive usage, large-file finder and admin helpers.
const fsp = require('fs').promises;
const path = require('path');
const os = require('os');
const { runPSJson, run } = require('./ps');

async function info() {
  const [extra] = await runPSJson(String.raw`
    $os = Get-CimInstance Win32_OperatingSystem
    $cs = Get-CimInstance Win32_ComputerSystem
    $gpu = (Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name) -join ', '
    $disks = Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | ForEach-Object {
      [pscustomobject]@{ drive=$_.DeviceID; label=$_.VolumeName; size=[int64]$_.Size; free=[int64]$_.FreeSpace; fs=$_.FileSystem }
    }
    [pscustomobject]@{
      osName = $os.Caption; osBuild = $os.BuildNumber; installed = $os.InstallDate.ToString('yyyy-MM-dd')
      lastBoot = $os.LastBootUpTime.ToString('yyyy-MM-dd HH:mm')
      manufacturer = $cs.Manufacturer; model = $cs.Model; gpu = $gpu; disks = @($disks)
    } | ConvertTo-Json -Depth 4 -Compress
  `);
  const cpus = os.cpus();
  return {
    ...extra,
    hostname: os.hostname(),
    user: os.userInfo().username,
    arch: os.arch(),
    cpu: cpus[0]?.model?.trim() || 'Unknown',
    cores: cpus.length,
    totalMem: os.totalmem(),
    freeMem: os.freemem(),
    uptime: os.uptime(),
  };
}

let lastLarge = [];

async function largeFiles(root, minMB, onProgress) {
  const min = minMB * 1024 * 1024;
  const found = [];
  let scanned = 0;
  async function walk(dir, depth) {
    if (depth > 20) return;
    let entries;
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isSymbolicLink()) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (/^(\$Recycle\.Bin|System Volume Information|Windows|WinSxS)$/i.test(e.name)) continue;
        await walk(full, depth + 1);
      } else if (e.isFile()) {
        if (++scanned % 2000 === 0) onProgress?.({ scanned, current: dir });
        try {
          const st = await fsp.lstat(full);
          if (st.size >= min) found.push({ path: full, size: st.size, modified: st.mtimeMs });
        } catch { /* ignore */ }
      }
    }
  }
  await walk(root, 0);
  found.sort((a, b) => b.size - a.size);
  lastLarge = found.slice(0, 500);
  return { scanned, files: lastLarge };
}

function isKnownLargeFile(p) {
  return lastLarge.some((f) => f.path === p);
}

function forgetLargeFile(p) {
  lastLarge = lastLarge.filter((f) => f.path !== p);
}

async function isAdmin() {
  const r = await run('net', ['session']);
  return r.code === 0;
}

module.exports = { info, largeFiles, isKnownLargeFile, forgetLargeFile, isAdmin };
