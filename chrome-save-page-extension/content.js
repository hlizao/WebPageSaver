/**
 * content.js
 * 内容脚本（Content Script）
 * 注入到每个网页中，负责提取当前页面的完整 HTML 代码和所有媒体资源的 URL 列表
 *
 * 本文件依赖 page-extractor.js 中定义的提取函数：
 *   - extractPage(): 主入口，返回提取结果
 *   - extractMediaUrls(): 提取媒体资源 URL
 *   - buildOfflineHtml(): 构建离线可用的 HTML
 *   - getLocalFilename(): 生成本地文件名
 *   - getMediaCategory(): 判断媒体类型
 *   - hashCode(): 字符串哈希
 */

/**
 * 监听来自 popup.js 的消息
 * 当用户点击保存按钮时，popup.js 会发送 extractPage 消息
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'extractPage') {
    try {
      // 调用 page-extractor.js 中的主入口函数提取页面内容
      const result = extractPage();
      sendResponse(result);
    } catch (err) {
      sendResponse({
        success: false,
        error: err.message || '页面提取失败'
      });
    }
    // 返回 true 表示会异步调用 sendResponse
    return true;
  }
});
