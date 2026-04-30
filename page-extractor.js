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

  // 1. img src + srcset
  document.querySelectorAll('img').forEach(img => {
    tryAdd(img.src);
    processSrcset(img.srcset);
  });

  // 2. video src + poster
  document.querySelectorAll('video').forEach(video => {
    tryAdd(video.src);
    if (video.poster) tryAdd(video.poster);
  });

  // 3. audio src
  document.querySelectorAll('audio').forEach(audio => {
    tryAdd(audio.src);
  });

  // 4. source src + srcset
  document.querySelectorAll('source').forEach(source => {
    tryAdd(source.src);
    processSrcset(source.srcset);
  });

  // 5. link[rel="stylesheet"] href
  document.querySelectorAll('link[rel="stylesheet"]').forEach(link => {
    if (link.href) tryAdd(link.href);
  });

  // 6. script src
  document.querySelectorAll('script[src]').forEach(script => {
    if (script.src) tryAdd(script.src);
  });

  // 7. iframe, embed, object
  document.querySelectorAll('iframe[src], embed[src], object[data]').forEach(el => {
    if (el.src) tryAdd(el.src);
    if (el.getAttribute('data')) tryAdd(resolveUrl(el.getAttribute('data')));
  });

  // 8. CSS background-image from all elements
  document.querySelectorAll('*').forEach(el => {
    const style = window.getComputedStyle(el);
    extractUrlsFromCssValue(style.backgroundImage || el.style.backgroundImage, urls);
  });

  // 9. <style> tag content
  document.querySelectorAll('style').forEach(styleTag => {
    extractUrlsFromCssText(styleTag.textContent, urls);
  });

  // 10. external stylesheets via document.styleSheets
  try {
    Array.from(document.styleSheets).forEach(sheet => {
      try {
        Array.from(sheet.cssRules || []).forEach(rule => {
          if (rule.cssText) extractUrlsFromCssText(rule.cssText, urls);
        });
      } catch (e) {}
    });
  } catch (e) {}

  // 11. lazy-load attributes (data-src, data-original, data-lazy-src, data-lazy)
  document.querySelectorAll('[data-src], [data-original], [data-lazy-src], [data-lazy]').forEach(el => {
    const lazyAttrs = ['data-src', 'data-original', 'data-lazy-src', 'data-lazy'];
    lazyAttrs.forEach(attr => {
      const val = el.getAttribute(attr);
      if (val && !val.startsWith('data:')) tryAdd(resolveUrl(val));
    });
    // data-srcset
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
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.text();
  });
}

function buildOfflineHtml(mediaUrls) {
  const clone = document.documentElement.cloneNode(true);

  const urlToFilename = new Map();
  mediaUrls.forEach(url => {
    urlToFilename.set(url, getLocalFilename(url));
  });

  // Collect CSS and JS URLs for inline processing
  const cssUrls = [];
  const jsUrls = [];
  mediaUrls.forEach(url => {
    const ext = url.split('?')[0].split('.').pop().toLowerCase();
    const cssExts = ['css', 'less', 'scss', 'sass'];
    const jsExts = ['js', 'mjs', 'jsx'];
    if (cssExts.includes(ext)) cssUrls.push(url);
    if (jsExts.includes(ext)) jsUrls.push(url);
  });

  const walker = document.createTreeWalker(clone, NodeFilter.SHOW_ELEMENT);
  let node;
  while ((node = walker.nextNode()) !== null) {
    replaceElementUrls(node, urlToFilename);
  }

  // Replace <style> tag content
  clone.querySelectorAll('style').forEach(styleTag => {
    styleTag.textContent = replaceUrlsInText(styleTag.textContent, urlToFilename);
  });

  // Replace inline style attributes
  clone.querySelectorAll('[style]').forEach(el => {
    el.setAttribute('style', replaceUrlsInText(el.getAttribute('style'), urlToFilename));
  });

  // Inline CSS: replace <link rel="stylesheet"> with <style>
  clone.querySelectorAll('link[rel="stylesheet"]').forEach(link => {
    const href = link.getAttribute('href');
    if (!href) return;
    const style = document.createElement('style');
    style.setAttribute('data-original-href', href);
    style.textContent = '/* CSS from ' + href + ' */';
    link.parentNode.replaceChild(style, link);
  });

  // Inline JS: replace <script src> with inline <script>
  clone.querySelectorAll('script[src]').forEach(script => {
    const src = script.getAttribute('src');
    const abs = src ? resolveUrl(src) : null;
    if (abs && urlToFilename.has(abs)) {
      script.removeAttribute('src');
      script.textContent = '/* JS from ' + abs + ' */';
    } else if (src) {
      // If we can't resolve or find it, still try to inline as empty
      script.removeAttribute('src');
      script.textContent = '/* Original JS src: ' + src + ' */';
    }
  });

  // Set lazy-load attributes to empty so they don't trigger re-fetch
  clone.querySelectorAll('[data-src], [data-original], [data-lazy-src], [data-lazy]').forEach(el => {
    const tag = el.tagName.toLowerCase();
    const lazyAttrs = ['data-src', 'data-original', 'data-lazy-src', 'data-lazy'];
    let srcAttr = null;
    lazyAttrs.forEach(attr => {
      const val = el.getAttribute(attr);
      if (val) {
        const abs = resolveUrl(val);
        if (urlToFilename.has(abs)) {
          el.setAttribute('./media/' + urlToFilename.get(abs));
          el.removeAttribute(attr);
          srcAttr = true;
        }
      }
    });
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
  // src attribute
  if (el.hasAttribute('src')) {
    const src = el.getAttribute('src');
    const abs = resolveUrl(src);
    if (urlToFilename.has(abs)) {
      el.setAttribute('src', './media/' + urlToFilename.get(abs));
    }
  }

  // href attribute
  if (el.hasAttribute('href')) {
    const href = el.getAttribute('href');
    const abs = resolveUrl(href);
    if (urlToFilename.has(abs)) {
      el.setAttribute('href', './media/' + urlToFilename.get(abs));
    }
  }

  // srcset attribute
  if (el.hasAttribute('srcset')) {
    const newSrcset = el.getAttribute('srcset').split(',').map(part => {
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

  // poster attribute
  if (el.hasAttribute('poster')) {
    const poster = el.getAttribute('poster');
    const abs = resolveUrl(poster);
    if (urlToFilename.has(abs)) {
      el.setAttribute('poster', './media/' + urlToFilename.get(abs));
    }
  }

  // data attribute (for object)
  if (el.hasAttribute('data')) {
    const data = el.getAttribute('data');
    const abs = resolveUrl(data);
    if (urlToFilename.has(abs)) {
      el.setAttribute('data', './media/' + urlToFilename.get(abs));
    }
  }

  // inline style
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