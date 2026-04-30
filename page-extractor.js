async function extractPage() {
  try {
    const mediaUrls = extractMediaUrls();
    const title = document.title || '未命名页面';
    const mediaDirName = sanitizeMediaDirName(title);
    const html = await buildOfflineHtml(mediaUrls, mediaDirName);
    return {
      success: true,
      html: html,
      mediaUrls: mediaUrls,
      title: title,
      mediaDirName: mediaDirName
    };
  } catch (err) {
    return {
      success: false,
      error: err.message || '页面提取失败'
    };
  }
}

function sanitizeMediaDirName(name) {
  if (!name) return 'page_media';
  let safe = name.replace(/[\\/:*?"<>|]/g, '_').trim();
  if (safe.length > 100) safe = safe.substring(0, 100);
  return safe + '_media';
}

function extractMediaUrls() {
  const urls = new Set();

  const tryAdd = (url) => {
    if (url && (url.startsWith('http://') || url.startsWith('https://'))) urls.add(url);
  };

  const processSrcset = (srcset) => {
    if (!srcset) return;
    srcset.split(',').forEach(part => {
      const url = part.trim().split(/\s+/)[0];
      if (url) tryAdd(resolveUrl(url));
    });
  };

  document.querySelectorAll('img').forEach(img => {
    tryAdd(img.src);
    processSrcset(img.srcset);
  });

  document.querySelectorAll('video').forEach(video => {
    tryAdd(video.src);
    if (video.poster) tryAdd(video.poster);
  });

  document.querySelectorAll('audio').forEach(audio => {
    tryAdd(audio.src);
  });

  document.querySelectorAll('source').forEach(source => {
    tryAdd(source.src);
    processSrcset(source.srcset);
  });

  document.querySelectorAll('link[rel="stylesheet"]').forEach(link => {
    if (link.href) tryAdd(link.href);
  });

  document.querySelectorAll('script[src]').forEach(script => {
    if (script.src) tryAdd(script.src);
  });

  document.querySelectorAll('iframe[src], embed[src], object[data]').forEach(el => {
    if (el.src) tryAdd(el.src);
    if (el.getAttribute('data')) tryAdd(resolveUrl(el.getAttribute('data')));
  });

  document.querySelectorAll('*').forEach(el => {
    const style = window.getComputedStyle(el);
    extractUrlsFromCssValue(style.backgroundImage || el.style.backgroundImage, urls);
  });

  document.querySelectorAll('style').forEach(styleTag => {
    extractUrlsFromCssText(styleTag.textContent, urls);
  });

  try {
    Array.from(document.styleSheets).forEach(sheet => {
      try {
        Array.from(sheet.cssRules || []).forEach(rule => {
          if (rule.cssText) extractUrlsFromCssText(rule.cssText, urls);
        });
      } catch (e) {}
    });
  } catch (e) {}

  document.querySelectorAll('[data-src], [data-original], [data-lazy-src], [data-lazy]').forEach(el => {
    const lazyAttrs = ['data-src', 'data-original', 'data-lazy-src', 'data-lazy'];
    lazyAttrs.forEach(attr => {
      const val = el.getAttribute(attr);
      if (val && !val.startsWith('data:')) tryAdd(resolveUrl(val));
    });
    const dataSrcset = el.getAttribute('data-srcset');
    processSrcset(dataSrcset);
  });

  return Array.from(urls).filter(url => url && (url.startsWith('http://') || url.startsWith('https://')));
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

function fetchTextContent(url) {
  return fetch(url, { credentials: 'include' }).then(r => {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.text();
  });
}

async function buildOfflineHtml(mediaUrls, mediaDirName) {
  const clone = document.documentElement.cloneNode(true);

  const urlToFilename = new Map();
  mediaUrls.forEach(url => {
    urlToFilename.set(url, getLocalFilename(url));
  });

  const mediaPrefix = './' + mediaDirName + '/';

  const walker = document.createTreeWalker(clone, NodeFilter.SHOW_ELEMENT);
  let node;
  while ((node = walker.nextNode()) !== null) {
    replaceElementUrls(node, urlToFilename, mediaPrefix);
  }

  clone.querySelectorAll('style').forEach(styleTag => {
    styleTag.textContent = replaceUrlsInText(styleTag.textContent, urlToFilename, mediaPrefix);
  });

  clone.querySelectorAll('[style]').forEach(el => {
    el.setAttribute('style', replaceUrlsInText(el.getAttribute('style'), urlToFilename, mediaPrefix));
  });

  for (const link of clone.querySelectorAll('link[rel="stylesheet"]')) {
    const href = link.getAttribute('href');
    const abs = href ? resolveUrl(href) : null;
    if (abs && urlToFilename.has(abs)) {
      try {
        const cssText = await fetchTextContent(abs);
        const styleEl = document.createElement('style');
        styleEl.setAttribute('data-original-href', abs);
        styleEl.textContent = replaceUrlsInText(cssText, urlToFilename, mediaPrefix);
        link.parentNode.replaceChild(styleEl, link);
      } catch (e) {
        const styleEl = document.createElement('style');
        styleEl.setAttribute('data-original-href', abs);
        styleEl.textContent = '/* CSS from ' + abs + ' (fetch failed) */';
        link.parentNode.replaceChild(styleEl, link);
      }
    }
  }

  for (const script of clone.querySelectorAll('script[src]')) {
    const src = script.getAttribute('src');
    const abs = src ? resolveUrl(src) : null;
    if (abs && urlToFilename.has(abs)) {
      try {
        const jsText = await fetchTextContent(abs);
        script.removeAttribute('src');
        script.textContent = jsText;
      } catch (e) {
        script.removeAttribute('src');
        script.textContent = '/* JS from ' + abs + ' (fetch failed) */';
      }
    }
  }

  clone.querySelectorAll('[data-src], [data-original], [data-lazy-src], [data-lazy]').forEach(el => {
    const tag = el.tagName.toLowerCase();
    const lazyAttrs = ['data-src', 'data-original', 'data-lazy-src', 'data-lazy'];
    const setableTags = ['img', 'video', 'audio', 'source', 'iframe', 'embed'];

    lazyAttrs.forEach(attr => {
      const val = el.getAttribute(attr);
      if (val) {
        const abs = resolveUrl(val);
        if (urlToFilename.has(abs)) {
          if (setableTags.includes(tag)) {
            el.setAttribute('src', mediaPrefix + urlToFilename.get(abs));
          }
          el.removeAttribute(attr);
        }
      }
    });

    const dataSrcset = el.getAttribute('data-srcset');
    if (dataSrcset) {
      const newSrcset = dataSrcset.split(',').map(part => {
        const pieces = part.trim().split(/\s+/);
        const url = pieces[0];
        const abs = resolveUrl(url);
        if (urlToFilename.has(abs)) {
          pieces[0] = mediaPrefix + urlToFilename.get(abs);
        }
        return pieces.join(' ');
      }).join(', ');
      el.setAttribute('srcset', newSrcset);
      el.removeAttribute('data-srcset');
    }
  });

  const doctype = document.doctype
    ? '<!DOCTYPE ' + document.doctype.name +
      (document.doctype.publicId ? ' PUBLIC "' + document.doctype.publicId + '"' : '') +
      (document.doctype.systemId ? ' "' + document.doctype.systemId + '"' : '') +
      '>\n'
    : '';

  return doctype + clone.outerHTML;
}

function replaceElementUrls(el, urlToFilename, mediaPrefix) {
  if (el.hasAttribute('src')) {
    const src = el.getAttribute('src');
    const abs = resolveUrl(src);
    if (urlToFilename.has(abs)) {
      el.setAttribute('src', mediaPrefix + urlToFilename.get(abs));
    }
  }

  if (el.hasAttribute('href')) {
    const href = el.getAttribute('href');
    const abs = resolveUrl(href);
    if (urlToFilename.has(abs)) {
      el.setAttribute('href', mediaPrefix + urlToFilename.get(abs));
    }
  }

  if (el.hasAttribute('srcset')) {
    const newSrcset = el.getAttribute('srcset').split(',').map(part => {
      const pieces = part.trim().split(/\s+/);
      const url = pieces[0];
      const abs = resolveUrl(url);
      if (urlToFilename.has(abs)) {
        pieces[0] = mediaPrefix + urlToFilename.get(abs);
      }
      return pieces.join(' ');
    }).join(', ');
    el.setAttribute('srcset', newSrcset);
  }

  if (el.hasAttribute('poster')) {
    const poster = el.getAttribute('poster');
    const abs = resolveUrl(poster);
    if (urlToFilename.has(abs)) {
      el.setAttribute('poster', mediaPrefix + urlToFilename.get(abs));
    }
  }

  if (el.hasAttribute('data')) {
    const data = el.getAttribute('data');
    const abs = resolveUrl(data);
    if (urlToFilename.has(abs)) {
      el.setAttribute('data', mediaPrefix + urlToFilename.get(abs));
    }
  }

  if (el.hasAttribute('style')) {
    el.setAttribute('style', replaceUrlsInText(el.getAttribute('style'), urlToFilename, mediaPrefix));
  }
}

function replaceUrlsInText(text, urlToFilename, mediaPrefix) {
  if (!text) return text;
  let result = text;
  urlToFilename.forEach((filename, url) => {
    const escaped = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped, 'g');
    result = result.replace(regex, mediaPrefix + filename);
  });
  return result;
}