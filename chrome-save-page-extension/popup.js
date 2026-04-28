/**
 * popup.js
 * 插件弹窗页面的交互逻辑
 * 负责与 background service worker 通信，触发页面保存流程并展示进度
 *
 * 交互流程：
 * 1. 用户点击「保存当前网页」
 * 2. 提取页面内容，弹出「另存为」对话框让用户选择保存位置（仅 HTML 文件）
 * 3. 用户确认后，自动下载所有媒体资源到同级 media 文件夹（无需再次确认）
 */

// DOM 元素引用
const saveBtn = document.getElementById('saveBtn');
const confirmBtn = document.getElementById('confirmBtn');
const progressArea = document.getElementById('progressArea');
const progressBar = document.getElementById('progressBar');
const progressCount = document.getElementById('progressCount');
const statusText = document.getElementById('statusText');
const resultArea = document.getElementById('resultArea');

// 缓存提取到的页面数据，供用户确认后使用
let pendingData = null;

/**
 * 初始化：绑定按钮点击事件
 */
document.addEventListener('DOMContentLoaded', () => {
  saveBtn.addEventListener('click', handleSaveClick);
  confirmBtn.addEventListener('click', handleConfirmClick);
});

/**
 * 处理「保存当前网页」按钮点击事件
 * 1. 提取页面内容和媒体资源
 * 2. 弹出「另存为」对话框，仅让用户确认 HTML 文件的保存位置
 * 3. 用户确认后，显示「确认保存」按钮，进入下一步
 */
async function handleSaveClick() {
  resetUI();
  saveBtn.disabled = true;
  updateStatus('正在提取页面内容...');

  try {
    // 获取当前活动标签页
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) {
      throw new Error('无法获取当前标签页');
    }

    // 向 content script 发送消息，请求提取页面完整 HTML 和媒体资源列表
    const response = await chrome.tabs.sendMessage(tab.id, { action: 'extractPage' });

    if (!response || !response.success) {
      throw new Error(response?.error || '页面提取失败');
    }

    // 生成建议的文件名
    const folderName = sanitizeFileName(response.title || tab.title || '未命名页面');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const baseDir = `${folderName}_${timestamp}`;
    const suggestedName = `${baseDir}.html`;

    // 弹出「另存为」对话框，仅保存 HTML 文件，让用户选择保存位置
    // 使用 Chrome downloads API 的 saveAs: true
    const htmlBlob = new Blob([response.html], { type: 'text/html;charset=utf-8' });
    const dataUrl = await blobToDataUrl(htmlBlob);

    const downloadId = await new Promise((resolve, reject) => {
      chrome.downloads.download({
        url: dataUrl,
        filename: suggestedName,
        saveAs: true // 弹出另存为对话框，让用户选择保存位置
      }, (id) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(id);
        }
      });
    });

    // 监听下载项的变化，获取用户最终选择的文件路径
    const downloadItem = await waitForDownloadCompletion(downloadId);

    // 从用户选择的文件路径中解析出基础目录名
    // 例如用户保存到 /Download/我的网页_2023-10-01T12-00-00-000Z.html
    // 则 media 资源应保存到 /Download/我的网页_2023-10-01T12-00-00-000Z/media/
    const userFilePath = downloadItem.filename;
    const userBaseDir = userFilePath.substring(0, userFilePath.lastIndexOf('.'));

    // 缓存数据，等待用户点击「确认保存」
    pendingData = {
      html: response.html,
      mediaUrls: response.mediaUrls,
      baseDir: userBaseDir, // 用户确认后的实际保存路径（不含 .html 后缀）
      downloadId: downloadId
    };

    // 显示确认按钮，提示用户确认后开始下载媒体资源
    saveBtn.style.display = 'none';
    confirmBtn.style.display = 'block';
    updateStatus(`HTML 已保存。点击「确认保存」开始下载 ${response.mediaUrls.length} 个媒体资源到同级 media 文件夹。`);
  } catch (err) {
    showError(err.message || '保存过程中发生错误');
    saveBtn.disabled = false;
  }
}

/**
 * 处理「确认保存」按钮点击事件
 * 用户已在「另存为」对话框中确认了 HTML 的保存位置
 * 现在自动下载所有媒体资源到同级 media 文件夹，无需再次弹窗确认
 */
