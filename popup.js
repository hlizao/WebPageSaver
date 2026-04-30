var saveBtn = document.getElementById('saveBtn');
var openFolderBtn = document.getElementById('openFolderBtn');
var newSaveBtn = document.getElementById('newSaveBtn');
var progressArea = document.getElementById('progressArea');
var progressFill = document.getElementById('progressFill');
var progressLabel = document.getElementById('progressLabel');
var progressPct = document.getElementById('progressPct');
var statusText = document.getElementById('statusText');
var resultBanner = document.getElementById('resultBanner');
var resultText = document.getElementById('resultText');
var resultIcon = document.getElementById('resultIcon');
var statMedia = document.getElementById('statMedia');
var statImages = document.getElementById('statImages');
var statOthers = document.getElementById('statOthers');

var ROOT_DIR = 'WebPageSaver';
var pendingData = null;
var savedDownloadId = null;
var keepAlivePort = null;

document.addEventListener('DOMContentLoaded', function() {
  saveBtn.addEventListener('click', handleSaveClick);
  openFolderBtn.addEventListener('click', handleOpenFolder);
  newSaveBtn.addEventListener('click', function() {
    resetUI();
    handleSaveClick();
  });
});

function startKeepAlive() {
  try {
    keepAlivePort = chrome.runtime.connect({ name: 'keepAlive' });
    keepAlivePort.onDisconnect.addListener(function() { keepAlivePort = null; });
  } catch (e) {}
}

function stopKeepAlive() {
  if (keepAlivePort) {
    try { keepAlivePort.disconnect(); } catch (e) {}
    keepAlivePort = null;
  }
}

