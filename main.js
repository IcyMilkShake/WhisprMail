const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { google } = require('googleapis');
const open = require('open').default || require('open');
const http = require('http');
const url = require('url');

let mainWindow;
let gmail;
let oAuth2Client;
let isMonitoring = false;
let knownEmailIds = new Set();
let monitoringStartTime = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 600,
    height: 400,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.loadFile('index.html');
}

// Create a temporary HTTP server to handle OAuth callback
function createAuthServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const parsedUrl = url.parse(req.url, true);
      
      if (parsedUrl.pathname === '/') {
        const code = parsedUrl.query.code;
        const error = parsedUrl.query.error;

        if (error) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end('<h1>Authentication Error</h1><p>You can close this window.</p>');
          server.close();
          reject(new Error(error));
          return;
        }

        if (code) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`
            <h1>Authentication Successful!</h1>
            <p>You can close this window and return to the app.</p>
            <script>setTimeout(() => window.close(), 2000);</script>
          `);
          server.close();
          resolve(code);
          return;
        }

        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end('<h1>No authorization code received</h1>');
      }
    });

    server.listen(3000, 'localhost', () => {
      console.log('OAuth callback server running on http://localhost:3000');
    });

    server.on('error', (err) => {
      reject(err);
    });
  });
}

async function initializeGmail() {
  const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];
  const TOKEN_PATH = path.join(__dirname, 'token.json');
  const CREDENTIALS = JSON.parse(fs.readFileSync('credentials.json'));

  const { client_secret, client_id } = CREDENTIALS.installed;
  // Use localhost:3000 for Electron development
  oAuth2Client = new google.auth.OAuth2(client_id, client_secret, 'http://localhost:3000');

  // Check for saved token
  if (fs.existsSync(TOKEN_PATH)) {
    const token = JSON.parse(fs.readFileSync(TOKEN_PATH));
    oAuth2Client.setCredentials(token);
    
    // Check if token is still valid
    try {
      await oAuth2Client.getAccessToken();
      console.log('✅ Using existing valid token');
    } catch (error) {
      console.log('🔄 Token expired, need to re-authenticate');
      fs.unlinkSync(TOKEN_PATH); // Delete invalid token
      return await initializeGmail(); // Retry authentication
    }
  } else {
    console.log('🔐 Starting authentication process...');
    
    const authUrl = oAuth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
      prompt: 'consent' // Force consent screen to get refresh token
    });

    console.log('Opening browser for authentication...');
    await open(authUrl);

    try {
      // Start the callback server and wait for the code
      const code = await createAuthServer();
      console.log('✅ Received authorization code');

      // Exchange code for tokens
      const { tokens } = await oAuth2Client.getToken(code);
      oAuth2Client.setCredentials(tokens);
      
      // Save tokens
      fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens));
      console.log('✅ Token stored successfully');
      
    } catch (error) {
      console.error('❌ Authentication failed:', error.message);
      throw error;
    }
  }

  gmail = google.gmail({ version: 'v1', auth: oAuth2Client });
  console.log('✅ Gmail API initialized');
}

async function getNewEmails() {
  try {
    // Only get emails received after monitoring started
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
    console.error('Error fetching emails:', error);
    return [];
  }
}

async function getEmailDetails(messageId) {
  try {
    const res = await gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'full', // Fetch full message to get body
    });

    const headers = res.data.payload.headers;
    const from = headers.find(h => h.name === 'From')?.value || 'Unknown';
    const subject = headers.find(h => h.name === 'Subject')?.value || 'No Subject';
    const date = headers.find(h => h.name === 'Date')?.value || 'Unknown Date';

    // Extract plain text body
    let body = '';
    const payload = res.data.payload;

    function extractBody(payload) {
      if (payload.parts) {
        for (const part of payload.parts) {
          if (part.mimeType === 'text/plain' && part.body?.data) {
            return Buffer.from(part.body.data, 'base64').toString('utf-8');
          } else if (part.parts) {
            const inner = extractBody(part);
            if (inner) return inner;
          }
        }
      } else if (payload.body?.data) {
        return Buffer.from(payload.body.data, 'base64').toString('utf-8');
      }
      return '';
    }

    body = extractBody(payload);

    return { from, subject, date, body, id: messageId };
  } catch (error) {
    console.error('Error fetching email details:', error);
    return null;
  }
}

async function checkForNewEmails() {
  if (!gmail || !monitoringStartTime) return;

  try {
    const newEmails = await getNewEmails();
    const currentEmailIds = new Set(newEmails.map(email => email.id));

    // Find emails we haven't seen before
    const unseenEmailIds = [...currentEmailIds].filter(id => !knownEmailIds.has(id));

    if (unseenEmailIds.length > 0) {
      console.log(`\n🔔 ${unseenEmailIds.length} NEW EMAIL(S) RECEIVED!`);
      console.log('=' .repeat(50));

      for (const emailId of unseenEmailIds) {
        const emailDetails = await getEmailDetails(emailId);
        if (emailDetails) {
          console.log('📧 NEW EMAIL:');
          console.log(`   From: ${emailDetails.from}`);
          console.log(`   Subject: ${emailDetails.subject}`);
          console.log(`   Body: ${emailDetails.body}`);
          console.log(`   Date: ${emailDetails.date}`);
          console.log(`   ID: ${emailDetails.id}`);
          console.log('-'.repeat(30));
        }
      }

      // Update known emails
      knownEmailIds = new Set([...knownEmailIds, ...unseenEmailIds]);
    }

    // Send count to renderer (only new emails since monitoring started)
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('email-count-update', newEmails.length);
    }

  } catch (error) {
    console.error('Error checking for new emails:', error);
  }
}

async function startMonitoring() {
  if (isMonitoring) return;
  
  console.log('🚀 Starting Gmail monitoring for NEW emails only...');
  isMonitoring = true;
  
  // Set monitoring start time to current time
  monitoringStartTime = Date.now();
  
  // Clear known emails - we only care about emails from this point forward
  knownEmailIds.clear();
  
  console.log(`📊 Monitoring started at: ${new Date(monitoringStartTime).toLocaleString()}`);
  console.log('🔍 Only emails received AFTER this time will be logged');

  // Check every 10 seconds
  const monitoringInterval = setInterval(async () => {
    if (!isMonitoring) {
      clearInterval(monitoringInterval);
      return;
    }
    await checkForNewEmails();
  }, 10000);

  return monitoringInterval;
}

function stopMonitoring() {
  isMonitoring = false;
  monitoringStartTime = null;
  knownEmailIds.clear();
  console.log('⏹️ Gmail monitoring stopped');
}

app.whenReady().then(async () => {
  createWindow();
  
  try {
    await initializeGmail();
    await startMonitoring();
  } catch (error) {
    console.error('Failed to initialize Gmail:', error);
  }
});

ipcMain.handle('check-new-mail', async () => {
  if (!gmail) {
    await initializeGmail();
  }

  const newEmails = await getNewEmails();
  return newEmails.length;
});

ipcMain.handle('start-monitoring', async () => {
  if (!gmail) {
    await initializeGmail();
  }
  await startMonitoring();
  return 'Monitoring started - tracking NEW emails only';
});

ipcMain.handle('stop-monitoring', () => {
  stopMonitoring();
  return 'Monitoring stopped';
});

app.on('window-all-closed', () => {
  stopMonitoring();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});