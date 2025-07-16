const { app, BrowserWindow, ipcMain, Notification, shell, screen, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto'); // Added for PKCE
const keytar = require('keytar'); // Added for keytar
const { google } = require('googleapis');
// const open = require('open').default || require('open'); // Changed to dynamic import
const http = require('http');
const say = require('say');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer');
require('dotenv').config();
// const { MongoClient } = require('mongodb'); // MongoDB removed
const os = require('os'); // Or 'process' for environment variables, depending on how it's used later
// --- Keytar Constants ---
// KEYTAR_SERVICE_NAME: Used by keytar to identify the application or service storing the credential.
// It's a namespace for your credentials. For Google OAuth tokens.
const KEYTAR_SERVICE_NAME = 'WhisprMailGoogleOAuth';
// KEYTAR_ACCOUNT_NAME: The specific account name under the service. Here, it's a generic name
// as we're storing the token bundle for the primary user of the app for this service.
const KEYTAR_ACCOUNT_NAME = 'userTokens';
// Hugging Face token constants removed
const isDev = false; // Change to false for production
// --- Keytar Helper Functions ---
/**
 * Saves the provided tokens (JSON stringified) to the system keychain using keytar.
 * @param {object} tokens - The token object to save.
 */
async function saveTokensWithKeytar(tokens) {
  try {
    await keytar.setPassword(KEYTAR_SERVICE_NAME, KEYTAR_ACCOUNT_NAME, JSON.stringify(tokens));
    console.log('Tokens saved to keytar successfully.');
  } catch (error) {
    console.error('Error saving tokens to keytar:', error);
    // Potentially throw the error or handle it if keytar is unavailable
  }
}

/**
 * Retrieves tokens from the system keychain using keytar.
 * Parses the JSON string back into an object.
 * @returns {object|null} The token object or null if not found or an error occurs.
 */
async function getTokensFromKeytar() {
  try {
    const tokenString = await keytar.getPassword(KEYTAR_SERVICE_NAME, KEYTAR_ACCOUNT_NAME);
    if (tokenString) {
      console.log('Tokens retrieved from keytar.');
      return JSON.parse(tokenString);
    }
    console.log('No tokens found in keytar.');
    return null;
  } catch (error) {
    console.error('Error retrieving tokens from keytar:', error);
    // Potentially throw the error or handle it if keytar is unavailable
    return null;
  }
}

/**
 * Deletes tokens from the system keychain using keytar.
 */
async function deleteTokensFromKeytar() {
  try {
    const success = await keytar.deletePassword(KEYTAR_SERVICE_NAME, KEYTAR_ACCOUNT_NAME);
    if (success) {
      console.log('Tokens deleted from keytar.');
    } else {
      console.warn('Could not delete tokens from keytar (they might not have existed).');
    }
  } catch (error) {
    console.error('Error deleting tokens from keytar:', error);
  }
}

// --- End of MongoDB Functions --- (All MongoDB functions removed)

const NOTIFIABLE_AUTHORS_PATH = path.join(app.getPath('userData'), 'notifiable_authors.json');
const SETTINGS_PATH = path.join(app.getPath('userData'), 'app_settings.json');
let notifiableAuthors = []; // To store email addresses

// --- GLOBAL VARIABLES & CONSTANTS ---
const PYTHON_EXECUTABLE_PATH = isDev
  ? path.join(__dirname, 'python_executor', 'python.exe')
  : path.join(process.resourcesPath, 'python_executor', 'python.exe');
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.labels'
];

let mainWindow;
let originalConsoleLog;
let originalConsoleWarn;
let originalConsoleError;
let originalConsoleInfo;
let originalConsoleDebug;

let gmail;
let oAuth2Client;
let currentCodeVerifier; // Added for PKCE
let currentAuthState; // Added for state validation during OAuth flow
let isMonitoring = false;
let knownEmailIds = new Set();
let monitoringStartTime = null;
let activeNotifications = new Set(); // Track active notification windows
let openEmailViewWindows = new Set();

// IMPORTANT: User must replace 'YOUR_ACTUAL_CLIENT_ID' with their actual Google Client ID.
// This is a public identifier for the application, used by Google to identify this app.
// For installed applications (like Electron apps) using PKCE, the client ID is not a secret.
const GOOGLE_CLIENT_ID = '304008124129-6j79vk15selo581v1m870dnesma2vk9e.apps.googleusercontent.com';

// GOOGLE_CLIENT_SECRET is no longer used in this file.
// It will be used by the Vercel serverless function.

// Theme Palettes (mirrored from renderer.js)
const themePalettes = {
  dark: { // Current default theme - values from :root in index.html
    '--primary-bg': '#2C2F33',
    '--secondary-bg': '#23272A',
    '--tertiary-bg': '#36393F',
    '--main-text': '#FFFFFF',
    '--secondary-text': '#B9BBBE',
    '--accent-purple': '#7289DA',
    '--lighter-purple': '#8A9DF2',
    '--button-bg': '#4F545C',
    '--button-hover-bg': '#5D6269',
    '--success-color': '#43B581',
    '--error-color': '#F04747',
    '--warning-color': '#FAA61A',
    '--border-color': '#40444B'
  },
  light: {
    '--primary-bg': '#FFFFFF',
    '--secondary-bg': '#F2F3F5',
    '--tertiary-bg': '#E3E5E8',
    '--main-text': '#060607',
    '--secondary-text': '#5F6772',
    '--accent-purple': '#5865F2',
    '--lighter-purple': '#7983F5',
    '--button-bg': '#E3E5E8',
    '--button-hover-bg': '#D4D7DC',
    '--success-color': '#2DC770',
    '--error-color': '#ED4245',
    '--warning-color': '#E67E22',
    '--border-color': '#DCDFE4'
  },
  midnight: {
    '--primary-bg': '#1A1C1E',
    '--secondary-bg': '#111214',
    '--tertiary-bg': '#202225',
    '--main-text': '#E0E0E0',
    '--secondary-text': '#A0A0A0',
    '--accent-purple': '#6A79CC',
    '--lighter-purple': '#808EE0',
    '--button-bg': '#2A2D31',
    '--button-hover-bg': '#35393E',
    '--success-color': '#3BA55D',
    '--error-color': '#D83C3E',
    '--warning-color': '#D9822B',
    '--border-color': '#2D2F33'
  }
};

// User settings
let settings = {
  enableSummary: false,
  enableReadTime: true, 
  speakSenderName: true, // <-- ADD THIS LINE
  speakSubject: true,    // <-- ADD THIS LINE
  showUrgency: true,
  appearanceTheme: 'dark' // Added new theme setting
};

