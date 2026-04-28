/**
 * background.js
 * Service Worker（后台脚本）
 * 负责接收 popup.js 的保存请求，下载所有媒体资源，
 * 并将处理后的 HTML 文件和资源一起打包保存到用户本地。
 *
 * Manifest V3 中，background 使用 service worker，生命周期较短，
 * 因此所有异步操作需要妥善管理，避免 worker 被提前终止。
 */

/**
 * 监听来自 popup.js 的消息
 * 当 action 为 'savePage' 时，执行完整的保存流程
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'savePage') {
    // 使用一个自执行异步函数来处理保存逻辑
    (async () => {
      try {
        const result = await savePage(request.html, request.mediaUrls, request.baseDir);
        sendResponse({ success: true, ...result });
      } catch (err) {
        sendResponse({ success: false, error: err.message || '保存失败' });
      }
    })();

    // 返回 true 表示 sendResponse 会被异步调用
    return true;
  }
});

/**
 * 保存页面的主流程
 * @param {string} html - 处理后的 HTML 内容（资源路径已替换为相对路径）
 * @param {string[]} mediaUrls - 媒体资源的绝对 URL 列表
 * @param {string} baseDir - 用户确认后的保存路径前缀（不含 .html 后缀）
 * @returns {Promise<{downloadedCount: number}>} 保存结果
 */
async function savePage(html, mediaUrls, baseDir) {
  // 1. 先下载所有媒体资源到内存（Blob），避免 service worker 生命周期问题
  const mediaBlobs = await downloadAllMedia(mediaUrls);

  // 2. 使用 Chrome downloads API 保存所有媒体资源到用户确认的目录下的 media 文件夹
  // saveAs 设为 false，媒体资源下载不需要再次经过用户同意
  const downloadedCount = await saveAllFiles(baseDir, mediaBlobs);

  return {
    downloadedCount: downloadedCount
  };
}

/**
 * 下载所有媒体资源
 * 使用 fetch + blob 方式下载，支持跨域资源（需 host_permissions 包含 <all_urls>）
 * @param {string[]} urls - 媒体资源 URL 列表
 * @returns {Promise<Array<{url: string, blob: Blob|null, filename: string}>>} 下载结果
 */
async function downloadAllMedia(urls) {
  const total = urls.length;
  const results = [];

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    try {
      // 发送进度更新到 popup.js
      await notifyProgress(i, total, `正在下载: ${getShortUrl(url)}`);

      const blob = await fetchMediaAsBlob(url);
      results.push({
        url: url,
        blob: blob,
        filename: getLocalFilename(url)
      });
    } catch (err) {
      // 单个资源下载失败不影响整体流程，记录错误并继续
      console.warn(`下载失败: ${url}`, err);
      results.push({
        url: url,
        blob: null,
        filename: getLocalFilename(url)
      });
    }
  }

  // 通知下载完成
  await notifyProgress(total, total, '资源下载完成，正在保存文件...');
  return results;
}

/**
 * 使用 fetch 获取媒体资源的 Blob 数据
 * 由于插件声明了 host_permissions: [<all_urls>]，可以跨域请求
 * @param {string} url - 资源 URL
 * @returns {Promise<Blob>} Blob 对象
 */
