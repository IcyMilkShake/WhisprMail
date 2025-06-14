const { app, BrowserWindow, ipcMain, Notification, shell, screen, globalShortcut } = require('electron');
const path = require('path');
// fs is no longer directly used in main.js; file operations are in respective services.
// googleapis and http are no longer needed here as their functionality is in gmailAuth.js
// say module is now passed to and used by emailProcessingOrchestrator.js
// puppeteer module is now passed to and used by emailProcessingOrchestrator.js
require('dotenv').config();

// Import Python service
const pythonService = require('./pythonService');
// Import GmailAuth service
const gmailAuth = require('./gmailAuth');
// Import Email service
const emailService = require('./emailService');
// Import Notification service
const notificationService = require('./notificationService');
// Import Settings service
const settingsService = require('./settingsService');
// Import Monitoring service
const monitoringService = require('./monitoringService');
// Import Notifiable Authors service
const notifiableAuthorsService = require('./notifiableAuthorsService');
// Import Email Processing Orchestrator
const emailProcessingOrchestrator = require('./emailProcessingOrchestrator');
// Import Main UI Service
const mainUIService = require('./mainUIService');

// NOTIFIABLE_AUTHORS_PATH and notifiableAuthors array are now managed by notifiableAuthorsService.js

// --- GLOBAL VARIABLES & CONSTANTS ---
// PYTHON_EXECUTABLE_PATH has been moved to pythonService.js
// SCOPES has been moved to gmailAuth.js

let mainWindow;
let gmail;
let oAuth2Client;
// isMonitoring, knownEmailIds, monitoringStartTime moved to monitoringService.js
// activeNotifications has been moved to notificationService.js
// openEmailViewWindows is now managed by mainUIService.js

// User settings - will be initialized from settingsService
let settings = {};

// --- PYTHON SCRIPT EXECUTION HELPER ---
// executePythonScript has been moved to pythonService.js

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Promise Rejection at:', promise, 'reason:', reason);
  // Don't exit the process, just log the error
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  // Handle gracefully instead of crashing
});

// --- ELECTRON APP LIFECYCLE & MAIN WINDOW ---
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 700,
    height: 500,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    },
  });
  mainWindow.loadFile('index.html');
}

app.whenReady().then(async () => {
  createWindow();
  settings = settingsService.getSettings(); // Initialize settings

  // Initialize and load notifiable authors using the service
  notifiableAuthorsService.init(app); // Pass app object
  await notifiableAuthorsService.loadAuthors(); // Load authors

  try {
    // Call the imported initializeGmail and store its results
    const authResult = await gmailAuth.initializeGmail();
    oAuth2Client = authResult.oAuth2Client;
    gmail = authResult.gmail;

    if (gmail && oAuth2Client) {
      // Initialize Monitoring Service
      // Initialize Email Processing Orchestrator
      emailProcessingOrchestrator.init({
        gmail: gmail,
        pythonService: pythonService,
        emailService: emailService,
        notificationService: notificationService,
        settingsService: settingsService,
        notifiableAuthorsService: notifiableAuthorsService,
        say: say,
        mainWindow: mainWindow,
        puppeteer: puppeteer,
        app: app,
        shell: shell
      });

      // Initialize Monitoring Service
      monitoringService.init({
        gmail: gmail,
        emailService: emailService,
        processNewEmailIdCallback: emailProcessingOrchestrator.processNewEmailId,
        updateEmailCountCallback: updateEmailCountCallback,
        // mainWindow and settings are not directly needed by monitoringService itself now
        // It also doesn't need notifiableAuthors or a direct settings reference
      });

      // Initialize Main UI Service
      mainUIService.init({
        mainWindow: mainWindow,
        IFRAME_BASE_CSS_string: IFRAME_BASE_CSS, // Pass the constant from main.js
        emailProcessingOrchestrator: emailProcessingOrchestrator,
        emailService: emailService,
        BrowserWindowModule: BrowserWindow, // Pass the BrowserWindow class/module itself
        gmail: gmail // Pass the initialized gmail object
      });

      // Auto-start monitoring if desired, or rely on IPC call
      await monitoringService.startMonitoring();
      console.log('Email monitoring started via monitoringService!');
    } else {
      throw new Error('Gmail client or OAuth2 client not initialized properly after auth.');
    }
  } catch (error) {
    console.error('Failed to initialize application:', error);
    // Optionally, inform the user via a dialog if in main process context
    // dialog.showErrorBox('Initialization Error', `Failed to initialize application: ${error.message}`);
    // Consider whether to quit the app or let it run in a degraded state
  }
});

