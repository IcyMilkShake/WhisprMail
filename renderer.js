let isMonitoring = false;
let settings = {
  enableSummary: false,
  enableVoiceReading: true,
  showUrgency: true,
  enableReadTime: true,
  speakSenderName: true,
  speakSubject: true
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
const notifiableAuthorsListUL = document.getElementById('notifiableAuthorsList');
const noNotifiableAuthorsMsg = document.getElementById('noNotifiableAuthorsMsg');

const viewAllBtn = document.getElementById('viewAllBtn');
const emailPreviewModal = document.getElementById('emailPreviewModal');
const closeEmailPreviewModal = document.getElementById('closeEmailPreviewModal');
const emailPreviewFrame = document.getElementById('emailPreviewFrame');
const emailPreviewTitle = document.getElementById('emailPreviewTitle');

// IFRAME_BASE_CSS has been removed from here. It will be fetched from main.js.

if (viewAllBtn) {
  viewAllBtn.addEventListener('click', async () => {
    setLoading(viewAllBtn, true);
    try {
      // Fetch email HTML content and base CSS concurrently
      const [emailResult, iframeBaseCss] = await Promise.all([
        window.gmail.invoke('get-latest-email-html'),
        window.gmail.invoke('get-iframe-base-css')
      ]);

      if (!iframeBaseCss) {
        console.error('Failed to fetch IFRAME_BASE_CSS from main process.');
        showNotification('Error loading email preview: Could not load base styles.', 'error');
        emailPreviewFrame.srcdoc = ''; // Clear frame
        return; // Exit if base CSS is missing
      }

      if (emailResult && emailResult.success && emailResult.html) {
        // CSS from get-latest-email-html (result.css) is for specific email styling (if any)
        // IFRAME_BASE_CSS (iframeBaseCss) is the foundational style.
        // The task implies IFRAME_BASE_CSS is the one to be fetched and used.
        // If get-latest-email-html also returned a specific CSS for that email, it could be combined.
        // For now, assuming iframeBaseCss is the primary one.
        emailPreviewFrame.srcdoc = iframeBaseCss + emailResult.html;
        emailPreviewModal.style.display = 'block';
      } else if (emailResult && emailResult.error) {
        showNotification(result.error, 'error');
        emailPreviewFrame.srcdoc = ''; // Clear frame on error
      } else {
        showNotification('No email content found or an unknown error occurred.', 'info');
        emailPreviewFrame.srcdoc = ''; // Clear frame
      }
    } catch (error) {
      console.error('Error fetching latest email HTML:', error);
      showNotification('Failed to fetch email preview: ' + error.message, 'error');
      emailPreviewFrame.srcdoc = ''; // Clear frame on critical error
    } finally {
      setLoading(viewAllBtn, false);
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
  document.getElementById('urgencyToggle').checked = settings.showUrgency;
  document.getElementById('readTimeToggle').checked = settings.enableReadTime;
  document.getElementById('speakSenderNameToggle').checked = settings.speakSenderName;
  document.getElementById('speakSubjectToggle').checked = settings.speakSubject;

  // Additionally, enable/disable sub-toggles based on voiceToggle state
  const voiceToggleState = document.getElementById('voiceToggle').checked;
  document.getElementById('speakSenderNameToggle').disabled = !voiceToggleState;
  document.getElementById('speakSubjectToggle').disabled = !voiceToggleState;
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
    settings.enableReadTime = readTimeToggle.checked; // <-- ADD THIS LINE
    settings.speakSenderName = speakSenderNameToggle.checked; // <-- ADD THIS LINE
    settings.speakSubject = speakSubjectToggle.checked;     // <-- ADD THIS LINE
    
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
  
  // Animations are now in a global stylesheet injected at DOMContentLoaded
  
  // Auto-remove notification element after 4 seconds
  setTimeout(() => {
    notification.style.animation = 'slideOutRight 0.3s ease-in forwards'; // Added 'forwards' to keep end state
    // Wait for animation to finish before removing the element
    setTimeout(() => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
      // The global style tag is no longer removed here
    }, 300); // This timeout should match the animation duration
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
  // Inject global animation styles for notifications once
  const globalNotificationStyles = document.createElement('style');
  globalNotificationStyles.id = 'dynamic-notification-styles'; // Assign an ID
  globalNotificationStyles.textContent = `
    @keyframes slideInRight {
      from { transform: translateX(100%); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }
    @keyframes slideOutRight {
      from { transform: translateX(0); opacity: 1; }
      to { transform: translateX(100%); opacity: 0; }
    }
  `;
  document.head.appendChild(globalNotificationStyles);

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
  document.getElementById('urgencyToggle').addEventListener('change', debouncedSave);
  document.getElementById('readTimeToggle').addEventListener('change', debouncedSave); 
  document.getElementById('speakSenderNameToggle').addEventListener('change', debouncedSave);
  document.getElementById('speakSubjectToggle').addEventListener('change', debouncedSave);

  document.getElementById('voiceToggle').addEventListener('change', () => {
    settings.enableVoiceReading = document.getElementById('voiceToggle').checked;
    updateSettingsUI(); // Update UI, which handles disabling/enabling sub-toggles
    debouncedSave(); // Trigger save for all settings
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

// --- NOTIFIABLE AUTHORS UI LOGIC ---

// Listener for displaying email content in the modal
window.gmail.on('display-email-in-modal', async (event, emailData) => { // Made async
  if (emailPreviewFrame && emailPreviewModal && emailPreviewTitle) {
    console.log('Received email data for modal:', emailData.subject);
    try {
      const iframeBaseCss = await window.gmail.invoke('get-iframe-base-css');
      if (!iframeBaseCss) {
        console.error('Failed to fetch IFRAME_BASE_CSS for modal display.');
        showNotification('Error displaying email: Could not load base styles.', 'error');
        emailPreviewFrame.srcdoc = `<p>Error: Could not load styles.</p>`;
        emailPreviewTitle.textContent = emailData.subject || 'Email Preview';
        emailPreviewModal.style.display = 'block';
        return;
      }
      // Assuming emailData.css is for specific email styles and iframeBaseCss is foundational.
      // If emailData.css exists, it might be intended to be used *with* or *instead of* part of iframeBaseCss.
      // For this task, we prioritize using the fetched iframeBaseCss.
      // If emailData.html already includes necessary styling or if emailData.css is comprehensive,
      // this logic might need adjustment. Current interpretation: iframeBaseCss + emailData.html.
      const finalCss = emailData.css ? iframeBaseCss + emailData.css : iframeBaseCss; // Example of combining if needed
      emailPreviewFrame.srcdoc = finalCss + emailData.html;
      emailPreviewTitle.textContent = emailData.subject || 'Email Preview';
      emailPreviewModal.style.display = 'block';
    } catch (error) {
      console.error('Error fetching IFRAME_BASE_CSS for modal:', error);
      showNotification('Error displaying email: Failed to load styles. ' + error.message, 'error');
      emailPreviewFrame.srcdoc = `<p>Error: ${error.message}</p>`;
      emailPreviewTitle.textContent = emailData.subject || 'Email Preview';
      emailPreviewModal.style.display = 'block';
    }
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