async function handleSaveClick() {
  resetUI();
  setSaving(true);
  setStatus('正在提取页面内容...');

  try {
    var tab = (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
    if (!tab) throw new Error('无法获取当前标签页');

    var sp = checkSpecialPage(tab.url);
    if (sp.isSpecial) throw new Error(sp.reason);

    var response;
    try {
      response = await chrome.tabs.sendMessage(tab.id, { action: 'extractPage' });
    } catch (err) {
      if (err.message && err.message.indexOf('Receiving end does not exist') >= 0) {
        response = await injectAndExtract(tab.id);
      } else {
        throw err;
      }
    }

    if (!response || !response.success) throw new Error(response ? response.error : '页面提取失败');

    var total = response.mediaUrls.length;
    var imgCount = response.mediaUrls.filter(function(u) {
      var ext = u.split('?')[0].split('.').pop().toLowerCase();
      return ['jpg','jpeg','png','gif','webp','svg','bmp','ico','avif'].indexOf(ext) >= 0;
    }).length;
    statMedia.textContent = total;
    statImages.textContent = imgCount;
    statOthers.textContent = total - imgCount;

    var pageName = sanitizeFileName(response.title || tab.title || '未命名页面');
    var mediaDirName = pageName + '_media';
    var htmlFileName = ROOT_DIR + '/' + pageName + '.html';

    showProgress(true);
    setProgress(0, total + 1);
    setProgressLabel('正在保存 HTML 文件...');

    var htmlBlob = new Blob([response.html], { type: 'text/html;charset=utf-8' });
    var htmlUrl = URL.createObjectURL(htmlBlob);
    var htmlId = await new Promise(function(resolve, reject) {
      chrome.downloads.download({
        url: htmlUrl,
        filename: htmlFileName,
        saveAs: false,
        conflictAction: 'uniquify'
      }, function(id) {
        URL.revokeObjectURL(htmlUrl);
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(id);
      });
    });
    savedDownloadId = htmlId;

    setProgress(1, total + 1);

    if (total === 0) {
      setProgressLabel('保存完成');
      showResult('success', '保存成功！HTML 文件已下载（页面无媒体资源）');
      openFolderBtn.classList.remove('hidden');
      newSaveBtn.classList.remove('hidden');
      return;
    }

    setProgressLabel('已保存 HTML，开始下载 ' + total + ' 个媒体资源...');
    setStatus('正在下载 0 / ' + total);

    startKeepAlive();
    await chrome.runtime.sendMessage({ action: 'startBatch', baseDir: ROOT_DIR });

    var downloadedCount = 0;
    var filenameMap = new Map();

    for (var i = 0; i < total; i++) {
      var url = response.mediaUrls[i];
      try {
        setProgressLabel('下载 (' + (i + 1) + '/' + total + '): ' + getShortUrl(url));
        setStatus('正在下载 ' + (i + 1) + ' / ' + total);

        var filename = getLocalFilename(url);
        var uniqueName = filename;
        var counter = 1;
        while (filenameMap.has(uniqueName)) {
          var extIdx = filename.lastIndexOf('.');
          var name = extIdx > 0 ? filename.substring(0, extIdx) : filename;
          var ext = extIdx > 0 ? filename.substring(extIdx) : '';
          uniqueName = name + '_' + counter + ext;
          counter++;
        }
        filenameMap.set(uniqueName, true);

        var filePath = ROOT_DIR + '/' + mediaDirName + '/' + uniqueName;

        var result = await chrome.runtime.sendMessage({
          action: 'saveFile',
          url: url,
          filePath: filePath
        });

        if (result && result.success) downloadedCount++;
      } catch (err) {
        console.warn('跳过:', url, err);
      }

      setProgress(i + 2, total + 1);
    }

    await chrome.runtime.sendMessage({ action: 'endBatch' });
    stopKeepAlive();

    setProgress(total + 1, total + 1);
    setProgressLabel('保存完成');
    showResult('success', '保存成功！HTML 文件 + ' + downloadedCount + ' 个资源已下载');
    openFolderBtn.classList.remove('hidden');
    newSaveBtn.classList.remove('hidden');

  } catch (err) {
    showResult('error', err.message || '保存过程中发生错误');
    try { await chrome.runtime.sendMessage({ action: 'endBatch' }); } catch (e) {}
    stopKeepAlive();
  } finally {
    setSaving(false);
    pendingData = null;
  }
}

async function handleOpenFolder() {
  if (savedDownloadId) {
    try {
      chrome.downloads.search({ id: savedDownloadId }, function(items) {
        if (items && items.length > 0) {
          var htmlPath = items[0].filename;
          var dir = htmlPath.substring(0, htmlPath.lastIndexOf('/'));
          chrome.downloads.search({
            filenameRegex: '^' + dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '.*'
          }, function(mediaItems) {
            if (mediaItems && mediaItems.length > 0) {
              chrome.downloads.show(mediaItems[mediaItems.length - 1].id);
            } else {
              chrome.downloads.show(savedDownloadId);
            }
          });
        } else {
          chrome.downloads.show(savedDownloadId);
        }
      });
    } catch (e) {
      chrome.downloads.show(savedDownloadId);
    }
  }
}

function resetUI() {
  progressFill.style.width = '0%';
  progressPct.textContent = '0%';
  showProgress(false);
  setStatus('就绪');
  hideResult();
  openFolderBtn.classList.add('hidden');
  newSaveBtn.classList.add('hidden');
  statMedia.textContent = '-';
  statImages.textContent = '-';
  statOthers.textContent = '-';
  savedDownloadId = null;
}

function setSaving(active) {
  saveBtn.disabled = active;
  if (active) {
    saveBtn.innerHTML = '<span class="spinner"></span><span>保存中...</span>';
  } else {
    saveBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" style="width:18px;height:18px"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg><span>保存当前网页</span>';
  }
}

function setStatus(t) { statusText.textContent = t; }
function showProgress(v) { progressArea.classList.toggle('active', v); }

function setProgress(cur, total) {
  var pct = total > 0 ? Math.round((cur / total) * 100) : 0;
  progressFill.style.width = pct + '%';
  progressPct.textContent = pct + '%';
}

function setProgressLabel(t) { progressLabel.textContent = t; }

function showResult(type, msg) {
  resultBanner.className = 'result-banner visible ' + type;
  resultText.textContent = msg;
  if (type === 'success') {
    resultIcon.innerHTML = '<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>';
  } else {
    resultIcon.innerHTML = '<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>';
  }
}

function hideResult() {
  resultBanner.className = 'result-banner';
  resultText.textContent = '';
}

async function injectAndExtract(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId: tabId },
    files: ['shared.js', 'page-extractor.js']
  });
  var results = await chrome.scripting.executeScript({
    target: { tabId: tabId },
    func: async function() { return await extractPage(); }
  });
  if (results && results[0] && results[0].result) return results[0].result;
  throw new Error('页面提取失败：注入后仍无法执行提取');
}