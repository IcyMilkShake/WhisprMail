const assert = require('assert');

// --- Copied/Re-defined dependencies from main.js for testing ---

const IFRAME_BASE_CSS = `
      <style>
        body {
          margin: 10px;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;
          font-size: 14px;
          line-height: 1.5;
          color: #333;
          background-color: #fff; /* Ensure a background color */
          overflow: auto; /* Enable scrolling within the iframe's body */
          word-wrap: break-word;
        }
        a {
          color: #1a73e8;
          text-decoration: none;
        }
        a:hover {
          text-decoration: underline;
        }
        img {
          max-width: 100%;
          height: auto;
          display: block; /* Helps with spacing */
          margin: 5px 0;
        }
        p, div, li, th, td {
            /* Ensure text within common block elements also wraps */
            word-wrap: break-word;
            overflow-wrap: break-word;
        }
        table {
            border-collapse: collapse;
            width: auto;
            max-width: 100%;
            margin-bottom: 1em;
        }
        th, td {
            border: 1px solid #ddd;
            padding: 8px;
            text-align: left;
        }
        blockquote {
            border-left: 3px solid #ccc;
            padding-left: 10px;
            margin-left: 5px;
            color: #555;
        }
        pre {
            white-space: pre-wrap;
            word-wrap: break-word;
            background: #f4f4f4;
            padding: 10px;
            border-radius: 4px;
            overflow: auto;
        }
        ul, ol {
            padding-left: 20px;
        }
      </style>
    `;

let settings = {
  enableSummary: false,
  enableVoiceReading: true,
  enableReadTime: true,
  speakSenderName: true,
  speakSubject: true,
  huggingfaceToken: '',
  showUrgency: true
};

function getAttachmentIcon(mimeType) {
  if (!mimeType) return '📄';
  if (mimeType.startsWith('image/')) return '🖼️';
  return '📄';
}

function formatFileSize(bytes) {
  if (!bytes) return '0 B';
  return (bytes / 1024).toFixed(1) + ' KB';
}

