const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('gmail', {
  checkNewMail: () => ipcRenderer.invoke('check-new-mail'),
  startMonitoring: () => ipcRenderer.invoke('start-monitoring'),
  stopMonitoring: () => ipcRenderer.invoke('stop-monitoring'),
  onEmailCountUpdate: (callback) => ipcRenderer.on('email-count-update', callback),
  removeEmailCountListener: (callback) => ipcRenderer.removeListener('email-count-update', callback)
});