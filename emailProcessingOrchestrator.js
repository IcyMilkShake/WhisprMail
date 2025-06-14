// This module orchestrates the processing of an email, from fetching details to notifying the user.

// Dependencies that will be injected via init()
let dependencies = {
  gmail: null,
  pythonService: null,
  emailService: null,
  notificationService: null,
  settingsService: null,
  notifiableAuthorsService: null,
  say: null,
  mainWindow: null,
  puppeteer: null, // The puppeteer module itself
  electronApp: null, // For app.getPath, if needed by functions moved here (e.g. if download was moved here)
  electronShell: null, // For shell.openPath, if needed
};

// Initialize the orchestrator with all necessary dependencies
function init(deps) {
  dependencies.gmail = deps.gmail;
  dependencies.pythonService = deps.pythonService;
  dependencies.emailService = deps.emailService;
  dependencies.notificationService = deps.notificationService;
  dependencies.settingsService = deps.settingsService;
  dependencies.notifiableAuthorsService = deps.notifiableAuthorsService;
  dependencies.say = deps.say;
  dependencies.mainWindow = deps.mainWindow;
  dependencies.puppeteer = deps.puppeteer;
  dependencies.electronApp = deps.app; // Store app if needed
  dependencies.electronShell = deps.shell; // Store shell if needed
  console.log('EmailProcessingOrchestrator initialized.');
}

// --- Utility Functions (Moved from main.js or kept local) ---
function estimateReadTime(text) {
  if (!text) return { minutes: 0, seconds: 0, totalSeconds: 0, wordCount: 0 };
  const words = text.split(/\s+/).filter(Boolean).length;
  const wpm = 230; // Average reading speed
  const totalMinutes = words / wpm;
  const minutes = Math.floor(totalMinutes);
  const seconds = Math.round((totalMinutes - minutes) * 60);
  return { minutes, seconds, totalSeconds: Math.round(totalMinutes * 60), wordCount: words };
}

// --- Core Email Processing Functions ---

