try { importScripts('utils.js'); } catch (e) {}

chrome.downloads.onDeterminingFilename.addListener(function(downloadItem, suggest) {
  suggest();
});

chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  if (request.action === 'savePage') {
    savePage(request.html, request.title, request.mediaUrls)
      .then(function(result) { sendResponse(result); })
      .catch(function(err) { sendResponse({ success: false, error: err.message }); });
    return true;
  }
});

async function savePage(html, title, mediaUrls) {
  var pageName = sanitizeFileName(title || 'unnamed_page');
  var mediaDir = pageName + '_media';
  var ROOT = 'WebPageSaver';
  var htmlName = ROOT + '/' + pageName + '.html';

  await notify('progress', { current: 0, total: mediaUrls.length + 1, status: '正在保存 HTML 文件...' });

  var htmlId = await downloadDataUrl(html, htmlName);

  await notify('progress', { current: 1, total: mediaUrls.length + 1, status: 'HTML 保存完成，开始下载媒体资源...' });

  var downloadedCount = 0;
  var nameSet = new Set();

  for (var i = 0; i < mediaUrls.length; i++) {
    var url = mediaUrls[i];
    try {
      await notify('progress', {
        current: i + 1,
        total: mediaUrls.length + 1,
        status: '下载 (' + (i + 1) + '/' + mediaUrls.length + '): ' + getShortUrl(url)
      });

      var shortName = getLocalFilename(url);
      var uniqueName = shortName;
      var counter = 1;
      while (nameSet.has(uniqueName)) {
        var dot = shortName.lastIndexOf('.');
        var base = dot > 0 ? shortName.substring(0, dot) : shortName;
        var ext = dot > 0 ? shortName.substring(dot) : '';
        uniqueName = base + '_' + counter + ext;
        counter++;
      }
      nameSet.add(uniqueName);

      var filePath = ROOT + '/' + mediaDir + '/' + uniqueName;

      var ok = await tryDownloadDirect(url, filePath);
      if (!ok) {
        ok = await tryDownloadBlob(url, filePath);
      }
      if (ok) downloadedCount++;
    } catch (e) {
      console.warn('跳过:', url, e.message);
    }
  }

  await notify('progress', {
    current: mediaUrls.length + 1,
    total: mediaUrls.length + 1,
    status: '保存完成'
  });

  return { success: true, downloadedCount: downloadedCount, htmlId: htmlId };
}

function tryDownloadDirect(url, filePath) {
  return new Promise(function(resolve) {
    try {
      chrome.downloads.download({
        url: url,
        filename: filePath,
        saveAs: false,
        conflictAction: 'uniquify'
      }, function(id) {
        if (chrome.runtime.lastError) {
          resolve(false);
        } else {
          resolve(true);
        }
      });
    } catch (e) {
      resolve(false);
    }
  });
}

async function tryDownloadBlob(url, filePath) {
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

function downloadDataUrl(html, filePath) {
  return new Promise(function(resolve, reject) {
    try {
      var selfUrl = self.location ? self.location.href : '';
      var blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      var objUrl = URL.createObjectURL(blob);
      chrome.downloads.download({
        url: objUrl,
        filename: filePath,
        saveAs: false,
        conflictAction: 'uniquify'
      }, function(id) {
        URL.revokeObjectURL(objUrl);
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(id);
      });
    } catch (e) {
      reject(e);
    }
  });
}

function notify(action, data) {
  try {
    chrome.runtime.sendMessage({ action: action, data: data });
  } catch (e) {}
}