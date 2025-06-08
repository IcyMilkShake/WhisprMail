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
  },
  // Add the new functions for notifiable authors:
  getNotifiableAuthors: () => ipcRenderer.invoke('get-notifiable-authors'),
  addNotifiableAuthor: (email) => ipcRenderer.invoke('add-notifiable-author', email),
  removeNotifiableAuthor: (email) => ipcRenderer.invoke('remove-notifiable-author', email)
});

// Electron API for notification windows (used when this preload is loaded in notification windows)
contextBridge.exposeInMainWorld('electronAPI', {
  send: (channel, ...args) => {
    const validSendChannels = ['close-notification', 'focus-main-window'];
    if (validSendChannels.includes(channel)) {
      ipcRenderer.send(channel, ...args);
    }
  },
  invoke: (channel, ...args) => {
    const validInvokeChannels = ['download-attachment', 'mark-as-read', 'move-to-trash', 'snooze-email'];
    if (validInvokeChannels.includes(channel)) {
      return ipcRenderer.invoke(channel, ...args);
    }
    // Optionally, return a rejected promise or throw an error for invalid channels
    return Promise.reject(new Error(`Invalid invoke channel: ${channel}`));
  }
});