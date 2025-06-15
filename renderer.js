let isMonitoring = false;
let settings = {
  enableSummary: false,
  enableVoiceReading: true,
  showUrgency: true,
  enableReadTime: true,
  speakSenderName: true, 
  speakSubject: true,
  appearanceTheme: 'dark' // Default theme
};

const themes = {
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
    '--secondary-bg': '#F2F3F5', // Light grey for cards/panels
    '--tertiary-bg': '#E3E5E8',  // Slightly darker grey for headers or distinct sections
    '--main-text': '#060607',    // Very dark grey/black for main text
    '--secondary-text': '#5F6772', // Medium grey for secondary text
    '--accent-purple': '#5865F2', // Discord-like purple, slightly adjusted for light theme
    '--lighter-purple': '#7983F5',
    '--button-bg': '#E3E5E8',    // Buttons can be light grey
    '--button-hover-bg': '#D4D7DC', // Darker hover for light grey buttons
    '--success-color': '#2DC770',
    '--error-color': '#ED4245',
    '--warning-color': '#E67E22',
    '--border-color': '#DCDFE4'  // Light border color
  },
  midnight: {
    '--primary-bg': '#1A1C1E',    // Very dark (almost black) blue/grey
    '--secondary-bg': '#111214',  // Even darker for panels
    '--tertiary-bg': '#202225',   // Slightly lighter dark for headers
    '--main-text': '#E0E0E0',    // Off-white/light grey text
    '--secondary-text': '#A0A0A0', // Medium grey secondary text
    '--accent-purple': '#6A79CC', // Muted purple for midnight
    '--lighter-purple': '#808EE0',
    '--button-bg': '#2A2D31',    // Dark buttons
    '--button-hover-bg': '#35393E', // Slightly lighter hover for dark buttons
    '--success-color': '#3BA55D',
    '--error-color': '#D83C3E',
    '--warning-color': '#D9822B',
    '--border-color': '#2D2F33'   // Dark border color
  }
};

// UI Elements
const statusDisplay = document.getElementById('statusDisplay');
const statusIcon = document.getElementById('statusIcon');
const statusText = document.getElementById('statusText');
const statusSubtext = document.getElementById('statusSubtext');
const countNumber = document.getElementById('countNumber');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const checkBtn = document.getElementById('checkBtn');
const notifiableAuthorEmailInput = document.getElementById('notifiableAuthorEmailInput');
const addNotifiableAuthorBtn = document.getElementById('addNotifiableAuthorBtn');
const notifiableAuthorsListUL = document.getElementById('notifiableAuthorsList'); // Renamed for clarity
const noNotifiableAuthorsMsg = document.getElementById('noNotifiableAuthorsMsg');

// At the top of renderer.js, add new UI element references
const viewAllBtn = document.getElementById('viewAllBtn');
const emailPreviewModal = document.getElementById('emailPreviewModal');
const closeEmailPreviewModal = document.getElementById('closeEmailPreviewModal');
const emailPreviewFrame = document.getElementById('emailPreviewFrame');
const emailPreviewTitle = document.getElementById('emailPreviewTitle');


// IFRAME_BASE_CSS (intended to be identical to main.js version)
const IFRAME_BASE_CSS = `
      <style>
        body {
          margin: 0;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;
          font-size: 14px;
          line-height: 1.5;
          color: #333;
          background-color: #fff;
          word-wrap: break-word;
          overflow-wrap: break-word;
          box-sizing: border-box;
          overflow-x: auto;
        }
        a {
          color: #1a73e8;
        }
        a:hover {
        }
        img {
          max-width: 100%;
          height: auto;
        }
        p, div, li {
            word-wrap: break-word;
            overflow-wrap: break-word;
        }
        table {
          table-layout: auto;
          width: auto;
          border-collapse: collapse;
        }
        td, th {
          border: none;
          word-wrap: break-word;
          overflow-wrap: break-word;
          min-width: 0;
        }
        pre {
          white-space: pre-wrap;
          word-wrap: break-word;
          overflow-x: auto;
          background: #f4f4f4;
          padding: 10px;
          border-radius: 4px;
          max-width: 100%;
          box-sizing: border-box;
        }
        ul, ol {
        }
        * {
          outline: none !important;
          outline-style: none !important;
          -moz-outline-style: none !important;
        }
      </style>
    `;

