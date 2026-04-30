try { importScripts('utils.js'); } catch (e) {}

let currentBaseDir = null;

chrome.downloads.onDeterminingFilename.addListener((downloadItem, suggest) => {
  if (currentBaseDir && downloadItem.filename && downloadItem.filename.startsWith(currentBaseDir + '/')) {
    suggest({ filename: downloadItem.filename, conflictAction: 'uniquify' });
  } else {
    suggest();
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'setBaseDir') {
    currentBaseDir = request.baseDir;
    sendResponse({});
  } else if (request.action === 'clearBaseDir') {
    currentBaseDir = null;
    sendResponse({});
  }
});