// --- PYTHON SCRIPT EXECUTION HELPER ---
function executePythonScript(scriptName, scriptArgs = [], inputText = null, timeout = 100000) {
  return new Promise((resolve, reject) => {
  const fullScriptPath = isDev
    ? path.join(__dirname, scriptName)
    : path.join(process.resourcesPath, scriptName);

    // --- Prepare environment for Python script ---
    const pythonEnv = { ...process.env }; // Clone current environment
    // Hugging Face token logic removed from here
    // --- End of environment preparation ---

    // Pass the modified environment to spawn
    const pythonProcess = spawn(PYTHON_EXECUTABLE_PATH, [fullScriptPath, ...scriptArgs], { env: pythonEnv });

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

// --- CONSOLE LOG OVERRIDE ---
function overrideConsole() {
  originalConsoleLog = console.log;
  originalConsoleWarn = console.warn;
  originalConsoleError = console.error;
  originalConsoleInfo = console.info;
  originalConsoleDebug = console.debug;

  const sendToRenderer = (type, ...args) => {
    if (mainWindow && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send('console-log-from-main', { type, messages: args });
    }
  };

  console.log = (...args) => {
    originalConsoleLog.apply(console, args);
    sendToRenderer('log', ...args);
  };
  console.warn = (...args) => {
    originalConsoleWarn.apply(console, args);
    sendToRenderer('warn', ...args);
  };
  console.error = (...args) => {
    originalConsoleError.apply(console, args);
    sendToRenderer('error', ...args);
  };
  console.info = (...args) => {
    originalConsoleInfo.apply(console, args);
    sendToRenderer('info', ...args);
  };
  console.debug = (...args) => {
    originalConsoleDebug.apply(console, args);
    sendToRenderer('debug', ...args);
  };
}

function restoreConsole() {
  if (originalConsoleLog) console.log = originalConsoleLog;
  if (originalConsoleWarn) console.warn = originalConsoleWarn;
  if (originalConsoleError) console.error = originalConsoleError;
  if (originalConsoleInfo) console.info = originalConsoleInfo;
  if (originalConsoleDebug) console.debug = originalConsoleDebug;
}

// --- ELECTRON APP LIFECYCLE & MAIN WINDOW ---
function createWindow() {
  overrideConsole(); // Override console before window creation
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
  // Hugging Face token fetching logic removed.
  // Users needing Python scripts with Hugging Face will need to set HUGGING_FACE_HUB_TOKEN
  // as an environment variable manually or through other means outside this app's direct management.

  loadAppSettings(); // Load settings first
  await saveAppSettings(); // Ensure file exists with current/default settings
  
  createWindow();
  loadNotifiableAuthors(); // This can come after loading app settings
  try {
    await startMonitoring();
    console.log('Email monitoring started!');
  } catch (error) {
    console.error('Failed to initialize:', error);
  }
});

ipcMain.on('show-full-email-in-main-window', async (event, messageId) => {
  console.log(`IPC: Request to open email ID ${messageId} externally.`); // Log message updated for clarity
  try {
    if (messageId) {
      createAndShowEmailWindow(messageId); // Call modified function directly
    } else {
      console.error('Error opening email: messageId is missing or invalid.');
      // Optionally, inform the user via a dialog if appropriate in your app's UX
      // dialog.showErrorBox('Error', 'Could not open email as the ID was missing.');
    }
  } catch (error) {
    console.error(`Error processing 'show-full-email-in-main-window' for ID ${messageId}:`, error);
    // Optionally, inform the user
    // dialog.showErrorBox('Error', `Error trying to open email ID ${messageId}: ${error.message}`);
  }
});

// Placeholder for the function that will be fully defined in the next step
// function createAndShowEmailWindow(viewData) { // Placeholder removed, new implementation below
//   console.log(`Placeholder: Would create new window for subject: ${viewData.subject}`);
// }

function createAndShowEmailWindow(messageId) { // Changed signature
  console.log(`Attempting to show email. ID: ${messageId}`); // Changed log

  if (messageId) { // Use messageId directly
    const gmailUrl = `https://mail.google.com/mail/u/0/#inbox/${messageId}`; // Use messageId directly
    console.log(`Opening email in Gmail: ${gmailUrl}`);
    shell.openExternal(gmailUrl);
  } else {
    console.error('Cannot open in Gmail: messageId is missing.'); // Updated error message
    // Optionally, show a main process dialog error to the user
    // dialog.showErrorBox('Error', 'Cannot open email in Gmail because its ID is missing.');
  }
}

app.on('window-all-closed', () => {
  restoreConsole(); // Restore console when all windows are closed
  stopMonitoring();
  if (process.platform !== 'darwin') app.quit();
});

// Also, ensure that when the main app quits, these windows are closed.
app.on('before-quit', () => {
  openEmailViewWindows.forEach(win => {
    if (win && !win.isDestroyed()) {
      win.close();
    }
  });
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// --- PKCE HELPER FUNCTIONS ---
// Proof Key for Code Exchange (PKCE) is an extension to the Authorization Code flow
// to prevent CSRF and authorization code injection attacks.

/**
 * Generates a cryptographically random string used as the PKCE code verifier.
 * The verifier is a high-entropy secret.
 * @returns {string} A base64url encoded random string.
 */
function generateCodeVerifier() {
  return crypto.randomBytes(64).toString('base64url');
}

/**
 * Generates a PKCE code challenge from a given code verifier.
 * The challenge is typically a SHA256 hash of the verifier, then base64url encoded.
 * @param {string} codeVerifier - The PKCE code verifier.
 * @returns {string} The base64url encoded SHA256 hash of the verifier.
 */
function generateCodeChallenge(codeVerifier) {
  return crypto
    .createHash('sha256')
    .update(codeVerifier)
    .digest('base64url'); // Ensure base64url encoding
}

/**
 * Exchanges an authorization code for OAuth tokens by calling the Vercel backend.
 * @param {string} authCode - The authorization code received from the OAuth server.
 * @param {string} verifier - The original PKCE code_verifier.
 * @returns {Promise<object>} A promise that resolves with the token object (access_token, refresh_token, etc.).
 */
async function exchangeCodeViaBackend(authCode, verifier) {
  // TODO: Replace 'https://your-vercel-app-url.vercel.app' with the actual Vercel deployment URL from the user.
  // This URL will be provided once the backend function is deployed.
  const backendTokenEndpoint = 'https://whisprmailapi.vercel.app/api/auth/exchange-google-auth';
  const redirectUri = 'http://localhost:3000'; 

  console.log('Exchanging code for tokens via backend:', backendTokenEndpoint);
  try {
    const response = await fetch(backendTokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        authorizationCode: authCode,
        codeVerifier: verifier,
        redirectUri: redirectUri, // Send the redirectUri used by the client
      }),
    });

    const responseBody = await response.json();

    if (!response.ok) {
      console.error('Backend token exchange failed! Response Status:', response.status, 'Body:', responseBody);
      throw new Error(`Backend token exchange failed: ${responseBody.error || 'Unknown backend error'}`);
    }

    console.log('Tokens obtained successfully via backend exchange.');
    return responseBody; 
  } catch (error) {
    console.error('Error during backend token exchange:', error);
    // Add a more specific error message if the fetch itself fails (e.g. network error)
    if (error.message.includes('fetch failed')) {
        throw new Error(`Network error or Vercel function not reachable at ${backendTokenEndpoint}. Details: ${error.message}`);
    }
    throw error; 
  }
}

// --- GMAIL AUTHENTICATION & API SETUP ---
// Create OAuth server
function createAuthServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const parsedUrl = new URL(req.url, 'http://localhost:3000');
      if (parsedUrl.pathname === '/') {
        const code = parsedUrl.searchParams.get('code');
        const error = parsedUrl.searchParams.get('error');
        const returnedState = parsedUrl.searchParams.get('state'); // Capture returned state

        if (error) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end('<h1>OAuth Error</h1><p>An error occurred during authentication. You can close this window.</p>');
          server.close(() => console.log('Auth server closed due to OAuth error.'));
          reject(new Error(`OAuth authentication error: ${error}`));
          currentAuthState = null; // Clear state
          return;
        }

        // Validate state
        if (!currentAuthState || returnedState !== currentAuthState) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end('<h1>OAuth Error</h1><p>Invalid state parameter. CSRF attack suspected or state mismatch. You can close this window.</p>');
          server.close(() => console.log('Auth server closed due to state mismatch.'));
          reject(new Error('OAuth state parameter mismatch.'));
          currentAuthState = null; // Clear state
          return;
        }
        currentAuthState = null; // Clear state after successful validation
        
        if (code) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end('<h1>Authentication Successful!</h1><p>You can close this window. The application will now proceed.</p>');
          server.close(() => console.log('Auth server closed after successful code retrieval.'));
          resolve(code); // Only resolve with code, state has been validated
          return;
        }

        // If neither code nor error is present, it's an unexpected request.
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end('<h1>Invalid Request</h1><p>This page was accessed incorrectly. Please close this window.</p>');
      }
    });

    server.on('error', (err) => {
      currentAuthState = null; // Clear state on server error too
      if (err.code === 'EADDRINUSE') {
        console.error('Error: Port 3000 is already in use. Cannot start authentication server.');
        reject(new Error('Port 3000 is already in use. Please ensure no other application is using it.'));
      } else {
        console.error('Auth server encountered an error:', err);
        reject(err);
      }
    });

    server.listen(3000, 'localhost', () => {
      console.log('Authentication server listening on http://localhost:3000');
    });
  });
}