if (viewAllBtn) {
  viewAllBtn.addEventListener('click', async () => {
    try {
      // In the next step, 'get-latest-email-html' IPC handler in main.js will be created.
      // For now, we expect it to return an object: { success: true, html: '...', css: '...' } or { success: false, error: '...' }
      const result = await window.gmail.invoke('get-latest-email-html'); // Using invoke as it's a new handler

      if (result && result.success && result.html) {
        // If CSS is also passed from main.js, use result.css. Otherwise, use the local IFRAME_BASE_CSS.
        // For consistency, we are now making the local IFRAME_BASE_CSS match the main.js one.
        const cssToUse = IFRAME_BASE_CSS;
        emailPreviewFrame.srcdoc = cssToUse + result.html;
        emailPreviewModal.style.display = 'block';

      } else if (result && result.error) {
        showNotification(result.error, 'error');
        emailPreviewFrame.srcdoc = ''; 
      } else {
        showNotification('No email content found or an unknown error occurred when fetching for View All.', 'info');
        emailPreviewFrame.srcdoc = ''; 
      }
    } catch (error) {
      console.error('Error in View All button click listener:', error);
      showNotification('Failed to process View All request: ' + error.message, 'error');
      emailPreviewFrame.srcdoc = ''; 
    }
  });
}

if (closeEmailPreviewModal) {
  closeEmailPreviewModal.addEventListener('click', () => {
    emailPreviewModal.style.display = 'none';
    emailPreviewFrame.srcdoc = ''; // Clear iframe content when closing
  });
}

// Close modal if user clicks outside of the modal content
window.addEventListener('click', (event) => {
  if (event.target == emailPreviewModal) {
    emailPreviewModal.style.display = 'none';
    emailPreviewFrame.srcdoc = ''; // Clear iframe content
  }
});

function updateUI() {
  if (isMonitoring) {
    statusDisplay.className = 'status-display monitoring';
    statusIcon.textContent = '🟢';
    statusText.textContent = 'Monitoring Active';
    statusSubtext.textContent = 'Watching for new emails in real-time';
    startBtn.disabled = true;
    stopBtn.disabled = false;
  } else {
    statusDisplay.className = 'status-display stopped';
    statusIcon.textContent = '🔴';
    statusText.textContent = 'Monitoring Stopped';
    statusSubtext.textContent = 'Click start to begin monitoring';
    startBtn.disabled = false;
    stopBtn.disabled = true;
  }
}

function updateSettingsUI() {
  document.getElementById('summaryToggle').checked = settings.enableSummary;
  document.getElementById('voiceToggle').checked = settings.enableVoiceReading;
  document.getElementById('urgencyToggle').checked = settings.showUrgency; // Add this line
  document.getElementById('readTimeToggle').checked = settings.enableReadTime; // <-- ADD THIS LINE
  document.getElementById('summaryToggle').checked = settings.enableSummary;
  document.getElementById('voiceToggle').checked = settings.enableVoiceReading;
  document.getElementById('urgencyToggle').checked = settings.showUrgency;
  document.getElementById('readTimeToggle').checked = settings.enableReadTime;
  document.getElementById('speakSenderNameToggle').checked = settings.speakSenderName; 
  document.getElementById('speakSubjectToggle').checked = settings.speakSubject;   

  // Additionally, enable/disable sub-toggles based on voiceToggle state
  const voiceToggleState = document.getElementById('voiceToggle').checked; 
  document.getElementById('speakSenderNameToggle').disabled = !voiceToggleState;
  document.getElementById('speakSubjectToggle').disabled = !voiceToggleState;

  // Update Theme Radio Buttons
  const themeDark = document.getElementById('themeDark');
  const themeLight = document.getElementById('themeLight');
  const themeMidnight = document.getElementById('themeMidnight');

  if (settings.appearanceTheme === 'light') {
    themeLight.checked = true;
  } else if (settings.appearanceTheme === 'midnight') {
    themeMidnight.checked = true;
  } else { // Default to dark
    themeDark.checked = true;
  }
}

