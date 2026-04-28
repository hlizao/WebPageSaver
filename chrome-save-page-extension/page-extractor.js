/**
 * page-extractor.js
 * 页面内容提取模块
 * 提供 extractPage() 函数，用于提取当前页面的完整 HTML 和所有媒体资源 URL
 * 该模块可在 content script 和页面上下文中运行（通过 executeScript 注入）
 */

/**
 * 主入口函数：提取页面内容
 * @returns {Object} 提取结果 { success, html, mediaUrls, title }
 */
function extractPage() {
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

/**
 * 提取页面中的媒体资源 URL
 * 包括：img 标签的 src、video 标签的 src/poster、audio 标签的 src、
 *       背景图片（style 中的 background-image）、source 标签的 src、picture 中的 srcset
 * @returns {string[]} 去重后的绝对 URL 数组
 */
function extractMediaUrls() {
  const urls = new Set();

  // 1. 提取 <img> 标签的 src 和 srcset
  document.querySelectorAll('img').forEach((img) => {
    if (img.src) {
      urls.add(img.src);
    }
    if (img.srcset) {
      // srcset 可能包含多个 URL，按逗号分隔
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

  // 4. 提取 <source> 标签的 src 和 srcset（常用于 video/audio/picture 内部）
  document.querySelectorAll('source').forEach((source) => {
    if (source.src) urls.add(source.src);
    if (source.srcset) {
      source.srcset.split(',').forEach((part) => {
        const url = part.trim().split(/\s+/)[0];
        if (url) urls.add(resolveUrl(url));
      });
    }
  });

  // 5. 提取 CSS 中引用的背景图片（内联 style 和 style 标签中的样式）
  document.querySelectorAll('*').forEach((el) => {
    const style = window.getComputedStyle(el);
    const bgImage = style.backgroundImage || el.style.backgroundImage;
    extractUrlsFromCssValue(bgImage, urls);
  });

  // 6. 提取所有 <style> 标签内的 CSS 中的图片 URL
  document.querySelectorAll('style').forEach((styleTag) => {
    extractUrlsFromCssText(styleTag.textContent, urls);
  });

  // 7. 提取所有外部 CSS 文件中的图片 URL（通过 document.styleSheets 访问）
  try {
    Array.from(document.styleSheets).forEach((sheet) => {
      try {
        Array.from(sheet.cssRules || []).forEach((rule) => {
          if (rule.cssText) {
            extractUrlsFromCssText(rule.cssText, urls);
          }
        });
      } catch (e) {
        // 跨域样式表可能无法访问 cssRules，忽略错误
      }
    });
  } catch (e) {
    // 忽略样式表访问错误
  }

  // 过滤掉 data URI、javascript:、about: 等非 HTTP URL，以及重复项
  return Array.from(urls).filter((url) => {
    return url && (url.startsWith('http://') || url.startsWith('https://'));
  });
}

/**
 * 从 CSS 属性值中提取 URL（如 background-image: url("...")）
 * @param {string} cssValue - CSS 属性值字符串
 * @param {Set} urlSet - 用于存储 URL 的 Set
 */
function extractUrlsFromCssValue(cssValue, urlSet) {
  if (!cssValue || cssValue === 'none') return;
  // 匹配 url("...") 或 url('...') 或 url(...)
  const regex = /url\((['"]?)(.+?)\1\)/gi;
  let match;
  while ((match = regex.exec(cssValue)) !== null) {
    const url = match[2].trim();
    if (url) {
      urlSet.add(resolveUrl(url));
    }
  }
}

/**
 * 从 CSS 文本中提取所有图片 URL
 * @param {string} cssText - CSS 文本
 * @param {Set} urlSet - 用于存储 URL 的 Set
 */
function extractUrlsFromCssText(cssText, urlSet) {
  if (!cssText) return;
  const regex = /url\((['"]?)(.+?)\1\)/gi;
  let match;
  while ((match = regex.exec(cssText)) !== null) {
    const url = match[2].trim();
    if (url) {
      urlSet.add(resolveUrl(url));
    }
  }
}

/**
 * 将相对 URL 解析为绝对 URL
 * @param {string} url - 可能是相对路径的 URL
 * @returns {string} 绝对 URL
 */
function resolveUrl(url) {
  try {
    return new URL(url, window.location.href).href;
  } catch (e) {
    return url;
  }
}

/**
 * 克隆整个文档并处理资源引用路径
 * 1. 克隆 document.documentElement 以获取完整 HTML
 * 2. 将所有媒体资源的 src/href 等属性中的绝对 URL 替换为相对路径（如 ./media/xxx.jpg）
 * 3. 将 CSS 中的 url(...) 引用也替换为相对路径
 * @param {string[]} mediaUrls - 需要替换的媒体资源绝对 URL 列表
 * @returns {string} 处理后的完整 HTML 字符串
 */
function buildOfflineHtml(mediaUrls) {
  // 深克隆整个 HTML 节点
  const clone = document.documentElement.cloneNode(true);

  // 创建 URL 到本地文件名的映射表
  const urlToFilename = new Map();
  mediaUrls.forEach((url) => {
    urlToFilename.set(url, getLocalFilename(url));
  });

  // 遍历克隆树中的所有元素，替换媒体资源的引用
  const walker = document.createTreeWalker(clone, NodeFilter.SHOW_ELEMENT);
  let node;
  while ((node = walker.nextNode()) !== null) {
    replaceElementUrls(node, urlToFilename);
  }

  // 处理 <style> 标签内的 CSS 文本
  clone.querySelectorAll('style').forEach((styleTag) => {
    styleTag.textContent = replaceUrlsInText(styleTag.textContent, urlToFilename);
  });

  // 处理元素的内联 style 属性
  clone.querySelectorAll('[style]').forEach((el) => {
    el.setAttribute('style', replaceUrlsInText(el.getAttribute('style'), urlToFilename));
  });

  // 序列化为字符串
  const doctype = document.doctype
    ? `<!DOCTYPE ${document.doctype.name}` +
      (document.doctype.publicId ? ` PUBLIC "${document.doctype.publicId}"` : '') +
      (document.doctype.systemId ? ` "${document.doctype.systemId}"` : '') +
      `>\n`
    : '';

  return doctype + clone.outerHTML;
}

/**
 * 替换单个元素中与媒体资源相关的属性 URL
 * @param {Element} el - DOM 元素
 * @param {Map} urlToFilename - URL 到本地文件名的映射
 */
function replaceElementUrls(el, urlToFilename) {
  const tag = el.tagName.toLowerCase();

  // 处理 src 属性（img, video, audio, source, iframe 等）
  if (el.hasAttribute('src')) {
    const src = el.getAttribute('src');
    const abs = resolveUrl(src);
    if (urlToFilename.has(abs)) {
      el.setAttribute('src', './media/' + urlToFilename.get(abs));
    }
  }

  // 处理 srcset 属性（img, source）
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

  // 处理 poster 属性（video）
  if (el.hasAttribute('poster')) {
    const poster = el.getAttribute('poster');
    const abs = resolveUrl(poster);
    if (urlToFilename.has(abs)) {
      el.setAttribute('poster', './media/' + urlToFilename.get(abs));
    }
  }

  // 处理 CSS 变量或背景图片等内联样式中的 URL
  if (el.hasAttribute('style')) {
    el.setAttribute('style', replaceUrlsInText(el.getAttribute('style'), urlToFilename));
  }
}

/**
 * 在任意文本中查找并替换 URL 为本地相对路径
 * @param {string} text - 原始文本
 * @param {Map} urlToFilename - URL 到本地文件名的映射
 * @returns {string} 替换后的文本
 */
function replaceUrlsInText(text, urlToFilename) {
  if (!text) return text;
  let result = text;
  urlToFilename.forEach((filename, url) => {
    // 使用正则全局替换，处理 url("...")、url('...')、url(...)
    const escaped = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped, 'g');
    result = result.replace(regex, './media/' + filename);
  });
  return result;
}

/**
 * 根据 URL 和媒体类型生成本地文件路径
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
    // 从路径中提取文件名
    let pathname = urlObj.pathname;
    let filename = pathname.substring(pathname.lastIndexOf('/') + 1);

    // 去除查询参数和哈希（如果文件名中包含）
    filename = filename.split('?')[0].split('#')[0];

    // 如果文件名为空或没有扩展名，使用默认名称
    if (!filename || filename.length === 0) {
      filename = 'resource';
    }

    // 对文件名进行安全处理，去除非法字符
    filename = filename.replace(/[\\/:*?"<>|]/g, '_');

    // 限制文件名长度，避免过长
    if (filename.length > 200) {
      const ext = filename.lastIndexOf('.') > 0 ? filename.substring(filename.lastIndexOf('.')) : '';
      filename = filename.substring(0, 200 - ext.length) + ext;
    }

    // 根据扩展名判断媒体类型，并添加分类目录前缀
    const category = getMediaCategory(filename);
    return `${category}/${filename}`;
  } catch (e) {
    // 如果解析失败，返回基于 URL 哈希的默认文件名，归类到 others
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
 * 简单的字符串哈希函数，用于生成唯一标识
 * @param {string} str - 输入字符串
 * @returns {number} 哈希值
 */
function hashCode(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0; // 转为 32 位整数
  }
  return hash;
}