// NEW function to handle refresh via backend
async function refreshAccessTokenViaBackend() {
  if (!oAuth2Client || !oAuth2Client.credentials || !oAuth2Client.credentials.refresh_token) {
    console.log('No refresh token available in oAuth2Client. Cannot refresh via backend.');
    throw new Error('No refresh token available for backend refresh.');
  }

  const refreshToken = oAuth2Client.credentials.refresh_token;
  console.log('Attempting to refresh access token via backend...');

  try {
    const response = await fetch('https://whisprmailapi.vercel.app/api/auth/refresh-google-token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ refreshToken }), // Sending refreshToken in the body
    });

    const newTokens = await response.json();

    if (!response.ok) {
      console.error('Backend token refresh failed! Response Status:', response.status, 'Body:', newTokens);
      // Specific check for invalid_grant from Google, which means refresh token is bad
      if (newTokens.details && (newTokens.details.error === 'invalid_grant' || newTokens.details.error === 'unauthorized_client')) {
        console.log('Refresh token is invalid or revoked according to backend. Full re-authentication needed.');
        throw new Error(`Refresh token invalid: ${newTokens.details.error_description || newTokens.details.error}`);
      }
      throw new Error(`Backend token refresh failed: ${newTokens.error || 'Unknown backend error'}`);
    }

    console.log('Access token refreshed successfully via backend.');
    
    // Google's token refresh response includes new access_token, expires_in, etc.
    // It might not include a new refresh_token.
    // We need to merge with existing credentials if refresh_token is not in newTokens.
    const updatedCredentials = {
      ...oAuth2Client.credentials, // keep existing refresh_token if not in newTokens
      access_token: newTokens.access_token,
      expiry_date: newTokens.expires_in ? Date.now() + (newTokens.expires_in * 1000) : null,
      // If Google sends back a new refresh_token, use it. Otherwise, keep the old one.
      refresh_token: newTokens.refresh_token || refreshToken 
    };
    
    if (newTokens.id_token) { // if id_token is part of the refresh response
        updatedCredentials.id_token = newTokens.id_token;
    }
    if (newTokens.scope) { // if scope is part of the refresh response
        updatedCredentials.scope = newTokens.scope;
    }
    if (newTokens.token_type) {
        updatedCredentials.token_type = newTokens.token_type;
    }

    oAuth2Client.setCredentials(updatedCredentials);
    await saveTokensWithKeytar(updatedCredentials); // Save the updated tokens (important!)
    console.log('Updated tokens saved to keytar after backend refresh.');

    return updatedCredentials.access_token; // Return the new access token
  } catch (error) {
    console.error('Error during backend token refresh process:', error);
    // Re-throw specific errors to be caught by initializeGmail for re-auth flow
    if (error.message.includes('Refresh token invalid') || error.message.includes('No refresh token available')) {
        throw error;
    }
    // Generic error for other failures
    throw new Error(`Failed to refresh token via backend: ${error.message}`);
  }
}


