// full_email_renderer.js

document.addEventListener('DOMContentLoaded', () => {
  const subjectElement = document.getElementById('emailSubject');
  const iframeElement = document.getElementById('emailBodyFrame');

  if (!window.electronAPI || typeof window.electronAPI.onEmailDataForFullView !== 'function') {
    console.error('Electron API with "onEmailDataForFullView" method is not available! Check preload.js.');
    if (subjectElement) {
        subjectElement.textContent = 'Error: Preload script not configured correctly for email data.';
    }
    return;
  }

  const cleanupListener = window.electronAPI.onEmailDataForFullView((data) => {
    const { subject, bodyHtml, iframeBaseCss } = data;

    // Update window title
    document.title = subject || 'View Email';

    // Update subject header
    if (subjectElement) {
      subjectElement.textContent = subject || 'No Subject';
    } else {
      console.error('Subject element (emailSubject) not found.');
    }

    // Populate the iframe
    if (iframeElement) {
      if (bodyHtml && iframeBaseCss) {
        // Construct the srcdoc content. Ensure iframeBaseCss is properly wrapped in <style> tags.
        // The IFRAME_BASE_CSS string from main.js already includes <style> tags.
        const completeSrcDoc = `${iframeBaseCss}${bodyHtml}`;
        iframeElement.setAttribute('srcdoc', completeSrcDoc);
      } else {
        let errorMessage = '<p style="padding: 20px; color: #ccc;">Email content is unavailable.</p>';
        if (!iframeBaseCss) {
            errorMessage = '<p style="padding: 20px; color: #ccc;">Critical error: Base styles for email view are missing.</p>';
        }
        iframeElement.setAttribute('srcdoc', errorMessage);
        console.error('Missing bodyHtml or iframeBaseCss for rendering full email view.', data);
      }
    } else {
      console.error('Iframe element (emailBodyFrame) not found.');
    }
  });

  // Optional: Send a message to main that this renderer is ready for data,
  // if the main process wasn't already waiting for 'did-finish-load'.
  // This can be useful for more complex initialization sequences.
  // Example: if (window.electronAPI && typeof window.electronAPI.send === 'function') {
  //   window.electronAPI.send('full-email-renderer-ready');
  // }

  // Optional: If the window could be closed or re-purposed, call cleanupListener() on unload.
  // window.addEventListener('beforeunload', () => {
  //   if (cleanupListener) cleanupListener();
  //   window.electronAPI.removeAllEmailDataListeners?.(); // Or a more general cleanup
  // });
});
