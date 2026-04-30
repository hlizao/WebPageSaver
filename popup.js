const saveBtn = document.getElementById('saveBtn');
const openFolderBtn = document.getElementById('openFolderBtn');
const newSaveBtn = document.getElementById('newSaveBtn');
const progressArea = document.getElementById('progressArea');
const progressFill = document.getElementById('progressFill');
const progressLabel = document.getElementById('progressLabel');
const progressPct = document.getElementById('progressPct');
const statusText = document.getElementById('statusText');
const resultBanner = document.getElementById('resultBanner');
const resultText = document.getElementById('resultText');
const resultIcon = document.getElementById('resultIcon');
const statMedia = document.getElementById('statMedia');
const statImages = document.getElementById('statImages');
const statOthers = document.getElementById('statOthers');

const ROOT_DIR = 'WebPageSaver';
let pendingData = null;
let savedDownloadId = null;

document.addEventListener('DOMContentLoaded', () => {
  saveBtn.addEventListener('click', handleSaveClick);
  openFolderBtn.addEventListener('click', handleOpenFolder);
  newSaveBtn.addEventListener('click', () => {
    resetUI();
    handleSaveClick();
  });
});

async function handleSaveClick() {
  resetUI();
  setSaving(true);
  setStatus('正在提取页面内容...');

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) throw new Error('无法获取当前标签页');

    const special = checkSpecialPage(tab.url);
    if (special.isSpecial) throw new Error(special.reason);

    let response;
    try {
      response = await chrome.tabs.sendMessage(tab.id, { action: 'extractPage' });
    } catch (err) {
      if (err.message && err.message.includes('Receiving end does not exist')) {
        response = await injectAndExtract(tab.id);
      } else {
        throw err;
      }
    }

    if (!response || !response.success) {
      throw new Error(response?.error || '页面提取失败');
    }

    // Show stats
    const total = response.mediaUrls.length;
    const imgCount = response.mediaUrls.filter(u => {
      const ext = u.split('?')[0].split('.').pop().toLowerCase();
      return ['jpg','jpeg','png','gif','webp','svg','bmp','ico','avif'].includes(ext);
    }).length;
    statMedia.textContent = total;
    statImages.textContent = imgCount;
    statOthers.textContent = total - imgCount;

    const pageName = sanitizeFileName(response.title || tab.title || '未命名页面');
    const mediaDirName = pageName + '_media';
    const htmlFileName = ROOT_DIR + '/' + pageName + '.html';

    pendingData = {
      html: response.html,
      mediaUrls: response.mediaUrls,
      baseDir: ROOT_DIR,
      mediaDirName: mediaDirName
    };

    showProgress(true);
    setProgress(0, total + 1);
    setProgressLabel('正在保存 HTML 文件...');

    const htmlBlob = new Blob([response.html], { type: 'text/html;charset=utf-8' });
    const dataUrl = await blobToDataUrl(htmlBlob);

    const htmlDownloadId = await new Promise((resolve, reject) => {
      chrome.downloads.download({
        url: dataUrl,
        filename: htmlFileName,
        saveAs: false
      }, (id) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(id);
      });
    });

    savedDownloadId = htmlDownloadId;

    setProgress(1, total + 1);
    setProgressLabel('已保存 HTML，开始下载 ' + total + ' 个媒体资源...');
    setStatus('正在下载 0 / ' + total);

    const saveResult = await chrome.runtime.sendMessage({
      action: 'savePage',
      html: response.html,
      mediaUrls: response.mediaUrls,
      baseDir: ROOT_DIR,
      mediaDirName: mediaDirName
    });

    if (saveResult && saveResult.success) {
      setProgress(total + 1, total + 1);
      setProgressLabel('保存完成');
      showResult('success', '保存成功！HTML 文件 + ' + saveResult.downloadedCount + ' 个资源已下载');
      openFolderBtn.classList.remove('hidden');
      newSaveBtn.classList.remove('hidden');
    } else {
      throw new Error(saveResult?.error || '保存失败');
    }
  } catch (err) {
    showResult('error', err.message || '保存过程中发生错误');
  } finally {
    setSaving(false);
    pendingData = null;
  }
}

async function handleOpenFolder() {
  if (savedDownloadId) {
    try {
      chrome.downloads.search({ id: savedDownloadId }, (items) => {
        if (items && items.length > 0) {
          const htmlPath = items[0].filename;
          const dir = htmlPath.substring(0, htmlPath.lastIndexOf('/'));
          chrome.downloads.search({
            filenameRegex: '^' + dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '.*'
          }, (mediaItems) => {
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

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
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

function setStatus(text) {
  statusText.textContent = text;
}

function showProgress(show) {
  progressArea.classList.toggle('active', show);
}

function setProgress(current, total) {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  progressFill.style.width = pct + '%';
  progressPct.textContent = pct + '%';
}

function setProgressLabel(text) {
  progressLabel.textContent = text;
}

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

  const results = await chrome.scripting.executeScript({
    target: { tabId: tabId },
    func: async () => {
      return await extractPage();
    }
  });

  if (results && results[0] && results[0].result) {
    return results[0].result;
  }
  throw new Error('页面提取失败：注入后仍无法执行提取');
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.action === 'downloadProgress') {
    const total = pendingData ? pendingData.mediaUrls.length : 0;
    const completed = Math.min(message.current, total);
    setProgress(completed + 1, total + 1);
    setProgressLabel('正在下载: ' + (message.status || (completed + '/' + total)));
    setStatus('正在下载 ' + completed + ' / ' + total);
  }
  return false;
});