/**
 * popup.js
 * 插件弹窗页面的交互逻辑
 * 负责与 background service worker 通信，触发页面保存流程并展示进度
 */

// DOM 元素引用
const saveBtn = document.getElementById('saveBtn');
const progressArea = document.getElementById('progressArea');
const progressBar = document.getElementById('progressBar');
const progressCount = document.getElementById('progressCount');
const statusText = document.getElementById('statusText');
const resultArea = document.getElementById('resultArea');

/**
 * 初始化：绑定按钮点击事件
 */
document.addEventListener('DOMContentLoaded', () => {
  saveBtn.addEventListener('click', handleSaveClick);
});

/**
 * 处理保存按钮点击事件
 * 1. 获取当前活动标签页
 * 2. 向 content script 发送消息，请求提取页面内容和媒体资源
 * 3. 将提取结果转发给 background.js 进行下载和保存
 */
async function handleSaveClick() {
  // 重置 UI 状态
  resetUI();
  saveBtn.disabled = true;
  progressArea.classList.add('active');
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

    // 提取成功，开始下载资源并保存 HTML
    updateStatus(`发现 ${response.mediaUrls.length} 个媒体资源，开始下载...`);

    // 通过 chrome.runtime.sendMessage 与 background.js 通信
    const saveResult = await chrome.runtime.sendMessage({
      action: 'savePage',
      html: response.html,
      mediaUrls: response.mediaUrls,
      title: response.title || tab.title || '未命名页面'
    });

    if (saveResult && saveResult.success) {
      showSuccess(`保存成功！\nHTML 文件：${saveResult.htmlFileName}\n媒体资源：${saveResult.downloadedCount} 个`);
    } else {
      throw new Error(saveResult?.error || '保存失败');
    }
  } catch (err) {
    showError(err.message || '保存过程中发生错误');
  } finally {
    saveBtn.disabled = false;
  }
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
  // 必须返回 false 或 true；异步响应时才需要 true
  return false;
});
