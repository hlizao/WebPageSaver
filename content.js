chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'extractPage') {
    extractPage().then(result => {
      sendResponse(result);
    }).catch(err => {
      sendResponse({ success: false, error: err.message });
    });
    return true;
  }
});