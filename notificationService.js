const { screen, BrowserWindow, globalShortcut, shell, app, ipcMain } = require('electron');
const path = require('path');

// --- MODULE SCOPE VARIABLES ---
const activeNotifications = new Set();

// --- HELPER FUNCTIONS (Moved from main.js) ---

function formatFileSize(bytes) {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function getAttachmentIcon(mimeType) {
  if (!mimeType) return '📄';
  if (mimeType.startsWith('image/')) return '🖼️';
  if (mimeType.startsWith('video/')) return '🎥';
  if (mimeType.startsWith('audio/')) return '🎵';
  if (mimeType.includes('pdf')) return '📕';
  if (mimeType.includes('word') || mimeType.includes('document')) return '📝';
  if (mimeType.includes('excel') || mimeType.includes('spreadsheet')) return '📊';
  if (mimeType.includes('powerpoint') || mimeType.includes('presentation')) return '📽️';
  if (mimeType.includes('zip') || mimeType.includes('archive')) return '🗜️';
  if (mimeType.includes('text/')) return '📃';
  return '📄';
}

// Reposition notifications after one closes
// Note: BrowserWindow might not be strictly needed if only bounds are used from existing windows.
// However, the original used it, so keeping for now.
function repositionNotifications() {
  const notifications = Array.from(activeNotifications); // Uses module-scoped activeNotifications
  const primaryDisplay = screen.getPrimaryDisplay(); // electron.screen needs to be passed or required
  const { width, height } = primaryDisplay.workAreaSize;
  const notificationWidth = 450; // Assuming a fixed width, or it needs to be dynamic/passed
  const margin = 20;
  let stackOffset = 15; // Initial stack offset

  let currentY = margin;

  notifications.forEach((notificationWindow) => {
    if (notificationWindow && !notificationWindow.isDestroyed()) {
      const bounds = notificationWindow.getBounds();
      const x = width - notificationWidth - margin;

      notificationWindow.setPosition(x, currentY, true); // Animate the move
      currentY += bounds.height + stackOffset;

      // If notifications would go off screen, adjust stackOffset (simple example)
      if (currentY > height - bounds.height) { // Check against next potential position
         stackOffset = Math.max(5, stackOffset - 2); // Reduce offset, ensure minimum
      }
    }
  });
}

// Close notification with fade animation
function closeNotificationWithAnimation(notificationWindow) {
  if (notificationWindow && !notificationWindow.isDestroyed()) {
    notificationWindow.webContents.executeJavaScript(`
      document.body.style.animation = 'slideOut 0.3s ease-in forwards';
      setTimeout(() => { window.close(); }, 300);
      true; // Return a simple value
    `).catch(error => {
      console.error('Error executing close animation:', error);
      if (!notificationWindow.isDestroyed()) {
        notificationWindow.close(); // Fallback
      }
    });
  }
}

// This function is large and moved as-is for now.
// `settings` and `urgencyFromEmailDetails` (which is `emailData.urgency`) will be passed.
function createEnhancedNotificationHTML(emailData, settings, urgencyFromEmailDetails) {
  const notificationData = emailData; // Alias for clarity
  const senderInitial = notificationData.from.charAt(0).toUpperCase();

  let attachmentsHTML = '';
  if (notificationData.attachments && notificationData.attachments.length > 0) {
    const attachmentItems = notificationData.attachments.map(attachment => {
      const icon = getAttachmentIcon(attachment.mimeType); // Uses local getAttachmentIcon
      const sizeStr = formatFileSize(attachment.size);   // Uses local formatFileSize
      return `
        <div class="attachment-item" data-message-id="${notificationData.id}" data-attachment-id="${attachment.attachmentId}" data-filename="${attachment.filename}">
          <div class="attachment-icon">${icon}</div>
          <div class="attachment-info">
            <div class="attachment-name">${attachment.filename}</div>
            <div class="attachment-size">${sizeStr}</div>
          </div>
          ${attachment.mimeType && attachment.mimeType.startsWith('image/') ? '<div class="image-preview-badge">🖼️</div>' : ''}
        </div>`;
    }).join('');
    attachmentsHTML = `
      <div class="attachments-section">
        <div class="attachments-header">
          <span class="attachments-title">📎 ${notificationData.attachments.length} Attachment${notificationData.attachments.length > 1 ? 's' : ''}</span>
        </div>
        <div class="attachments-list">${attachmentItems}</div>
      </div>`;
  }

  let urgencyBadge = '';
  if (settings.showUrgency) { // settings is passed as an argument
    if (urgencyFromEmailDetails === 'high') { // urgencyFromEmailDetails is passed
      urgencyBadge = '<div class="urgency-badge high">🚨 Urgent</div>';
    } else if (urgencyFromEmailDetails === 'medium') {
      urgencyBadge = '<div class="urgency-badge medium">⚠️ Important</div>';
    }
  }

  const readTimeBadge = settings.enableReadTime && notificationData.readTime ?
    `<div class="read-time-badge">📖 ${notificationData.readTime.minutes}m ${notificationData.readTime.seconds}s</div>` : '';
  const summaryBadge = notificationData.isSummary ? '<div class="summary-badge">🤖 AI Summary</div>' : '';
  const ocrBadge = notificationData.isOCRProcessed ? '<div class="ocr-badge">👁️ OCR Processed</div>' : '';

  const quickActionsHTML = `
    <div class="quick-actions">
      <button class="quick-btn view-full-email" data-message-id="${notificationData.id}" title="View full email in app"><span class="btn-icon">👁️</span><span class="btn-text">View Full</span></button>
      <button class="quick-btn mark-as-read" data-message-id="${notificationData.id}" title="Mark as read"><span class="btn-icon">✓</span><span class="btn-text">Mark Read</span></button>
      <button class="quick-btn trash" data-message-id="${notificationData.id}" title="Move to trash"><span class="btn-icon">🗑️</span><span class="btn-text">Delete</span></button>
      <button class="quick-btn star" data-message-id="${notificationData.id}" title="Star email"><span class="btn-icon">⭐</span><span class="btn-text">Star</span></button>
    </div>`;

  const plainBodyForDisplay = (notificationData.body || 'No body content available.').replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const emailBodyDisplayHTML = `<div class="body-text">${plainBodyForDisplay}</div>`;

  // The extensive CSS from main.js's createEnhancedNotificationHTML is included here
  return \`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>Email Notification</title>
      <style>
        /* All CSS from main.js's createEnhancedNotificationHTML */
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;
          background: linear-gradient(135deg, #e0e0e0, #f5f5f5);
          width: 100%; height: 100%; border-radius: 16px; overflow: hidden; cursor: pointer;
          animation: slideIn 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94);
          box-shadow: 0 5px 15px rgba(0,0,0,0.1); position: relative;
        }
        .notification-container {
          background: #ffffff; height: 100%; display: flex; flex-direction: column;
          position: relative; overflow: hidden;
        }
        .notification-container::before {
          content: ''; position: absolute; top: 0; left: 0; right: 0; height: 4px;
          background: #7f8c8d; z-index: 1;
        }
        .notification-container.high-urgency::before { background: #c9302c; height: 4px; }
        .main-content { display: flex; padding: 20px; flex: 1; min-height: 0; }
        .avatar {
          width: 56px; height: 56px; border-radius: 50%; background: #bdc3c7;
          display: flex; align-items: center; justify-content: center;
          color: white; font-weight: 700; font-size: 22px; margin-right: 16px;
          flex-shrink: 0; box-shadow: 0 2px 6px rgba(0,0,0,0.1);
        }
        .avatar.high-urgency { background: #dc2626; box-shadow: 0 4px 12px rgba(220, 38, 38, 0.4); }
        .content { flex: 1; min-width: 0; display: flex; flex-direction: column; }
        .header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
        .sender {
          font-weight: 700; color: #1a1a1a; font-size: 16px; white-space: nowrap;
          overflow: hidden; text-overflow: ellipsis; max-width: 250px;
        }
        .badges { display: flex; gap: 6px; flex-shrink: 0; align-items: center; }
        .urgency-badge {
          font-size: 11px; padding: 3px 7px; border-radius: 10px; font-weight: 600;
          color: white; white-space: nowrap; letter-spacing: 0.2px;
          box-shadow: 0 1px 2px rgba(0,0,0,0.15);
        }
        .urgency-badge.high { background-color: #c9302c; }
        .urgency-badge.medium { background-color: #f0ad4e; }
        .summary-badge, .ocr-badge {
          color: white; box-shadow: 0 1px 2px rgba(0,0,0,0.1); padding: 3px 7px;
          border-radius: 10px; font-weight: 600; font-size: 10px;
        }
        .summary-badge { background-color: #5dade2; }
        .ocr-badge { background-color: #9b59b6; }
        .read-time-badge {
          font-size: 10px; padding: 2px 6px; border-radius: 8px;
          background: #ecf0f1; color: #555;
        }
        .subject {
          font-weight: 600; color: #2c2c2c; font-size: 15px; margin-bottom: 10px;
          line-height: 1.3; word-wrap: break-word;
        }
        .body-text {
          color: #555; font-size: 13px; line-height: 1.5; flex: 1; overflow-y: auto;
          word-wrap: break-word; white-space: pre-wrap; max-height: 200px; padding-right: 8px;
          background-color: #fff; border: 1px solid #eee; border-radius: 4px; padding: 10px;
        }
        .body-text::-webkit-scrollbar { width: 4px; }
        .body-text::-webkit-scrollbar-track { background: rgba(0,0,0,0.05); border-radius: 2px; }
        .body-text::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.2); border-radius: 2px; }
        .body-text::-webkit-scrollbar-thumb:hover { background: rgba(0,0,0,0.3); }
        .attachments-section {
          border-top: 1px solid rgba(0,0,0,0.1); padding: 12px 20px; background: #f8f9fa;
        }
        .attachments-header { margin-bottom: 8px; }
        .attachments-title { font-size: 12px; font-weight: 600; color: #4a5568; }
        .attachments-list { display: flex; flex-direction: column; gap: 6px; }
        .attachment-item {
          display: flex; align-items: center; padding: 8px 12px; background: white;
          border-radius: 8px; cursor: pointer; transition: all 0.2s ease;
          box-shadow: 0 1px 2px rgba(0,0,0,0.05); border: 1px solid rgba(0,0,0,0.05);
        }
        .attachment-item:hover { background: #e9ecef; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
        .attachment-icon {
          width: 32px; height: 32px; border-radius: 6px; background-color: #aab7c4;
          display: flex; align-items: center; justify-content: center;
          margin-right: 10px; font-size: 16px; color: white; flex-shrink: 0;
        }
        .attachment-info { flex: 1; min-width: 0; }
        .attachment-name {
          font-size: 13px; font-weight: 500; color: #2d3748; white-space: nowrap;
          overflow: hidden; text-overflow: ellipsis;
        }
        .attachment-size { font-size: 11px; color: #718096; }
        .image-preview-badge { font-size: 16px; margin-left: 8px; }
        .quick-actions {
          display: flex; gap: 8px; padding: 12px 20px; background: #f1f3f5;
          border-top: 1px solid rgba(0,0,0,0.05);
        }
        .quick-btn {
          flex: 1; display: flex; align-items: center; justify-content: center;
          gap: 6px; padding: 8px 12px; border: none; border-radius: 6px;
          font-size: 12px; font-weight: 600; cursor: pointer; transition: all 0.2s ease;
          background: white; color: #4a5568; box-shadow: 0 1px 2px rgba(0,0,0,0.1);
        }
        .quick-btn:hover { box-shadow: 0 2px 4px rgba(0,0,0,0.12); }
        .quick-btn.mark-as-read:hover { background: #10b981; color: white; }
        .quick-btn.trash:hover { background: #ef4444; color: white; }
        .quick-btn.star:hover { background: #f59e0b; color: white; }
        .quick-btn.view-full-email:hover { background: #3498db; color: white; }
        .btn-icon { font-size: 14px; }
        .btn-text { font-size: 11px; }
        .close-btn {
          position: absolute; top: 12px; right: 12px; width: 28px; height: 28px;
          border-radius: 50%; background: rgba(0,0,0,0.1); border: none; color: #666;
          cursor: pointer; display: flex; align-items: center; justify-content: center;
          font-size: 16px; opacity: 0; transition: all 0.3s ease; z-index: 2;
        }
        .notification-container:hover .close-btn { opacity: 1; }
        .close-btn:hover { background: rgba(239, 68, 68, 0.9); color: white; transform: scale(1.1); }
        @keyframes slideIn {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
        @media (max-height: 400px) {
          .body-text { max-height: 100px; }
        }
      </style>
    </head>
    <body>
      <div class="notification-container ${urgencyFromEmailDetails === 'high' ? 'high-urgency' : ''}">
        <div class="main-content">
          <div class="avatar ${urgencyFromEmailDetails === 'high' ? 'high-urgency' : ''}">${senderInitial}</div>
          <div class="content">
            <div class="header">
              <div class="sender">${notificationData.from}</div>
              <div class="badges">${urgencyBadge}${summaryBadge}${readTimeBadge}${ocrBadge}</div>
            </div>
            <div class="subject">${notificationData.subject || 'No Subject'}</div>
            ${emailBodyDisplayHTML}
          </div>
        </div>
        ${attachmentsHTML}
        ${quickActionsHTML}
        <button class="close-btn" onclick="window.electronAPI.send('close-notification')">×</button>
      </div>
      <script>
        // Script for handling clicks will be part of createCustomNotification's webContents setup
        // Or, if that proves too complex, can be partially here with more generic IPC calls.
        // For now, keeping it simple and assuming main process sets up detailed listeners.
        // The close button above directly uses an IPC send for simplicity in this HTML string.
      </script>
    </body>
    </html>
  \`;
}

// Main function to be exported
function createCustomNotification(emailData, settings, electronModules, serviceFunctions) {
  const { screen, BrowserWindow, globalShortcut, path } = electronModules; // ipcMain, shell, app are part of electronModules but used in serviceFunctions or html string

  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;

  const baseWidth = 450;
  const baseHeight = 180;
  const maxHeight = Math.min(height * 0.8, 600);

  const textLines = Math.ceil((emailData.body || '').length / 60);
  const attachmentHeight = emailData.attachments && emailData.attachments.length > 0 ? 80 : 0;
  const calculatedHeight = Math.min(baseHeight + (textLines * 15) + attachmentHeight, maxHeight);

  const notificationWidth = baseWidth;
  const notificationHeight = calculatedHeight;
  const margin = 20;
  const stackOffset = 15; // This is used by repositionNotifications

  // Calculate X, Y position considering existing notifications
  // For simplicity, this example stacks them; repositionNotifications would adjust if one closes.
  // A more robust solution might involve querying activeNotifications from this module.
  const x = width - notificationWidth - margin;
  let currentY = margin;
  activeNotifications.forEach(win => {
    if (!win.isDestroyed()) {
        const bounds = win.getBounds();
        currentY += bounds.height + stackOffset;
    }
  });
   // Basic check to prevent going off screen, repositionNotifications handles better
  const y = Math.min(currentY, height - notificationHeight - margin);


  const notificationWindow = new BrowserWindow({
    width: notificationWidth,
    height: notificationHeight,
    x: x,
    y: y,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    transparent: true,
    focusable: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js') // Assuming preload.js is in the same dir as main.js/notificationService.js
                                                  // Or adjust path if preload is specific to notifications
    }
  });

  activeNotifications.add(notificationWindow);

  notificationWindow.on('focus', () => {
    globalShortcut.register('CommandOrControl+Shift+I', () => {
      if (notificationWindow && !notificationWindow.isDestroyed()) {
        notificationWindow.webContents.openDevTools({ mode: 'detach' });
      }
    });
  });

  notificationWindow.on('blur', () => {
    globalShortcut.unregister('CommandOrControl+Shift+I');
  });

  notificationWindow.on('closed', () => {
    globalShortcut.unregister('CommandOrControl+Shift+I');
    activeNotifications.delete(notificationWindow);
    repositionNotifications(); // Call reposition for remaining notifications
  });

  // Use urgency from emailData itself as it's directly available.
  const notificationHTML = createEnhancedNotificationHTML(emailData, settings, emailData.urgency);
  notificationWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(notificationHTML)}`);

  // Setup IPC listeners for the new window's webContents
  // These call functions passed via serviceFunctions
  notificationWindow.webContents.on('ipc-message', async (event, channel, ...args) => {
    const messageId = args[0]; // Often the first arg is messageId

    if (channel === 'download-attachment') {
      const [msgId, attachmentId, filename] = args;
      try {
        if (serviceFunctions.downloadAttachment) {
          await serviceFunctions.downloadAttachment(msgId, attachmentId, filename);
        }
      } catch (error) {
        console.error('Failed to download attachment via service function:', error);
      }
    } else if (channel === 'close-notification') {
      closeNotificationWithAnimation(notificationWindow); // Uses local helper
    } else if (channel === 'focus-main-window') {
      // This action might need to be handled by the main process if it involves focusing mainWindow
      // For now, assuming serviceFunctions.focusMainWindow can do this or it's handled by electronAPI in preload
      if (serviceFunctions.focusMainWindow) serviceFunctions.focusMainWindow();
    } else if (channel === 'mark-as-read') {
        if(serviceFunctions.markAsRead) await serviceFunctions.markAsRead(messageId);
    } else if (channel === 'move-to-trash') {
        if(serviceFunctions.moveToTrash) await serviceFunctions.moveToTrash(messageId);
    } else if (channel === 'snooze-email') { // Corresponds to 'star' button in current HTML
        if(serviceFunctions.toggleStarEmail) await serviceFunctions.toggleStarEmail(messageId);
    } else if (channel === 'show-full-email-in-main-window') {
        if(serviceFunctions.showFullEmailInMainWindow) serviceFunctions.showFullEmailInMainWindow(messageId);
    }
    // Other actions from quick-btn can be added here
  });

  // The preload.js for the notification window should expose `window.electronAPI.send` and `window.electronAPI.invoke`
  // The HTML string for createEnhancedNotificationHTML was updated to use `window.electronAPI.send('close-notification')`
  // for the close button. Other buttons in HTML will need to use `electronAPI.invoke` or `electronAPI.send`
  // that are then handled by the listeners above.

  return notificationWindow;
}

module.exports = {
  createCustomNotification
};
