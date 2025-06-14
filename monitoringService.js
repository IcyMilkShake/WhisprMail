let isMonitoring = false;
let knownEmailIds = new Set();
let monitoringStartTime = null;
let checkIntervalId = null;

// To store dependencies injected from main.js
let dependencies = {
  gmail: null,
  emailService: null,
  processNewEmailIdCallback: null,
  updateEmailCountCallback: null,
};

// Initialize the service with dependencies from main.js
function init(deps) {
  dependencies.gmail = deps.gmail;
  dependencies.emailService = deps.emailService;
  dependencies.processNewEmailIdCallback = deps.processNewEmailIdCallback;
  dependencies.updateEmailCountCallback = deps.updateEmailCountCallback;
  console.log('Monitoring service initialized with dependencies.');
}

async function checkForNewEmails() {
  if (!dependencies.gmail || !isMonitoring || !dependencies.emailService) {
    return;
  }

  try {
    const newEmails = await dependencies.emailService.getNewEmails(dependencies.gmail, monitoringStartTime);
    const unseenEmailIds = newEmails.filter(email => !knownEmailIds.has(email.id)).map(email => email.id);

    if (unseenEmailIds.length > 0) {
      console.log(`Found ${unseenEmailIds.length} new emails.`);
      unseenEmailIds.forEach(id => knownEmailIds.add(id));

      for (const emailId of unseenEmailIds) {
        if (dependencies.processNewEmailIdCallback) {
          await dependencies.processNewEmailIdCallback(emailId); // Settings no longer passed
        }
      }
    }

    if (dependencies.updateEmailCountCallback) {
      // Get current total unread count for the badge
      const currentUnreadMessages = await dependencies.emailService.getNewEmails(dependencies.gmail, null); // null to get all unread
      dependencies.updateEmailCountCallback(currentUnreadMessages.length);
    }
  } catch (error) {
    console.error('Error checking for new emails in monitoringService:', error);
  }
}

async function startMonitoring() {
  if (isMonitoring) {
    return 'Monitoring is already active.';
  }
  if (!dependencies.gmail || !dependencies.emailService) {
    return 'Gmail service or EmailService not initialized. Cannot start monitoring.';
  }

  console.log('Starting email monitoring...');
  isMonitoring = true;
  monitoringStartTime = Date.now();
  knownEmailIds.clear();

  try {
    // Initial population of knownEmailIds and UI update
    const initialEmails = await dependencies.emailService.getNewEmails(dependencies.gmail, null); // Get all unread initially
    if (initialEmails) {
      initialEmails.forEach(email => knownEmailIds.add(email.id));
      console.log(`Initialized monitoring with ${knownEmailIds.size} existing unread emails.`);
      if (dependencies.updateEmailCountCallback) {
        dependencies.updateEmailCountCallback(initialEmails.length);
      }
    }
  } catch (error) {
    console.error('Error during initial email check for monitoring:', error);
    // Don't necessarily stop monitoring here, but log the error
  }

  // Clear previous interval if any (should not happen if logic is correct)
  if (checkIntervalId) {
    clearInterval(checkIntervalId);
  }
  checkIntervalId = setInterval(checkForNewEmails, 10000); // Check every 10 seconds

  return 'Email monitoring started successfully.';
}

function stopMonitoring() {
  if (!isMonitoring) {
    return 'Monitoring is not active.';
  }
  console.log('Stopping email monitoring...');
  isMonitoring = false;
  if (checkIntervalId) {
    clearInterval(checkIntervalId);
    checkIntervalId = null;
  }
  monitoringStartTime = null;
  // knownEmailIds.clear(); // Optionally clear this, or keep for context if restarted
  return 'Email monitoring stopped.';
}

function getIsMonitoring() {
  return isMonitoring;
}

module.exports = {
  init,
  startMonitoring,
  stopMonitoring,
  getIsMonitoring
  // checkForNewEmails is internal and not exported
};
