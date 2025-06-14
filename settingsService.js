// Internal settings object with default values
let _settings = {
  enableSummary: false,
  enableVoiceReading: true,
  enableReadTime: true,
  speakSenderName: true,
  speakSubject: true,
  huggingfaceToken: process.env.HUGGINGFACE_TOKEN || '', // Get from env or default to empty
  showUrgency: true
};

// Returns a copy of the internal settings object
function getSettings() {
  return { ..._settings };
}

// Merges newSettings into the internal settings object and returns a copy
function updateSettings(newSettings) {
  if (newSettings && typeof newSettings === 'object') {
    _settings = { ..._settings, ...newSettings };
  }
  return { ..._settings };
}

module.exports = {
  getSettings,
  updateSettings
};