// openEmailViewWindow and createAndShowEmailWindow are now part of mainUIService.js

ipcMain.on('show-full-email-in-main-window', async (event, messageId) => {
  await mainUIService.openEmailViewWindow(messageId); // MODIFIED
});

app.on('window-all-closed', () => {
  // stopMonitoring(); // This should be called by monitoringService if it has a cleanup, or handled by app exit
  if (monitoringService && typeof monitoringService.stopMonitoring === 'function') {
    monitoringService.stopMonitoring();
  }
  if (process.platform !== 'darwin') app.quit();
});

// Also, ensure that when the main app quits, these windows are closed.
app.on('before-quit', () => {
  if (mainUIService && typeof mainUIService.closeAllEmailViewWindows === 'function') {
    mainUIService.closeAllEmailViewWindows();
  }
  // Potentially other cleanup for services if needed
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// --- GMAIL AUTHENTICATION & API SETUP ---
// createAuthServer has been moved to gmailAuth.js
// initializeGmail has been moved to gmailAuth.js

// --- EMAIL PROCESSING & ANALYSIS ---
// getNewEmails has been moved to emailService.js
// extractSenderName has been moved to emailService.js
// processEmailContent has been moved to emailService.js
// getEmailDetails, captureEmailWithPuppeteer, processEmailWithOCR, and estimateReadTime are moved to emailProcessingOrchestrator.js

// --- NOTIFICATION DISPLAY & MANAGEMENT ---
// createCustomNotification, formatFileSize, getAttachmentIcon,
// repositionNotifications, closeNotificationWithAnimation, createEnhancedNotificationHTML
// have been moved to notificationService.js

const IFRAME_BASE_CSS = `
      <style>
        body {
          margin: 0; /* MODIFIED */
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;
          font-size: 14px;
          line-height: 1.5;
          color: #333;
          background-color: #fff;
          word-wrap: break-word;
          overflow-wrap: break-word;
          /* width: 100%; // Keep if you want body to at least try to fill, but content can make it wider */
          /* max-width: 100%; // Remove this if body content is meant to define scrollable width */
          box-sizing: border-box;
          overflow-x: auto; /* CRITICAL: Re-enable horizontal scrolling for the body */
          /* overflow-y: auto; // Implicitly handled by default or can be added if needed */
        }
        a {
          color: #1a73e8;
        }
        a:hover {
        }
        img {
          max-width: 100%; /* No !important. Allows inline style to override for wider images. */
          height: auto;    /* No !important. */
        }
        p, div, li, blockquote {
            word-wrap: break-word;
            overflow-wrap: break-word;
        }
        table {
          table-layout: auto;  /* More natural for content-based sizing, allows tables to be wider than container */
          width: auto;         /* Let table determine its own width based on content */
                           /* Remove max-width: 100% if tables are meant to scroll horizontally */
          border-collapse: collapse;
          /* word-wrap and overflow-wrap on table itself might be less effective than on cells */
        }
        td, th {
          border: none; /* MODIFIED */
          word-wrap: break-word;   /* Still important for content within cells */
          overflow-wrap: break-word;
          min-width: 0;          /* Still useful for flexible columns */
        }
        pre {
          white-space: pre-wrap;
          word-wrap: break-word;
          overflow-x: auto; /* Allows horizontal scroll *within the pre block only* */
          background: #f4f4f4;
          padding: 10px;
          border-radius: 4px;
          max-width: 100%; /* The pre block itself tries to fit the container width */
          box-sizing: border-box;
        }
        ul, ol {
        }
      </style>
    `;
// NOTE: Duplicated versions of summarizeText, detectEmotionalTone, fallbackUrgencyDetection,
// and estimateReadTime have been removed.
// Their definitions are consolidated elsewhere in the file (using executePythonScript or under UTILITY FUNCTIONS).

// NOTE: The duplicated functions createAuthServer, initializeGmail, getNewEmails,
// extractSenderName, processEmailContent, getEmailDetails, and the first downloadAttachment
// have been removed. Their definitions are consolidated elsewhere in the file.

// Gmail API Actions
// Enhanced Gmail API Actions with proper error handling and scope management

// Removing the duplicated SCOPES and associated functions.
// This was previously identified as a source of error.
// The SEARCH block targets the beginning of this duplicated section.
// The REPLACE block is empty, effectively deleting this section.
// End of the duplicated block to be deleted.

// NOTE: The older versions of markAsRead, moveToTrash, and toggleStarEmail that were here
// have been removed as per the refactoring task.
// The versions used by IPC handlers are located further down under
// `// --- GMAIL API ACTIONS (Called via IPC) ---`

// NOTE: Duplicated versions of captureEmailWithPuppeteer, runPythonOCR, processEmailWithOCR,
// checkForNewEmails, startMonitoring, and stopMonitoring have been removed.
// Their definitions are consolidated elsewhere in the file.


ipcMain.handle('download-attachment', async (event, messageId, attachmentId, filename) => {
  try {
    // Ensure gmail is available
    if (!gmail) {
      console.error('Gmail service not initialized. Cannot download attachment.');
      return { success: false, error: 'Gmail service not available.' };
    }
    const filePath = await emailService.downloadAttachment(gmail, app, shell, messageId, attachmentId, filename);
    
    // Send success notification back to the notification window
    const notification = BrowserWindow.fromWebContents(event.sender);
    if (notification && !notification.isDestroyed()) {
      notification.webContents.executeJavaScript(`
        // Show download success feedback
        const item = document.querySelector('[data-attachment-id="${attachmentId}"]');
        if (item) {
          item.style.background = 'linear-gradient(135deg, #10b981, #059669)';
          item.style.color = 'white';
          item.querySelector('.attachment-name').textContent = '✓ Downloaded';
          setTimeout(() => {
            item.style.background = '';
            item.style.color = '';
          }, 2000);
        }
      `);
    }
    
    return { success: true, filePath };
  } catch (error) {
    console.error('Attachment download failed:', error);
    
    // Send error feedback to notification window
    const notification = BrowserWindow.fromWebContents(event.sender);
    if (notification && !notification.isDestroyed()) {
      notification.webContents.executeJavaScript(`
        const item = document.querySelector('[data-attachment-id="${attachmentId}"]');
        if (item) {
          item.style.background = 'linear-gradient(135deg, #ef4444, #dc2626)';
          item.style.color = 'white';
          item.querySelector('.attachment-name').textContent = '✗ Download failed';
          setTimeout(() => {
            item.style.background = '';
            item.style.color = '';
            item.querySelector('.attachment-name').textContent = '${filename}';
          }, 3000);
        }
      `);
    }
    
    return { success: false, error: error.message };
  }
});
ipcMain.handle('mark-as-read', async (event, messageId) => {
  try {
    if (!gmail) return { success: false, error: 'Gmail service not available.', messageId };
    const result = await emailService.markAsRead(gmail, messageId);
    if (result.success) {
        knownEmailIds.delete(messageId);
    }
    // Send result back to notification window for UI feedback
    const notification = BrowserWindow.fromWebContents(event.sender);
    if (notification && !notification.isDestroyed()) {
      if (result.success) {
        notification.webContents.executeJavaScript(`
          // Update UI to show success
          const btn = document.querySelector('.quick-btn.mark-as-read[data-message-id="${messageId}"]');
          if (btn) {
            btn.innerHTML = '<span class="btn-icon">✓</span><span class="btn-text">Read</span>';
            btn.style.background = '#10b981';
            btn.style.color = 'white';
          }
        `).catch(console.error); // Add error handling for executeJavaScript
      } else {
        notification.webContents.executeJavaScript(`
          const btn = document.querySelector('.quick-btn.mark-as-read[data-message-id="${messageId}"]');
          if (btn) {
            btn.innerHTML = '<span class="btn-icon">✗</span><span class="btn-text">Error</span>';
            btn.style.background = '#ef4444';
            btn.style.color = 'white';
          }
        `).catch(console.error);
      }
    }
    
    // Return only serializable data
    return {
      success: result.success,
      error: result.error || null,
      messageId: messageId
    };
  } catch (error) {
    console.error('Error in mark-as-read handler:', error);
    return {
      success: false,
      error: error.message,
      messageId: messageId
    };
  }
});
ipcMain.handle('move-to-trash', async (event, messageId) => {
  try {
    if (!gmail) return { success: false, error: 'Gmail service not available.', messageId };
    const result = await emailService.moveToTrash(gmail, messageId);
    if (result.success) {
        knownEmailIds.delete(messageId);
    }
    // Send result back to notification window for UI feedback
    const notification = BrowserWindow.fromWebContents(event.sender);
    if (notification && !notification.isDestroyed()) {
      if (result.success) {
        notification.webContents.executeJavaScript(`
          const btn = document.querySelector('.quick-btn.trash[data-message-id="${messageId}"]');
          if (btn) {
            btn.innerHTML = '<span class="btn-icon">✓</span><span class="btn-text">Deleted</span>';
            btn.style.background = '#10b981';
            btn.style.color = 'white';
          }
        `).catch(console.error);
      } else {
        notification.webContents.executeJavaScript(`
          const btn = document.querySelector('.quick-btn.trash[data-message-id="${messageId}"]');
          if (btn) {
            btn.innerHTML = '<span class="btn-icon">✗</span><span class="btn-text">Error</span>';
            btn.style.background = '#ef4444';
            btn.style.color = 'white';
          }
        `).catch(console.error);
      }
    }
    
    // Return only serializable data
    return {
      success: result.success,
      error: result.error || null,
      messageId: messageId
    };
  } catch (error) {
    console.error('Error in move-to-trash handler:', error);
    return {
      success: false,
      error: error.message,
      messageId: messageId
    };
  }
});

ipcMain.handle('snooze-email', async (event, messageId, days = 1) => { // 'days' param seems unused by toggleStarEmail
  try {
    if (!gmail) return { success: false, error: 'Gmail service not available.', messageId };
    const result = await emailService.toggleStarEmail(gmail, messageId);
    // Send result back to notification window for UI feedback
    const notification = BrowserWindow.fromWebContents(event.sender);
    if (notification && !notification.isDestroyed()) {
      const buttonSelector = `.quick-btn.star[data-message-id="${messageId}"]`;

      if (result.success) {
        const starIcon = '⭐';
        const statusText = result.starred ? 'Starred' : 'Unstarred';
        const backgroundColor = result.starred ? '#f59e0b' : '#7f8c8d';

        notification.webContents.executeJavaScript(`
          const btn = document.querySelector('${buttonSelector}');
          if (btn) {
            btn.innerHTML = '<span class="btn-icon">${starIcon}</span><span class="btn-text">${statusText}</span>';
            btn.style.background = '${backgroundColor}';
            btn.style.color = 'white';
          }
        `).catch(console.error);
      } else {
        notification.webContents.executeJavaScript(`
          const btn = document.querySelector('${buttonSelector}');
          if (btn) {
            btn.innerHTML = '<span class="btn-icon">⭐</span><span class="btn-text">Star</span>';
            btn.style.background = '#ef4444';
            btn.style.color = 'white';
            btn.title = 'Error: ${result.error || 'Could not star email'}';
          }
        `).catch(console.error);
      }
    }

    // Return only serializable data
    return {
      success: result.success,
      starred: result.starred || false,
      error: result.error || null,
      messageId: messageId
    };
  } catch (error) {
    console.error('Error in snooze-email handler:', error);
    return {
      success: false,
      starred: false,
      error: error.message,
      messageId: messageId
    };
  }
});
// --- UTILITY FUNCTIONS ---
// estimateReadTime has been moved to emailProcessingOrchestrator.js

// --- GMAIL API ACTIONS (Called via IPC) ---
// downloadAttachment, markAsRead, moveToTrash, toggleStarEmail are moved to emailService.js
// The IPC handlers below will call these service functions.

// --- EMAIL MONITORING SERVICE ---
// checkForNewEmails, startMonitoring, stopMonitoring moved to monitoringService.js
// processNewEmailIdCallback is effectively replaced by emailProcessingOrchestrator.processNewEmailId

// Callback for updating email count in UI, to be passed to monitoringService
function updateEmailCountCallback(count) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('email-count-update', count);
  }
}