async function fetchMediaAsBlob(url) {
  const response = await fetch(url, {
    method: 'GET',
    // 不限制 credentials，允许携带 cookie（某些资源可能需要）
    credentials: 'include'
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return await response.blob();
}

/**
 * 保存所有媒体资源文件到本地
 * 使用 Chrome downloads API，将资源保存到用户已确认目录的 media 子文件夹中
 * 此处 saveAs 设为 false，不需要再次弹窗让用户确认
 * @param {string} baseDir - 用户确认后的基础目录路径（不含 .html 后缀）
 * @param {Array<{url: string, blob: Blob|null, filename: string}>} mediaBlobs - 媒体资源列表
 * @returns {Promise<number>} 成功保存的资源数量
 */
async function saveAllFiles(baseDir, mediaBlobs) {
  let downloadedCount = 0;

  // 保存媒体资源到 media 子文件夹
  // Chrome downloads API 不支持直接创建文件夹，我们通过文件名中的斜杠来模拟目录结构
  const filenameMap = new Map(); // 用于处理重名文件

  for (const item of mediaBlobs) {
    if (!item.blob) continue; // 下载失败的跳过

    // 处理重名：如果文件名已存在，添加序号
    let uniqueName = item.filename;
    let counter = 1;
    while (filenameMap.has(uniqueName)) {
      const extIndex = item.filename.lastIndexOf('.');
      const name = extIndex > 0 ? item.filename.substring(0, extIndex) : item.filename;
      const ext = extIndex > 0 ? item.filename.substring(extIndex) : '';
      uniqueName = `${name}_${counter}${ext}`;
      counter++;
    }
    filenameMap.set(uniqueName, true);

    // 构造带目录结构的文件名：baseDir/media/pictures/xxx.jpg
    // baseDir 是用户通过「另存为」对话框确认后的相对路径（不含 .html 后缀）
    // uniqueName 已包含分类子目录，如 "pictures/xxx.jpg"
    // 例如 baseDir = "下载/我的网页_2023-10-01T12-00-00-000Z"
    // 则文件路径为 "下载/我的网页_2023-10-01T12-00-00-000Z/media/pictures/xxx.jpg"
    const filePath = `${baseDir}/media/${uniqueName}`;

    // saveAs 设为 false，媒体资源下载不需要再次经过用户同意
    await saveBlobToFile(item.blob, filePath, false);
    downloadedCount++;
  }

  return downloadedCount;
}

/**
 * 使用 Chrome downloads API 将 Blob 保存为本地文件
 * @param {Blob} blob - 文件内容
 * @param {string} filename - 建议的文件名（可包含目录层级）
 * @param {boolean} saveAs - 是否弹出另存为对话框
 * @returns {Promise<number>} 下载项的 ID
 */
function saveBlobToFile(blob, filename, saveAs = false) {
  return new Promise((resolve, reject) => {
    // 将 Blob 转为 data URL，供 Chrome downloads API 使用
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = reader.result;
      chrome.downloads.download({
        url: dataUrl,
        filename: filename,
        saveAs: saveAs // false 表示不弹出另存为对话框，直接保存
      }, (downloadId) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(downloadId);
        }
      });
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/**
 * 向 popup.js 发送进度更新消息
 * @param {number} current - 当前完成数量
 * @param {number} total - 总数量
 * @param {string} status - 状态描述
 */
async function notifyProgress(current, total, status) {
  try {
    await chrome.runtime.sendMessage({
      action: 'downloadProgress',
      current: current,
      total: total,
      status: status
    });
  } catch (e) {
    // popup 可能已关闭，忽略发送失败
  }
}

/**
 * 根据 URL 和媒体类型生成本地文件路径（与 content.js 中的逻辑保持一致）
 * 按媒体类型分类保存到不同子目录：
 *   - pictures: 图片（jpg, jpeg, png, gif, webp, svg, bmp, ico）
 *   - videos: 视频（mp4, webm, ogv, mov）
 *   - audios: 音频（mp3, wav, ogg, m4a, flac, aac）
 *   - others: 其他类型
 * @param {string} url - 资源 URL
 * @returns {string} 本地相对文件路径（如 pictures/xxx.jpg）
 */
function getLocalFilename(url) {
  try {
    const urlObj = new URL(url);
    let pathname = urlObj.pathname;
    let filename = pathname.substring(pathname.lastIndexOf('/') + 1);
    filename = filename.split('?')[0].split('#')[0];
    if (!filename || filename.length === 0) {
      filename = 'resource';
    }
    filename = filename.replace(/[\\/:*?"<>|]/g, '_');
    if (filename.length > 200) {
      const ext = filename.lastIndexOf('.') > 0 ? filename.substring(filename.lastIndexOf('.')) : '';
      filename = filename.substring(0, 200 - ext.length) + ext;
    }

    // 根据扩展名判断媒体类型，并添加分类目录前缀
    const category = getMediaCategory(filename);
    return `${category}/${filename}`;
  } catch (e) {
    return 'others/resource_' + Math.abs(hashCode(url)) + '.bin';
  }
}

/**
 * 根据文件名扩展名判断媒体类型分类
 * @param {string} filename - 文件名
 * @returns {string} 分类目录名（pictures / videos / audios / others）
 */
function getMediaCategory(filename) {
  const ext = filename.split('.').pop().toLowerCase();

  // 图片类型
  const pictureExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif', 'tiff'];
  if (pictureExts.includes(ext)) {
    return 'pictures';
  }

  // 视频类型
  const videoExts = ['mp4', 'webm', 'ogv', 'mov', 'mkv', 'avi', 'flv', 'm4v', '3gp'];
  if (videoExts.includes(ext)) {
    return 'videos';
  }

  // 音频类型
  const audioExts = ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac', 'wma', 'opus'];
  if (audioExts.includes(ext)) {
    return 'audios';
  }

  // 无法识别的类型归类到 others
  return 'others';
}

/**
 * 简单的字符串哈希函数
 * @param {string} str - 输入字符串
 * @returns {number} 哈希值
 */
function hashCode(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return hash;
}

/**
 * 获取 URL 的简短显示文本（用于进度提示）
 * @param {string} url - 完整 URL
 * @returns {string} 缩短后的 URL
 */
function getShortUrl(url) {
  try {
    const u = new URL(url);
    let path = u.pathname;
    if (path.length > 30) {
      path = '...' + path.substring(path.length - 27);
    }
    return u.hostname + path;
  } catch (e) {
    return url.substring(0, 40);
  }
}