async function initializeGmail() {
  oAuth2Client = new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    undefined, // CORRECT: Client secret is undefined on the client
    'http://localhost:3000' // Redirect URI
  );
  console.log("Initializing Gmail: OAuth2 client created.");

  // Listen for 'tokens' event on oAuth2Client
  // This is a safety net: if the library internally refreshes tokens successfully,
  // (which we try to avoid for refresh, but it might happen for other reasons or future library changes)
  // we ensure those tokens are saved.
  oAuth2Client.on('tokens', (tokens) => {
    console.log('oAuth2Client emitted "tokens" event:', tokens);
    const currentCreds = oAuth2Client.credentials || {};
    const updatedTokens = { ...currentCreds };

    if (tokens.access_token) {
      updatedTokens.access_token = tokens.access_token;
    }
    if (tokens.refresh_token) {
      // This is important: if Google issues a new refresh token, we MUST use it.
      updatedTokens.refresh_token = tokens.refresh_token;
      console.log('New refresh_token received from "tokens" event.');
    }
    if (tokens.expiry_date) {
      updatedTokens.expiry_date = tokens.expiry_date;
    } else if (tokens.expires_in) {
      updatedTokens.expiry_date = Date.now() + (tokens.expires_in * 1000);
    }
    // Preserve other potential fields like id_token, scope, token_type if they are part of `tokens`
    if (tokens.id_token) updatedTokens.id_token = tokens.id_token;
    if (tokens.scope) updatedTokens.scope = tokens.scope;
    if (tokens.token_type) updatedTokens.token_type = tokens.token_type;


    // Update the client with potentially merged tokens
    oAuth2Client.setCredentials(updatedTokens);
    console.log('Saving tokens from "tokens" event to keytar.');
    saveTokensWithKeytar(updatedTokens);
  });
  // TEMPORARY: Delete tokens for development testing. REMOVE THIS FOR PRODUCTION.
  console.warn('TEMPORARY DEVELOPMENT CODE: Deleting stored OAuth tokens.');
  await deleteTokensFromKeytar(); 
  // END TEMPORARY CODE
  let token = await getTokensFromKeytar();

  if (token && token.access_token) { // Ensure token object and access_token exist
    oAuth2Client.setCredentials(token);
    try {
      const expiryDate = token.expiry_date;
      // Refresh if expiry_date is missing, or if less than 5 minutes remaining (300,000 ms)
      const needsRefresh = !expiryDate || expiryDate < (Date.now() + 5 * 60 * 1000);

      if (needsRefresh) {
        console.log('Token expired or nearing expiry, attempting refresh via backend.');
        if (!token.refresh_token) {
            console.log('No refresh token found in stored tokens. Proceeding to full auth flow.');
            throw new Error('No refresh token for backend refresh.'); // This will lead to full re-auth
        }
        // Ensure the client has the refresh token before attempting refresh
        oAuth2Client.setCredentials({ refresh_token: token.refresh_token }); 
        await refreshAccessTokenViaBackend(); // Use our backend refresh
        token = oAuth2Client.credentials; // Update token with new credentials from client
        console.log("Successfully refreshed token using backend.");
      } else {
        // If token is not expired, we can assume it's valid for now.
        // A lightweight check or just proceeding might be fine.
        // oAuth2Client.getAccessToken() might still attempt its own refresh if it disagrees.
        // For now, we'll trust our expiry check.
        console.log("Token from keytar is still valid.");
      }
    } catch (error) {
      console.log('Error processing existing token (could be during proactive refresh):', error.message);
      // If refresh failed because refresh token is invalid, or no refresh token was available for our backend call
      if (error.message.includes('Refresh token invalid') || error.message.includes('No refresh token available')) {
        console.log('Token from keytar invalid (refresh failed or no refresh token), deleting and re-authenticating...');
      } else {
        console.log('Other error with token from keytar, deleting and re-authenticating...');
      }
      await deleteTokensFromKeytar();
      token = null; // Signal that full authentication is needed
      oAuth2Client.setCredentials(null); // Clear any potentially bad credentials from the client
    }
  } else {
      // No token in keytar or token object is incomplete
      if (token) { // Token object existed but was incomplete (e.g. no access_token)
          console.log('Incomplete token found in keytar, deleting and re-authenticating...');
          await deleteTokensFromKeytar();
      }
      token = null; 
  }


  if (!token || !token.access_token) { // Check again, as token might have been nulled above or still be invalid
    console.log('No valid token available, starting new auth flow with PKCE...');
    
    currentCodeVerifier = generateCodeVerifier(); 
    const codeChallenge = generateCodeChallenge(currentCodeVerifier); 
    currentAuthState = crypto.randomBytes(32).toString('hex'); // Generate and store state for validation

    console.log('Constructing authorization URL...');
    const authParams = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID, 
      redirect_uri: 'http://localhost:3000', 
      response_type: 'code',
      scope: SCOPES.join(' '), 
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state: currentAuthState, // Add state to auth URL
      access_type: 'offline', 
      prompt: 'consent'       
    });
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${authParams.toString()}`;
    console.log('Constructed authUrl:', authUrl);

    const open = (await import('open')).default; 
    await open(authUrl); 
    
    let code;
    try {
      // createAuthServer now also validates state internally and clears currentAuthState
      code = await createAuthServer(currentAuthState);  // Pass state to createAuthServer
    } catch (error) {
      console.error("Authentication failed during local server callback:", error.message);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('auth-error', `Authentication callback failed: ${error.message}`);
      }
      throw error; // Propagate error to stop further execution
    }

    console.log('Attempting token exchange with backend using server-provided code...');
    const newTokens = await exchangeCodeViaBackend(code, currentCodeVerifier);

    oAuth2Client.setCredentials(newTokens); // This will also trigger the 'tokens' event
    // saveTokensWithKeytar is now handled by the 'tokens' event listener,
    // but calling it here explicitly ensures it's saved before gmail client is created,
    // especially if the event is asynchronous.
    await saveTokensWithKeytar(newTokens); 
    console.log('New tokens obtained via backend exchange and saved to keytar.');
    // token = newTokens; // oAuth2Client.credentials holds the authoritative tokens
  }

  gmail = google.gmail({ version: 'v1', auth: oAuth2Client });
  console.log("Gmail API client initialized successfully.");
  // console.log without arguments removed as it caused an error.
}

// --- API CALL WRAPPER ---
async function makeGmailApiCall(apiCallFunction) {
  if (!oAuth2Client || !oAuth2Client.credentials || !oAuth2Client.credentials.access_token) {
    console.log('Gmail client not ready or no access token, attempting to initialize/re-initialize.');
    await initializeGmail(); // Attempt to re-initialize which handles auth and refresh
    if (!oAuth2Client || !oAuth2Client.credentials || !oAuth2Client.credentials.access_token) {
      throw new Error("Gmail client initialization failed or no valid tokens after re-init.");
    }
  }
  
  const expiryDate = oAuth2Client.credentials.expiry_date;
  // Refresh if expiry_date is missing, or if less than 1 minute remaining (60,000 ms)
  const needsRefresh = !expiryDate || expiryDate < (Date.now() + 1 * 60 * 1000);

  if (needsRefresh) {
    console.log('Token possibly expired or nearing expiry before API call, attempting refresh via backend.');
    try {
      await refreshAccessTokenViaBackend();
      console.log('Token refreshed successfully before API call.');
    } catch (refreshError) {
      console.error('Failed to refresh token before API call:', refreshError.message);
      // If refresh failed critically (e.g. invalid refresh token), re-initialize to force full auth flow.
      if (refreshError.message.includes('Refresh token invalid') || refreshError.message.includes('No refresh token available')) {
        console.log('Critical refresh error, triggering full re-authentication.');
        await initializeGmail(); // This will attempt the full auth flow
        // After re-init, check again if client is ready
        if (!oAuth2Client || !oAuth2Client.credentials || !oAuth2Client.credentials.access_token) {
          throw new Error('Re-authentication failed, Gmail client not available after critical refresh error.');
        }
      } else {
        // For other refresh errors, we might just throw and let higher level decide
        throw new Error(`Token refresh failed, API call aborted: ${refreshError.message}`);
      }
    }
  }
  // At this point, oAuth2Client should have valid credentials.
  // The `gmail` object is already configured with this oAuth2Client.
  return await apiCallFunction();
}

// --- EMAIL PROCESSING & ANALYSIS ---
async function getNewEmails() {
  if (!gmail) {
    console.log("Gmail client not initialized in getNewEmails. Attempting to initialize.");
    await initializeGmail(); // Ensure client is initialized
    if (!gmail) {
      console.error("Failed to initialize Gmail client in getNewEmails.");
      return [];
    }
  }
  
  try {
    const query = monitoringStartTime
      ? `is:unread after:${Math.floor(monitoringStartTime / 1000)}`
      : 'is:unread';

    const res = await makeGmailApiCall(() => gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults: 50
    }));
    return res.data.messages || [];
  } catch (err) {
    // Error logging is now more centralized in makeGmailApiCall or initializeGmail for auth issues
    // Here, log specific API call errors if they are not auth related.
    if (err.message.includes('Token refresh failed') || err.message.includes('Gmail client initialization failed')) {
        console.error(`getNewEmails aborted due to auth/refresh issue: ${err.message}`);
    } else if (err.response) { // Standard Google API error structure
      console.error('getNewEmails - Gmail API error (response):', err.response.data);
    } else if (err.errors) { // Another Google API error structure
      console.error('getNewEmails - Gmail API error (errors):', err.errors);
    } else {
      console.error('getNewEmails - Gmail API unknown error:', err);
    }
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
  let htmlContent = ''; // New variable to store HTML content
  let attachments = [];

  function extractContent(part) {
    if (!part) return;

    if (part.parts) {
      part.parts.forEach(extractContent);
    } else {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        // Prefer textContent from dedicated text/plain parts if htmlContent is also found elsewhere
        // but append if multiple text/plain parts exist.
        if (textContent === '') { // Only take the first one if multiple are present
             textContent += Buffer.from(part.body.data, 'base64').toString('utf-8');
        }
      } else if (part.mimeType === 'text/html' && part.body?.data) {
        // Prefer htmlContent from dedicated text/html parts
         if (htmlContent === '') { // Only take the first one if multiple are present
            htmlContent += Buffer.from(part.body.data, 'base64').toString('utf-8');
        }
      } else if (part.filename && part.body?.attachmentId) {
        attachments.push({
          filename: part.filename,
          mimeType: part.mimeType,
          attachmentId: part.body.attachmentId,
          size: part.body.size
        });
      }
    }
  }

  // Handle cases where the body is directly in the payload (not in parts)
  if (payload?.body?.data) {
    if (payload.mimeType === 'text/plain' && !textContent) {
      textContent = Buffer.from(payload.body.data, 'base64').toString('utf-8');
    } else if (payload.mimeType === 'text/html' && !htmlContent) {
      htmlContent = Buffer.from(payload.body.data, 'base64').toString('utf-8');
    }
  }

  // If there are parts, prioritize them
  if (payload?.parts) {
    extractContent(payload);
  }

  // If HTML content is present but no plain text, try to create a basic plain text version from HTML.
  if (htmlContent && !textContent) {
    let rawBody = htmlContent;
    rawBody = rawBody.replace(/<style([\s\S]*?)<\/style>/gi, '')
                     .replace(/<script([\s\S]*?)<\/script>/gi, '')
                     .replace(/<\/div>|<\/li>|<\/p>|<br\s*\/?>/gi, '\n')
                     .replace(/<li>/ig, '  *  ')
                     .replace(/<[^>]+>/ig, '');
    textContent = rawBody.replace(/\s+/g, ' ').trim();
  }

  // If plain text is present but no HTML, use plain text as a fallback for HTML (wrapped in pre)
  // This is less ideal but ensures htmlBody is always somewhat populated if textContent exists.
  // However, the goal is to use actual HTML when available. So only do this if htmlContent is truly empty.
  if (textContent && !htmlContent) {
    htmlContent = `<pre style="white-space: pre-wrap; font-family: sans-serif;">${textContent}</pre>`;
  }


  textContent = textContent.replace(/\[image:.*?\]/gi, '').replace(/\s+/g, ' ').trim();
  // htmlContent is kept raw as it will be rendered in an iframe.

  return { textContent, htmlContent, attachments };
}

async function getEmailDetails(messageId) {
  try {
    const res = await gmail.users.messages.get({ userId: 'me', id: messageId, format: 'full' });
    const { payload } = res.data;
    if (!payload) return null;

    const headers = payload.headers;
    const fromHeader = headers.find(h => h.name.toLowerCase() === 'from')?.value || 'Unknown Sender';
    let fromEmail = 'unknown@example.com'; // Default
    const emailMatch = fromHeader.match(/<(.+?)>/);
    if (emailMatch && emailMatch[1]) {
        fromEmail = emailMatch[1].toLowerCase();
    } else if (fromHeader.includes('@')) {
        // Fallback if no <...> format, try to extract a valid email
        const parts = fromHeader.split(/[\s,;]+/); // Split by common delimiters
        const foundEmail = parts.find(part => part.includes('@') && part.includes('.'));
        if (foundEmail) fromEmail = foundEmail.toLowerCase();
    }
    const subject = headers.find(h => h.name.toLowerCase() === 'subject')?.value || 'No Subject';

    const { textContent, htmlContent, attachments } = processEmailContent(payload); // New line
    const contentForAnalysis = `${subject}\n\n${textContent}`.trim();

    console.log(`Processing email: "${subject}" from ${fromHeader}`);

    let tone;
    if (settings.showUrgency) {
      tone = await detectEmotionalTone(contentForAnalysis);
    } else {
      tone = { label: 'NEUTRAL', score: 0.0, urgency: 'low', analysis_source: 'disabled_setting' };
    }
    const readTime = estimateReadTime(textContent);

    return {
      from: extractSenderName(fromHeader),
      fromEmail: fromEmail,
      subject,
      body: textContent, // This is the plain text body
      bodyHtml: htmlContent, // This is the HTML body
      attachments,
      id: messageId,
      tone,
      readTime,
      urgency: tone.urgency // This will correctly use the tone object from the conditional logic
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

  console.log("Input text to summarizer.py:", text); // Added log
  return executePythonScript('summarizer.py', [], text)
    .then(result => {
      if (result && result.success && result.summary_text) {
        console.log("Summarization successful via Python script.");
        console.log("Summary text from summarizer.py:", result.summary_text);

        const summary = result.summary_text;
        const originalLength = text.length;
        const summaryLength = summary.length;

        // Condition for not effective summary:
        // 1. Summary is longer than 75% of original, AND very close in length to original (e.g. less than 20 char diff)
        // OR 2. Summary is actually longer than original (shouldn't happen with BART but good to check)
        const notEffectiveReduction = (summaryLength > originalLength * 0.75 && (originalLength - summaryLength) < 20);
        const longerThanOriginal = summaryLength >= originalLength; // Check if summary is same or longer

        if (longerThanOriginal || notEffectiveReduction) {
          console.log("Summarization deemed not effective or summary is same/longer than original. Returning original text. Original length:", originalLength, "Summary length:", summaryLength);
          return text; // Return original text
        } else {
          console.log("Summarization effective. Original length:", originalLength, "Summary length:", summaryLength);
          return summary; // Return the good summary
        }
      } else {
        console.error(`Error or invalid response from summarizer.py: ${result?.error || 'Unknown error'}`);
        console.error("Full result from summarizer.py (non-success or invalid):", result); // Added log
        return text; // Fallback to original text
      }
    })
    .catch(error => {
      console.error(`Summarization script execution failed: ${error.message}`);
      console.error("Raw error object from executePythonScript in summarizeText:", error); // Added log
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

async function processEmailWithOCR(messageId) {
  try {
    // Directly get email details without any OCR fallback.
    let emailDetails = await getEmailDetails(messageId);
    if (!emailDetails) {
      console.log(`Failed to get email details for ${messageId}, no OCR fallback.`);
      return null;
    }
    // Add a log to indicate OCR is skipped.
    console.log(`OCR process skipped for ${messageId}. Using fetched email content directly.`);
    // Ensure properties that might have been set by OCR are initialized or absent.
    emailDetails.isOCRProcessed = false; 
    emailDetails.ocrWordCount = 0;

    return emailDetails;
  } catch (error) {
    console.error(`Error in processEmailWithOCR (OCR removed) for ${messageId}:`, error);
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
  
  // Handle focus to register DevTools shortcut
  notificationWindow.on('focus', () => {
    console.log('Notification window focused. Registering DevTools shortcut.');
    globalShortcut.register('CommandOrControl+Shift+I', () => {
      console.log('DevTools shortcut pressed for focused notification.');
      if (notificationWindow && !notificationWindow.isDestroyed()) {
        notificationWindow.webContents.openDevTools({ mode: 'detach' });
      }
    });
  });

  // Handle blur to unregister DevTools shortcut
  notificationWindow.on('blur', () => {
    console.log('Notification window blurred. Unregistering DevTools shortcut.');
    globalShortcut.unregister('CommandOrControl+Shift+I');
  });

  // Remove from tracking when closed and unregister shortcut
  notificationWindow.on('closed', () => {
    console.log('Notification window closed. Unregistering DevTools shortcut if active.');
    globalShortcut.unregister('CommandOrControl+Shift+I');
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

// Dynamically generated IFRAME CSS
function generateIframeCss(theme) {
  return `
      <style>
        body {
          margin: 10px;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;
          font-size: 14px;
          line-height: 1.6;
          color: ${theme['--main-text']};
          background-color: ${theme['--primary-bg']};
          word-wrap: break-word;
          overflow-wrap: break-word;
          box-sizing: border-box;
          overflow-x: auto;
        }
        a {
          color: ${theme['--accent-purple']};
          text-decoration: none;
        }
        a:hover {
          color: ${theme['--lighter-purple']};
          text-decoration: underline;
        }
        img {
          max-width: 100%;
          height: auto;
          display: block;
          margin: 5px 0;
        }
        p, div, li {
            color: ${theme['--main-text']};
        }
        table {
          table-layout: auto;
          width: auto;
          border-collapse: collapse;
          margin-bottom: 1em;
          border: 1px solid ${theme['--border-color']};
        }
        td, th {
          border: 1px solid ${theme['--border-color']};
          padding: 8px;
          text-align: left;
          word-wrap: break-word;
          overflow-wrap: break-word;
          min-width: 0;
        }
        th {
          background-color: ${theme['--secondary-bg']};
          color: ${theme['--main-text']};
          font-weight: bold;
        }
        blockquote {
            border-left: 3px solid ${theme['--accent-purple']};
            background-color: ${theme['--secondary-bg']};
            color: ${theme['--secondary-text']};
            padding: 10px 15px;
            margin: 10px 0;
            border-radius: 4px;
        }
        pre {
          white-space: pre-wrap;
          word-wrap: break-word;
          overflow-x: auto;
          background-color: ${theme['--secondary-bg']};
          color: ${theme['--secondary-text']};
          border: 1px solid ${theme['--border-color']};
          padding: 12px;
          border-radius: 4px;
          max-width: 100%;
          box-sizing: border-box;
        }
        ul, ol {
          padding-left: 20px;
          color: ${theme['--main-text']};
        }
        li {
          margin-bottom: 5px;
        }
        h1, h2, h3, h4, h5, h6 {
          color: ${theme['--main-text']};
          margin-top: 1em;
          margin-bottom: 0.5em;
        }
        /* Scrollbars */
        ::-webkit-scrollbar {
          width: 8px;
          height: 8px;
        }
        ::-webkit-scrollbar-track {
          background: ${theme['--primary-bg']};
        }
        ::-webkit-scrollbar-thumb {
          background: ${theme['--button-bg']};
          border-radius: 4px;
        }
        ::-webkit-scrollbar-thumb:hover {
          background: ${theme['--button-hover-bg']};
        }
      </style>
      `;
}

// Global variable for IFRAME_BASE_CSS, initialized with the default theme from settings
let IFRAME_BASE_CSS = generateIframeCss(themePalettes[settings.appearanceTheme] || themePalettes.dark);


const IFRAME_BASE_CSS_OLD = `
      <style>
        /* Theme Colors (comments for reference, actual values used directly)
          --primary-bg: #2C2F33;
          --secondary-bg: #23272A;
          --tertiary-bg: #36393F;
          --main-text: #FFFFFF;
          --secondary-text: #B9BBBE;
          --accent-purple: #7289DA;
          --lighter-purple: #8A9DF2;
          --button-bg: #4F545C;
          --button-hover-bg: #5D6269;
          --border-color: #40444B;
          --success-color: #43B581;
          --error-color: #F04747;
          --warning-color: #FAA61A;
        */
        body {
          margin: 10px; /* Added some margin for better aesthetics */
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;
          font-size: 14px;
          line-height: 1.6; /* Slightly increased line height */
          color: #FFFFFF; /* --main-text */
          background-color: #2C2F33; /* --primary-bg */
          word-wrap: break-word;
          overflow-wrap: break-word;
          box-sizing: border-box;
          overflow-x: auto; 
        }
        a {
          color: #7289DA; /* --accent-purple */
          text-decoration: none; /* Remove underline by default */
        }
        a:hover {
          color: #8A9DF2; /* --lighter-purple */
          text-decoration: underline; /* Underline on hover */
        }
        img {
          max-width: 100%; 
          height: auto; 
          display: block; /* Block display for proper spacing */
          margin: 5px 0; /* Some margin around images */
        }
        p, div, li { /* General text containers */
            color: #FFFFFF; /* --main-text, ensure inheritance or set explicitly */
        }
        table {
          table-layout: auto;  
          width: auto;         
          border-collapse: collapse;
          margin-bottom: 1em; /* Spacing below tables */
          border: 1px solid #40444B; /* --border-color */
        }
        td, th {
          border: 1px solid #40444B; /* --border-color */
          padding: 8px; 
          text-align: left; /* Align text to left by default */
          word-wrap: break-word;   
          overflow-wrap: break-word;
          min-width: 0;          
        }
        th { /* Table headers */
          background-color: #23272A; /* --secondary-bg */
          color: #FFFFFF; /* --main-text */
          font-weight: bold; /* Make headers bold */
        }
        blockquote {
            border-left: 3px solid #7289DA; /* --accent-purple */
            background-color: #23272A; /* --secondary-bg */
            color: #B9BBBE; /* --secondary-text */
            padding: 10px 15px; /* Padding inside blockquote */
            margin: 10px 0; /* Margin around blockquote */
            border-radius: 4px; /* Rounded corners */
        }
        pre {
          white-space: pre-wrap;
          word-wrap: break-word;
          overflow-x: auto; 
          background-color: #23272A; /* --secondary-bg */
          color: #B9BBBE; /* --secondary-text */
          border: 1px solid #40444B; /* --border-color */
          padding: 12px; /* Increased padding */
          border-radius: 4px;
          max-width: 100%; 
          box-sizing: border-box;
        }
        ul, ol {
          padding-left: 20px; /* Standard padding for lists */
          color: #FFFFFF; /* --main-text */
        }
        li {
          margin-bottom: 5px; /* Spacing between list items */
        }
        h1, h2, h3, h4, h5, h6 {
          color: #FFFFFF; /* --main-text */
          margin-top: 1em; /* Space above headings */
          margin-bottom: 0.5em; /* Space below headings */
        }
        /* Scrollbars */
        ::-webkit-scrollbar {
          width: 8px;
          height: 8px;
        }
        ::-webkit-scrollbar-track {
          background: #2C2F33; /* --primary-bg */
        }
        ::-webkit-scrollbar-thumb {
          background: #4F545C; /* --button-bg */
          border-radius: 4px;
        }
        ::-webkit-scrollbar-thumb:hover {
          background: #5D6269; /* --button-hover-bg */
        }
      </style>
    `;

function createEnhancedNotificationHTML(emailData) {
  // Parameter is now 'emailData', which is consistent with how it's called.
  // Let's rename it to 'notificationData' for clarity within this function,
  // as it might have been processed (e.g., summarization).
  const notificationData = emailData;

  console.log('[MAIN DEBUG] createEnhancedNotificationHTML received notificationData.id:', notificationData ? notificationData.id : 'notificationData is null/undefined');
  console.log('[MAIN DEBUG] full notificationData:', JSON.stringify(notificationData, null, 2));
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
      <button class="quick-btn view-full-email" data-message-id="${emailData.id}" title="View full email in app">
        <span class="btn-icon">👁️</span>
        <span class="btn-text">View Full</span>
      </button>
      <button class="quick-btn mark-as-read" data-message-id="${emailData.id}" title="Mark as read">
        <span class="btn-icon">✓</span>
        <span class="btn-text">Mark Read</span>
      </button>
      <button class="quick-btn trash" data-message-id="${emailData.id}" title="Move to trash">
        <span class="btn-icon">🗑️</span>
        <span class="btn-text">Delete</span>
      </button>
      <button class="quick-btn star" data-message-id="${emailData.id}" title="Star email">
        <span class="btn-icon">⭐</span>
        <span class="btn-text">Star</span>
      </button>
    </div>
  `;

  // Process body text
  // const plainBodyForDisplay = notificationData.body || 'No preview available'; // Original line
  // let isPlainFallbackLong = false; // Removed
  // if (!notificationData.bodyHtml && plainBodyForDisplay.length > 2000) { // Check length of plain text // Removed
  //     isPlainFallbackLong = true; // Removed
  // } // Removed

  // Always display plain text in notifications, escaping HTML characters
  const plainBodyForDisplay = (notificationData.body || 'No body content available.').replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const emailBodyDisplayHTML = `<div class="body-text">${plainBodyForDisplay}</div>`;

  const finalHTML = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        /* All your existing CSS styles remain the same */
        /* Theme Colors (comments for reference, actual values used directly)
          --primary-bg: #2C2F33;
          --secondary-bg: #23272A;
          --tertiary-bg: #36393F;
          --main-text: #FFFFFF;
          --secondary-text: #B9BBBE;
          --accent-purple: #7289DA;
          --lighter-purple: #8A9DF2;
          --button-bg: #4F545C;
          --button-hover-bg: #5D6269;
          --border-color: #40444B;
          --success-color: #43B581;
          --error-color: #F04747;
          --warning-color: #FAA61A;
        */
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }
        
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;
          /* background: linear-gradient(135deg, #e0e0e0, #f5f5f5); Removed for dark theme */
          width: 100%;
          height: 100%;
          border-radius: 8px; /* Updated from 16px for consistency */
          overflow: hidden;
          cursor: pointer;
          animation: slideIn 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94);
          /* box-shadow: 0 5px 15px rgba(0,0,0,0.1); Removed for dark theme */
          position: relative;
          background-color: #23272A; /* --secondary-bg */
        }
        
        .notification-container {
          background: #23272A; /* --secondary-bg */
          height: 100%;
          display: flex;
          flex-direction: column;
          position: relative;
          overflow: hidden;
          border-radius: 8px;
          box-shadow: 0 5px 15px rgba(0,0,0,0.2);
        }
        
        .notification-container::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          height: 4px;
          background: #7289DA; /* --accent-purple */
          z-index: 1;
        }
        
        .notification-container.high-urgency::before {
          background: #F04747; /* --error-color */
        }
        
        .main-content {
          display: flex;
          padding: 15px; /* Slightly reduced padding */
          flex: 1;
          min-height: 0;
        }
        
        .avatar {
          width: 48px; /* Slightly smaller */
          height: 48px;
          border-radius: 50%;
          background: #36393F; /* --tertiary-bg */
          display: flex;
          align-items: center;
          justify-content: center;
          color: #FFFFFF; /* --main-text */
          font-weight: 700;
          font-size: 20px;
          margin-right: 12px;
          flex-shrink: 0;
          box-shadow: 0 2px 4px rgba(0,0,0,0.15);
        }
        
        .avatar.high-urgency {
          background: #F04747; /* --error-color */
          box-shadow: 0 2px 8px rgba(240, 71, 71, 0.4);
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
          margin-bottom: 6px;
        }
        
        .sender {
          font-weight: 600; /* Slightly less bold */
          color: #FFFFFF; /* --main-text */
          font-size: 15px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 220px; /* Adjusted max-width */
        }
        
        .badges {
          display: flex;
          gap: 5px; /* Reduced gap */
          flex-shrink: 0;
          align-items: center;
          margin-right: 30px; /* Added margin to prevent overlap */
        }
        
        .urgency-badge {
          font-size: 10px;
          padding: 3px 6px; 
          border-radius: 6px; 
          font-weight: 600; 
          color: #FFFFFF; /* Default white text */
          white-space: nowrap;
          letter-spacing: 0.1px; 
          box-shadow: 0 1px 2px rgba(0,0,0,0.2);
        }

        .urgency-badge.high {
          background-color: #F04747; /* --error-color */
        }

        .urgency-badge.medium {
          background-color: #FAA61A; /* --warning-color */
          color: #000000; /* Black text for contrast */
        }
        
        .summary-badge {
          background-color: #7289DA; /* --accent-purple */
          color: #FFFFFF; /* --main-text */
          box-shadow: 0 1px 2px rgba(0,0,0,0.2);
          padding: 3px 6px;
          border-radius: 6px;
          font-weight: 600;
          font-size: 10px;
        }
        
        .read-time-badge {
          font-size: 10px;
          padding: 3px 6px; 
          border-radius: 6px; 
          background: #36393F; /* --tertiary-bg */
          color: #B9BBBE; /* --secondary-text */
        }

        .ocr-badge {
          background-color: #8A9DF2; /* --lighter-purple */
          color: #000000; /* Black text for contrast */
          box-shadow: 0 1px 2px rgba(0,0,0,0.2);
          padding: 3px 6px;
          border-radius: 6px;
          font-weight: 600;
          font-size: 10px;
        }
        
        .subject {
          font-weight: 500; /* Normal weight */
          color: #FFFFFF; /* --main-text */
          font-size: 14px;
          margin-bottom: 8px;
          line-height: 1.3;
          word-wrap: break-word;
        }
        
        .body-text {
          color: #B9BBBE; /* --secondary-text */
          font-size: 13px;
          line-height: 1.4; /* Adjusted line height */
          flex: 1; 
          overflow-y: auto; 
          word-wrap: break-word;
          white-space: pre-wrap;
          max-height: 150px; /* Adjusted max height */
          padding-right: 5px; 
          background-color: #2C2F33; /* --primary-bg */
          border: 1px solid #40444B; /* --border-color */
          border-radius: 4px; 
          padding: 8px; 
        }
        
        .body-text::-webkit-scrollbar {
          width: 8px; 
          height: 8px;
        }
        
        .body-text::-webkit-scrollbar-track {
          background: #2C2F33; /* --primary-bg */
        }
        
        .body-text::-webkit-scrollbar-thumb {
          background: #4F545C; /* --button-bg */
          border-radius: 4px;
        }
        
        .body-text::-webkit-scrollbar-thumb:hover {
          background: #5D6269; /* --button-hover-bg */
        }
        
        .attachments-section {
          border-top: 1px solid #40444B; /* --border-color */
          padding: 10px 15px; /* Adjusted padding */
          background: #2C2F33; /* --primary-bg */
        }
        
        .attachments-header {
          margin-bottom: 6px;
        }
        
        .attachments-title {
          font-size: 11px; /* Slightly smaller */
          font-weight: 600;
          color: #B9BBBE; /* --secondary-text */
        }
        
        .attachments-list {
          display: flex;
          flex-direction: column;
          gap: 5px; /* Reduced gap */
        }
        
        .attachment-item {
          display: flex;
          align-items: center;
          padding: 6px 10px; /* Adjusted padding */
          background: #36393F; /* --tertiary-bg */
          border-radius: 6px;
          cursor: pointer;
          transition: background-color 0.2s ease;
          border: 1px solid #40444B; /* --border-color */
        }
        
        .attachment-item:hover {
          background: #5D6269; /* --button-hover-bg */
        }
        
        .attachment-icon {
          width: 28px; /* Smaller icon */
          height: 28px;
          border-radius: 4px;
          background-color: #4F545C; /* --button-bg for icon bg */
          display: flex;
          align-items: center;
          justify-content: center;
          margin-right: 8px;
          font-size: 14px;
          color: #FFFFFF; /* --main-text */
          flex-shrink: 0;
        }
        
        .attachment-info {
          flex: 1;
          min-width: 0;
        }
        
        .attachment-name {
          font-size: 12px;
          font-weight: 500;
          color: #FFFFFF; /* --main-text */
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        
        .attachment-size {
          font-size: 10px;
          color: #B9BBBE; /* --secondary-text */
        }
        
        .image-preview-badge {
          font-size: 14px; /* Adjusted size */
          margin-left: 6px;
        }
        
        .quick-actions {
          display: flex;
          gap: 6px; /* Reduced gap */
          padding: 10px 15px; /* Adjusted padding */
          background: #2C2F33; /* --primary-bg */
          border-top: 1px solid #40444B; /* --border-color */
        }

        .quick-btn {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 5px; /* Reduced gap */
          padding: 8px 10px; /* Adjusted padding */
          border: 1px solid #40444B; /* --border-color */
          border-radius: 5px; /* Standardized radius */
          font-size: 11px; /* Smaller font */
          font-weight: 600;
          cursor: pointer;
          transition: background-color 0.2s ease;
          background: #4F545C; /* --button-bg */
          color: #FFFFFF; /* --main-text */
          box-shadow: 0 1px 2px rgba(0,0,0,0.15);
        }

        .quick-btn:hover {
          background: #5D6269; /* --button-hover-bg */
        }

        .quick-btn.mark-as-read:hover {
          background: #43B581; /* --success-color */
          color: white;
        }

        .quick-btn.trash:hover {
          background: #F04747; /* --error-color */
          color: white;
        }

        .quick-btn.star:hover {
          background: #FAA61A; /* --warning-color */
          color: black; /* Contrast for yellow */
        }

        .quick-btn.view-full-email:hover {
          background: #7289DA; /* --accent-purple */
          color: white;
        }

        .btn-icon {
          font-size: 13px; /* Adjusted size */
        }

        .btn-text {
          font-size: 10px; /* Adjusted size */
        }
        
        .close-btn {
          position: absolute;
          top: 10px; /* Adjusted position */
          right: 10px;
          width: 24px; /* Smaller button */
          height: 24px;
          border-radius: 50%;
          background: #36393F; /* --tertiary-bg */
          border: none;
          color: #B9BBBE; /* --secondary-text */
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 14px; /* Adjusted size */
          opacity: 0.7; /* Slightly visible by default */
          transition: all 0.2s ease;
          z-index: 2;
        }
        
        .notification-container:hover .close-btn {
          opacity: 1;
        }

        .close-btn:hover {
          background: #F04747; /* --error-color */
          color: #FFFFFF; /* --main-text */
          transform: scale(1.1);
        }
        
        /* Removed .long-content-indicator as it's not themed for dark */
        
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
          .body-text { /* This would apply to the fallback */
            max-height: 100px;
          }
          .body-html-container { /* And also to the iframe container */
            height: 100px;
            max-height: 100px;
          }
        }
      </style>
    </head>
    <body>
      <div class="notification-container ${notificationData.urgency === 'high' ? 'high-urgency' : ''}">
        <div class="main-content">
          <div class="avatar ${notificationData.urgency === 'high' ? 'high-urgency' : ''}">${senderInitial}</div>
          <div class="content">
            <div class="header">
              <div class="sender">${notificationData.from}</div>
              <div class="badges">
                ${urgencyBadge}
                ${summaryBadge}
                ${readTimeBadge}
                ${ocrBadge}
              </div>
            </div>
            <div class="subject">${notificationData.subject || 'No Subject'}</div>
            ${emailBodyDisplayHTML}
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

            if (btn.classList.contains('view-full-email')) {
              console.log(\`[Notification LOG] 'View Full Email' button clicked for messageId: \${messageId}\`);
              // Send a message to main process to show this email in the main window's modal
              window.electronAPI.send('show-full-email-in-main-window', messageId); // New IPC channel
              // Optionally, close this notification after clicking "View Full Email"
              // closeNotification(); // Or window.electronAPI?.send('close-notification');
            } else {
              // Existing logic for other quick actions (mark-as-read, trash, star)
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
              setTimeout(() => closeNotification(), 300000); // 300000ms = 5 minutes
            } catch (error) {
              // ... existing error handling logic ...
              console.error(\`[Notification LOG] Error during action for messageId:\`, error);
              btn.innerHTML = '<span class="btn-icon">✗</span><span class="btn-text">Error</span>';
              btn.style.background = '#ef4444';
              btn.style.color = 'white';
              setTimeout(() => {
                btn.style.transform = '';
                btn.style.opacity = '';
              }, 2000);
              console.log('[Notification LOG] Error occurred during action, closing notification in 5 mins for debug.');
              setTimeout(() => closeNotification(), 300000); // 5 minutes
            }
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

  console.log("Final HTML generated with urgency badge:", urgencyBadge ? "YES" : "NO", "Uses Iframe:", !!notificationData.bodyHtml);
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
          // Check if the sender is in the notifiableAuthors list
          if (notifiableAuthors.length === 0 || (emailDetails.fromEmail && notifiableAuthors.includes(emailDetails.fromEmail.toLowerCase()))) {
            // Original logic for notification and voice reading
            let displayText = emailDetails.body;
            let isSummary = false;
            if (settings.enableSummary && emailDetails.body) {
              displayText = await summarizeText(emailDetails.body);
              isSummary = displayText !== emailDetails.body;
            }
            const notificationData = { ...emailDetails, body: displayText, isSummary };
            createCustomNotification(notificationData);

            let voiceMsgParts = [];

            if (settings.speakSenderName && notificationData.from) {
              voiceMsgParts.push(`New message from ${notificationData.from}.`);
            }

            if (settings.speakSubject && notificationData.subject) {
              voiceMsgParts.push(`Subject: ${notificationData.subject}.`);
            }
            
            if (voiceMsgParts.length > 0) {
              const voiceMsg = voiceMsgParts.join(' ');
              say.speak(voiceMsg);
            } else {
              // Fallback if everything is off but voice reading is enabled
              say.speak("You have a new email.");
            }
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('new-email', notificationData);
            }
          } else {
            console.log(`Email from ${emailDetails.fromEmail} not in notifiable authors list. Skipping notification.`);
            // Optionally, still add to knownEmailIds or handle as a regular email without notification
            // For now, we just skip the custom notification if not in the list.
            // If notifiableAuthors is empty, it means notify for all (original behavior).
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
ipcMain.handle('open-email-in-gmail', async (event, messageId) => {
  if (!messageId) {
    console.error('Error opening email in Gmail: No messageId provided.');
    return { success: false, error: 'No messageId provided' };
  }
  try {
    const gmailUrl = `https://mail.google.com/mail/u/0/#inbox/${messageId}`;
    await shell.openExternal(gmailUrl);
    console.log(`Successfully opened email ${messageId} in Gmail.`);
    return { success: true };
  } catch (error) {
    console.error(`Error opening email ${messageId} in Gmail:`, error);
    return { success: false, error: `Failed to open email in Gmail: ${error.message}` };
  }
});

