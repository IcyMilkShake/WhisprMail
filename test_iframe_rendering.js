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
          background-color: #fff;
          word-wrap: break-word;
          overflow-wrap: break-word;
          /* width: 100%; // Keep if you want body to at least try to fill, but content can make it wider */
          /* max-width: 100%; // Remove this if body content is meant to define scrollable width */
          box-sizing: border-box;
          overflow-x: auto; /* CRITICAL: Re-enable horizontal scrolling for the body */
          /* overflow-y: auto; // Implicitly handled by default or can be added if needed */
        }
        a {
          color: #1a73e8;
          text-decoration: none;
        }
        a:hover {
          text-decoration: underline;
        }
        img {
          max-width: 100%; /* No !important. Allows inline style to override for wider images. */
          height: auto;    /* No !important. */
          display: block;
          margin: 5px 0;
        }
        p, div, li, blockquote {
            word-wrap: break-word;
            overflow-wrap: break-word;
        }
        table {
          table-layout: auto;  /* More natural for content-based sizing, allows tables to be wider than container */
          width: auto;         /* Let table determine its own width based on content */
                           /* Remove max-width: 100% if tables are meant to scroll horizontally */
          border-collapse: collapse;
          margin-bottom: 1em;
          /* word-wrap and overflow-wrap on table itself might be less effective than on cells */
        }
        td, th {
          border: 1px solid #ddd;
          padding: 8px;
          text-align: left;
          word-wrap: break-word;   /* Still important for content within cells */
          overflow-wrap: break-word;
          min-width: 0;          /* Still useful for flexible columns */
        }
        blockquote {
            border-left: 3px solid #ccc;
            padding-left: 10px;
            margin-left: 5px;
            color: #555;
            /* word-wrap and overflow-wrap are now handled by the p, div, li, blockquote rule */
        }
        pre {
          white-space: pre-wrap;
          word-wrap: break-word;
          overflow-x: auto; /* Allows horizontal scroll *within the pre block only* */
          background: #f4f4f4;
          padding: 10px;
          border-radius: 4px;
          max-width: 100%; /* The pre block itself tries to fit the container width */
          box-sizing: border-box;
        }
        ul, ol {
            padding-left: 20px;
        }

        /* Reset outlines to prevent browser default focus rings */
        div, h1, h2, h3, h4, h5, h6, p, span, li, td, th, a, img, figure, article, section, header, footer, nav, aside, button, input, select, textarea, label {
          outline: none !important;
          outline-style: none !important; /* Be explicit */
          -moz-outline-style: none !important; /* Firefox specific if needed */
        }
      </style>
    `;

let settings = {
  enableSummary: false, enableVoiceReading: true, enableReadTime: true,
  speakSenderName: true, speakSubject: true, huggingfaceToken: '', showUrgency: true
};

function getAttachmentIcon(mimeType) { return mimeType && mimeType.startsWith('image/') ? '🖼️' : '📄'; }
function formatFileSize(bytes) { return bytes ? (bytes / 1024).toFixed(1) + ' KB' : '0 B'; }

function createEnhancedNotificationHTML(emailData) {
  const notificationData = emailData;
  const senderInitial = (notificationData.from || "S").charAt(0).toUpperCase();
  let attachmentsHTML = '';
  if (notificationData.attachments && notificationData.attachments.length > 0) {
    attachmentsHTML = `<div class="attachments-section">...</div>`; // Simplified for brevity
  }
  let urgencyBadge = '';
  if (settings.showUrgency && notificationData.urgency === 'high') urgencyBadge = '<div class="urgency-badge high">🚨 Urgent</div>';
  else if (settings.showUrgency && notificationData.urgency === 'medium') urgencyBadge = '<div class="urgency-badge medium">⚠️ Important</div>';
  const readTimeBadge = settings.enableReadTime && notificationData.readTime ? `<div class="read-time-badge">📖 ${notificationData.readTime.minutes}m ${notificationData.readTime.seconds}s</div>` : '';
  const summaryBadge = notificationData.isSummary ? '<div class="summary-badge">🤖 AI Summary</div>' : '';
  const ocrBadge = notificationData.isOCRProcessed ? '<div class="ocr-badge">👁️ OCR Processed</div>' : '';
  const quickActionsHTML = `<div class="quick-actions">...</div>`; // Simplified

  const plainBodyForDisplay = notificationData.body || 'No preview available';
  let isPlainFallbackLong = !notificationData.bodyHtml && plainBodyForDisplay.length > 2000;

  let emailBodyDisplayHTML;
  if (notificationData.bodyHtml) {
    const sandboxRules = "allow-popups allow-scripts allow-same-origin";
    emailBodyDisplayHTML = `
      <div class="body-html-container" style="height: 200px; max-height: 200px; overflow: hidden; background-color: #fff; border: 1px solid #eee; border-radius: 4px;">
        <iframe srcdoc="${IFRAME_BASE_CSS}${notificationData.bodyHtml.replace(/"/g, '&quot;')}" style="width: 100%; height: 100%; border: none;" sandbox="${sandboxRules}"></iframe>
      </div>`;
  } else {
    emailBodyDisplayHTML = `<div class="body-text" style="max-height: 200px; overflow-y: auto; padding: 8px; background-color: #fff; border: 1px solid #eee; border-radius: 4px;">${plainBodyForDisplay}</div>`;
  }
  const indicatorText = '📄 Long email - click to view full content in main app';
  return `<!DOCTYPE html><html><head><style>/* Minimal CSS */</style></head><body>
      <div class="notification-container"><div class="main-content"><div class="avatar">${senderInitial}</div>
        <div class="content"><div class="header"><div class="sender">${notificationData.from}</div>
            <div class="badges">${urgencyBadge}${summaryBadge}${readTimeBadge}${ocrBadge}</div></div>
          <div class="subject">${notificationData.subject || 'No Subject'}</div>
          ${emailBodyDisplayHTML}
          ${isPlainFallbackLong ? `<div class="long-content-indicator">${indicatorText}</div>` : ''}
        </div></div>${attachmentsHTML}${quickActionsHTML}<button class="close-btn">×</button>
      </div><script> </script></body></html>`;
}

// --- Mock Email Data ---
const mockEmailBase = {
  from: "Sender", subject: "Test", attachments: [], id: "id1",
  tone: { label: "NEUTRAL", urgency: "low" }, readTime: { minutes: 1, seconds: 0 },
  isSummary: false, isOCRProcessed: false, urgency: "low",
};

const mockEmailWideImageScroll = { ...mockEmailBase, subject: "Wide Image Scroll",
  bodyHtml: "<p>Image below should cause horizontal scrolling:</p><img src='https_//via.placeholder.com/800x200' style='width: 800px; height: 200px;' alt='Wide Image'>",
  body: "Wide image designed to scroll."
};
const mockEmailWideTableScroll = { ...mockEmailBase, subject: "Wide Table Scroll",
  bodyHtml: "<p>Table below should cause horizontal scrolling:</p><table border='1' style='width: 700px;'><tr><td style='width:250px;'>Cell A1 - Some text</td><td style='width:250px;'>Cell A2 - Some more text</td><td style='width:200px;'>Cell A3</td></tr><tr><td>Cell B1</td><td>Cell B2</td><td>Cell B3</td></table>",
  body: "Wide table designed to scroll."
};
const mockEmailLongPreScroll = { ...mockEmailBase, subject: "Long Pre Scroll",
  bodyHtml: "<p>Preformatted text:</p><pre>This is a very long line of preformatted text that should not break the main layout and instead allow the pre block itself to scroll if necessary. This line just keeps going and going to test the overflow properties of the pre tag specifically.</pre>",
  body: "Long preformatted text."
};
const mockEmailNormalContentScroll = { ...mockEmailBase, subject: "Normal Content Scroll",
  bodyHtml: "<h1>Heading 1</h1><p>A paragraph with a <a>link</a>.</p><div>A div element.</div><h2>Heading 2</h2><ul><li>List item 1</li><li>List item 2</li></ul>",
  body: "Normal content with headings and lists."
};

const INDICATOR_TEXT_CONTENT = '📄 Long email - click to view full content in main app';

function runTests() {
  console.log("--- Starting Revised CSS Horizontal Scrolling Tests ---");

  testCase("Wide Image Scroll CSS", mockEmailWideImageScroll, (html, data) => {
    const srcDocContent = getSrcDoc(html);
    assert(srcDocContent.includes('body {') && srcDocContent.includes('overflow-x: auto;'), "Body CSS should have overflow-x: auto.");
    assert(srcDocContent.includes('img {') && srcDocContent.includes('max-width: 100%;') && !srcDocContent.includes('max-width: 100% !important'), "Image CSS should have max-width: 100% (no !important).");
    console.log("    Wide Image Scroll CSS: Passed");
  });

  testCase("Wide Table Scroll CSS", mockEmailWideTableScroll, (html, data) => {
    const srcDocContent = getSrcDoc(html);
    assert(srcDocContent.includes('body {') && srcDocContent.includes('overflow-x: auto;'), "Body CSS should have overflow-x: auto.");
    assert(srcDocContent.includes('table {') && srcDocContent.includes('table-layout: auto;') && srcDocContent.includes('width: auto;'), "Table CSS should have table-layout:auto and width:auto.");
    assert(!srcDocContent.match(/table\s*{[^}]*max-width:\s*100%\s*!important/), "Table CSS should NOT have max-width: 100% !important.");
    console.log("    Wide Table Scroll CSS: Passed");
  });

  testCase("Long Pre Scroll CSS", mockEmailLongPreScroll, (html, data) => {
    const srcDocContent = getSrcDoc(html);
    assert(srcDocContent.includes('pre {') && srcDocContent.includes('overflow-x: auto;') && srcDocContent.includes('max-width: 100%;'), "Pre CSS should have overflow-x:auto and max-width:100%.");
    console.log("    Long Pre Scroll CSS: Passed");
  });

  testCase("Normal Content (No Outline & No Scroll)", mockEmailNormalContentScroll, (html, data) => {
    const srcDocContent = getSrcDoc(html);
    assert(srcDocContent.includes('outline: none !important;'), "CSS for outline reset should be present.");
    // For normal content, we'd expect the body's overflow-x: auto to not actually show a scrollbar if content fits.
    // The key is that the CSS *allows* it rather than strictly forbids it.
    assert(srcDocContent.includes('body {') && srcDocContent.includes('overflow-x: auto;'), "Body CSS should have overflow-x: auto.");
    console.log("    Normal Content (No Outline & No Scroll): Passed");
  });

  console.log("\n--- All Revised CSS tests finished ---");
}

function getSrcDoc(htmlString) {
  const match = htmlString.match(/srcdoc="([^"]*)"/);
  return match ? match[1].replace(/&quot;/g, '"') : "";
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

runTests();
