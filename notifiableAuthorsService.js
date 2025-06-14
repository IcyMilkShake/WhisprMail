const fs = require('fs').promises; // Using promises API for async operations
const path = require('path');

let NOTIFIABLE_AUTHORS_PATH = '';
let notifiableAuthors = [];

// Initialize the service with the Electron app object to set the path
function init(electronApp) {
  if (!electronApp || typeof electronApp.getPath !== 'function') {
    console.error('Invalid Electron app object passed to notifiableAuthorsService.init()');
    // Fallback or throw error, depending on how critical this path is at init time
    // For now, let's log and allow it to proceed, path will be incorrect.
    NOTIFIABLE_AUTHORS_PATH = path.join('__userDataFallback__', 'notifiable_authors.json');
    return;
  }
  NOTIFIABLE_AUTHORS_PATH = path.join(electronApp.getPath('userData'), 'notifiable_authors.json');
  console.log(`Notifiable authors path set to: ${NOTIFIABLE_AUTHORS_PATH}`);
}

// Load authors from the JSON file
async function loadAuthors() {
  if (!NOTIFIABLE_AUTHORS_PATH) {
    console.error('NOTIFIABLE_AUTHORS_PATH is not initialized. Call init() first.');
    notifiableAuthors = []; // Reset to empty or handle as appropriate
    return;
  }
  try {
    const data = await fs.readFile(NOTIFIABLE_AUTHORS_PATH, 'utf8');
    notifiableAuthors = JSON.parse(data);
    console.log('Notifiable authors loaded:', notifiableAuthors);
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.log('No notifiable authors file found, starting with an empty list.');
      notifiableAuthors = [];
    } else {
      console.error('Failed to load notifiable authors:', error);
      notifiableAuthors = []; // Reset to empty list on other errors (e.g., parse error)
    }
  }
}

// Save authors to the JSON file
async function saveAuthors() {
  if (!NOTIFIABLE_AUTHORS_PATH) {
    console.error('NOTIFIABLE_AUTHORS_PATH is not initialized. Cannot save authors.');
    return;
  }
  try {
    await fs.writeFile(NOTIFIABLE_AUTHORS_PATH, JSON.stringify(notifiableAuthors, null, 2), 'utf8');
    console.log('Notifiable authors saved.');
  } catch (error) {
    console.error('Failed to save notifiable authors:', error);
  }
}

// Get a copy of the current notifiable authors
function getAuthors() {
  return [...notifiableAuthors]; // Return a copy
}

// Add an author to the list
async function addAuthor(email) {
  if (email && typeof email === 'string') {
    const normalizedEmail = email.trim().toLowerCase();
    if (normalizedEmail && !notifiableAuthors.includes(normalizedEmail)) {
      notifiableAuthors.push(normalizedEmail);
      await saveAuthors();
      return { success: true, authors: getAuthors() };
    }
    if (notifiableAuthors.includes(normalizedEmail)) {
      return { success: false, error: 'Email already exists.', authors: getAuthors() };
    }
  }
  return { success: false, error: 'Invalid email provided.', authors: getAuthors() };
}

// Remove an author from the list
async function removeAuthor(email) {
  if (email && typeof email === 'string') {
    const normalizedEmail = email.trim().toLowerCase();
    const index = notifiableAuthors.indexOf(normalizedEmail);
    if (index > -1) {
      notifiableAuthors.splice(index, 1);
      await saveAuthors();
      return { success: true, authors: getAuthors() };
    }
    return { success: false, error: 'Email not found.', authors: getAuthors() };
  }
  return { success: false, error: 'Invalid email provided.', authors: getAuthors() };
}

module.exports = {
  init,
  loadAuthors,
  // saveAuthors, // Not typically exported if only used internally by add/remove
  getAuthors,
  addAuthor,
  removeAuthor
};