ipcMain.handle('check-new-mail', async () => {
  if (!gmail) try { await initializeGmail(); } catch (e) { console.error("Gmail init failed in check-new-mail:", e); return 0; }
  if (!gmail) return 0;
  return (await getNewEmails()).length;
});

ipcMain.handle('start-monitoring', async () => {
  if (!gmail) {
    try {
    } catch (e) {
      console.error("Gmail init failed in start-monitoring:", e);
      // Ensure a string is returned in all error paths
      return 'Gmail initialization failed due to: ' + e.message;
    }
  }
  // Ensure a string is returned if gmail is still not initialized
  if (!gmail) return 'Gmail initialization failed.';

  // Await the result of startMonitoring and return it
  try {
    const result = await startMonitoring(); // 'startMonitoring' is the function defined in main.js
    return result; // This will be a string like 'Monitoring started successfully.' or 'Monitoring already active.'
  } catch (error) {
    console.error('Error during startMonitoring invocation:', error);
    return 'Failed to start monitoring: ' + error.message;
  }
});

ipcMain.handle('stop-monitoring', () => stopMonitoring());

ipcMain.handle('update-settings', async (event, newSettings) => { // Made handler async
  const oldTheme = settings.appearanceTheme;
  settings = { ...settings, ...newSettings };
  if (newSettings.appearanceTheme && newSettings.appearanceTheme !== oldTheme) {
    IFRAME_BASE_CSS = generateIframeCss(themePalettes[newSettings.appearanceTheme] || themePalettes.dark);
    console.log(`IFRAME_BASE_CSS updated for theme: ${newSettings.appearanceTheme}`);
  }
  console.log('Settings updated in main.js:', settings);
  await saveAppSettings(); // Save updated settings
  return settings; 
});

