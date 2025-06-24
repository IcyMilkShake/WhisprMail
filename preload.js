// preload.js
const { contextBridge, ipcRenderer } = require('electron');

// List of channels that 'on' can subscribe to from main process
const validReceiveChannels = [
  'display-email-in-modal',
  'display-email-in-modal-error',
  'email-count-update',
  'new-email', // Assuming this is used from main.js to renderer.js for new email notifications shown in-app
  'console-log-from-main' // Added for receiving main process logs
  // Add any other channels that main.js sends to renderer.js for the main window
];

// List of channels that 'send' can use from renderer to main process (if any, invoke is preferred)
// For renderer.js, most communication to main is via invoke.
// Channels used by notification windows are handled by their own preload if different.
const validSendChannels = [
  // Example: 'some-renderer-to-main-channel'
];

// List of channels that 'invoke' can use
const validInvokeChannels = [
  'get-settings',
  'update-settings',
  'check-new-mail',
  'start-monitoring',
  'stop-monitoring',
  'get-notifiable-authors',
  'add-notifiable-author',
  'remove-notifiable-author',
  'get-latest-email-html', // Used by main window's "View All" button to populate modal
  'open-email-in-gmail', // Added for opening email in Gmail via View All button
  // Channels for quick actions in notifications, if they were to be invoked from main renderer (currently not the case)
  // 'mark-as-read',
  // 'move-to-trash',
  // 'snooze-email',
  // 'download-attachment'
  // Note: The quick actions in notifications use their own preload exposing electronAPI.invoke.
  // This list is for window.gmail.invoke from the main renderer.js
];

contextBridge.exposeInMainWorld('gmail', {
  // Generic invoke function for renderer -> main -> renderer communication
  invoke: (channel, ...args) => {
    if (validInvokeChannels.includes(channel)) {
      return ipcRenderer.invoke(channel, ...args);
    }
    console.warn(`[Preload] Attempted to invoke invalid channel: ${channel}`);
    return Promise.reject(new Error(`Invalid invoke channel: ${channel}`));
  },

  // Generic 'on' function for main -> renderer communication
  on: (channel, callback) => {
    if (validReceiveChannels.includes(channel)) {
      // Strip event from callback to avoid exposing sender
      const newCallback = (_, ...args) => callback(...args);
      ipcRenderer.on(channel, newCallback);
      // Return a cleanup function
      return () => {
        ipcRenderer.removeListener(channel, newCallback);
      };
    }
    console.warn(`[Preload] Attempted to subscribe to invalid channel: ${channel}`);
    return () => {}; // Return a no-op cleanup function for invalid channels
  },

  // Generic 'send' function for renderer -> main one-way communication (if needed)
  send: (channel, ...args) => {
    if (validSendChannels.includes(channel)) {
      ipcRenderer.send(channel, ...args);
    } else {
      console.warn(`[Preload] Attempted to send on invalid channel: ${channel}`);
    }
  },

  // Specific function wrappers (which internally use invoke)
  // These are kept if renderer.js calls them directly like window.gmail.getSettings()
  // If renderer.js was changed to use window.gmail.invoke('get-settings'), these wouldn't be needed.
  // Based on renderer.js structure, it uses these direct calls.
  getSettings: () => ipcRenderer.invoke('get-settings'),
  updateSettings: (settings) => ipcRenderer.invoke('update-settings', settings),
  checkNewMail: () => ipcRenderer.invoke('check-new-mail'),
  startMonitoring: () => ipcRenderer.invoke('start-monitoring'),
  stopMonitoring: () => ipcRenderer.invoke('stop-monitoring'),
  getNotifiableAuthors: () => ipcRenderer.invoke('get-notifiable-authors'),
  addNotifiableAuthor: (email) => ipcRenderer.invoke('add-notifiable-author', email),
  removeNotifiableAuthor: (email) => ipcRenderer.invoke('remove-notifiable-author', email),

  // A function to remove all listeners for a channel (if truly needed, specific cleanup is better)
  // removeAllListeners: (channel) => {
  //   if (validReceiveChannels.includes(channel)) {
  //     ipcRenderer.removeAllListeners(channel);
  //   } else {
  //     console.warn(`[Preload] Attempted to remove listeners from invalid channel: ${channel}`);
  //   }
  // }
  // Note: The 'on' function now returns a specific cleanup function, which is preferred.
});

console.log('[Preload] Gmail API exposed to renderer.');

// Expose a specific listener for main process logs
contextBridge.exposeInMainWorld('mainProcessLogs', {
  onLog: (callback) => {
    const listener = (event, logEntry) => callback(logEntry);
    ipcRenderer.on('console-log-from-main', listener);
    return () => {
      ipcRenderer.removeListener('console-log-from-main', listener);
    };
  }
});

console.log('[Preload] mainProcessLogs API exposed to renderer.');

// Define channels for electronAPI (for notification windows)
const validNotificationInvokeChannels = [
  'download-attachment',
  'mark-as-read',
  'move-to-trash',
  'snooze-email'
];

const validNotificationSendChannels = [
  'show-full-email-in-main-window',
  'focus-main-window',
  'close-notification'
];

// Expose electronAPI for notification windows
contextBridge.exposeInMainWorld('electronAPI', {
  invoke: (channel, ...args) => {
    if (validNotificationInvokeChannels.includes(channel)) {
      return ipcRenderer.invoke(channel, ...args);
    }
    console.warn(`[Preload - electronAPI] Attempted to invoke invalid channel: ${channel}`);
    return Promise.reject(new Error(`Invalid invoke channel for electronAPI: ${channel}`));
  },
  send: (channel, ...args) => {
    if (validNotificationSendChannels.includes(channel)) {
      ipcRenderer.send(channel, ...args);
    } else {
      console.warn(`[Preload - electronAPI] Attempted to send on invalid channel: ${channel}`);
    }
  }
});

console.log('[Preload] electronAPI exposed for notification windows.');

// It's important to also consider the preload script for the notification windows.
// The `createEnhancedNotificationHTML` function in `main.js` defines its own preload for `window.electronAPI`.
// That preload should expose:
// window.electronAPI.send('channel', ...args) -> ipcRenderer.send('channel', ...args)
// window.electronAPI.invoke('channel', ...args) -> ipcRenderer.invoke('channel', ...args)
// The errors provided are from the main renderer.js, so this subtask focuses on the main preload.js.
