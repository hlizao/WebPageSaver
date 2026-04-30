try { importScripts('utils.js'); } catch (e) {}

var currentBaseDir = null;

chrome.downloads.onDeterminingFilename.addListener(function(downloadItem, suggest) {
  if (currentBaseDir && downloadItem.filename && downloadItem.filename.indexOf(currentBaseDir + '/') === 0) {
    suggest({ filename: downloadItem.filename, conflictAction: 'uniquify' });
  } else {
    suggest();
  }
});

chrome.runtime.onConnect.addListener(function(port) {
  if (port.name === 'keepAlive') {
    port.onDisconnect.addListener(function() {});
  }
});

chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  if (request.action === 'saveFile') {
    downloadMedia(request.url, request.filePath)
      .then(function(id) { sendResponse({ success: true, id: id }); })
      .catch(function(err) { sendResponse({ success: false, error: err.message }); });
    return true;
  }
  if (request.action === 'startBatch') {
    currentBaseDir = request.baseDir;
    sendResponse({});
    return true;
  }
  if (request.action === 'endBatch') {
    currentBaseDir = null;
    sendResponse({});
    return true;
  }
});

async function downloadMedia(url, filePath) {
  var blob = await fetchWithRetry(url, 3);
  return await saveBlobToFile(blob, filePath, false);
}

async function fetchWithRetry(url, maxRetries) {
  for (var attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      var response = await fetch(url, { method: 'GET', credentials: 'include' });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return await response.blob();
    } catch (err) {
      if (attempt < maxRetries) {
        await new Promise(function(r) { setTimeout(r, attempt * 1000); });
      } else {
        throw err;
      }
    }
  }
  return null;
}

function saveBlobToFile(blob, filename, saveAs) {
  return new Promise(function(resolve, reject) {
    var timeout = setTimeout(function() { reject(new Error('Timeout')); }, 120000);
    try {
      var url = URL.createObjectURL(blob);
      chrome.downloads.download({
        url: url,
        filename: filename,
        saveAs: !!saveAs,
        conflictAction: 'uniquify'
      }, function(downloadId) {
        URL.revokeObjectURL(url);
        clearTimeout(timeout);
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(downloadId);
      });
    } catch (err) {
      clearTimeout(timeout);
      reject(err);
    }
  });
}