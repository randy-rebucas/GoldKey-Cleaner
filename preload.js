const { contextBridge, ipcRenderer } = require('electron');

const call = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('api', {
  junk: { scan: call('junk:scan'), clean: call('junk:clean') },
  registry: {
    scan: call('registry:scan'), fix: call('registry:fix'), backups: call('registry:backups'),
    restore: call('registry:restore'), openBackups: call('registry:openBackups'),
  },
  startup: { list: call('startup:list'), set: call('startup:set') },
  programs: { list: call('programs:list'), uninstall: call('programs:uninstall') },
  system: { info: call('system:info'), isAdmin: call('system:isAdmin'), relaunchAdmin: call('system:relaunchAdmin') },
  disk: {
    pickFolder: call('disk:pickFolder'), home: call('disk:home'), largeFiles: call('disk:largeFiles'),
    reveal: call('disk:reveal'), trash: call('disk:trash'),
  },
  onProgress: (cb) => ipcRenderer.on('progress', (_e, d) => cb(d)),
  onDiskProgress: (cb) => ipcRenderer.on('disk-progress', (_e, d) => cb(d)),
});
