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

const btnThemeDark = document.getElementById('btnThemeDark');
const btnThemeLight = document.getElementById('btnThemeLight');
const btnThemeMidnight = document.getElementById('btnThemeMidnight');

// At the top of renderer.js, add new UI element references


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
  document.getElementById('urgencyToggle').checked = settings.showUrgency; // Add this line
  document.getElementById('readTimeToggle').checked = settings.enableReadTime; // <-- ADD THIS LINE
  document.getElementById('speakSenderNameToggle').checked = settings.speakSenderName; 
  document.getElementById('speakSubjectToggle').checked = settings.speakSubject;   

  updateActiveThemeButton(settings.appearanceTheme);
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
    const urgencyToggle = document.getElementById('urgencyToggle'); // Add this
    const readTimeToggle = document.getElementById('readTimeToggle'); // <-- ADD THIS LINE
    const speakSenderNameToggle = document.getElementById('speakSenderNameToggle'); // <-- ADD THIS LINE
    const speakSubjectToggle = document.getElementById('speakSubjectToggle');     // <-- ADD THIS LINE
    
    settings.enableSummary = summaryToggle.checked;
    settings.showUrgency = urgencyToggle.checked; // Add this
    settings.enableReadTime = readTimeToggle.checked; 
    settings.speakSenderName = speakSenderNameToggle.checked; 
    settings.speakSubject = speakSubjectToggle.checked;

    // settings.appearanceTheme is now set directly by button click handlers
    
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

  // New Theme Button Listeners
  if (btnThemeDark) { // Add checks to ensure elements exist
    btnThemeDark.addEventListener('click', () => {
      settings.appearanceTheme = 'dark';
      applyTheme('dark');
      saveSettings(); // Direct call, or debouncedSave if preferred
      updateActiveThemeButton('dark');
    });
  }

  if (btnThemeLight) {
    btnThemeLight.addEventListener('click', () => {
      settings.appearanceTheme = 'light';
      applyTheme('light');
      saveSettings();
      updateActiveThemeButton('light');
    });
  }

  if (btnThemeMidnight) {
    btnThemeMidnight.addEventListener('click', () => {
      settings.appearanceTheme = 'midnight';
      applyTheme('midnight');
      saveSettings();
      updateActiveThemeButton('midnight');
    });
  }
  
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
  if (typeof cleanupMainProcessLogs === 'function') {
    cleanupMainProcessLogs();
  }
});

// --- MAIN PROCESS LOG LISTENER ---
const cleanupMainProcessLogs = window.mainProcessLogs.onLog((logEntry) => {
  const { type, messages } = logEntry;
  const prefix = `[MAIN]`;
  switch (type) {
    case 'log':
      console.log(prefix, ...messages);
      break;
    case 'warn':
      console.warn(prefix, ...messages);
      break;
    case 'error':
      console.error(prefix, ...messages);
      break;
    case 'info':
      console.info(prefix, ...messages);
      break;
    case 'debug':
      console.debug(prefix, ...messages);
      break;
    default:
      console.log(`[MAIN - unknown type: ${type}]`, ...messages);
  }
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

function updateActiveThemeButton(themeName) {
  if (btnThemeDark) btnThemeDark.classList.remove('active');
  if (btnThemeLight) btnThemeLight.classList.remove('active');
  if (btnThemeMidnight) btnThemeMidnight.classList.remove('active');

  if (themeName === 'dark' && btnThemeDark) {
    btnThemeDark.classList.add('active');
  } else if (themeName === 'light' && btnThemeLight) {
    btnThemeLight.classList.add('active');
  } else if (themeName === 'midnight' && btnThemeMidnight) {
    btnThemeMidnight.classList.add('active');
  }
}

// --- NOTIFIABLE AUTHORS UI LOGIC ---

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