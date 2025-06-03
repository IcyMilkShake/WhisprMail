let isMonitoring = false;
let settings = {
  enableSummary: false,
  enableVoiceReading: true,
  showUrgency: true // Add this line, defaulting to true
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
    
    settings.enableSummary = summaryToggle.checked;
    settings.enableVoiceReading = voiceToggle.checked;
    settings.showUrgency = urgencyToggle.checked; // Add this
    
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
window.gmail.onEmailCountUpdate((event, count) => {
  countNumber.textContent = count;
  
  // Add a subtle animation when count updates
  countNumber.style.transform = 'scale(1.1)';
  setTimeout(() => {
    countNumber.style.transform = 'scale(1)';
  }, 200);
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
  document.getElementById('voiceToggle').addEventListener('change', debouncedSave);
  document.getElementById('urgencyToggle').addEventListener('change', debouncedSave);
  
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
});

// Cleanup on unload
window.addEventListener('beforeunload', () => {
  window.gmail.removeAllListeners();
});