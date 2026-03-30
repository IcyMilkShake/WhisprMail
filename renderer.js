let isMonitoring = true; // Starts automatically

// Update UI based on monitoring status
function updateUI() {
  const status = document.getElementById('status');
  const startBtn = document.getElementById('startBtn');
  const stopBtn = document.getElementById('stopBtn');
  
  if (isMonitoring) {
    status.textContent = '🟢 Monitoring active - Watching for new emails...';
    status.className = 'status monitoring';
    startBtn.disabled = true;
    stopBtn.disabled = false;
  } else {
    status.textContent = '🔴 Monitoring stopped';
    status.className = 'status stopped';
    startBtn.disabled = false;
    stopBtn.disabled = true;
  }
}

// Manual check function
async function checkEmail() {
  try {
    const count = await window.gmail.checkNewMail();
    alert(`You have ${count} unread messages.`);
    document.getElementById('emailCount').textContent = `Unread emails: ${count}`;
  } catch (err) {
    alert('Error: ' + err.message);
    console.error('Manual check error:', err);
  }
}

// Start monitoring
async function startMonitoring() {
  try {
    const result = await window.gmail.startMonitoring();
    console.log(result);
    isMonitoring = true;
    updateUI();
  } catch (err) {
    alert('Error starting monitoring: ' + err.message);
    console.error('Start monitoring error:', err);
  }
}

// Stop monitoring
async function stopMonitoring() {
  try {
    const result = await window.gmail.stopMonitoring();
    console.log(result);
    isMonitoring = false;
    updateUI();
  } catch (err) {
    alert('Error stopping monitoring: ' + err.message);
    console.error('Stop monitoring error:', err);
  }
}

// Listen for email count updates from main process
window.gmail.onEmailCountUpdate((event, count) => {
  document.getElementById('emailCount').textContent = `Unread emails: ${count}`;
});

// Initialize UI when page loads
document.addEventListener('DOMContentLoaded', () => {
  updateUI();
  console.log('📧 Gmail Monitor started!');
  console.log('💡 New emails will be logged here in real-time');
});