// --- IPC HANDLERS ---
ipcMain.handle('check-new-mail', async () => {
  // Ensure Gmail is initialized before checking mail
  if (!gmail || !oAuth2Client) {
    try {
      console.log('Gmail not initialized. Attempting to initialize for check-new-mail...');
      const authResult = await gmailAuth.initializeGmail();
      oAuth2Client = authResult.oAuth2Client;
      gmail = authResult.gmail;
      if (!gmail) throw new Error('Gmail service not available after initialization.');
    } catch (e) {
      console.error("Gmail init failed in check-new-mail:", e.message);
      return 0; // Return 0 or appropriate error indicator
    }
  }
  return (await emailService.getNewEmails(gmail, monitoringStartTime)).length;
});

ipcMain.handle('start-monitoring', async () => {
  // Ensure Gmail is initialized before starting monitoring
  if (!gmail || !oAuth2Client) {
    try {
      console.log('Gmail not initialized for IPC start-monitoring. Attempting to initialize...');
      const authResult = await gmailAuth.initializeGmail();
      oAuth2Client = authResult.oAuth2Client;
      gmail = authResult.gmail;
      // Re-initialize monitoring service with potentially new gmail object & orchestrator callback
       emailProcessingOrchestrator.init({ // Also re-init orchestrator if gmail changes
        gmail: gmail, pythonService: pythonService, emailService: emailService, notificationService: notificationService,
        settingsService: settingsService, notifiableAuthorsService: notifiableAuthorsService, say: say, mainWindow: mainWindow,
        puppeteer: puppeteer, app: app, shell: shell
      });
      monitoringService.init({
        gmail: gmail, emailService: emailService,
        processNewEmailIdCallback: emailProcessingOrchestrator.processNewEmailId,
        updateEmailCountCallback: updateEmailCountCallback
      });
      if (!gmail) throw new Error('Gmail service not available after initialization for start-monitoring IPC.');
    } catch (e) {
      console.error("Gmail init failed in start-monitoring IPC:", e.message);
      return `Gmail initialization failed: ${e.message}`;
    }
  }
  return await monitoringService.startMonitoring();
});

