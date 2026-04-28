/**
 * test-content-extraction.js
 * 模拟测试 content.js 在 CSDN 页面上的提取逻辑
 */

const fs = require('fs');
const { JSDOM } = require('jsdom');

// 读取获取到的 CSDN 页面 HTML
const htmlContent = fs.readFileSync('/root/.local/share/opencode/tool-output/tool_dd35d7f6f001jHeGnI7pjRitv3', 'utf-8');

// 使用 JSDOM 模拟浏览器环境
const dom = new JSDOM(htmlContent, {
  url: 'https://blog.csdn.net/bdfcfff77fa/article/details/156047633',
  runScripts: 'outside-only'
});

const document = dom.window.document;
const window = dom.window;

// ====== 模拟 content.js 的核心函数 ======

function extractMediaUrls() {
  const urls = new Set();

  // 1. 提取 <img> 标签的 src 和 srcset
  document.querySelectorAll('img').forEach((img) => {
    if (img.src) {
      urls.add(img.src);
    }
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

  // 过滤掉 data URI、javascript:、about: 等非 HTTP URL
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
    if (url) {
      urlSet.add(resolveUrl(url));
    }
  }
}

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

function resolveUrl(url) {
  try {
    return new URL(url, window.location.href).href;
  } catch (e) {
    return url;
  }
}

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
    return filename;
  } catch (e) {
    return 'resource_' + Math.abs(hashCode(url)) + '.bin';
  }
}

function hashCode(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return hash;
}

// ====== 执行测试 ======

console.log('========== CSDN 页面插件功能测试 ==========\n');

// 测试 1：提取媒体资源
console.log('【测试 1】提取媒体资源 URL');
const mediaUrls = extractMediaUrls();
console.log(`发现媒体资源数量: ${mediaUrls.length}`);
console.log('\n前 20 个媒体资源 URL:');
mediaUrls.slice(0, 20).forEach((url, index) => {
  console.log(`  ${index + 1}. ${url}`);
});

if (mediaUrls.length > 20) {
  console.log(`  ... 还有 ${mediaUrls.length - 20} 个资源`);
}

// 测试 2：验证路径重写
console.log('\n\n【测试 2】验证路径重写逻辑');
const urlToFilename = new Map();
mediaUrls.forEach((url) => {
  urlToFilename.set(url, getLocalFilename(url));
});

console.log('\nURL -> 本地文件名映射（前 10 个）:');
let count = 0;
for (const [url, filename] of urlToFilename) {
  if (count >= 10) break;
  console.log(`  ${url.substring(0, 60)}... -> ./media/${filename}`);
  count++;
}

// 测试 3：检查文章核心图片是否被提取
console.log('\n\n【测试 3】检查文章核心图片');
const articleImages = mediaUrls.filter(url => 
  url.includes('i-blog.csdnimg.cn') || 
  url.includes('img-blog.csdnimg.cn') ||
  url.includes('img_convert')
);
console.log(`文章相关图片数量: ${articleImages.length}`);

// 测试 4：检查头像是否被提取
console.log('\n【测试 4】检查头像资源');
const avatarImages = mediaUrls.filter(url => 
  url.includes('profile-avatar')
);
console.log(`头像资源数量: ${avatarImages.length}`);
if (avatarImages.length > 0) {
  console.log(`  头像 URL: ${avatarImages[0]}`);
}

// 测试 5：检查 UI 图标是否被提取
console.log('\n【测试 5】检查 UI 图标资源');
const uiIcons = mediaUrls.filter(url => 
  url.includes('csdnimg.cn/release/blogv2')
);
console.log(`UI 图标资源数量: ${uiIcons.length}`);

// 测试 6：验证 HTML 内容保留
console.log('\n\n【测试 6】验证 HTML 内容完整性');
const title = document.title;
const articleContent = document.getElementById('article_content');
console.log(`页面标题: ${title}`);
console.log(`文章正文元素存在: ${articleContent ? '是' : '否'}`);
if (articleContent) {
  console.log(`文章正文长度: ${articleContent.innerHTML.length} 字符`);
}

// 测试 7：统计资源域名分布
console.log('\n\n【测试 7】资源域名分布');
const domainCount = new Map();
mediaUrls.forEach(url => {
  try {
    const domain = new URL(url).hostname;
    domainCount.set(domain, (domainCount.get(domain) || 0) + 1);
  } catch (e) {}
});

const sortedDomains = Array.from(domainCount.entries()).sort((a, b) => b[1] - a[1]);
sortedDomains.forEach(([domain, count]) => {
  console.log(`  ${domain}: ${count} 个资源`);
});

console.log('\n========== 测试完成 ==========');
