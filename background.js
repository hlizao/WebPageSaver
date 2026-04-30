try {
  importScripts('utils.js');
} catch (e) {
  console.error('importScripts failed:', e);
}

let currentSaveBaseDir = null;

chrome.downloads.onDeterminingFilename.addListener((downloadItem, suggest) => {
  if (currentSaveBaseDir && downloadItem.filename && downloadItem.filename.startsWith(currentSaveBaseDir + '/')) {
    suggest({ filename: downloadItem.filename, conflictAction: 'uniquify' });
  } else {
    suggest();
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'savePage') {
    (async () => {
      try {
        const result = await savePage(request.html, request.mediaUrls, request.baseDir, request.mediaDirName);
        sendResponse({ success: true, ...result });
      } catch (err) {
        sendResponse({ success: false, error: err.message || '保存失败' });
      }
    })();
    return true;
  }
});

async function savePage(html, mediaUrls, baseDir, mediaDirName) {
  currentSaveBaseDir = baseDir;

  let downloadedCount = 0;
  const total = mediaUrls.length;

  try {
    await notifyProgress(0, total, '开始下载资源...');

    const filenameMap = new Map();

    for (let i = 0; i < mediaUrls.length; i++) {
      const url = mediaUrls[i];

      try {
        await notifyProgress(i, total, getShortUrl(url));

        const blob = await fetchMediaWithRetry(url, 3);

        if (blob) {
          let filename = getLocalFilename(url);

          let uniqueName = filename;
          let counter = 1;
          while (filenameMap.has(uniqueName)) {
            const extIndex = filename.lastIndexOf('.');
            const name = extIndex > 0 ? filename.substring(0, extIndex) : filename;
            const ext = extIndex > 0 ? filename.substring(extIndex) : '';
            uniqueName = name + '_' + counter + ext;
            counter++;
          }
          filenameMap.set(uniqueName, true);

          const filePath = baseDir + '/' + mediaDirName + '/' + uniqueName;
          const dlId = await saveBlobToFile(blob, filePath, false);
          downloadedCount++;
        }
      } catch (err) {
        console.warn('跳过资源:', url, err);
      }

      await new Promise(r => setTimeout(r, 50));
    }

    await notifyProgress(total, total, '资源下载完成');

    return { downloadedCount };
  } finally {
    currentSaveBaseDir = null;
  }
}

async function fetchMediaWithRetry(url, maxRetries) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, { method: 'GET', credentials: 'include' });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return await response.blob();
    } catch (err) {
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, attempt * 1000));
      } else {
        throw err;
      }
    }
  }
  return null;
}

function saveBlobToFile(blob, filename, saveAs) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timeout')), 60000);
    try {
      const url = URL.createObjectURL(blob);
      chrome.downloads.download({
        url: url,
        filename: filename,
        saveAs: !!saveAs,
        conflictAction: 'uniquify'
      }, (downloadId) => {
        URL.revokeObjectURL(url);
        clearTimeout(timeout);
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(downloadId);
        }
      });
    } catch (err) {
      clearTimeout(timeout);
      reject(err);
    }
  });
}

async function notifyProgress(current, total, status) {
  try {
    await chrome.runtime.sendMessage({
      action: 'downloadProgress',
      current: current,
      total: total,
      status: status || ''
    });
  } catch (e) {}
}