ipcMain.handle('stop-monitoring', () => monitoringService.stopMonitoring());

ipcMain.handle('update-settings', async (event, newSettingsFromRenderer) => {
  settings = settingsService.updateSettings(newSettingsFromRenderer); // Use service
  console.log('Settings updated via service:', settings);
  return settings; // Return the updated settings back to renderer
});

ipcMain.handle('get-settings', () => {
  // Ensure main.js settings are up-to-date, though direct return from service is cleaner
  // settings = settingsService.getSettings(); // Optional: Re-sync if concerned about direct manipulation elsewhere
  return settingsService.getSettings(); // Directly return from service
});

// Make sure IFRAME_BASE_CSS is accessible in this scope.
// It's already defined globally in main.js, so it should be fine.

ipcMain.handle('get-latest-email-html', async () => {
  // Ensure Gmail is initialized - this check should ideally be part of the service method
  // or handled by ensuring service is only called when gmail is ready.
  // For now, the service method itself will need access to an initialized gmail object.
  try {
    // The mainUIService's init method should have received the gmail object.
    if (!mainUIService) { // Basic check
        return { success: false, error: 'Main UI Service not available.'};
    }
    return await mainUIService.getLatestEmailHTMLHandlerLogic();
  } catch (error) {
    console.error('Error in get-latest-email-html IPC handler:', error);
    return { success: false, error: 'Failed to get latest email HTML: ' + error.message };
  }
});

// --- NOTIFIABLE AUTHORS IPC HANDLERS ---
ipcMain.handle('get-notifiable-authors', () => {
  return notifiableAuthorsService.getAuthors();
});

ipcMain.handle('add-notifiable-author', async (event, authorEmail) => {
  return await notifiableAuthorsService.addAuthor(authorEmail);
});

ipcMain.handle('remove-notifiable-author', async (event, authorEmail) => {
  return await notifiableAuthorsService.removeAuthor(authorEmail);
});

// --- NOTIFIABLE AUTHORS FUNCTIONS --- (These are now removed)
// loadNotifiableAuthors moved to notifiableAuthorsService.js
// saveNotifiableAuthors moved to notifiableAuthorsService.js

// IPC handler to provide IFRAME_BASE_CSS to renderer processes
ipcMain.handle('get-iframe-base-css', () => {
  return IFRAME_BASE_CSS;
});

// TEMPORARY EXPORT FOR TESTING