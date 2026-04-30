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
        const result = await savePage(request.html, request.mediaUrls, request.baseDir);
        sendResponse({ success: true, ...result });
      } catch (err) {
        sendResponse({ success: false, error: err.message || '保存失败' });
      }
    })();
    return true;
  }
});

async function savePage(html, mediaUrls, baseDir) {
  currentSaveBaseDir = baseDir;

  let downloadedCount = 0;
  const total = mediaUrls.length;

  try {
    await notifyProgress(0, total, `开始下载 ${total} 个资源...`);

    const filenameMap = new Map();

    for (let i = 0; i < mediaUrls.length; i++) {
      const url = mediaUrls[i];

      try {
        await notifyProgress(i, total, `正在下载: ${getShortUrl(url)}`);

        const blob = await fetchMediaWithRetry(url, 3);

        if (blob) {
          let filename = getLocalFilename(url);

          // deduplicate
          let uniqueName = filename;
          let counter = 1;
          while (filenameMap.has(uniqueName)) {
            const extIndex = filename.lastIndexOf('.');
            const name = extIndex > 0 ? filename.substring(0, extIndex) : filename;
            const ext = extIndex > 0 ? filename.substring(extIndex) : '';
            uniqueName = `${name}_${counter}${ext}`;
            counter++;
          }
          filenameMap.set(uniqueName, true);

          const filePath = `${baseDir}/media/${uniqueName}`;
          await saveBlobToFile(blob, filePath, false);
          downloadedCount++;
        }
      } catch (err) {
        console.warn(`跳过资源: ${url}`, err);
      }

      await delay(50);
    }

    await notifyProgress(total, total, '资源下载完成！');

    return { downloadedCount };
  } finally {
    currentSaveBaseDir = null;
  }
}

async function fetchMediaWithRetry(url, maxRetries) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'GET',
        credentials: 'include'
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.blob();
    } catch (err) {
      if (attempt < maxRetries) {
        const backoff = attempt * 1000;
        console.warn(`下载失败 (${attempt}/${maxRetries}): ${url}, ${backoff}ms 后重试`, err);
        await delay(backoff);
      } else {
        throw err;
      }
    }
  }
  return null;
}

function saveBlobToFile(blob, filename, saveAs = false) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('保存文件超时'));
    }, 30000);

    const reader = new FileReader();
    reader.onloadend = () => {
      try {
        const dataUrl = reader.result;
        chrome.downloads.download({
          url: dataUrl,
          filename: filename,
          saveAs: saveAs
        }, (downloadId) => {
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
    };
    reader.onerror = () => {
      clearTimeout(timeout);
      reject(reader.error);
    };
    reader.readAsDataURL(blob);
  });
}

async function notifyProgress(current, total, status) {
  try {
    await chrome.runtime.sendMessage({
      action: 'downloadProgress',
      current: current,
      total: total,
      status: status
    });
  } catch (e) {
    // popup may be closed
  }
}