ipcMain.handle('get-settings', () => settings);

// Make sure IFRAME_BASE_CSS is accessible in this scope.
// It's already defined globally in main.js, so it should be fine.

// --- NOTIFIABLE AUTHORS IPC HANDLERS ---
ipcMain.handle('get-notifiable-authors', () => {
  return notifiableAuthors;
});

ipcMain.handle('add-notifiable-author', async (event, authorEmail) => {
  if (authorEmail && typeof authorEmail === 'string') {
    const email = authorEmail.trim().toLowerCase();
    if (email && !notifiableAuthors.includes(email)) {
      notifiableAuthors.push(email);
      await saveNotifiableAuthors();
      return { success: true, authors: notifiableAuthors };
    }
    if (notifiableAuthors.includes(email)) {
      return { success: false, error: 'Email already exists.', authors: notifiableAuthors };
    }
  }
  return { success: false, error: 'Invalid email provided.', authors: notifiableAuthors };
});

ipcMain.handle('remove-notifiable-author', async (event, authorEmail) => {
  if (authorEmail && typeof authorEmail === 'string') {
    const email = authorEmail.trim().toLowerCase();
    const index = notifiableAuthors.indexOf(email);
    if (index > -1) {
      notifiableAuthors.splice(index, 1);
      await saveNotifiableAuthors();
      return { success: true, authors: notifiableAuthors };
    }
    return { success: false, error: 'Email not found.', authors: notifiableAuthors };
  }
  return { success: false, error: 'Invalid email provided.', authors: notifiableAuthors };
});

