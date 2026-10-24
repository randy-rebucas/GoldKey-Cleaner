const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const cleaner = require('./src/cleaner');
const registry = require('./src/registry');
const startup = require('./src/startup');
const programs = require('./src/programs');
const system = require('./src/system');

let win;

function createWindow() {
  win = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 960,
    minHeight: 620,
    backgroundColor: '#0c0a07',
    title: 'GoldKey Cleaner',
    icon: path.join(__dirname, 'renderer', 'logo.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

const progress = (channel) => (data) => win?.webContents.send(channel, data);

// Wraps handlers so errors reach the renderer as { error } instead of rejecting.
function handle(channel, fn) {
  ipcMain.handle(channel, async (_e, ...args) => {
    try { return { ok: true, data: await fn(...args) }; }
    catch (err) { return { ok: false, error: err.message || String(err) }; }
  });
}

handle('junk:scan', (group) => cleaner.scan(group, progress('progress')));
handle('junk:clean', (ids) => cleaner.clean(ids, progress('progress')));

handle('registry:scan', () => registry.scan());
handle('registry:fix', (ids) => registry.fix(ids, app));
handle('registry:backups', () => registry.listBackups(app));
handle('registry:restore', (p) => registry.restore(p, app));
handle('registry:openBackups', () => {
  require('fs').mkdirSync(registry.backupDir(app), { recursive: true });
  return shell.openPath(registry.backupDir(app));
});

handle('startup:list', () => startup.list());
handle('startup:set', (id, enabled) => startup.setEnabled(id, enabled));

handle('programs:list', () => programs.list());
handle('programs:uninstall', (id) => programs.uninstall(id));

handle('system:info', () => system.info());
handle('system:isAdmin', () => system.isAdmin());
handle('system:relaunchAdmin', () => {
  const args = app.isPackaged ? [] : [app.getAppPath()];
  const argList = args.map((a) => `'${a.replace(/'/g, "''")}'`).join(',');
  const ps = `Start-Process -FilePath '${process.execPath.replace(/'/g, "''")}' ${argList ? `-ArgumentList ${argList}` : ''} -Verb RunAs`;
  const child = spawn('powershell.exe', ['-NoProfile', '-Command', ps], { detached: true, stdio: 'ignore', windowsHide: true });
  child.on('exit', (code) => { if (code === 0) app.quit(); });
  return true;
});

handle('disk:pickFolder', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'], defaultPath: os.homedir() });
  return r.canceled ? null : r.filePaths[0];
});
handle('disk:home', () => os.homedir());
handle('disk:largeFiles', (root, minMB) => system.largeFiles(root, minMB, progress('disk-progress')));
handle('disk:reveal', (p) => {
  if (!system.isKnownLargeFile(p)) throw new Error('Unknown file');
  shell.showItemInFolder(p);
});
handle('disk:trash', async (p) => {
  if (!system.isKnownLargeFile(p)) throw new Error('Unknown file');
  await shell.trashItem(p);
  system.forgetLargeFile(p);
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