// Captures email content using Puppeteer.
// Note: Assumes it still needs messageId to fetch full HTML if not directly passed.
async function captureEmailWithPuppeteer(messageId) {
  if (!dependencies.puppeteer || !dependencies.gmail) {
    console.error('Puppeteer or Gmail service not initialized in orchestrator.');
    return null;
  }
  let browser;
  try {
    browser = await dependencies.puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 800 });

    const emailRes = await dependencies.gmail.users.messages.get({ userId: 'me', id: messageId, format: 'full' });
    let htmlBody = '';
    if (emailRes.data.payload.mimeType === 'text/html' && emailRes.data.payload.body.data) {
      htmlBody = Buffer.from(emailRes.data.payload.body.data, 'base64').toString();
    } else {
      const htmlPart = emailRes.data.payload.parts?.find(part => part.mimeType === 'text/html');
      if (htmlPart && htmlPart.body.data) {
        htmlBody = Buffer.from(htmlPart.body.data, 'base64').toString();
      }
    }
    if (!htmlBody) {
        console.log(`No HTML body found for puppeteer capture of message ${messageId}`);
        return null;
    }

    const content = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body>${htmlBody}</body></html>`;
    await page.setContent(content, { waitUntil: 'networkidle0' });
    const screenshot = await page.screenshot({ type: 'png', fullPage: true });
    return screenshot;
  } catch (error) {
    console.error('Puppeteer capture failed in orchestrator:', error);
    return null;
  } finally {
    if (browser) await browser.close();
  }
}

// Fetches and processes details for a single email.
async function getEmailDetails(messageId) {
  if (!dependencies.gmail || !dependencies.emailService || !dependencies.pythonService) {
    console.error('Required services (Gmail, EmailService, PythonService) not available in orchestrator for getEmailDetails.');
    return null;
  }
  try {
    const res = await dependencies.gmail.users.messages.get({ userId: 'me', id: messageId, format: 'full' });
    const { payload } = res.data;
    if (!payload) return null;

    const headers = payload.headers;
    const fromHeader = headers.find(h => h.name.toLowerCase() === 'from')?.value || 'Unknown Sender';
    let fromEmail = 'unknown@example.com';
    const emailMatch = fromHeader.match(/<(.+?)>/);
    if (emailMatch && emailMatch[1]) {
      fromEmail = emailMatch[1].toLowerCase();
    } else if (fromHeader.includes('@')) {
      const parts = fromHeader.split(/[\s,;]+/);
      const foundEmail = parts.find(part => part.includes('@') && part.includes('.'));
      if (foundEmail) fromEmail = foundEmail.toLowerCase();
    }
    const subject = headers.find(h => h.name.toLowerCase() === 'subject')?.value || 'No Subject';

    const { textContent, htmlContent, attachments } = dependencies.emailService.processEmailContent(payload);
    const contentForAnalysis = `${subject}\n\n${textContent}`.trim();

    const tone = await dependencies.pythonService.detectEmotionalTone(contentForAnalysis);
    const readTime = estimateReadTime(textContent); // Uses local estimateReadTime

    return {
      from: dependencies.emailService.extractSenderName(fromHeader),
      fromEmail: fromEmail,
      subject,
      body: textContent,
      bodyHtml: htmlContent,
      attachments,
      id: messageId,
      tone,
      readTime,
      urgency: tone.urgency, // Assuming tone object includes urgency
    };
  } catch (error) {
    console.error(`Error getting email details for ${messageId} in orchestrator:`, error);
    return null;
  }
}

// Processes an email, including OCR if necessary.
async function processEmailWithOCR(messageId) {
  if (!dependencies.pythonService) {
     console.error('PythonService not available in orchestrator for processEmailWithOCR.');
     return null;
  }
  try {
    let emailDetails = await getEmailDetails(messageId); // Uses local getEmailDetails
    if (!emailDetails) return null;

    if (!emailDetails.body || emailDetails.body.length < 50) { // Arbitrary length to trigger OCR
      console.log(`Attempting OCR for ${messageId} via orchestrator...`);
      const screenshot = await captureEmailWithPuppeteer(messageId); // Uses local captureEmailWithPuppeteer
      if (screenshot) {
        const imageBase64 = screenshot.toString('base64');
        try {
          const ocrResult = await dependencies.pythonService.runPythonOCR(imageBase64);
          if (ocrResult && ocrResult.text) {
            emailDetails.body = ocrResult.text;
            emailDetails.isOCRProcessed = true;
            emailDetails.ocrWordCount = ocrResult.word_count || 0;
          }
        } catch (ocrError) {
          console.error(`OCR step failed for ${messageId} in orchestrator:`, ocrError.message);
        }
      }
    }
    return emailDetails;
  } catch (error) {
    console.error(`Error in processEmailWithOCR for ${messageId} in orchestrator:`, error);
    return null;
  }
}

// Main function to process a new email ID. This replaces the old processNewEmailIdCallback from main.js.
async function processNewEmailId(emailId) {
  if (!dependencies.settingsService || !dependencies.notifiableAuthorsService ||
      !dependencies.pythonService || !dependencies.notificationService ||
      !dependencies.say || !dependencies.mainWindow || !dependencies.emailService) {
    console.error('One or more critical dependencies not initialized in EmailProcessingOrchestrator.');
    return;
  }

  const currentSettings = dependencies.settingsService.getSettings(); // Get current settings
  const currentNotifiableAuthors = dependencies.notifiableAuthorsService.getAuthors();

  try {
    const emailDetails = await processEmailWithOCR(emailId); // Uses local processEmailWithOCR
    if (emailDetails) {
      if (currentNotifiableAuthors.length === 0 || (emailDetails.fromEmail && currentNotifiableAuthors.includes(emailDetails.fromEmail.toLowerCase()))) {
        let displayText = emailDetails.body;
        let isSummary = false;
        if (currentSettings.enableSummary && emailDetails.body) {
          displayText = await dependencies.pythonService.summarizeText(emailDetails.body);
          isSummary = displayText !== emailDetails.body;
        }
        const notificationData = { ...emailDetails, body: displayText, isSummary };

        const electronModules = { // Prepare for notification service
          screen: dependencies.electronApp.screen, // Assuming app was passed as electronApp
          BrowserWindow: dependencies.electronApp.BrowserWindow, // This is problematic, BrowserWindow is a class not on app
                                                              // Needs to be passed directly if required by notif service
                                                              // For now, assuming notificationService handles its own BrowserWindow needs or gets it via its own init
          globalShortcut: dependencies.electronApp.globalShortcut,
          shell: dependencies.electronShell, // Pass shell
          app: dependencies.electronApp,     // Pass app
          ipcMain: dependencies.electronApp.ipcMain, // Pass ipcMain
          path: require('path') // path can be required directly
        };

        // Corrected service functions for createCustomNotification
         const serviceFunctions = {
          downloadAttachment: (messageId, attachmentId, filename) => dependencies.emailService.downloadAttachment(dependencies.gmail, dependencies.electronApp, dependencies.electronShell, messageId, attachmentId, filename),
          markAsRead: (msgId) => dependencies.emailService.markAsRead(dependencies.gmail, msgId),
          moveToTrash: (msgId) => dependencies.emailService.moveToTrash(dependencies.gmail, msgId),
          toggleStarEmail: (msgId) => dependencies.emailService.toggleStarEmail(dependencies.gmail, msgId),
          showFullEmailInMainWindow: (msgId) => {
            // This needs to call a function in main.js that can show the window.
            // This could be done via an IPC call back to main, or if mainWindow is passed:
            if (dependencies.mainWindow && dependencies.mainWindow.webContents) {
                 dependencies.mainWindow.webContents.send('orchestrator-show-full-email', msgId);
            } else {
                 console.error("MainWindow not available or webContents not ready for orchestrator-show-full-email");
            }
          },
          focusMainWindow: () => {
            if (dependencies.mainWindow) {
              if (dependencies.mainWindow.isMinimized()) dependencies.mainWindow.restore();
              dependencies.mainWindow.focus();
              dependencies.mainWindow.show();
            }
          }
        };

        dependencies.notificationService.createCustomNotification(notificationData, currentSettings, electronModules, serviceFunctions);

        if (currentSettings.enableVoiceReading) {
          let voiceMsgParts = [];
          if (currentSettings.speakSenderName && notificationData.from) voiceMsgParts.push(`New message from ${notificationData.from}.`);
          if (currentSettings.speakSubject && notificationData.subject) voiceMsgParts.push(`Subject: ${notificationData.subject}.`);
          if (notificationData.body) voiceMsgParts.push(`Description: ${notificationData.body}.`);
          if (voiceMsgParts.length > 0) dependencies.say.speak(voiceMsgParts.join(' '));
          else dependencies.say.speak("You have a new email.");
        }
        if (dependencies.mainWindow && !dependencies.mainWindow.isDestroyed()) {
          dependencies.mainWindow.webContents.send('new-email', notificationData);
        }
      } else {
        console.log(`Email from ${emailDetails.fromEmail} (ID: ${emailId}) not in notifiable authors list. Skipping notification.`);
      }
    }
  } catch (error) {
    console.error(`Error processing email ID ${emailId} in orchestrator:`, error);
  }
}

module.exports = {
  init,
  estimateReadTime,
  captureEmailWithPuppeteer,
  getEmailDetails,
  processEmailWithOCR,
  processNewEmailId
};
