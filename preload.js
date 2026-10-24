const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('blob', {
  onEvent: (cb) => ipcRenderer.on('claude-event', (_e, evt) => cb(evt)),
  onCursor: (cb) => ipcRenderer.on('cursor', (_e, pos) => cb(pos)),
  setIgnore: (ignore) => ipcRenderer.send('set-ignore', ignore),
  dragStart: () => ipcRenderer.send('drag-start'),
  dragEnd: () => ipcRenderer.send('drag-end'),
  contextMenu: () => ipcRenderer.send('context-menu'),
});