function setLoading(element, loading) {
  if (loading) {
    element.classList.add('loading');
    element.style.pointerEvents = 'none';
  } else {
    element.classList.remove('loading');
    element.style.pointerEvents = '';
  }
}

function showSuccessFlash(element) {
  element.classList.add('success-flash');
  setTimeout(() => element.classList.remove('success-flash'), 600);
}

async function loadSettings() {
  try {
    settings = await window.gmail.getSettings();
    updateSettingsUI();
    applyTheme(settings.appearanceTheme); // Apply initial theme
  } catch (error) {
    console.error('Error loading settings:', error);
    showNotification('Failed to load settings', 'error');
  }
}

async function saveSettings() {
  try {
    const summaryToggle = document.getElementById('summaryToggle');
    const voiceToggle = document.getElementById('voiceToggle');
    const urgencyToggle = document.getElementById('urgencyToggle'); // Add this
    const readTimeToggle = document.getElementById('readTimeToggle'); // <-- ADD THIS LINE
    const speakSenderNameToggle = document.getElementById('speakSenderNameToggle'); // <-- ADD THIS LINE
    const speakSubjectToggle = document.getElementById('speakSubjectToggle');     // <-- ADD THIS LINE
    
    settings.enableSummary = summaryToggle.checked;
    settings.enableVoiceReading = voiceToggle.checked;
    settings.showUrgency = urgencyToggle.checked; // Add this
    settings.enableReadTime = readTimeToggle.checked; 
    settings.speakSenderName = speakSenderNameToggle.checked; 
    settings.speakSubject = speakSubjectToggle.checked;

    // Save Appearance Theme
    if (document.getElementById('themeLight').checked) {
      settings.appearanceTheme = 'light';
    } else if (document.getElementById('themeMidnight').checked) {
      settings.appearanceTheme = 'midnight';
    } else {
      settings.appearanceTheme = 'dark';
    }
    
    await window.gmail.updateSettings(settings);
    showSuccessFlash(document.querySelector('.settings-panel'));
  } catch (error) {
    console.error('Error saving settings:', error);
    showNotification('Failed to save settings', 'error');
  }
}

async function checkEmail() {
  setLoading(checkBtn, true);
  
  try {
    const count = await window.gmail.checkNewMail();
    countNumber.textContent = count;
    showSuccessFlash(document.getElementById('emailCount'));
    
    // Update status temporarily
    const originalText = statusSubtext.textContent;
    statusSubtext.textContent = `Last check: ${new Date().toLocaleTimeString()}`;
    setTimeout(() => {
      if (statusSubtext.textContent.includes('Last check:')) {
        statusSubtext.textContent = originalText;
      }
    }, 3000);
    
  } catch (error) {
    console.error('Error checking email:', error);
    showNotification('Failed to check emails', 'error');
  } finally {
    setLoading(checkBtn, false);
  }
}

async function startMonitoring() {
  setLoading(startBtn, true);
  
  try {
    await window.gmail.startMonitoring();
    isMonitoring = true;
    updateUI();
    showSuccessFlash(statusDisplay);
  } catch (error) {
    console.error('Error starting monitoring:', error);
    showNotification('Failed to start monitoring', 'error');
  } finally {
    setLoading(startBtn, false);
  }
}

async function stopMonitoring() {
  setLoading(stopBtn, true);
  
  try {
    await window.gmail.stopMonitoring();
    isMonitoring = false;
    updateUI();
    showSuccessFlash(statusDisplay);
  } catch (error) {
    console.error('Error stopping monitoring:', error);
    showNotification('Failed to stop monitoring', 'error');
  } finally {
    setLoading(stopBtn, false);
  }
}