// --- NOTIFIABLE AUTHORS FUNCTIONS ---
function loadNotifiableAuthors() {
  try {
    if (fs.existsSync(NOTIFIABLE_AUTHORS_PATH)) {
      const data = fs.readFileSync(NOTIFIABLE_AUTHORS_PATH, 'utf8');
      notifiableAuthors = JSON.parse(data);
      console.log('Notifiable authors loaded:', notifiableAuthors);
    } else {
      notifiableAuthors = [];
      console.log('No notifiable authors file found, starting with an empty list.');
    }
  } catch (error) {
    console.error('Failed to load notifiable authors:', error);
    notifiableAuthors = []; // Reset to empty list on error
  }
}

async function saveNotifiableAuthors() {
  try {
    await fs.promises.writeFile(NOTIFIABLE_AUTHORS_PATH, JSON.stringify(notifiableAuthors, null, 2), 'utf8');
    console.log('Notifiable authors saved.');
  } catch (error) {
    console.error('Failed to save notifiable authors:', error);
  }
}

function loadAppSettings() {
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      const data = fs.readFileSync(SETTINGS_PATH, 'utf8');
      const loadedSettingsFromFile = JSON.parse(data);
      // Merge loaded settings with defaults.
      // Defaults provide the structure and new settings.
      // Loaded settings override defaults for existing keys.
      settings = { ...settings, ...loadedSettingsFromFile };
      console.log('Application settings loaded from file:', SETTINGS_PATH);
    } else {
      console.log('No application settings file found at', SETTINGS_PATH, '. Using default settings.');
      // `settings` variable already holds the defaults, so no action needed here if file doesn't exist.
    }
  } catch (error) {
    console.error('Failed to load application settings from', SETTINGS_PATH, ':', error);
    // In case of error (e.g., corrupted file), fall back to default settings.
    // `settings` variable should still hold the initial defaults if an error occurs during merge.
    // To be absolutely sure, one could re-assign defaults here if the structure of `settings` could be compromised by a partial merge.
    // However, the current spread syntax `{ ...settings, ...loadedSettingsFromFile }` should be safe.
    // If `loadedSettingsFromFile` is malformed and `JSON.parse` throws, `settings` remains unchanged.
  }
}

async function saveAppSettings() {
  try {
    await fs.promises.writeFile(SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf8');
    console.log('Application settings saved to:', SETTINGS_PATH);
  } catch (error) {
    console.error('Failed to save application settings to', SETTINGS_PATH, ':', error);
  }
}

// TEMPORARY EXPORT FOR TESTING