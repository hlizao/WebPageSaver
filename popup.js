const saveBtn = document.getElementById('saveBtn');
const confirmBtn = document.getElementById('confirmBtn');
const openFolderBtn = document.getElementById('openFolderBtn');
const progressArea = document.getElementById('progressArea');
const progressBar = document.getElementById('progressBar');
const progressCount = document.getElementById('progressCount');
const statusText = document.getElementById('statusText');
const resultArea = document.getElementById('resultArea');

let pendingData = null;
let savedFolderPath = null;

document.addEventListener('DOMContentLoaded', () => {
  saveBtn.addEventListener('click', handleSaveClick);
  confirmBtn.addEventListener('click', handleConfirmClick);
  openFolderBtn.addEventListener('click', handleOpenFolder);
});

async function handleSaveClick() {
  resetUI();
  saveBtn.disabled = true;
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

    const htmlBlob = new Blob([response.html], { type: 'text/html;charset=utf-8' });
    const dataUrl = await blobToDataUrl(htmlBlob);

    const downloadId = await new Promise((resolve, reject) => {
      chrome.downloads.download({
        url: dataUrl,
        filename: htmlFileName,
        saveAs: false
      }, (id) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(id);
      });
    });

    pendingData = {
      html: response.html,
      mediaUrls: response.mediaUrls,
      baseDir: saveDir,
      downloadId: downloadId
    };

    await handleConfirmClick();
  } catch (err) {
    showError(err.message || '保存过程中发生错误');
    saveBtn.disabled = false;
  }
}

async function handleConfirmClick() {
  if (!pendingData) {
    showError('没有待保存的数据，请重新提取页面');
    return;
  }

  progressArea.classList.add('active');
  confirmBtn.style.display = 'none';
  updateStatus(`开始下载 ${pendingData.mediaUrls.length} 个媒体资源...`);

  try {
    const saveResult = await chrome.runtime.sendMessage({
      action: 'savePage',
      html: pendingData.html,
      mediaUrls: pendingData.mediaUrls,
      baseDir: pendingData.baseDir
    });

    if (saveResult && saveResult.success) {
      savedFolderPath = pendingData.baseDir;
      showSuccess(`保存成功！\n媒体资源：${saveResult.downloadedCount} 个已下载`);
      openFolderBtn.style.display = 'block';
    } else {
      throw new Error(saveResult?.error || '保存失败');
    }
  } catch (err) {
    showError(err.message || '保存过程中发生错误');
  } finally {
    saveBtn.disabled = false;
    pendingData = null;
  }
}

async function handleOpenFolder() {
  if (!savedFolderPath) {
    showError('无法获取保存路径');
    return;
  }

  chrome.downloads.search({
    filenameRegex: '^' + savedFolderPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '.*'
  }, (results) => {
    if (results && results.length > 0) {
      chrome.downloads.show(results[0].id);
    } else {
      showError('未找到保存的文件夹');
    }
  });
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
  saveBtn.style.display = 'block';
  confirmBtn.style.display = 'none';
  openFolderBtn.style.display = 'none';
  savedFolderPath = null;
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
  resultArea.textContent = '保存失败：' + msg;
  resultArea.style.display = 'block';
}

async function injectAndExtract(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId: tabId },
    files: ['shared.js', 'page-extractor.js']
  });

  const results = await chrome.scripting.executeScript({
    target: { tabId: tabId },
    func: () => extractPage()
  });

  if (results && results[0] && results[0].result) {
    return results[0].result;
  }
  throw new Error('页面提取失败：注入后仍无法执行提取');
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.action === 'downloadProgress') {
    updateProgress(message.current, message.total);
    updateStatus(message.status || `正在下载资源... (${message.current}/${message.total})`);
  }
  return false;
});

// Re-export from shared.js references used in this file
// shared.js is NOT injected into popup.html, so we must have local copies
function checkSpecialPage(url) {
  if (!url) return { isSpecial: true, reason: '无法获取当前页面 URL' };
  try {
    const urlObj = new URL(url);
    const protocol = urlObj.protocol;
    if (['chrome:', 'chrome-extension:'].includes(protocol))
      return { isSpecial: true, reason: '无法保存 Chrome 内部页面' };
    if (['edge:', 'edge-extension:'].includes(protocol))
      return { isSpecial: true, reason: '无法保存 Edge 内部页面' };
    if (protocol === 'about:')
      return { isSpecial: true, reason: '无法保存 about 页面' };
    if (protocol === 'file:')
      return { isSpecial: true, reason: '本地文件页面不支持保存媒体资源' };
    if (urlObj.href === 'about:blank' || url.includes('newtab'))
      return { isSpecial: true, reason: '当前为新标签页，没有可保存的内容' };
    return { isSpecial: false, reason: null };
  } catch (e) {
    return { isSpecial: true, reason: '页面 URL 格式异常' };
  }
}

function sanitizeFileName(name) {
  if (!name) return '未命名页面';
  let safe = name.replace(/[\\/:*?"<>|]/g, '_').trim();
  if (safe.length > 100) safe = safe.substring(0, 100);
  return safe || '未命名页面';
}