function showNotification(message, type = 'info') {
  // Create a temporary notification element
  const notification = document.createElement('div');
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 16px 20px;
    border-radius: 8px;
    color: white;
    font-weight: 600;
    z-index: 10000;
    animation: slideInRight 0.3s ease-out;
    max-width: 300px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.3);
  `;
  
  switch (type) {
    case 'error':
      notification.style.background = 'linear-gradient(135deg, #ef4444, #dc2626)';
      break;
    case 'success':
      notification.style.background = 'linear-gradient(135deg, #10b981, #059669)';
      break;
    default:
      notification.style.background = 'linear-gradient(135deg, #3b82f6, #2563eb)';
  }
  
  notification.textContent = message;
  document.body.appendChild(notification);
  
  // Add slide-in animation
  const style = document.createElement('style');
  style.textContent = `
    @keyframes slideInRight {
      from { transform: translateX(100%); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }
    @keyframes slideOutRight {
      from { transform: translateX(0); opacity: 1; }
      to { transform: translateX(100%); opacity: 0; }
    }
  `;
  document.head.appendChild(style);
  
  // Auto-remove after 4 seconds
  setTimeout(() => {
    notification.style.animation = 'slideOutRight 0.3s ease-in';
    setTimeout(() => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
      if (style.parentNode) {
        style.parentNode.removeChild(style);
      }
    }, 300);
  }, 4000);
}

// Event listeners
// New way to listen for email count updates
const cleanupEmailCountUpdate = window.gmail.on('email-count-update', (count) => {
  // The 'event' object is stripped by the preload wrapper, so 'count' is the first argument
  if (countNumber) {
    countNumber.textContent = count;

    // Add a subtle animation when count updates
  countNumber.style.transform = 'scale(1.1)';
  setTimeout(() => {
    countNumber.style.transform = 'scale(1)';
  }, 200);
}
});

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', async () => {
  // Initial UI update
  updateUI();
  
  // Load settings
  await loadSettings();
  
  // Set up smooth transitions
  countNumber.style.transition = 'transform 0.2s ease';
  
  // Settings event listeners with debouncing
  let saveTimeout;
  const debouncedSave = () => {
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(saveSettings, 300);
  };
  
  document.getElementById('summaryToggle').addEventListener('change', debouncedSave);
  // document.getElementById('voiceToggle').addEventListener('change', debouncedSave); // Original listener removed/modified below
  document.getElementById('urgencyToggle').addEventListener('change', debouncedSave);
  document.getElementById('readTimeToggle').addEventListener('change', debouncedSave); 
  document.getElementById('speakSenderNameToggle').addEventListener('change', debouncedSave); 
  document.getElementById('speakSubjectToggle').addEventListener('change', debouncedSave);

  // Theme Radio Button Listeners
  const themeDarkRadio = document.getElementById('themeDark');
  const themeLightRadio = document.getElementById('themeLight');
  const themeMidnightRadio = document.getElementById('themeMidnight');

  function handleThemeChange(themeValue) {
    // No need to update settings.appearanceTheme here, saveSettings will do it.
    debouncedSave();
    applyTheme(themeValue); // Call placeholder function
  }

  themeDarkRadio.addEventListener('change', () => {
    if (themeDarkRadio.checked) handleThemeChange('dark');
  });
  themeLightRadio.addEventListener('change', () => {
    if (themeLightRadio.checked) handleThemeChange('light');
  });
  themeMidnightRadio.addEventListener('change', () => {
    if (themeMidnightRadio.checked) handleThemeChange('midnight');
  });

  document.getElementById('voiceToggle').addEventListener('change', () => {
    // Update the settings object directly for immediate reflection in updateSettingsUI
    settings.enableVoiceReading = document.getElementById('voiceToggle').checked;
    // Update UI (this will handle disabling/enabling sub-toggles)
    updateSettingsUI();
    // Trigger save for all settings
    debouncedSave();
  });
  
  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey) {
      switch (e.key) {
        case 's':
          e.preventDefault();
          if (isMonitoring) {
            stopMonitoring();
          } else {
            startMonitoring();
          }
          break;
        case 'r':
          e.preventDefault();
          checkEmail();
          break;
      }
    }
  });
  
  // Auto-start monitoring on app load
  setTimeout(() => {
    if (!isMonitoring) {
      startMonitoring();
    }
  }, 1000);

  // Notifiable Authors
  addNotifiableAuthorBtn.addEventListener('click', handleAddAuthor);
  loadAndRenderNotifiableAuthors(); // Load and display the list on startup
});

// Cleanup on unload
window.addEventListener('beforeunload', () => {
  // window.gmail.removeAllListeners(); // This will now cause an error as it's not exposed
  if (typeof cleanupEmailCountUpdate === 'function') {
    cleanupEmailCountUpdate();
  }
  // If other .on listeners are added, their cleanup functions should be called here too.
});

// --- THEME APPLICATION LOGIC ---
function applyTheme(themeName) {
  console.log('Applying theme:', themeName);
  const selectedTheme = themes[themeName] || themes.dark; // Default to dark if theme not found

  for (const variable in selectedTheme) {
    document.documentElement.style.setProperty(variable, selectedTheme[variable]);
  }

  // Special handling for iframe text color based on theme
  // This is a simplified approach. A more robust solution might involve sending theme info to the iframe.
  // const iframeTextColor = (themeName === 'light') ? '#333333' : '#FFFFFF'; // Example: black for light, white for dark/midnight
  // Update IFRAME_BASE_CSS if it's used to style the iframe directly from renderer.js
  // However, the IFRAME_BASE_CSS in renderer.js is currently set for light background.
  // The actual email content styling is handled in main.js by `renderEmailHTML`.
  // We need to ensure main.js is aware of the theme to style the email iframe content appropriately.
  // For now, we'll focus on the main app theme. The iframe part will be addressed in step 4 if needed.
}

// --- NOTIFIABLE AUTHORS UI LOGIC ---

// Listener for displaying email content in the modal
window.gmail.on('display-email-in-modal', (event, emailData) => {
  if (emailPreviewFrame && emailPreviewModal && emailPreviewTitle) {
    console.log('Received email data for modal:', emailData.subject);
    const cssToUse = emailData.css; // IFRAME_BASE_CSS was removed
    if (!cssToUse) {
      console.warn("No CSS provided from main process for email display. Email might not render correctly.");
      // Optionally, show a notification to the user, though it might be noisy if it happens often.
    }
    emailPreviewFrame.srcdoc = (cssToUse || "") + emailData.html; // Use empty string if cssToUse is undefined
    emailPreviewTitle.textContent = emailData.subject || 'Email Preview';
    emailPreviewModal.style.display = 'block';
  } else {
    console.error('Email preview modal elements not found in renderer.js');
  }
});

// Listener for handling errors when trying to display email in modal
window.gmail.on('display-email-in-modal-error', (event, errorData) => {
  if (emailPreviewFrame && emailPreviewModal && emailPreviewTitle) {
    console.error('Received error for email modal:', errorData.error);
    emailPreviewTitle.textContent = 'Error Loading Email';
    // Display error message directly in the iframe for simplicity, or use showNotification
    emailPreviewFrame.srcdoc = `<div style="padding: 20px; font-family: sans-serif; color: red;">
                                 <h3>Could not load email content:</h3>
                                 <p>${errorData.error.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>
                               </div>`;
    emailPreviewModal.style.display = 'block';
  } else {
    // Fallback if modal elements aren't found, though unlikely
    showNotification(errorData.error || 'Failed to load email in preview.', 'error');
  }
});

function renderNotifiableAuthorsList(authors) {
  notifiableAuthorsListUL.innerHTML = ''; // Clear existing list items

  if (!authors || authors.length === 0) {
    noNotifiableAuthorsMsg.style.display = 'block';
    notifiableAuthorsListUL.style.display = 'none';
  } else {
    noNotifiableAuthorsMsg.style.display = 'none';
    notifiableAuthorsListUL.style.display = 'block';
    authors.forEach(email => {
      const listItem = document.createElement('li');
      listItem.style.display = 'flex';
      listItem.style.justifyContent = 'space-between';
      listItem.style.alignItems = 'center';
      listItem.style.padding = '10px 5px';
      listItem.style.borderBottom = '1px solid #f0f0f0';
      listItem.style.fontSize = '14px';
      listItem.style.color = '#444';

      const emailSpan = document.createElement('span');
      emailSpan.textContent = email;
      emailSpan.className = 'author-email'; // From index.html example

      const removeBtn = document.createElement('button');
      removeBtn.innerHTML = '<span>🗑️</span> Remove'; // Using innerHTML to include span for icon
      removeBtn.dataset.email = email;
      removeBtn.className = 'remove-author-btn'; // For potential shared styling
      // Applying styles similar to those in index.html example, can be moved to CSS
      removeBtn.style.background = 'linear-gradient(135deg, #ef4444, #dc2626)';
      removeBtn.style.color = 'white';
      removeBtn.style.border = 'none';
      removeBtn.style.borderRadius = '6px';
      removeBtn.style.padding = '6px 12px';
      removeBtn.style.fontSize = '12px';
      removeBtn.style.cursor = 'pointer';
      removeBtn.style.transition = 'background-color 0.2s ease';

      removeBtn.addEventListener('click', handleRemoveAuthor);

      listItem.appendChild(emailSpan);
      listItem.appendChild(removeBtn);
      notifiableAuthorsListUL.appendChild(listItem);
    });
  }
}

async function loadAndRenderNotifiableAuthors() {
  try {
    const authors = await window.gmail.getNotifiableAuthors(); // Assumes preload.js exposes this
    renderNotifiableAuthorsList(authors);
  } catch (error) {
    console.error('Error loading notifiable authors:', error);
    showNotification('Failed to load notifiable authors list.', 'error');
    renderNotifiableAuthorsList([]); // Render empty list on error
  }
}

async function handleAddAuthor() {
  const email = notifiableAuthorEmailInput.value.trim();
  if (!email) {
    showNotification('Please enter an email address.', 'error');
    return;
  }
  // Basic email validation regex
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    showNotification('Please enter a valid email address.', 'error');
    return;
  }

  setLoading(addNotifiableAuthorBtn, true);
  try {
    const result = await window.gmail.addNotifiableAuthor(email); // Assumes preload.js
    if (result.success) {
      notifiableAuthorEmailInput.value = ''; // Clear input
      renderNotifiableAuthorsList(result.authors);
      showNotification('Author added successfully!', 'success');
      showSuccessFlash(document.getElementById('notifiableAuthorsCard')); // Flash the card
    } else {
      showNotification(result.error || 'Failed to add author.', 'error');
    }
  } catch (error) {
    console.error('Error adding notifiable author:', error);
    showNotification('An error occurred while adding the author.', 'error');
  } finally {
    setLoading(addNotifiableAuthorBtn, false);
  }
}

async function handleRemoveAuthor(event) {
  // 'this' refers to the button clicked, or use event.currentTarget
  const buttonElement = event.currentTarget;
  const email = buttonElement.dataset.email;
  if (!email) return;

  setLoading(buttonElement, true); // Visually indicate loading on the button itself
  try {
    const result = await window.gmail.removeNotifiableAuthor(email); // Assumes preload.js
    if (result.success) {
      renderNotifiableAuthorsList(result.authors);
      showNotification('Author removed successfully!', 'success');
      showSuccessFlash(document.getElementById('notifiableAuthorsCard'));
    } else {
      showNotification(result.error || 'Failed to remove author.', 'error');
    }
  } catch (error) {
    console.error('Error removing notifiable author:', error);
    showNotification('An error occurred while removing the author.', 'error');
  } finally {
    // No need to setLoading(buttonElement, false) as the button will be re-rendered
    // If an error occurs and list isn't re-rendered, you might want to re-enable it.
    // However, renderNotifiableAuthorsList will typically redraw.
    // For safety, if the button might still exist after an error:
    if (buttonElement && buttonElement.parentElement) { // Check if button is still in DOM
         setLoading(buttonElement, false);
    }
  }
}