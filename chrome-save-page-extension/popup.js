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
    // 如果 content script 未注入（如 chrome:// 页面或新打开的标签），则先注入
    let response;
    try {
      response = await chrome.tabs.sendMessage(tab.id, { action: 'extractPage' });
    } catch (err) {
      // 可能是 content script 未加载，尝试使用 scripting.executeScript 注入并执行
      if (err.message && err.message.includes('Receiving end does not exist')) {
        // 通过 executeScript 在当前页面执行提取逻辑
        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: extractPageInPage,
        });
        if (results && results[0] && results[0].result) {
          response = results[0].result;
        } else {
          throw new Error('页面提取失败：无法执行内容脚本');
        }
      } else {
        throw err;
      }
    }

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
    // Chrome downloads API 返回的 filename 是相对于下载目录的相对路径
    // 例如 "我的网页_2023-10-01T12-00-00-000Z.html"
    const userFilePath = downloadItem.filename;
    const userBaseDir = userFilePath.substring(0, userFilePath.lastIndexOf('.'));

    // 缓存数据，等待用户点击「确认保存」
    pendingData = {
      html: response.html,
      mediaUrls: response.mediaUrls,
      baseDir: userBaseDir, // 用户确认后的相对路径（不含 .html 后缀）
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

/**
 * 在页面上下文中执行的提取函数
 * 当 content script 未加载时，通过 chrome.scripting.executeScript 注入执行
 * 该函数在页面隔离环境中运行，需要包含完整的提取逻辑
 * @returns {Object} 提取结果 { success, html, mediaUrls, title }
 */
function extractPageInPage() {
  // ====== 内联的提取逻辑（与 content.js 保持一致） ======

  function extractMediaUrls() {
    const urls = new Set();

    // 1. 提取 <img> 标签的 src 和 srcset
    document.querySelectorAll('img').forEach((img) => {
      if (img.src) urls.add(img.src);
      if (img.srcset) {
        img.srcset.split(',').forEach((part) => {
          const url = part.trim().split(/\s+/)[0];
          if (url) urls.add(resolveUrl(url));
        });
      }
    });

    // 2. 提取 <video> 标签的 src 和 poster
    document.querySelectorAll('video').forEach((video) => {
      if (video.src) urls.add(video.src);
      if (video.poster) urls.add(video.poster);
    });

    // 3. 提取 <audio> 标签的 src
    document.querySelectorAll('audio').forEach((audio) => {
      if (audio.src) urls.add(audio.src);
    });

    // 4. 提取 <source> 标签的 src 和 srcset
    document.querySelectorAll('source').forEach((source) => {
      if (source.src) urls.add(source.src);
      if (source.srcset) {
        source.srcset.split(',').forEach((part) => {
          const url = part.trim().split(/\s+/)[0];
          if (url) urls.add(resolveUrl(url));
        });
      }
    });

    // 5. 提取 CSS 中引用的背景图片
    document.querySelectorAll('*').forEach((el) => {
      const style = window.getComputedStyle(el);
      const bgImage = style.backgroundImage || el.style.backgroundImage;
      extractUrlsFromCssValue(bgImage, urls);
    });

    // 6. 提取 <style> 标签内的 CSS 中的图片 URL
    document.querySelectorAll('style').forEach((styleTag) => {
      extractUrlsFromCssText(styleTag.textContent, urls);
    });

    // 7. 提取外部 CSS 文件中的图片 URL
    try {
      Array.from(document.styleSheets).forEach((sheet) => {
        try {
          Array.from(sheet.cssRules || []).forEach((rule) => {
            if (rule.cssText) extractUrlsFromCssText(rule.cssText, urls);
          });
        } catch (e) {}
      });
    } catch (e) {}

    return Array.from(urls).filter((url) => {
      return url && (url.startsWith('http://') || url.startsWith('https://'));
    });
  }

  function extractUrlsFromCssValue(cssValue, urlSet) {
    if (!cssValue || cssValue === 'none') return;
    const regex = /url\((['"]?)(.+?)\1\)/gi;
    let match;
    while ((match = regex.exec(cssValue)) !== null) {
      const url = match[2].trim();
      if (url) urlSet.add(resolveUrl(url));
    }
  }

  function extractUrlsFromCssText(cssText, urlSet) {
    if (!cssText) return;
    const regex = /url\((['"]?)(.+?)\1\)/gi;
    let match;
    while ((match = regex.exec(cssText)) !== null) {
      const url = match[2].trim();
      if (url) urlSet.add(resolveUrl(url));
    }
  }

  function resolveUrl(url) {
    try {
      return new URL(url, window.location.href).href;
    } catch (e) {
      return url;
    }
  }

  function getMediaCategory(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    const pictureExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif', 'tiff'];
    if (pictureExts.includes(ext)) return 'pictures';
    const videoExts = ['mp4', 'webm', 'ogv', 'mov', 'mkv', 'avi', 'flv', 'm4v', '3gp'];
    if (videoExts.includes(ext)) return 'videos';
    const audioExts = ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac', 'wma', 'opus'];
    if (audioExts.includes(ext)) return 'audios';
    return 'others';
  }

  function getLocalFilename(url) {
    try {
      const urlObj = new URL(url);
      let pathname = urlObj.pathname;
      let filename = pathname.substring(pathname.lastIndexOf('/') + 1);
      filename = filename.split('?')[0].split('#')[0];
      if (!filename || filename.length === 0) filename = 'resource';
      filename = filename.replace(/[\\/:*?"<>|]/g, '_');
      if (filename.length > 200) {
        const ext = filename.lastIndexOf('.') > 0 ? filename.substring(filename.lastIndexOf('.')) : '';
        filename = filename.substring(0, 200 - ext.length) + ext;
      }
      const category = getMediaCategory(filename);
      return `${category}/${filename}`;
    } catch (e) {
      return 'others/resource_unknown.bin';
    }
  }

  function buildOfflineHtml(mediaUrls) {
    const clone = document.documentElement.cloneNode(true);
    const urlToFilename = new Map();
    mediaUrls.forEach((url) => {
      urlToFilename.set(url, getLocalFilename(url));
    });

    const walker = document.createTreeWalker(clone, NodeFilter.SHOW_ELEMENT);
    let node;
    while ((node = walker.nextNode()) !== null) {
      replaceElementUrls(node, urlToFilename);
    }

    clone.querySelectorAll('style').forEach((styleTag) => {
      styleTag.textContent = replaceUrlsInText(styleTag.textContent, urlToFilename);
    });

    clone.querySelectorAll('[style]').forEach((el) => {
      el.setAttribute('style', replaceUrlsInText(el.getAttribute('style'), urlToFilename));
    });

    const doctype = document.doctype
      ? `<!DOCTYPE ${document.doctype.name}` +
        (document.doctype.publicId ? ` PUBLIC "${document.doctype.publicId}"` : '') +
        (document.doctype.systemId ? ` "${document.doctype.systemId}"` : '') +
        `>\n`
      : '';

    return doctype + clone.outerHTML;
  }

  function replaceElementUrls(el, urlToFilename) {
    if (el.hasAttribute('src')) {
      const src = el.getAttribute('src');
      const abs = resolveUrl(src);
      if (urlToFilename.has(abs)) {
        el.setAttribute('src', './media/' + urlToFilename.get(abs));
      }
    }

    if (el.hasAttribute('srcset')) {
      const newSrcset = el.getAttribute('srcset').split(',').map((part) => {
        const pieces = part.trim().split(/\s+/);
        const url = pieces[0];
        const abs = resolveUrl(url);
        if (urlToFilename.has(abs)) {
          pieces[0] = './media/' + urlToFilename.get(abs);
        }
        return pieces.join(' ');
      }).join(', ');
      el.setAttribute('srcset', newSrcset);
    }

    if (el.hasAttribute('poster')) {
      const poster = el.getAttribute('poster');
      const abs = resolveUrl(poster);
      if (urlToFilename.has(abs)) {
        el.setAttribute('poster', './media/' + urlToFilename.get(abs));
      }
    }

    if (el.hasAttribute('style')) {
      el.setAttribute('style', replaceUrlsInText(el.getAttribute('style'), urlToFilename));
    }
  }

  function replaceUrlsInText(text, urlToFilename) {
    if (!text) return text;
    let result = text;
    urlToFilename.forEach((filename, url) => {
      const escaped = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escaped, 'g');
      result = result.replace(regex, './media/' + filename);
    });
    return result;
  }

  // ====== 执行提取 ======
  try {
    const mediaUrls = extractMediaUrls();
    const html = buildOfflineHtml(mediaUrls);
    return {
      success: true,
      html: html,
      mediaUrls: mediaUrls,
      title: document.title || '未命名页面'
    };
  } catch (err) {
    return {
      success: false,
      error: err.message || '页面提取失败'
    };
  }
}
