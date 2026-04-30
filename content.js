chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'extractPage') {
    try { sendResponse(extractPage()); } catch (err) { sendResponse({ success: false, error: err.message }); }
    return true;
  }
});