// Copied createEnhancedNotificationHTML function from main.js
function createEnhancedNotificationHTML(emailData) {
  const notificationData = emailData;

  const senderInitial = (notificationData.from || "S").charAt(0).toUpperCase();

  let attachmentsHTML = '';
  if (notificationData.attachments && notificationData.attachments.length > 0) {
    const attachmentItems = notificationData.attachments.map(attachment => {
      const isImage = attachment.mimeType && attachment.mimeType.startsWith('image/');
      const icon = getAttachmentIcon(attachment.mimeType);
      const sizeStr = formatFileSize(attachment.size);

      return `
        <div class="attachment-item" data-message-id="${notificationData.id}" data-attachment-id="${attachment.attachmentId}" data-filename="${attachment.filename}">
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
          <span class="attachments-title">📎 ${notificationData.attachments.length} Attachment${notificationData.attachments.length > 1 ? 's' : ''}</span>
        </div>
        <div class="attachments-list">
          ${attachmentItems}
        </div>
      </div>
    `;
  }

  let urgencyBadge = '';
  if (settings.showUrgency) {
    if (notificationData.urgency === 'high') {
      urgencyBadge = '<div class="urgency-badge high">🚨 Urgent</div>';
    } else if (notificationData.urgency === 'medium') {
      urgencyBadge = '<div class="urgency-badge medium">⚠️ Important</div>';
    }
  }

  const readTimeBadge = settings.enableReadTime && notificationData.readTime ?
    `<div class="read-time-badge">📖 ${notificationData.readTime.minutes}m ${notificationData.readTime.seconds}s</div>` : '';

  const summaryBadge = notificationData.isSummary
    ? '<div class="summary-badge">🤖 AI Summary</div>'
    : '';

  const ocrBadge = notificationData.isOCRProcessed ?
    '<div class="ocr-badge">👁️ OCR Processed</div>' : '';

  const quickActionsHTML = `
    <div class="quick-actions">
      <button class="quick-btn mark-as-read" data-message-id="${notificationData.id}">
        <span class="btn-icon">✓</span>
        <span class="btn-text">Mark Read</span>
      </button>
      <button class="quick-btn trash" data-message-id="${notificationData.id}">
        <span class="btn-icon">🗑️</span>
        <span class="btn-text">Delete</span>
      </button>
      <button class="quick-btn star" data-message-id="${notificationData.id}">
        <span class="btn-icon">⭐</span>
        <span class="btn-text">Star</span>
      </button>
    </div>
  `;

  const plainBodyForDisplay = notificationData.body || 'No preview available';
  let isPlainFallbackLong = false;
  if (!notificationData.bodyHtml && plainBodyForDisplay.length > 2000) {
      isPlainFallbackLong = true;
  }

  let emailBodyDisplayHTML;
  if (notificationData.bodyHtml) {
    const sandboxRules = "allow-popups allow-scripts allow-same-origin";
    emailBodyDisplayHTML = `
      <div class="body-html-container" style="height: 200px; max-height: 200px; overflow: hidden; background-color: #fff; border: 1px solid #eee; border-radius: 4px;">
        <iframe
          srcdoc="${IFRAME_BASE_CSS}${notificationData.bodyHtml.replace(/"/g, '&quot;')}"
          style="width: 100%; height: 100%; border: none;"
          sandbox="${sandboxRules}"
        ></iframe>
      </div>
    `;
  } else {
    emailBodyDisplayHTML = `<div class="body-text" style="max-height: 200px; overflow-y: auto; padding: 8px; background-color: #fff; border: 1px solid #eee; border-radius: 4px;">${plainBodyForDisplay}</div>`;
  }

  const indicatorText = '📄 Long email - click to view full content in main app';
  const finalHTML = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        /* Minimal CSS for structure testing; main.js has the full CSS */
        .body-html-container { height: 200px; max-height: 200px; overflow: hidden; background-color: #fff; border: 1px solid #eee; border-radius: 4px; flex-grow: 1; min-height: 0; }
        .body-text { color: #555; font-size: 13px; line-height: 1.5; flex: 1; overflow-y: auto; word-wrap: break-word; white-space: pre-wrap; max-height: 200px; padding-right: 8px; background-color: #fff; border: 1px solid #eee; border-radius: 4px; padding: 10px; }
        .long-content-indicator { text-align: center; padding: 8px; font-size: 11px; color: #718096; font-style: italic; }
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
            ${isPlainFallbackLong ? `<div class="long-content-indicator">${indicatorText}</div>` : ''}
          </div>
        </div>
        ${attachmentsHTML}
        ${quickActionsHTML}
        <button class="close-btn" onclick="closeNotification()">×</button>
      </div>
      <script> </script>
    </body>
    </html>
  `;
  return finalHTML;
}

const mockEmailBase = {
  from: "Sender Name",
  fromEmail: "sender@example.com",
  subject: "Test Subject",
  attachments: [],
  id: "test-email-id",
  tone: { label: "NEUTRAL", score: 0.5, urgency: "low" },
  readTime: { minutes: 1, seconds: 30, totalSeconds: 90, wordCount: 150 },
  isSummary: false,
  isOCRProcessed: false,
  urgency: "low",
};

const mockEmailSimpleHTML = {
  ...mockEmailBase,
  subject: "Simple HTML",
  bodyHtml: "<p>This is <b>bold</b>. Visit <a href='http://example.com'>example.com</a>.</p><ul><li>Item 1</li><li>Item 2</li></ul>",
  body: "This is bold. Visit example.com. Item 1 Item 2"
};

const mockEmailStyledHTML = {
  ...mockEmailBase,
  subject: "Styled HTML",
  bodyHtml: "<div style='color: blue; font-family: Arial, sans-serif;'><p>This is styled text.</p><img src='https://via.placeholder.com/150'></div>",
  body: "This is styled text."
};

const mockEmailLongHTML = {
  ...mockEmailBase,
  subject: "Long HTML",
  bodyHtml: "<p>Line 1</p>".repeat(50),
  body: "Line 1...".repeat(10)
};

const mockEmailPlainTextOnly = {
  ...mockEmailBase,
  subject: "Plain Long Text",
  bodyHtml: null,
  body: "This is plain text only, quite long to test the fallback indicator. ".repeat(100)
};

const mockEmailPlainTextOnlyShort = {
  ...mockEmailBase,
  subject: "Plain Short Text",
  bodyHtml: "",
  body: "This is short plain text."
};

const mockEmailWithScript = {
  ...mockEmailBase,
  subject: "HTML with Script",
  bodyHtml: "<p>Test</p><script>console.log('SCRIPT_TEST_IN_IFRAME');</script>",
  body: "Test"
};

const INDICATOR_TEXT_CONTENT = '📄 Long email - click to view full content in main app';

function runTests() {
  console.log("--- Starting iframe rendering tests (with corrected assertions) ---");

  testCase("Simple HTML Email", mockEmailSimpleHTML, (html, data) => {
    assert(html.includes('<iframe'), "Should contain an iframe.");
    assert(html.includes('srcdoc="'), "iframe should have srcdoc attribute.");
    assert(html.includes(IFRAME_BASE_CSS), "srcdoc should contain IFRAME_BASE_CSS.");
    assert(html.includes(data.bodyHtml.replace(/"/g, '&quot;')), "srcdoc should contain the escaped bodyHtml.");
    assert(html.includes('sandbox="allow-popups allow-scripts allow-same-origin"'), "iframe should have correct sandbox attribute.");
    assert(!html.includes(INDICATOR_TEXT_CONTENT), "Indicator TEXT should NOT be present for HTML email.");
    console.log("    Simple HTML Email: Passed");
  });

  testCase("Styled HTML Email", mockEmailStyledHTML, (html, data) => {
    assert(html.includes('<iframe'), "Should contain an iframe.");
    assert(html.includes(data.bodyHtml.replace(/"/g, '&quot;')), "srcdoc should contain the styled HTML.");
    assert(html.includes("<img src='https://via.placeholder.com/150'>"), "Image tag should be present in srcdoc");
    assert(!html.includes(INDICATOR_TEXT_CONTENT), "Indicator TEXT should NOT be present for HTML email.");
    console.log("    Styled HTML Email: Passed");
  });

  testCase("Long HTML Email (for scrolling)", mockEmailLongHTML, (html, data) => {
    assert(html.includes('<iframe'), "Should contain an iframe.");
    assert(html.includes(data.bodyHtml.replace(/"/g, '&quot;')), "srcdoc should contain the long HTML.");
    assert(html.includes('<div class="body-html-container" style="height: 200px; max-height: 200px; overflow: hidden;'), "Container div with correct style for fixed height should be present.");
    assert(!html.includes(INDICATOR_TEXT_CONTENT), "Indicator TEXT should NOT be present for HTML email.");
    console.log("    Long HTML Email: Passed");
  });

  testCase("Plain Text Only Email (Long)", mockEmailPlainTextOnly, (html, data) => {
    assert(!html.includes('<iframe'), "Should NOT contain an iframe.");
    assert(html.includes('<div class="body-text"'), "Should contain a div with class 'body-text'.");
    assert(html.includes('style="max-height: 200px; overflow-y: auto; padding: 8px; background-color: #fff; border: 1px solid #eee; border-radius: 4px;"'), "Fallback body-text div has correct styling.");
    assert(html.includes(data.body), "body-text div should contain the plain text body.");
    assert(html.includes(INDICATOR_TEXT_CONTENT), "Indicator TEXT SHOULD be present for long plain text fallback.");
    console.log("    Plain Text Only Email (Long): Passed");
  });

  testCase("Plain Text Only Email (Short)", mockEmailPlainTextOnlyShort, (html, data) => {
    assert(!html.includes('<iframe'), "Should NOT contain an iframe for short plain text.");
    assert(html.includes('<div class="body-text"'), "Should contain a div with class 'body-text' for short plain text.");
    assert(html.includes(data.body), "body-text div should contain the short plain text body.");
    assert(!html.includes(INDICATOR_TEXT_CONTENT), "Indicator TEXT should NOT be present for short plain text fallback.");
    console.log("    Plain Text Only Email (Short): Passed");
  });

  testCase("HTML Email with Script Tag", mockEmailWithScript, (html, data) => {
    assert(html.includes('<iframe'), "Should contain an iframe for script tag test.");
    const expectedScriptTag = "<script>console.log('SCRIPT_TEST_IN_IFRAME');</script>";
    assert(html.includes(expectedScriptTag), "srcdoc should contain the script tag as is from bodyHtml.");
    assert(html.includes('sandbox="allow-popups allow-scripts allow-same-origin"'), "iframe should have 'allow-scripts' in sandbox.");
    assert(!html.includes(INDICATOR_TEXT_CONTENT), "Indicator TEXT should NOT be present for HTML email with script.");
    console.log("    HTML Email with Script Tag: Passed");
  });

  console.log("\n--- CSS and Styling Logic Review (Conceptual based on code) ---");
  reviewCSS();

  console.log("\n--- All iframe rendering tests finished ---");
}

function testCase(name, mockData, validationFn) {
  console.log(`\n  Testing: ${name}`);
  try {
    const htmlOutput = createEnhancedNotificationHTML(mockData);
    validationFn(htmlOutput, mockData);
  } catch (e) {
    console.error(`    ${name}: Failed!`);
    console.error(e.message);
    if (e.stack) console.error(e.stack);
  }
}

function reviewCSS() {
  console.log("  Reviewing IFRAME_BASE_CSS:");
  assert(IFRAME_BASE_CSS.includes('body {'), "IFRAME_BASE_CSS: body style exists.");
  assert(IFRAME_BASE_CSS.includes('overflow: auto;'), "IFRAME_BASE_CSS: body has overflow: auto for scrollability.");
  assert(IFRAME_BASE_CSS.includes('word-wrap: break-word;'), "IFRAME_BASE_CSS: body has word-wrap: break-word.");
  assert(IFRAME_BASE_CSS.includes('img {'), "IFRAME_BASE_CSS: img style exists.");
  assert(IFRAME_BASE_CSS.includes('max-width: 100%;'), "IFRAME_BASE_CSS: img has max-width: 100%.");
  assert(IFRAME_BASE_CSS.includes('height: auto;'), "IFRAME_BASE_CSS: img has height: auto.");
  console.log("    IFRAME_BASE_CSS seems to cover basic scrollability, responsive images, and typography.");

  const sampleHtmlOutput = createEnhancedNotificationHTML(mockEmailSimpleHTML);
  console.log("\n  Reviewing iframe container styles (div.body-html-container):");
  assert(sampleHtmlOutput.includes('<div class="body-html-container" style="height: 200px; max-height: 200px; overflow: hidden;'),
    "Container div should have fixed height and overflow: hidden.");
  console.log("    body-html-container styles seem correct for fixed height and hidden overflow.");

  console.log("\n  Reviewing fallback .body-text styles:");
  const plainTextOutput = createEnhancedNotificationHTML(mockEmailPlainTextOnlyShort);
  assert(plainTextOutput.includes('class="body-text" style="max-height: 200px; overflow-y: auto; padding: 8px; background-color: #fff; border: 1px solid #eee; border-radius: 4px;"'),
    "Fallback .body-text has appropriate styling for scrolling and appearance.");
  console.log("    Fallback .body-text styles seem correct.");
}

runTests();
