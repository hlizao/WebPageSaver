try { importScripts('utils.js'); } catch (e) {}

var FALLBACK_PROBE_URL = 'https://www.google.com/favicon.ico';

chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  if (request.action === 'checkProbe') {
    var pageOrigin = request.pageUrl ? getOrigin(request.pageUrl) : null;
    var probeUrl = pageOrigin ? pageOrigin + '/favicon.ico' : FALLBACK_PROBE_URL;
    var probePath = 'WebPageSaver/_probe_' + Date.now() + '.tmp';

    var resolved = false;
    var downloadId = null;

    var listener = function(delta) {
      if (downloadId === null || delta.id !== downloadId) return;
      if (delta.state) {
        if (delta.state.current === 'complete') finish(true);
        else if (delta.state.current === 'interrupted') finish(false);
      }
    };
    chrome.downloads.onChanged.addListener(listener);

    var timeout = setTimeout(function() { finish(false); }, 3000);

    function finish(ok) {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      chrome.downloads.onChanged.removeListener(listener);
      if (downloadId != null) {
        try { chrome.downloads.removeFile(downloadId); } catch (e) {}
        try { chrome.downloads.erase({ id: downloadId }); } catch (e) {}
      }
      sendResponse({ success: ok, probeId: downloadId });
    }

    chrome.downloads.download({
      url: probeUrl,
      filename: probePath,
      saveAs: false,
      conflictAction: 'overwrite'
    }, function(id) {
      if (chrome.runtime.lastError || !id) { finish(false); return; }
      downloadId = id;
      chrome.downloads.search({ id: id }, function(results) {
        if (results && results.length > 0) {
          if (results[0].state === 'complete') finish(true);
          else if (results[0].state === 'interrupted') finish(false);
        }
      });
    });

    return true;
  }

  if (request.action === 'downloadByUrl') {
    var fetchUrl = request.url;
    var filePath = request.filename;

    fetch(fetchUrl, { method: 'GET', credentials: 'include' }).then(function(resp) {
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      return resp.blob();
    }).then(function(blob) {
      var url = URL.createObjectURL(blob);
      chrome.downloads.download({
        url: url,
        filename: filePath,
        saveAs: false,
        conflictAction: 'uniquify'
      }, function(id) {
        URL.revokeObjectURL(url);
        if (chrome.runtime.lastError) {
          sendResponse({ success: false, error: chrome.runtime.lastError.message });
        } else {
          sendResponse({ success: true, downloadId: id });
        }
      });
    }).catch(function(err) {
      chrome.downloads.download({
        url: fetchUrl,
        filename: filePath,
        saveAs: false,
        conflictAction: 'uniquify'
      }, function(id) {
        if (chrome.runtime.lastError) {
          sendResponse({ success: false, error: chrome.runtime.lastError.message });
        } else {
          sendResponse({ success: true, downloadId: id });
        }
      });
    });
    return true;
  }

  sendResponse({});
});

function getOrigin(url) {
  try {
    var u = new URL(url);
    return u.origin;
  } catch (e) {
    return null;
  }
}