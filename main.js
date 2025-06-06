const { app, BrowserWindow, ipcMain, Notification, shell, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { google } = require('googleapis');
const open = require('open').default || require('open');
const http = require('http');
const say = require('say');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer');
require('dotenv').config();

// --- GLOBAL VARIABLES & CONSTANTS ---
const PYTHON_EXECUTABLE_PATH = path.join(__dirname, 'python_executor', 'python.exe'); // Added from previous task
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.labels'
];

let mainWindow;
let gmail;
let oAuth2Client;
let isMonitoring = false;
let knownEmailIds = new Set();
let monitoringStartTime = null;
let activeNotifications = new Set(); // Track active notification windows

// User settings
let settings = {
  enableSummary: false,
  enableVoiceReading: true,
  enableReadTime: true, 
  speakSenderName: true, // <-- ADD THIS LINE
  speakSubject: true,    // <-- ADD THIS LINE
  huggingfaceToken: process.env.HUGGINGFACE_TOKEN, // Retain from .env
  showUrgency: true
};

// --- PYTHON SCRIPT EXECUTION HELPER ---
function executePythonScript(scriptName, scriptArgs = [], inputText = null, timeout = 100000) {
  return new Promise((resolve, reject) => {
    const fullScriptPath = path.join(__dirname, scriptName);
    const pythonProcess = spawn(PYTHON_EXECUTABLE_PATH, [fullScriptPath, ...scriptArgs]);

    let stdoutData = '';
    let stderrData = '';
    let timer;

    // Timeout mechanism
    if (timeout > 0) {
      timer = setTimeout(() => {
        pythonProcess.kill('SIGKILL'); // Force kill the process
        reject(new Error(`Python script ${scriptName} timed out after ${timeout}ms`));
      }, timeout);
    }

    pythonProcess.stdout.on('data', (data) => {
      stdoutData += data.toString();
    });

    pythonProcess.stderr.on('data', (data) => {
      stderrData += data.toString();
    });

    pythonProcess.on('close', (code) => {
      clearTimeout(timer); // Clear the timeout
      if (stderrData) {
        console.error(`${scriptName} stderr: ${stderrData}`);
      }
      if (code === 0) {
        try {
          const result = JSON.parse(stdoutData);
          resolve(result);
        } catch (e) {
          console.error(`Failed to parse JSON from ${scriptName}: ${e}`);
          console.error(`Raw stdout from ${scriptName}: ${stdoutData}`);
          reject(new Error(`Failed to parse JSON output from ${scriptName}`));
        }
      } else {
        reject(new Error(`${scriptName} exited with code ${code}. Stderr: ${stderrData}`));
      }
    });

    pythonProcess.on('error', (error) => {
      clearTimeout(timer); // Clear the timeout
      console.error(`Failed to start ${scriptName}: ${error}`);
      reject(error);
    });

    if (inputText !== null) {
      pythonProcess.stdin.write(inputText);
      pythonProcess.stdin.end();
    }
  });
}

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
  try {
    await initializeGmail();
    await startMonitoring();
    console.log('Email monitoring started!');
  } catch (error) {
    console.error('Failed to initialize:', error);
  }
});

app.on('window-all-closed', () => {
  stopMonitoring();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// --- GMAIL AUTHENTICATION & API SETUP ---
// Create OAuth server
function createAuthServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const parsedUrl = new URL(req.url, 'http://localhost:3000');
      if (parsedUrl.pathname === '/') {
        const code = parsedUrl.searchParams.get('code');
        const error = parsedUrl.searchParams.get('error');

        if (error) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end('<h1>Error</h1><p>Close this window.</p>');
          server.close();
          reject(new Error(error));
          return;
        }

        if (code) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end('<h1>Success!</h1><p>Close this window.</p>');
          server.close();
          resolve(code);
          return;
        }
      }
    });
    server.listen(3000, 'localhost');
  });
}

async function initializeGmail() {
  // SCOPES is now a global constant
  const TOKEN_PATH = path.join(__dirname, 'token.json');
  const CREDENTIALS = JSON.parse(fs.readFileSync('credentials.json'));

  const { client_secret, client_id } = CREDENTIALS.installed;
  oAuth2Client = new google.auth.OAuth2(client_id, client_secret, 'http://localhost:3000');

  if (fs.existsSync(TOKEN_PATH)) {
    const token = JSON.parse(fs.readFileSync(TOKEN_PATH));
    oAuth2Client.setCredentials(token);
    try {
      await oAuth2Client.getAccessToken();
    } catch (error) {
      console.log('Token expired, re-authenticating...');
      fs.unlinkSync(TOKEN_PATH);
      return await initializeGmail();
    }
  } else {
    const authUrl = oAuth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES, // Updated scopes
      prompt: 'consent'
    });

    await open(authUrl);
    const code = await createAuthServer();
    const { tokens } = await oAuth2Client.getToken(code);
    oAuth2Client.setCredentials(tokens);
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens));
  }

  gmail = google.gmail({ version: 'v1', auth: oAuth2Client });
}

// --- EMAIL PROCESSING & ANALYSIS ---
async function getNewEmails() {
  try {
    const query = monitoringStartTime
      ? `is:unread after:${Math.floor(monitoringStartTime / 1000)}`
      : 'is:unread';

    const res = await gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults: 50
    });
    return res.data.messages || [];
  } catch (error) {
    console.error("Error fetching new emails:", error.message);
    return [];
  }
}

