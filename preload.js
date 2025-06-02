const { contextBridge, ipcRenderer } = require('electron');

// Main Gmail API for the main window
contextBridge.exposeInMainWorld('gmail', {
  checkNewMail: () => ipcRenderer.invoke('check-new-mail'),
  startMonitoring: () => ipcRenderer.invoke('start-monitoring'),
  stopMonitoring: () => ipcRenderer.invoke('stop-monitoring'),
  updateSettings: (settings) => ipcRenderer.invoke('update-settings', settings),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  downloadAttachment: (messageId, attachmentId, filename) => 
    ipcRenderer.invoke('download-attachment', messageId, attachmentId, filename),
  onEmailCountUpdate: (callback) => ipcRenderer.on('email-count-update', callback),
  onNewEmail: (callback) => ipcRenderer.on('new-email', callback),
  removeAllListeners: () => {
    ipcRenderer.removeAllListeners('email-count-update');
    ipcRenderer.removeAllListeners('new-email');
  }
});

// Electron API for notification windows (used when this preload is loaded in notification windows)
contextBridge.exposeInMainWorld('electronAPI', {
  send: (channel, ...args) => {
    const validChannels = ['download-attachment', 'close-notification', 'focus-main-window'];
    if (validChannels.includes(channel)) {
      ipcRenderer.send(channel, ...args);
    }
  }
});