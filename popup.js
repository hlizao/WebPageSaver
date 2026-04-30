const saveBtn = document.getElementById('saveBtn');
const openFolderBtn = document.getElementById('openFolderBtn');
const progressArea = document.getElementById('progressArea');
const progressBar = document.getElementById('progressBar');
const progressCount = document.getElementById('progressCount');
const statusText = document.getElementById('statusText');
const resultArea = document.getElementById('resultArea');
const fileInfo = document.getElementById('fileInfo');

let pendingData = null;
let savedFolderPath = null;
let savedDownloadId = null;

document.addEventListener('DOMContentLoaded', () => {
  saveBtn.addEventListener('click', handleSaveClick);
  openFolderBtn.addEventListener('click', handleOpenFolder);
});

async function handleSaveClick() {
  resetUI();
  saveBtn.disabled = true;
  saveBtn.innerHTML = '<span class="spinner"></span> 处理中...';
  updateStatus('正在提取页面内容...');

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

    const folderName = sanitizeFileName(response.title || tab.title || '未命名页面');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const saveDir = `${folderName}_${timestamp}`;
    const htmlFileName = `${saveDir}/${saveDir}.html`;

    pendingData = {
      html: response.html,
      mediaUrls: response.mediaUrls,
      baseDir: saveDir
    };

    progressArea.classList.add('active');
    updateStatus('正在保存 HTML 文件...');
    updateProgress(0, response.mediaUrls.length + 1);

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

    savedFolderPath = saveDir;
    savedDownloadId = htmlDownloadId;

    updateProgress(1, response.mediaUrls.length + 1);
    updateStatus(`开始下载 ${response.mediaUrls.length} 个媒体资源...`);

    const saveResult = await chrome.runtime.sendMessage({
      action: 'savePage',
      html: response.html,
      mediaUrls: response.mediaUrls,
      baseDir: saveDir
    });

    if (saveResult && saveResult.success) {
      updateProgress(response.mediaUrls.length + 1, response.mediaUrls.length + 1);
      showSuccess(`保存成功！HTML 文件 + ${saveResult.downloadedCount} 个媒体资源已下载`);
      openFolderBtn.style.display = 'flex';
    } else {
      throw new Error(saveResult?.error || '保存失败');
    }
  } catch (err) {
    showError(err.message || '保存过程中发生错误');
  } finally {
    saveBtn.disabled = false;
    saveBtn.innerHTML = '<svg class="btn-icon" viewBox="0 0 24 24"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg> 保存当前网页';
    pendingData = null;
  }
}

async function handleOpenFolder() {
  if (savedDownloadId) {
    try {
      chrome.downloads.show(savedDownloadId);
      return;
    } catch (e) {}
  }

  if (savedFolderPath) {
    chrome.downloads.search({
      query: [savedFolderPath]
    }, (results) => {
      if (results && results.length > 0) {
        chrome.downloads.show(results[0].id);
      } else {
        showError('未找到已下载的文件');
      }
    });
  } else {
    showError('没有可打开的文件夹');
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
  progressBar.style.width = '0%';
  progressCount.textContent = '0 / 0';
  statusText.textContent = '准备中...';
  resultArea.className = '';
  resultArea.textContent = '';
  resultArea.style.display = 'none';
  progressArea.classList.remove('active');
  openFolderBtn.style.display = 'none';
  savedFolderPath = null;
  savedDownloadId = null;
  if (fileInfo) fileInfo.textContent = '';
}

function updateStatus(text) {
  statusText.textContent = text;
}

function updateProgress(current, total) {
  const percent = total > 0 ? Math.round((current / total) * 100) : 0;
  progressBar.style.width = percent + '%';
  progressCount.textContent = `${current} / ${total}`;
}

function showSuccess(msg) {
  resultArea.className = 'success';
  resultArea.textContent = msg;
  resultArea.style.display = 'block';
}

function showError(msg) {
  resultArea.className = 'error';
  resultArea.textContent = msg;
  resultArea.style.display = 'block';
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
    const total = pendingData ? pendingData.mediaUrls.length + 1 : 1;
    updateProgress(Math.min(message.current + 1, total), total);
    updateStatus(message.status || `正在下载资源... (${message.current}/${message.total})`);
  }
  return false;
});