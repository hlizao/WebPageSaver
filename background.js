try { importScripts('utils.js'); } catch (e) {}

chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  sendResponse({});
});