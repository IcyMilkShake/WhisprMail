const fs = require('fs');
const path = require('path');
const { Buffer } = require('buffer'); // Ensure Buffer is explicitly imported if used for base64 decoding

// Fetches new emails from the Gmail API.
async function getNewEmails(gmail, monitoringStartTime) {
  if (!gmail) {
    console.error("Gmail API client not provided to getNewEmails.");
    return [];
  }
  try {
    const query = monitoringStartTime
      ? `is:unread after:${Math.floor(monitoringStartTime / 1000)}`
      : 'is:unread';

    const res = await gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults: 50 // Keep a reasonable limit
    });
    return res.data.messages || [];
  } catch (error) {
    console.error("Error fetching new emails:", error.message);
    // Check for specific error types, e.g., authentication issues
    if (error.code === 401) {
        console.error("Authentication error in getNewEmails. Token might be invalid.");
        // Potentially trigger re-authentication or notify user
    }
    return [];
  }
}

// Extracts the sender's name from the 'From' header.
function extractSenderName(fromHeader) {
  try {
    if (!fromHeader) return 'Unknown Sender';
    // Match display name and email, e.g., "John Doe" <john.doe@example.com>
    const match = fromHeader.match(/^(.*?)\s*<(.+?)>$/);
    if (match && match[1]) {
      // Remove quotes around the name if present
      return match[1].replace(/^['"]|['"]$/g, '').trim();
    }
    // Fallback: if no <> format, try to extract the part before @ or the whole string
    const emailPart = fromHeader.includes('@') ? fromHeader.split('@')[0] : fromHeader;
    return emailPart.replace(/^['"]|['"]$/g, '').trim();
  } catch (error) {
    console.error('Error extracting sender name:', error);
    return 'Unknown Sender'; // Fallback on error
  }
}

// Processes the email payload to extract text, HTML content, and attachments.
function processEmailContent(payload) {
  let textContent = '';
  let htmlContent = '';
  let attachments = [];

  function extractContent(part) {
    if (!part) return;

    if (part.parts) {
      part.parts.forEach(extractContent);
    } else {
      const mimeType = part.mimeType?.toLowerCase();
      const bodyData = part.body?.data;

      if (bodyData) { // Ensure data exists
        if (mimeType === 'text/plain') {
          if (textContent === '') { // Prioritize the first plain text part found
            textContent += Buffer.from(bodyData, 'base64').toString('utf-8');
          }
        } else if (mimeType === 'text/html') {
          if (htmlContent === '') { // Prioritize the first HTML part found
            htmlContent += Buffer.from(bodyData, 'base64').toString('utf-8');
          }
        }
      }
      // Attachment processing
      if (part.filename && part.body?.attachmentId) {
        attachments.push({
          filename: part.filename,
          mimeType: part.mimeType || 'application/octet-stream', // Default MIME type
          attachmentId: part.body.attachmentId,
          size: part.body.size || 0 // Default size
        });
      }
    }
  }

  // Handle cases where the body is directly in the payload (not in parts array)
  if (payload?.body?.data) {
    const mimeType = payload.mimeType?.toLowerCase();
    if (mimeType === 'text/plain' && !textContent) {
      textContent = Buffer.from(payload.body.data, 'base64').toString('utf-8');
    } else if (mimeType === 'text/html' && !htmlContent) {
      htmlContent = Buffer.from(payload.body.data, 'base64').toString('utf-8');
    }
  }

  // If there are parts, prioritize content extracted from them
  if (payload?.parts) {
    extractContent(payload);
  }

  // If HTML content is present but no plain text, create a basic plain text version.
  if (htmlContent && !textContent) {
    let rawBody = htmlContent;
    rawBody = rawBody
      .replace(/<style([\s\S]*?)<\/style>/gi, '')
      .replace(/<script([\s\S]*?)<\/script>/gi, '')
      .replace(/<\/div>|<\/li>|<\/p>|<br\s*\/?>/gi, '\n')
      .replace(/<li>/ig, '  *  ')
      .replace(/<[^>]+>/ig, ''); // Strip other HTML tags
    textContent = rawBody.replace(/\s+/g, ' ').trim(); // Normalize whitespace
  }

  // Basic cleanup for text content
  textContent = textContent.replace(/\[image:.*?\]/gi, '').replace(/\s+/g, ' ').trim();

  return { textContent, htmlContent, attachments };
}

// Marks an email as read.
async function markAsRead(gmail, messageId) {
  if (!gmail) throw new Error("Gmail API client not provided to markAsRead.");
  try {
    await gmail.users.messages.modify({
      userId: 'me',
      id: messageId,
      resource: { removeLabelIds: ['UNREAD'] }
    });
    console.log(`Successfully marked email ${messageId} as read.`);
    return { success: true, messageId };
  } catch (error) {
    console.error(`Mark as read failed for ${messageId}:`, error.message);
    return { success: false, error: error.message, messageId, code: error.code };
  }
}

// Moves an email to trash.
async function moveToTrash(gmail, messageId) {
  if (!gmail) throw new Error("Gmail API client not provided to moveToTrash.");
  try {
    await gmail.users.messages.trash({ userId: 'me', id: messageId });
    console.log(`Successfully moved email ${messageId} to trash.`);
    return { success: true, messageId };
  } catch (error) {
    console.error(`Move to trash failed for ${messageId}:`, error.message);
    return { success: false, error: error.message, messageId, code: error.code };
  }
}

// Toggles the 'STARRED' label on an email.
async function toggleStarEmail(gmail, messageId) {
  if (!gmail) throw new Error("Gmail API client not provided to toggleStarEmail.");
  try {
    const message = await gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'metadata',
      fields: 'labelIds' // Only fetch labelIds
    });
    const isStarred = (message.data.labelIds || []).includes('STARRED');
    const resource = isStarred ? { removeLabelIds: ['STARRED'] } : { addLabelIds: ['STARRED'] };
    await gmail.users.messages.modify({ userId: 'me', id: messageId, resource });
    console.log(`Successfully ${isStarred ? 'unstarred' : 'starred'} email ${messageId}.`);
    return { success: true, starred: !isStarred, messageId };
  } catch (error) {
    console.error(`Toggle star failed for ${messageId}:`, error.message);
    return { success: false, error: error.message, messageId, code: error.code };
  }
}

// Downloads an attachment to a temporary directory and opens it.
async function downloadAttachment(gmail, app, shell, messageId, attachmentId, filename) {
  if (!gmail) throw new Error("Gmail API client not provided to downloadAttachment.");
  if (!app || !shell) throw new Error("Electron app/shell objects not provided to downloadAttachment.");

  try {
    const attachment = await gmail.users.messages.attachments.get({
      userId: 'me',
      messageId,
      id: attachmentId
    });
    const data = Buffer.from(attachment.data.data, 'base64');

    // Use app.getPath('temp') for temporary storage
    const tempDir = path.join(app.getPath('temp'), 'email-attachments');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    // Sanitize filename (basic example, consider more robust sanitization)
    const safeFilename = filename.replace(/[^a-z0-9._-]/gi, '_');
    const filePath = path.join(tempDir, safeFilename);

    fs.writeFileSync(filePath, data);
    shell.openPath(filePath); // Opens the file with the default application
    console.log(`Attachment ${safeFilename} downloaded and opened from ${filePath}`);
    return filePath;
  } catch (error) {
    console.error('Error downloading attachment:', error.message);
    throw error; // Re-throw to be handled by the caller (e.g., IPC handler)
  }
}

module.exports = {
  getNewEmails,
  extractSenderName,
  processEmailContent,
  markAsRead,
  moveToTrash,
  toggleStarEmail,
  downloadAttachment
};
