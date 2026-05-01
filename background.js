try { importScripts('utils.js'); } catch (e) {}

var PROBE_URL = 'https://www.google.com/favicon.ico';
var probeCallbacks = {};

chrome.downloads.onChanged.addListener(function(delta) {
  if (probeCallbacks[delta.id]) {
    probeCallbacks[delta.id](delta);
    delete probeCallbacks[delta.id];
  }
});

chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  if (request.action === 'checkProbe') {
    chrome.downloads.download({
      url: PROBE_URL,
      filename: request.filename,
      saveAs: false
    }, function(id) {
      if (chrome.runtime.lastError) {
        sendResponse({ success: false });
      } else {
        var timer = setTimeout(function() {
          if (probeCallbacks[id]) {
            delete probeCallbacks[id];
            sendResponse({ success: false, probeId: id });
          }
        }, 3000);
        probeCallbacks[id] = function(delta) {
          clearTimeout(timer);
          if (delta.state && delta.state.current === 'complete') {
            sendResponse({ success: true, probeId: id });
          } else if (delta.state && delta.state.current === 'interrupted') {
            sendResponse({ success: false, probeId: id });
          }
        };
      }
    });
    return true;
  }
  sendResponse({});
});