async function handleConfirmClick() {
  if (!pendingData) {
    showError('没有待保存的数据，请重新提取页面');
    return;
  }

  confirmBtn.disabled = true;
  progressArea.classList.add('active');
  updateStatus(`开始下载 ${pendingData.mediaUrls.length} 个媒体资源...`);

  try {
    // 通过 background.js 下载所有媒体资源，使用用户确认的保存路径
    const saveResult = await chrome.runtime.sendMessage({
      action: 'savePage',
      html: pendingData.html,
      mediaUrls: pendingData.mediaUrls,
      baseDir: pendingData.baseDir // 传递用户确认后的实际路径
    });

    if (saveResult && saveResult.success) {
      showSuccess(`保存成功！\n媒体资源：${saveResult.downloadedCount} 个已下载到同级 media 文件夹`);
    } else {
      throw new Error(saveResult?.error || '保存失败');
    }
  } catch (err) {
    showError(err.message || '保存过程中发生错误');
  } finally {
    confirmBtn.disabled = false;
    pendingData = null;
  }
}

/**
 * 等待指定下载项完成，并返回下载项信息
 * @param {number} downloadId - 下载项 ID
 * @returns {Promise<Object>} 下载项对象
 */
function waitForDownloadCompletion(downloadId) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('等待下载完成超时'));
    }, 60000); // 60 秒超时

    function onChanged(delta) {
      if (delta.id === downloadId && delta.state && delta.state.current === 'complete') {
        cleanup();
        chrome.downloads.search({ id: downloadId }, (results) => {
          if (results && results.length > 0) {
            resolve(results[0]);
          } else {
            reject(new Error('无法获取下载项信息'));
          }
        });
      }
    }

    function cleanup() {
      clearTimeout(timeout);
      chrome.downloads.onChanged.removeListener(onChanged);
    }

    chrome.downloads.onChanged.addListener(onChanged);

    // 立即查询一次，可能下载已经完成
    chrome.downloads.search({ id: downloadId }, (results) => {
      if (results && results.length > 0 && results[0].state === 'complete') {
        cleanup();
        resolve(results[0]);
      }
    });
  });
}

/**
 * 将 Blob 转换为 Data URL
 * @param {Blob} blob - Blob 对象
 * @returns {Promise<string>} Data URL
 */
function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/**
 * 将字符串转换为安全的文件/文件夹名
 * @param {string} name - 原始名称
 * @returns {string} 安全的名称
 */
function sanitizeFileName(name) {
  if (!name) return '未命名页面';
  let safe = name.replace(/[\\/:*?"<>|]/g, '_');
  safe = safe.trim();
  if (safe.length > 100) {
    safe = safe.substring(0, 100);
  }
  if (!safe) {
    safe = '未命名页面';
  }
  return safe;
}

/**
 * 重置 UI 到初始状态
 */
function resetUI() {
  progressBar.style.width = '0%';
  progressCount.textContent = '0 / 0';
  statusText.textContent = '准备中...';
  resultArea.className = '';
  resultArea.textContent = '';
  progressArea.classList.remove('active');
  saveBtn.style.display = 'block';
  confirmBtn.style.display = 'none';
}

/**
 * 更新状态文本
 * @param {string} text - 状态描述
 */
function updateStatus(text) {
  statusText.textContent = text;
}

/**
 * 更新进度条
 * @param {number} current - 当前完成数量
 * @param {number} total - 总数量
 */
function updateProgress(current, total) {
  const percent = total > 0 ? Math.round((current / total) * 100) : 0;
  progressBar.style.width = percent + '%';
  progressCount.textContent = `${current} / ${total}`;
}

/**
 * 显示成功提示
 * @param {string} msg - 成功信息
 */
function showSuccess(msg) {
  resultArea.className = 'success';
  resultArea.textContent = msg;
}

/**
 * 显示错误提示
 * @param {string} msg - 错误信息
 */
function showError(msg) {
  resultArea.className = 'error';
  resultArea.textContent = '保存失败：' + msg;
}

/**
 * 监听来自 background.js 的进度更新消息
 * 用于实时展示资源下载进度
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'downloadProgress') {
    updateProgress(message.current, message.total);
    updateStatus(message.status || `正在下载资源... (${message.current}/${message.total})`);
  }
  return false;
});
