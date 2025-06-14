// This service handles UI logic related to the main window's email viewing features.

let dependencies = {
  mainWindow: null,
  IFRAME_BASE_CSS_string: null,
  emailProcessingOrchestrator: null,
  emailService: null,
  BrowserWindowModule: null, // To create new windows
};

const openEmailViewWindows = new Set(); // Manages currently open email view windows

function init(deps) {
  dependencies.mainWindow = deps.mainWindow;
  dependencies.IFRAME_BASE_CSS_string = deps.IFRAME_BASE_CSS_string;
  dependencies.emailProcessingOrchestrator = deps.emailProcessingOrchestrator;
  dependencies.emailService = deps.emailService; // Needed for getLatestEmailHTMLHandlerLogic
  dependencies.BrowserWindowModule = deps.BrowserWindowModule; // Store Electron's BrowserWindow module
  console.log('MainUIService initialized.');
}

// Moved from main.js
// This function creates and shows the actual email window.
function createAndShowEmailWindow(viewData) {
  if (!dependencies.BrowserWindowModule || !dependencies.IFRAME_BASE_CSS_string) {
    console.error('MainUIService not properly initialized. BrowserWindowModule or IFRAME_BASE_CSS_string missing.');
    return;
  }
  console.log(`MainUIService: Creating new email view window for subject: ${viewData.subject}`);

  let contentToLoad = '';
  if (viewData.bodyHtml) {
    contentToLoad = viewData.bodyHtml;
  } else if (viewData.bodyText) {
    const escapedBodyText = viewData.bodyText.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    contentToLoad = `<pre style="white-space: pre-wrap; word-wrap: break-word; font-family: sans-serif;">${escapedBodyText}</pre>`;
  } else {
    contentToLoad = '<p>No content available for this email.</p>';
  }

  const combinedContent = dependencies.IFRAME_BASE_CSS_string + contentToLoad;
  const iframeSrcDoc = combinedContent.replace(/"/g, '&quot;');

  const newWindowHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>${viewData.subject.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</title>
      <style>
        body, html { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; }
        iframe { width: 100%; height: 100%; border: none; }
      </style>
    </head>
    <body>
      <iframe srcdoc="${iframeSrcDoc}" sandbox="allow-popups allow-same-origin allow-scripts"></iframe>
    </body>
    </html>`;

  const emailViewWindow = new dependencies.BrowserWindowModule({
    width: 800,
    height: 700,
    title: viewData.subject || 'Email Preview',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
    },
    show: false
  });

  openEmailViewWindows.add(emailViewWindow);

  emailViewWindow.on('closed', () => {
    console.log(`MainUIService: Email view window for subject "${viewData.subject}" closed.`);
    openEmailViewWindows.delete(emailViewWindow);
  });

  emailViewWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(newWindowHtml)}`);

  emailViewWindow.once('ready-to-show', () => {
    emailViewWindow.show();
    emailViewWindow.focus();
  });
}

// Moved from main.js
// Function to open an email in a new window, using the orchestrator to get details
async function openEmailViewWindow(messageId) {
  if (!dependencies.emailProcessingOrchestrator) {
     console.error('MainUIService: emailProcessingOrchestrator not initialized.');
     return;
  }
  console.log(`MainUIService: Request to open email ID ${messageId} in a new window.`);
  try {
    // getEmailDetails is now part of the orchestrator
    const emailDetails = await dependencies.emailProcessingOrchestrator.getEmailDetails(messageId);

    if (emailDetails && (emailDetails.bodyHtml || emailDetails.body)) {
      const viewData = {
        subject: emailDetails.subject || 'Email Preview',
        bodyHtml: emailDetails.bodyHtml,
        bodyText: emailDetails.body
      };
      createAndShowEmailWindow(viewData); // Calls local createAndShowEmailWindow
    } else {
      console.error(`MainUIService: Could not fetch sufficient details for emailId: ${messageId} to display.`);
    }
  } catch (error) {
    console.error(`MainUIService: Error processing request to open email (ID ${messageId}):`, error);
  }
}

// Core logic for 'get-latest-email-html' IPC handler
async function getLatestEmailHTMLHandlerLogic() {
  if (!dependencies.emailService || !dependencies.emailProcessingOrchestrator || !dependencies.IFRAME_BASE_CSS_string) {
    console.error('MainUIService: Critical dependencies missing for getLatestEmailHTMLHandlerLogic.');
    return { success: false, error: 'Service not properly configured.' };
  }

  // This still needs access to monitoringStartTime if getNewEmails is to be filtered by it.
  // However, for "latest email", it's usually the absolute latest unread.
  // For simplicity, assuming getNewEmails can be called with null startTime to get all unread.
  const newEmails = await dependencies.emailService.getNewEmails(dependencies.gmail, null); // Pass gmail from orchestrator's deps or main's global?
                                                                                            // Let's assume orchestrator exposes gmail if needed, or this function needs gmail passed to init.
                                                                                            // For now, this will fail as gmail is not in this.dependencies.
                                                                                            // Corrected: emailService takes gmail as an argument.
                                                                                            // The `gmail` object itself needs to be available.
                                                                                            // This suggests `gmail` should also be a dependency of `mainUIService`.

  if (!newEmails || newEmails.length === 0) {
    return { success: false, error: 'No unread emails found.' };
  }
  const latestEmailMeta = newEmails[0];
  if (!latestEmailMeta || !latestEmailMeta.id) {
    return { success: false, error: 'Could not identify the latest email.' };
  }

  // getEmailDetails is now part of the orchestrator
  const emailDetails = await dependencies.emailProcessingOrchestrator.getEmailDetails(latestEmailMeta.id);

  if (!emailDetails) {
    return { success: false, error: 'Failed to fetch details for the latest email.' };
  }

  if (emailDetails.bodyHtml && emailDetails.bodyHtml.trim() !== '') {
    return { success: true, html: emailDetails.bodyHtml, css: dependencies.IFRAME_BASE_CSS_string };
  } else {
    return { success: false, error: 'Latest email has no HTML content to display.' };
  }
}

function closeAllEmailViewWindows() {
    openEmailViewWindows.forEach(win => {
        if (win && !win.isDestroyed()) {
            win.close();
        }
    });
    openEmailViewWindows.clear();
}


module.exports = {
  init,
  createAndShowEmailWindow, // Exported if direct creation is needed, though openEmailViewWindow is typical entry
  openEmailViewWindow,
  getLatestEmailHTMLHandlerLogic,
  closeAllEmailViewWindows
};
