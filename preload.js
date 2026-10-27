const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('blob', {
  onEvent: (cb) => ipcRenderer.on('claude-event', (_e, evt) => cb(evt)),
  onCursor: (cb) => ipcRenderer.on('cursor', (_e, pos) => cb(pos)),
  onLight: (cb) => ipcRenderer.on('light', (_e, light) => cb(light)),
  onColor: (cb) => ipcRenderer.on('color', (_e, color) => cb(color)),
  setColor: (color, done) => ipcRenderer.send('set-color', color, done),
  onPin: (cb) => ipcRenderer.on('pin', (_e, id) => cb(id)),
  setSessions: (list) => ipcRenderer.send('sessions', list),
  setIgnore: (ignore) => ipcRenderer.send('set-ignore', ignore),
  dragStart: () => ipcRenderer.send('drag-start'),
  dragEnd: () => ipcRenderer.send('drag-end'),
  contextMenu: () => ipcRenderer.send('context-menu'),
});