function extractSenderName(fromHeader) {
  try {
    if (!fromHeader) return 'Unknown Sender';
    const match = fromHeader.match(/^(.*?)\s*<(.+?)>$/);
    if (match && match[1]) {
      return match[1].replace(/['"]/g, '').trim();
    }
    const emailPart = fromHeader.includes('@') ? fromHeader.split('@')[0] : fromHeader;
    return emailPart.replace(/['"]/g, '').trim();
  } catch (error) {
    console.error('Error extracting sender name:', error);
    return 'Unknown Sender';
  }
}

function processEmailContent(payload) {
  let textContent = '';
  let attachments = [];

  function extractContent(part) {
    if (!part) return;
    if (part.parts) {
      part.parts.forEach(extractContent);
    } else if (part.mimeType === 'text/plain' && part.body?.data) {
      textContent += Buffer.from(part.body.data, 'base64').toString('utf-8');
    } else if (part.filename && part.body?.attachmentId) {
      attachments.push({
        filename: part.filename,
        mimeType: part.mimeType,
        attachmentId: part.body.attachmentId,
        size: part.body.size
      });
    }
  }

  if (payload?.body?.data && (payload.mimeType === 'text/plain' || payload.mimeType === 'text/html')) {
    let rawBody = Buffer.from(payload.body.data, 'base64').toString('utf-8');
    if (payload.mimeType === 'text/html') {
      rawBody = rawBody.replace(/<style([\s\S]*?)<\/style>/gi, '')
                       .replace(/<script([\s\S]*?)<\/script>/gi, '')
                       .replace(/<\/div>|<\/li>|<\/p>|<br\s*\/?>/gi, '\n')
                       .replace(/<li>/ig, '  *  ')
                       .replace(/<[^>]+>/ig, '');
    }
    textContent = rawBody;
  } else if (payload?.parts) {
    extractContent(payload);
  }

  textContent = textContent.replace(/\[image:.*?\]/gi, '').replace(/\s+/g, ' ').trim();
  return { textContent, attachments };
}

async function getEmailDetails(messageId) {
  try {
    const res = await gmail.users.messages.get({ userId: 'me', id: messageId, format: 'full' });
    const { payload } = res.data;
    if (!payload) return null;

    const headers = payload.headers;
    const fromHeader = headers.find(h => h.name.toLowerCase() === 'from')?.value || 'Unknown Sender';
    const subject = headers.find(h => h.name.toLowerCase() === 'subject')?.value || 'No Subject';

    const { textContent, attachments } = processEmailContent(payload);
    const contentForAnalysis = `${subject}\n\n${textContent}`.trim();

    console.log(`Processing email: "${subject}" from ${fromHeader}`);

    const tone = await detectEmotionalTone(contentForAnalysis);
    const readTime = estimateReadTime(textContent); // Moved estimateReadTime to UTILITY

    return {
      from: extractSenderName(fromHeader),
      subject, body: textContent, attachments,
      id: messageId, tone, readTime, urgency: tone.urgency
    };
  } catch (error) {
    console.error(`Error getting email details for ${messageId}:`, error);
    return null;
  }
}

async function summarizeText(text) {
  console.log("Summarizing text via Python script...");
  if (!text || text.trim().length < 100) { // Keep basic check for very short text
    console.log("Text too short or empty for summarization, returning original.");
    return text;
  }

  return executePythonScript('summarizer.py', [], text)
    .then(result => {
      if (result && result.success && result.summary_text) {
        console.log("Summarization successful via Python script.");
        return result.summary_text;
      } else {
        console.error(`Error or invalid response from summarizer.py: ${result?.error || 'Unknown error'}`);
        return text; // Fallback to original text
      }
    })
    .catch(error => {
      console.error(`Summarization script execution failed: ${error.message}`);
      return text; // Fallback to original text
    });
}

async function detectEmotionalTone(text) {
  console.log("Analyzing email tone via Python script for:", text.substring(0, 100) + "...");
  // Python script now handles empty/short text appropriately
  return executePythonScript('tone_analyzer.py', [], text)
    .then(result => {
      if (result && result.success && result.label && result.urgency) {
        console.log("Tone analysis successful via Python script:", result);
        return {
          label: result.label,
          score: parseFloat(result.score) || 0.5,
          urgency: result.urgency,
          analysis_source: result.analysis_source || 'unknown'
        };
      } else {
        console.error('Error or invalid structure from tone_analyzer.py:', result?.error || result);
        return { // JS fallback if script reported an issue or structure is wrong
          label: 'NEUTRAL', score: 0.5, urgency: 'low',
          analysis_source: 'js_fallback_on_script_error',
          reason: `Tone analysis script returned error or invalid data: ${result?.error || 'No specific error returned'}`
        };
      }
    })
    .catch(error => { // JS fallback if script execution failed (spawn error, timeout)
      console.error(`Tone analysis script execution failed: ${error.message}`);
      return {
        label: 'NEUTRAL', score: 0.5, urgency: 'low',
        analysis_source: 'js_fallback_on_script_failure',
        reason: `Tone analysis script failed to execute: ${error.message}`
      };
    });
}

async function captureEmailWithPuppeteer(messageId) {
  let browser;
  try {
    browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox']});
    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 800 });

    const emailRes = await gmail.users.messages.get({ userId: 'me', id: messageId, format: 'full' });
    let htmlBody = '';
    if (emailRes.data.payload.mimeType === 'text/html' && emailRes.data.payload.body.data) {
        htmlBody = Buffer.from(emailRes.data.payload.body.data, 'base64').toString();
    } else {
        const htmlPart = emailRes.data.payload.parts?.find(part => part.mimeType === 'text/html');
        if (htmlPart && htmlPart.body.data) {
            htmlBody = Buffer.from(htmlPart.body.data, 'base64').toString();
        }
    }
    if (!htmlBody) return null;

    const content = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body>${htmlBody}</body></html>`;
    await page.setContent(content, { waitUntil: 'networkidle0' });
    const screenshot = await page.screenshot({ type: 'png', fullPage: true });
    return screenshot;
  } catch (error) {
    console.error('Puppeteer capture failed:', error); return null;
  } finally {
    if (browser) await browser.close();
  }
}

function runPythonOCR(imageBase64) {
  return executePythonScript('ocr_processor.py', ['ocr', imageBase64])
    .then(result => {
      // executePythonScript will resolve with parsed JSON if successful (exit code 0 and valid JSON)
      // or reject if any step fails (non-zero exit, JSON parse error, spawn error).
      // Python scripts are now expected to return {success: true/false, ...}
      if (result && result.success) {
        console.log("OCR processing successful via Python script.");
        return result; // Contains { success: true, text: "...", word_count: N }
      } else {
        // This case handles when the script runs (exit 0, valid JSON) but reports an internal error.
        console.error(`OCR script returned success:false or error: ${result?.error}`);
        throw new Error(result?.error || 'OCR processing failed in Python script.');
      }
    })
    .catch(error => {
      // This catches rejections from executePythonScript (spawn errors, timeouts, non-zero exits, JSON parse errors)
      // OR errors thrown from the .then block above (e.g. result.success is false).
      console.error(`OCR script execution failed or script error: ${error.message}`);
      // Re-throw to be handled by processEmailWithOCR or other callers.
      // It's important that this function now consistently throws an error on failure.
      throw error;
    });
}

async function processEmailWithOCR(messageId) {
  try {
    let emailDetails = await getEmailDetails(messageId);
    if (!emailDetails) return null;
    if (!emailDetails.body || emailDetails.body.length < 50) {
      console.log(`Attempting OCR for ${messageId}...`);
      const screenshot = await captureEmailWithPuppeteer(messageId);
      if (screenshot) {
        const imageBase64 = screenshot.toString('base64');
        try {
          const ocrResult = await runPythonOCR(imageBase64);
          if (ocrResult.text) { // runPythonOCR would throw if ocrResult.success is false
            emailDetails.body = ocrResult.text;
            emailDetails.isOCRProcessed = true;
            emailDetails.ocrWordCount = ocrResult.word_count || 0;
          }
        } catch (ocrError) {
          console.error(`OCR step failed for ${messageId}: ${ocrError.message}`);
        }
      }
    }
    return emailDetails;
  } catch (error) {
    console.error(`Error in processEmailWithOCR for ${messageId}:`, error);
    return null;
  }
}

// --- NOTIFICATION DISPLAY & MANAGEMENT ---
function createCustomNotification(emailData) {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  
  // Dynamic notification sizing based on content
  const baseWidth = 450;
  const baseHeight = 180;
  const maxHeight = Math.min(height * 0.8, 600); // Max 80% of screen height or 600px
  
  // Calculate dynamic height based on content
  const textLines = Math.ceil((emailData.body || '').length / 60); // Rough estimate
  const attachmentHeight = emailData.attachments && emailData.attachments.length > 0 ? 80 : 0;
  const calculatedHeight = Math.min(baseHeight + (textLines * 15) + attachmentHeight, maxHeight);
  
  const notificationWidth = baseWidth;
  const notificationHeight = calculatedHeight;
  const margin = 20;
  const stackOffset = 15;
  
  const x = width - notificationWidth - margin;
  const y = margin + (activeNotifications.size * (notificationHeight + stackOffset));
  
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
    focusable: true, // Allow focus for clicking attachments
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  // Track this notification
  activeNotifications.add(notificationWindow);
  
  // Remove from tracking when closed
  notificationWindow.on('closed', () => {
    activeNotifications.delete(notificationWindow);
    repositionNotifications();
  });

  // Create the enhanced notification HTML content
  const notificationHTML = createEnhancedNotificationHTML(emailData);
  
  // Load the notification content
  notificationWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(notificationHTML)}`);
  
  // Handle attachment clicks
  notificationWindow.webContents.on('ipc-message', async (event, channel, ...args) => {
    if (channel === 'download-attachment') {
      const [messageId, attachmentId, filename] = args;
      try {
        await downloadAttachment(messageId, attachmentId, filename);
      } catch (error) {
        console.error('Failed to download attachment:', error);
      }
    } else if (channel === 'close-notification') {
      closeNotificationWithAnimation(notificationWindow);
    } else if (channel === 'focus-main-window') {
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
        mainWindow.show();
      }
    }
  });

  return notificationWindow;
}
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
function repositionNotifications() {
  const notifications = Array.from(activeNotifications);
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const notificationWidth = 450;
  const margin = 20;
  const stackOffset = 15;
  
  let currentY = margin;
  
  notifications.forEach((notification, index) => {
    if (!notification.isDestroyed()) {
      const bounds = notification.getBounds();
      const x = width - notificationWidth - margin;
      
      notification.setPosition(x, currentY, true);
      currentY += bounds.height + stackOffset;
      
      // If notifications would go off screen, start overlapping more
      if (currentY > height - 100) {
        stackOffset = Math.max(5, stackOffset - 2);
      }
    }
  });
}

// Close notification with fade animation
function closeNotificationWithAnimation(notificationWindow) {
  if (notificationWindow && !notificationWindow.isDestroyed()) {
    // Don't wait for return value from executeJavaScript
    notificationWindow.webContents.executeJavaScript(`
      document.body.style.animation = 'slideOut 0.3s ease-in forwards';
      setTimeout(() => { window.close(); }, 300);
      // Return a simple value to avoid cloning issues
      true;
    `).catch(error => {
      console.error('Error executing close animation:', error);
      // Fallback: just close the window
      if (!notificationWindow.isDestroyed()) {
        notificationWindow.close();
      }
    });
  }
}
function createEnhancedNotificationHTML(emailData) {
  console.log('[MAIN DEBUG] createEnhancedNotificationHTML received emailData.id:', emailData ? emailData.id : 'emailData is null/undefined');
  console.log('[MAIN DEBUG] full emailData:', JSON.stringify(emailData, null, 2));
  console.log(`Creating notification for email with urgency: ${emailData.urgency}`);
  
  const senderInitial = emailData.from.charAt(0).toUpperCase();
  
  // Create attachment display (same as before)
  let attachmentsHTML = '';
  if (emailData.attachments && emailData.attachments.length > 0) {
    const attachmentItems = emailData.attachments.map(attachment => {
      const isImage = attachment.mimeType && attachment.mimeType.startsWith('image/');
      const icon = getAttachmentIcon(attachment.mimeType);
      const sizeStr = formatFileSize(attachment.size);
      
      return `
        <div class="attachment-item" data-message-id="${emailData.id}" data-attachment-id="${attachment.attachmentId}" data-filename="${attachment.filename}">
          <div class="attachment-icon">${icon}</div>
          <div class="attachment-info">
            <div class="attachment-name">${attachment.filename}</div>
            <div class="attachment-size">${sizeStr}</div>
          </div>
          ${isImage ? '<div class="image-preview-badge">🖼️</div>' : ''}
        </div>
      `;
    }).join('');
    
    attachmentsHTML = `
      <div class="attachments-section">
        <div class="attachments-header">
          <span class="attachments-title">📎 ${emailData.attachments.length} Attachment${emailData.attachments.length > 1 ? 's' : ''}</span>
        </div>
        <div class="attachments-list">
          ${attachmentItems}
        </div>
      </div>
    `;
  }

  // Enhanced urgency badge with debugging
  let urgencyBadge = '';
  if (settings.showUrgency) {
    console.log(`Urgency check: ${emailData.urgency} (type: ${typeof emailData.urgency})`);

    if (emailData.urgency === 'high') {
      urgencyBadge = '<div class="urgency-badge high">🚨 Urgent</div>';
      console.log("Adding HIGH urgency badge");
    } else if (emailData.urgency === 'medium') {
      urgencyBadge = '<div class="urgency-badge medium">⚠️ Important</div>';
      console.log("Adding MEDIUM urgency badge");
    } else {
      console.log("No urgency badge (low urgency)");
    }
  }

  const readTimeBadge = settings.enableReadTime && emailData.readTime ? 
    `<div class="read-time-badge">📖 ${emailData.readTime.minutes}m ${emailData.readTime.seconds}s</div>` : '';

  const summaryBadge = emailData.isSummary 
    ? '<div class="summary-badge">🤖 AI Summary</div>' 
    : '';

  const ocrBadge = emailData.isOCRProcessed ? 
    '<div class="ocr-badge">👁️ OCR Processed</div>' : '';

  const quickActionsHTML = `
    <div class="quick-actions">
      <button class="quick-btn mark-as-read" data-message-id="${emailData.id}">
        <span class="btn-icon">✓</span>
        <span class="btn-text">Mark Read</span>
      </button>
      <button class="quick-btn trash" data-message-id="${emailData.id}">
        <span class="btn-icon">🗑️</span>
        <span class="btn-text">Delete</span>
      </button>
      <button class="quick-btn star" data-message-id="${emailData.id}">
        <span class="btn-icon">⭐</span>
        <span class="btn-text">Star</span>
      </button>
    </div>
  `;

  // Process body text
  let bodyText = emailData.body || 'No preview available';
  let isLongContent = false;
  if (bodyText.length > 2000) {
    isLongContent = true;
  }

  const finalHTML = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        /* All your existing CSS styles remain the same */
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }
        
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;
          background: linear-gradient(135deg, #e0e0e0, #f5f5f5); /* Simpler gradient */
          width: 100%;
          height: 100%;
          border-radius: 16px;
          overflow: hidden;
          cursor: pointer;
          animation: slideIn 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94);
          box-shadow: 0 5px 15px rgba(0,0,0,0.1); /* More subtle shadow */
          position: relative;
        }
        
        .notification-container {
          background: #ffffff; /* Solid white */
          /* backdrop-filter: blur(30px); */ /* Removed blur */
          height: 100%;
          display: flex;
          flex-direction: column;
          position: relative;
          overflow: hidden;
        }
        
        .notification-container::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          height: 4px;
          background: #7f8c8d; /* Neutral grey */
          z-index: 1;
        }
        
        /* Add special styling for high urgency notifications */
        .notification-container.high-urgency::before {
          background: #c9302c; /* Solid, strong red */
          height: 4px; /* Standard height */
          /* animation: urgentPulse 1.5s infinite; */ /* Removed animation */
        }
        
        /*
        @keyframes urgentPulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.6; }
        }
        */
        
        .main-content {
          display: flex;
          padding: 20px;
          flex: 1;
          min-height: 0;
        }
        
        .avatar {
          width: 56px;
          height: 56px;
          border-radius: 50%;
          background: #bdc3c7; /* Neutral grey */
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          font-weight: 700;
          font-size: 22px;
          margin-right: 16px;
          flex-shrink: 0;
          box-shadow: 0 2px 6px rgba(0,0,0,0.1); /* Subtle shadow */
        }
        
        /* High urgency avatar styling */
        .avatar.high-urgency {
          background: #dc2626; /* Solid red */
          box-shadow: 0 4px 12px rgba(220, 38, 38, 0.4); /* More subtle shadow */
          /* animation: pulse 2s infinite; */ /* Consider removing or making pulse more subtle if keyframes are changed */
        }
        
        .content {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
        }
        
        .header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 8px;
        }
        
        .sender {
          font-weight: 700;
          color: #1a1a1a;
          font-size: 16px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 250px;
        }
        
        .badges {
          display: flex;
          gap: 6px;
          flex-shrink: 0;
          align-items: center;
        }
        
        .urgency-badge {
          font-size: 11px;
          padding: 3px 7px; /* Slightly adjusted padding */
          border-radius: 10px; /* Slightly smaller radius */
          font-weight: 600; /* Slightly less bold */
          color: white;
          white-space: nowrap;
          /* text-transform: uppercase; */ /* Optional: remove if too shouty */
          letter-spacing: 0.2px; /* Reduced letter spacing */
          box-shadow: 0 1px 2px rgba(0,0,0,0.15); /* More subtle shadow */
        }

        .urgency-badge.high {
          background-color: #c9302c; /* Solid, strong red */
          /* Removed animation and complex box-shadow */
        }

        .urgency-badge.medium {
          background-color: #f0ad4e; /* Solid, noticeable orange */
          /* Removed complex box-shadow */
        }

        /*
        @keyframes pulse {
          0%, 100% { 
            opacity: 1; 
            transform: scale(1);
          }
          50% { 
            opacity: 0.9;
            transform: scale(1.02);
          }
        }
        */
        
        .summary-badge {
          background-color: #5dade2; /* Solid blue/purple */
          color: white;
          box-shadow: 0 1px 2px rgba(0,0,0,0.1); /* Subtle shadow */
          padding: 3px 7px;
          border-radius: 10px;
          font-weight: 600;
          font-size: 10px;
        }
        
        .read-time-badge {
          font-size: 10px;
          padding: 2px 6px; /* Existing padding is fine */
          border-radius: 8px; /* Existing radius is fine */
          background: #ecf0f1; /* Light grey background */
          color: #555; /* Darker text for contrast */
        }

        .ocr-badge {
          background-color: #9b59b6; /* Solid purple */
          color: white;
          box-shadow: 0 1px 2px rgba(0,0,0,0.1); /* Subtle shadow */
          padding: 3px 7px;
          border-radius: 10px;
          font-weight: 600;
          font-size: 10px;
        }
        
        .subject {
          font-weight: 600;
          color: #2c2c2c;
          font-size: 15px;
          margin-bottom: 10px;
          line-height: 1.3;
          word-wrap: break-word;
        }
        
        .body-text {
          color: #555;
          font-size: 13px;
          line-height: 1.5;
          flex: 1;
          overflow-y: auto;
          word-wrap: break-word;
          white-space: pre-wrap;
          max-height: 200px;
          padding-right: 8px;
        }
        
        .body-text::-webkit-scrollbar {
          width: 4px;
        }
        
        .body-text::-webkit-scrollbar-track {
          background: rgba(0,0,0,0.05);
          border-radius: 2px;
        }
        
        .body-text::-webkit-scrollbar-thumb {
          background: rgba(0,0,0,0.2);
          border-radius: 2px;
        }
        
        .body-text::-webkit-scrollbar-thumb:hover {
          background: rgba(0,0,0,0.3);
        }
        
        .attachments-section {
          border-top: 1px solid rgba(0,0,0,0.1);
          padding: 12px 20px;
          background: #f8f9fa; /* More opaque, standard light grey */
        }
        
        .attachments-header {
          margin-bottom: 8px;
        }
        
        .attachments-title {
          font-size: 12px;
          font-weight: 600;
          color: #4a5568;
        }
        
        .attachments-list {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        
        .attachment-item {
          display: flex;
          align-items: center;
          padding: 8px 12px;
          background: white;
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.2s ease;
          box-shadow: 0 1px 2px rgba(0,0,0,0.05); /* Simplified shadow */
          border: 1px solid rgba(0,0,0,0.05);
        }
        
        .attachment-item:hover {
          background: #e9ecef; /* Darker hover */
          /* transform: translateY(-1px); */ /* Removed transform */
          box-shadow: 0 1px 3px rgba(0,0,0,0.08); /* Adjusted hover shadow */
        }
        
        .attachment-icon {
          width: 32px;
          height: 32px;
          border-radius: 6px;
          background-color: #aab7c4; /* Neutral grey */
          display: flex;
          align-items: center;
          justify-content: center;
          margin-right: 10px;
          font-size: 16px;
          color: white;
          flex-shrink: 0;
        }
        
        .attachment-info {
          flex: 1;
          min-width: 0;
        }
        
        .attachment-name {
          font-size: 13px;
          font-weight: 500;
          color: #2d3748;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        
        .attachment-size {
          font-size: 11px;
          color: #718096;
        }
        
        .image-preview-badge {
          font-size: 16px;
          margin-left: 8px;
        }
        
        .quick-actions {
          display: flex;
          gap: 8px;
          padding: 12px 20px;
          background: #f1f3f5; /* More opaque */
          border-top: 1px solid rgba(0,0,0,0.05);
        }

        .quick-btn {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          padding: 8px 12px;
          border: none;
          border-radius: 6px;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s ease;
          background: white;
          color: #4a5568;
          box-shadow: 0 1px 2px rgba(0,0,0,0.1); /* Simplified shadow */
        }

        .quick-btn:hover {
          /* transform: translateY(-1px); */ /* Removed transform */
          box-shadow: 0 2px 4px rgba(0,0,0,0.12); /* Adjusted hover shadow */
        }

        .quick-btn.mark-as-read:hover { /* Changed from mark-read */
          background: #10b981;
          color: white;
        }

        .quick-btn.trash:hover {
          background: #ef4444;
          color: white;
        }

        .quick-btn.star:hover {
          background: #f59e0b; /* Keep yellow for star, or choose another color */
          color: white;
        }

        .btn-icon {
          font-size: 14px;
        }

        .btn-text {
          font-size: 11px;
        }
        
        .close-btn {
          position: absolute;
          top: 12px;
          right: 12px;
          width: 28px;
          height: 28px;
          border-radius: 50%;
          background: rgba(0,0,0,0.1);
          border: none;
          color: #666;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 16px;
          opacity: 0;
          transition: all 0.3s ease;
          z-index: 2;
        }
        
        .notification-container:hover .close-btn {
          opacity: 1;
        }

        .close-btn:hover {
          background: rgba(239, 68, 68, 0.9);
          color: white;
          transform: scale(1.1);
        }
        
        .long-content-indicator {
          text-align: center;
          padding: 8px;
          font-size: 11px;
          color: #718096;
          font-style: italic;
          background: rgba(0,0,0,0.02);
          border-radius: 4px;
          margin-top: 8px;
        }
        
        @keyframes slideIn {
          from {
            transform: translateX(100%);
            opacity: 0;
          }
          to {
            transform: translateX(0);
            opacity: 1;
          }
        }
        
        /* Removed .notification-container:hover */
        
        @media (max-height: 400px) {
          .body-text {
            max-height: 100px;
          }
        }
      </style>
    </head>
    <body>
      <div class="notification-container ${emailData.urgency === 'high' ? 'high-urgency' : ''}">
        <div class="main-content">
          <div class="avatar ${emailData.urgency === 'high' ? 'high-urgency' : ''}">${senderInitial}</div>
          <div class="content">
            <div class="header">
              <div class="sender">${emailData.from}</div>
              <div class="badges">
                ${urgencyBadge}
                ${summaryBadge}
                ${readTimeBadge}
                ${ocrBadge}
              </div>
            </div>
            <div class="subject">${emailData.subject || 'No Subject'}</div>
            <div class="body-text">${bodyText}</div>
            ${isLongContent ? '<div class="long-content-indicator">📄 Long email - click to view full content in main app</div>' : ''}
          </div>
        </div>
        ${attachmentsHTML}
        ${quickActionsHTML}
        <button class="close-btn" onclick="closeNotification()">×</button>
      </div>
      
      <script>
        console.log(\`Notification created with urgency: ${emailData.urgency}\`);
        
        // Handle attachment clicks
        const attachmentItems = document.querySelectorAll('.attachment-item');
        console.log('[Notification LOG] Found attachment items:', attachmentItems.length, attachmentItems);
        attachmentItems.forEach(item => {
          item.addEventListener('click', async (e) => {
            e.stopPropagation();
            const messageId = item.dataset.messageId;
            const attachmentId = item.dataset.attachmentId;
            const filename = item.dataset.filename;

            console.log(\`[Notification LOG] Attachment item clicked.\`);
            
            item.style.transform = 'scale(0.95)';
            setTimeout(() => {
              item.style.transform = '';
            }, 150);
            
            try {
              console.log(\`[Notification LOG] Invoking IPC channel 'download-attachment' for messageId\`);
              await window.electronAPI.invoke('download-attachment', messageId, attachmentId, filename);
              console.log(\`[Notification LOG] 'download-attachment' invoked successfully for messageId \`);
            } catch (error) {
              console.error(\`[Notification LOG] Download attachment error:\`, error);
            }
          });
        });
        
        // Handle quick action clicks
        const quickButtons = document.querySelectorAll('.quick-btn');
        console.log('[Notification LOG] Found quick buttons:', quickButtons.length, quickButtons);
        quickButtons.forEach(btn => {
          btn.addEventListener('click', async (e) => {
            e.stopPropagation(); 
            const messageId = btn.dataset.messageId;
            console.log('[NOTIF SCRIPT DEBUG] messageId from button dataset:', messageId);
            const action = btn.classList.contains('mark-as-read') ? 'mark-as-read' :
                          btn.classList.contains('trash') ? 'move-to-trash' :
                          btn.classList.contains('star') ? 'snooze-email' : '';
            
            console.log(\`[Notification LOG] Quick action button clicked. Action: \${action}, Message ID: \${messageId}\`);

            btn.style.transform = 'scale(0.95)';
            btn.style.opacity = '0.7';
            
            try {
              let result;
              if (action) {
                console.log(\`[Notification LOG] Invoking IPC channel for messageId\`);
                result = await window.electronAPI.invoke(action, messageId);
                console.log(\`[Notification LOG] Result for action , messageId:\`, result);
              } else {
                console.error(\`[Notification LOG] Invalid action derived from button classes. Classes:\`);
                throw new Error('Invalid action for IPC call');
              }

              if (result && result.success) {
                if (action !== 'snooze-email') { 
                   btn.innerHTML = '<span class="btn-icon">✓</span><span class="btn-text">Done</span>';
                }
                btn.style.background = '#10b981';
                btn.style.color = 'white';
              } else if (result) { 
                console.error(\`[Notification LOG] Action  failed for messageId. Result:\`, result);
                btn.innerHTML = '<span class="btn-icon">✗</span><span class="btn-text">Failed</span>';
                btn.style.background = '#ef4444';
                btn.style.color = 'white';
              } else {
                console.error(\`[Notification LOG] No result or unexpected result structure for action , messageId.\`);
                btn.innerHTML = '<span class="btn-icon">?</span><span class="btn-text">Unknown</span>';
                btn.style.background = '#f0ad4e';
                btn.style.color = 'white';
              }
              console.log('[Notification LOG] Action processed, closing notification in 5 mins for debug.');
              setTimeout(() => closeNotification(), 60000); 
            } catch (error) {
              console.error(\`[Notification LOG] Error during action  for messageId:\`, error);
              btn.innerHTML = '<span class="btn-icon">✗</span><span class="btn-text">Error</span>';
              btn.style.background = '#ef4444';
              btn.style.color = 'white';
              setTimeout(() => {
                btn.style.transform = '';
                btn.style.opacity = '';
              }, 2000);
              console.log('[Notification LOG] Error occurred during action, closing notification in 5 mins for debug.');
              setTimeout(() => closeNotification(), 60000);
            }
          });
        });
        
        // Handle notification click
        document.addEventListener('click', (e) => {
          if (!e.target.closest('.close-btn') && !e.target.closest('.attachment-item')) {
            window.electronAPI?.send('focus-main-window');
            closeNotification();
          }
        });
        
        function closeNotification() {
          window.electronAPI?.send('close-notification');
        }
        
        document.addEventListener('contextmenu', e => e.preventDefault());
      </script>
    </body>
    </html>
  `;

  console.log("Final HTML generated with urgency badge:", urgencyBadge ? "YES" : "NO");
  return finalHTML;
}


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
    const filePath = await downloadAttachment(messageId, attachmentId, filename);
    
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
    const result = await markAsRead(messageId);
    
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
    const result = await moveToTrash(messageId);
    
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

ipcMain.handle('snooze-email', async (event, messageId, days = 1) => {
  try {
    const result = await toggleStarEmail(messageId);

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
function estimateReadTime(text) {
  if (!text) return { minutes: 0, seconds: 0, totalSeconds: 0, wordCount: 0 };
  const words = text.split(/\s+/).filter(Boolean).length;
  const wpm = 230;
  const totalMinutes = words / wpm;
  const minutes = Math.floor(totalMinutes);
  const seconds = Math.round((totalMinutes - minutes) * 60);
  return { minutes, seconds, totalSeconds: Math.round(totalMinutes * 60), wordCount: words };
}

// --- GMAIL API ACTIONS (Called via IPC) ---
async function downloadAttachment(messageId, attachmentId, filename) {
  try {
    const attachment = await gmail.users.messages.attachments.get({ userId: 'me', messageId, id: attachmentId });
    const data = Buffer.from(attachment.data.data, 'base64');
    const tempDir = path.join(app.getPath('temp'), 'email-attachments'); // Use app temp path for safety
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
    const filePath = path.join(tempDir, filename);
    fs.writeFileSync(filePath, data);
    shell.openPath(filePath);
    return filePath;
  } catch (error) {
    console.error('Error downloading attachment:', error);
    throw error;
  }
}

async function markAsRead(messageId) { // This is the one used by IPC
  try {
    await gmail.users.messages.modify({ userId: 'me', id: messageId, resource: { removeLabelIds: ['UNREAD'] }});
    knownEmailIds.delete(messageId);
    console.log(`Successfully marked email ${messageId} as read (IPC)`);
    return { success: true, messageId };
  } catch (error) {
    console.error(`Mark as read failed for ${messageId} (IPC):`, error);
    return { success: false, error: error.message, messageId, code: error.code };
  }
}

async function moveToTrash(messageId) { // This is the one used by IPC
  try {
    await gmail.users.messages.trash({ userId: 'me', id: messageId });
    knownEmailIds.delete(messageId);
    console.log(`Successfully moved email ${messageId} to trash (IPC)`);
    return { success: true, messageId };
  } catch (error) {
    console.error(`Move to trash failed for ${messageId} (IPC):`, error);
    return { success: false, error: error.message, messageId, code: error.code };
  }
}

async function toggleStarEmail(messageId) { // This is the one used by IPC
  try {
    const message = await gmail.users.messages.get({ userId: 'me', id: messageId, format: 'metadata', metadataHeaders: ['labelIds'] });
    const isStarred = (message.data.labelIds || []).includes('STARRED');
    const resource = isStarred ? { removeLabelIds: ['STARRED'] } : { addLabelIds: ['STARRED'] };
    await gmail.users.messages.modify({ userId: 'me', id: messageId, resource });
    console.log(`Successfully ${isStarred ? 'unstarred' : 'starred'} email ${messageId} (IPC)`);
    return { success: true, starred: !isStarred, messageId };
  } catch (error) {
    console.error(`Toggle star failed for ${messageId} (IPC):`, error);
    return { success: false, error: error.message, messageId, code: error.code };
  }
}

// --- EMAIL MONITORING SERVICE ---
async function checkForNewEmails() {
  if (!gmail || !isMonitoring) return;

  try {
    const newEmails = await getNewEmails();
    const unseenEmailIds = newEmails.filter(email => !knownEmailIds.has(email.id)).map(email => email.id);

    if (unseenEmailIds.length > 0) {
      unseenEmailIds.forEach(id => knownEmailIds.add(id));

      for (const emailId of unseenEmailIds) {
        const emailDetails = await processEmailWithOCR(emailId);
        if (emailDetails) {
          let displayText = emailDetails.body;
          let isSummary = false;
          if (settings.enableSummary && emailDetails.body) {
            displayText = await summarizeText(emailDetails.body); // Uses original spawn summarizeText
            isSummary = displayText !== emailDetails.body;
          }
          const notificationData = { ...emailDetails, body: displayText, isSummary };
          createCustomNotification(notificationData);

          if (settings.enableVoiceReading) {
            let voiceMsgParts = [];
            
            if (settings.speakSenderName && notificationData.from) {
              voiceMsgParts.push(`New message from ${notificationData.from}.`);
            }
            
            if (settings.speakSubject && notificationData.subject) {
              voiceMsgParts.push(`Subject: ${notificationData.subject}.`);
            }
            
            // ADD THIS: Include the email body/description
            if (notificationData.body) {
              voiceMsgParts.push(`Description: ${notificationData.body}.`);
            }
            
            if (voiceMsgParts.length > 0) {
              const voiceMsg = voiceMsgParts.join(' ');
              say.speak(voiceMsg);
            } else {
              // Fallback if everything is off but voice reading is enabled
              say.speak("You have a new email.");
            }
          }
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('new-email', notificationData);
          }
        }
      }
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      const currentUnread = await getNewEmails();
      mainWindow.webContents.send('email-count-update', currentUnread.length);
    }
  } catch (error) {
    console.error('Error checking emails:', error);
  }
}

async function startMonitoring() {
  if (isMonitoring) return 'Monitoring already active.';
  isMonitoring = true;
  monitoringStartTime = Date.now();
  knownEmailIds.clear();

  try {
    const initialEmails = await getNewEmails();
    initialEmails.forEach(email => knownEmailIds.add(email.id));
    console.log(`Initialized with ${knownEmailIds.size} existing unread emails.`);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('email-count-update', initialEmails.length);
    }
  } catch (error) {
    console.error('Error during initial email check for monitoring:', error);
  }

  const intervalId = setInterval(async () => {
    if (!isMonitoring) {
      clearInterval(intervalId);
      return;
    }
    await checkForNewEmails();
  }, 10000);
  console.log('Email monitoring started.');
  return 'Monitoring started successfully.';
}

function stopMonitoring() {
  isMonitoring = false;
  activeNotifications.forEach(notif => { if (!notif.isDestroyed()) notif.close(); });
  activeNotifications.clear();
  console.log('Email monitoring stopped.');
  return 'Monitoring stopped.';
}

// --- IPC HANDLERS ---
ipcMain.handle('check-new-mail', async () => {
  if (!gmail) try { await initializeGmail(); } catch (e) { console.error("Gmail init failed in check-new-mail:", e); return 0; }
  if (!gmail) return 0;
  return (await getNewEmails()).length;
});

ipcMain.handle('start-monitoring', async () => {
  if (!gmail) try { await initializeGmail(); } catch (e) { console.error("Gmail init failed in start-monitoring:", e); return 'Gmail initialization failed.'; }
  if (!gmail) return 'Gmail initialization failed.';
  return await startMonitoring();
});

ipcMain.handle('stop-monitoring', () => stopMonitoring());

ipcMain.handle('update-settings', (event, newSettings) => {
  settings = { ...settings, ...newSettings };
  console.log('Settings updated:', settings);
  return settings;
});

ipcMain.handle('get-settings', () => settings);