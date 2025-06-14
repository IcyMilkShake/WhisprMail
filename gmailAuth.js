const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const http = require('http');
const { URL } = require('url'); // Added for createAuthServer

// --- CONSTANTS ---
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.labels'
];
const TOKEN_PATH = path.join(__dirname, 'token.json');
const CREDENTIALS_PATH = path.join(__dirname, 'credentials.json'); // Assuming credentials.json is in the same directory

// --- HELPER FUNCTIONS ---

// Create OAuth server
// Moved from main.js
function createAuthServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      // Use new URL constructor for robust parsing
      const parsedUrl = new URL(req.url, 'http://localhost:3000');
      if (parsedUrl.pathname === '/') {
        const code = parsedUrl.searchParams.get('code');
        const error = parsedUrl.searchParams.get('error');

        if (error) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end('<h1>Authentication Error</h1><p>Please close this window and try again.</p>');
          server.close(() => reject(new Error(error))); // Ensure server closes before rejecting
          return;
        }

        if (code) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end('<h1>Authentication Successful!</h1><p>You can close this window now.</p>');
          server.close(() => resolve(code)); // Ensure server closes before resolving
          return;
        }
        // Optional: Handle case where neither code nor error is present
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end('<h1>Invalid Request</h1><p>Missing authorization code.</p>');
        server.close(); // Close server on invalid request too
        // No specific reject here as it might not be an error state we want to propagate as auth failure
      }
    });
    server.on('error', (err) => { // Handle server errors (e.g., port in use)
        reject(new Error(`Authentication server error: ${err.message}`));
    });
    server.listen(3000, 'localhost', () => {
        console.log('OAuth server listening on http://localhost:3000');
    });
  });
}

// --- GMAIL INITIALIZATION ---
// Moved and adapted from main.js
async function initializeGmail() {
  let oAuth2Client;
  let gmailService; // Renamed from gmail to avoid conflict with googleapis.gmail

  try {
    const credentialsFileContent = fs.readFileSync(CREDENTIALS_PATH);
    const credentials = JSON.parse(credentialsFileContent);
    const { client_secret, client_id, redirect_uris } = credentials.installed || credentials.web; // Support both types
    const redirect_uri = redirect_uris && redirect_uris.length > 0 ? redirect_uris[0] : 'http://localhost:3000';


    oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uri);

    console.log("Initializing Gmail authentication...");

    if (fs.existsSync(TOKEN_PATH)) {
      const token = JSON.parse(fs.readFileSync(TOKEN_PATH));
      oAuth2Client.setCredentials(token);
      try {
        // Test if the token is still valid by trying to get a new access token (if needed)
        // or making a simple API call. getAccessToken will refresh if necessary.
        await oAuth2Client.getAccessToken();
        console.log('Token is valid or refreshed.');
      } catch (error) {
        console.log('Token expired or invalid, re-authenticating...');
        fs.unlinkSync(TOKEN_PATH); // Delete expired token
        return await initializeGmail(); // Recursive call to re-authenticate
      }
    } else {
      const authUrl = oAuth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES,
        prompt: 'consent' // Force consent screen to ensure refresh token is obtained
      });

      const open = (await import('open')).default; // Dynamic import for ES module
      await open(authUrl);
      console.log('Authorization URL opened. Please authorize in your browser.');

      const code = await createAuthServer(); // Wait for the auth code from the server
      const { tokens } = await oAuth2Client.getToken(code);
      oAuth2Client.setCredentials(tokens);
      fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens));
      console.log('Token stored to', TOKEN_PATH);
    }

    gmailService = google.gmail({ version: 'v1', auth: oAuth2Client });
    console.log('Gmail API client initialized successfully.');
    return { oAuth2Client, gmail: gmailService };

  } catch (error) {
    console.error('Failed to initialize Gmail:', error.message);
    // More detailed error logging for debugging
    if (error.response && error.response.data) {
        console.error('Gmail API Error Details:', error.response.data);
    }
    // Propagate the error so the main process can handle it
    throw new Error(`Gmail initialization failed: ${error.message}`);
  }
}

module.exports = {
  SCOPES,
  createAuthServer, // Export if needed directly, though initializeGmail uses it internally
  initializeGmail
};
