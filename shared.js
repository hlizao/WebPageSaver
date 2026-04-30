const MEDIA_CATEGORIES = {
  pictures: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif', 'tiff'],
  videos: ['mp4', 'webm', 'ogv', 'mov', 'mkv', 'avi', 'flv', 'm4v', '3gp'],
  audios: ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac', 'wma', 'opus'],
  styles: ['css', 'less', 'scss', 'sass'],
  scripts: ['js', 'mjs', 'jsx', 'ts', 'tsx']
};

function getMediaCategory(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  for (const [category, exts] of Object.entries(MEDIA_CATEGORIES)) {
    if (exts.includes(ext)) return category;
  }
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
    return 'others/resource_' + Math.abs(hashCode(url)) + '.bin';
  }
}

function hashCode(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

function resolveUrl(url, base) {
  try {
    return new URL(url, base || (typeof window !== 'undefined' ? window.location.href : undefined)).href;
  } catch (e) {
    return url;
  }
}

function getShortUrl(url) {
  try {
    const u = new URL(url);
    let path = u.pathname;
    if (path.length > 30) path = '...' + path.substring(path.length - 27);
    return u.hostname + path;
  } catch (e) {
    return url.substring(0, 40);
  }
}

function sanitizeFileName(name) {
  if (!name) return '未命名页面';
  let safe = name.replace(/[\\/:*?"<>|]/g, '_').trim();
  if (safe.length > 100) safe = safe.substring(0, 100);
  return safe || '未命名页面';
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

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