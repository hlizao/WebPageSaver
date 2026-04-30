try { importScripts('utils.js'); } catch (e) {}

chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  if (request.action === 'downloadFile') {
    downloadOneFile(request.url, request.filePath)
      .then(function(success) { sendResponse({ success: success }); })
      .catch(function() { sendResponse({ success: false }); });
    return true;
  }
  if (request.action === 'setBaseDir') {
    currentBaseDir = request.baseDir;
    sendResponse({});
  }
  if (request.action === 'clearBaseDir') {
    currentBaseDir = null;
    sendResponse({});
  }
});

var currentBaseDir = null;

chrome.downloads.onDeterminingFilename.addListener(function(downloadItem, suggest) {
  if (currentBaseDir && downloadItem.filename && downloadItem.filename.indexOf(currentBaseDir + '/') === 0) {
    suggest({ filename: downloadItem.filename, conflictAction: 'uniquify' });
  } else {
    suggest();
  }
});

async function downloadOneFile(url, filePath) {
  var ok = await tryDirect(url, filePath);
  if (ok) return true;
  ok = await tryFetchBlob(url, filePath);
  return ok;
}

function tryDirect(url, filePath) {
  return new Promise(function(resolve) {
    try {
      chrome.downloads.download({
        url: url,
        filename: filePath,
        saveAs: false,
        conflictAction: 'uniquify'
      }, function(id) {
        if (chrome.runtime.lastError) resolve(false);
        else resolve(true);
      });
    } catch (e) {
      resolve(false);
    }
  });
}

async function tryFetchBlob(url, filePath) {
  try {
    var response = await fetch(url, { method: 'GET', credentials: 'include' });
    if (!response.ok) return false;
    var blob = await response.blob();
    return await saveBlob(blob, filePath);
  } catch (e) {
    return false;
  }
}

function saveBlob(blob, filePath) {
  return new Promise(function(resolve) {
    try {
      var objUrl = URL.createObjectURL(blob);
      chrome.downloads.download({
        url: objUrl,
        filename: filePath,
        saveAs: false,
        conflictAction: 'uniquify'
      }, function(id) {
        URL.revokeObjectURL(objUrl);
        if (chrome.runtime.lastError) resolve(false);
        else resolve(true);
      });
    } catch (e) {
      resolve(false);
    }
  });
}