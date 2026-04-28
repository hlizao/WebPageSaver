/**
 * test-media-download.js
 * 测试媒体资源下载逻辑
 * 模拟 background.js 中的 fetchMediaAsBlob 和下载流程
 */

const fs = require('fs');
const path = require('path');

// 从之前的测试结果中选取代表性的资源 URL 进行下载测试
const testUrls = [
  // 文章核心图片（i-blog.csdnimg.cn）
  'https://i-blog.csdnimg.cn/img_convert/c30fbf24d0e50c798997bec5f7d48b38.jpeg',
  'https://i-blog.csdnimg.cn/img_convert/4a9b0ef417e6fb93315de13bbbf82a17.jpeg',
  'https://i-blog.csdnimg.cn/direct/ca94d7aeb73e4a47842fa8af60cef20c.jpeg#pic_center',
  
  // UI 图标（csdnimg.cn）
  'https://csdnimg.cn/release/blogv2/dist/pc/img/newHeart2023Black.png',
  'https://csdnimg.cn/release/blogv2/dist/pc/img/tobarCollect2.png',
  
  // 头像（profile-avatar.csdnimg.cn）
  'https://profile-avatar.csdnimg.cn/0636d7128a9548e5819ade0b95f7d838_bdfcfff77fa.jpg!1',
  
  // 运营图片（i-operation.csdnimg.cn）
  'https://i-operation.csdnimg.cn/images/a5fff6f6c9f0464c9a46b130c972952b.png',
];

const outputDir = '/workspace/test-downloads';

// 创建测试目录
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// 模拟 getLocalFilename 函数
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
    return 'resource_unknown.bin';
  }
}

// 模拟 fetchMediaAsBlob 下载资源
async function fetchMediaAsBlob(url) {
  const response = await fetch(url, {
    method: 'GET',
    credentials: 'include'
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return await response.blob();
}

// 保存 Blob 到文件（模拟 saveBlobToFile）
async function saveBlobToFile(blob, filename) {
  const buffer = Buffer.from(await blob.arrayBuffer());
  const filePath = path.join(outputDir, filename);
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

// 主测试函数
async function runDownloadTest() {
  console.log('========== 媒体资源下载测试 ==========\n');
  console.log(`测试资源总数: ${testUrls.length}`);
  console.log(`保存目录: ${outputDir}\n`);

  let successCount = 0;
  let failCount = 0;
  const results = [];

  for (let i = 0; i < testUrls.length; i++) {
    const url = testUrls[i];
    const filename = getLocalFilename(url);
    
    console.log(`[${i + 1}/${testUrls.length}] 下载测试: ${url.substring(0, 70)}...`);
    
    try {
      const startTime = Date.now();
      const blob = await fetchMediaAsBlob(url);
      const downloadTime = Date.now() - startTime;
      
      const filePath = await saveBlobToFile(blob, filename);
      const stats = fs.statSync(filePath);
      
      console.log(`  ✓ 成功 | 文件名: ${filename} | 大小: ${(stats.size / 1024).toFixed(2)} KB | 耗时: ${downloadTime}ms`);
      
      results.push({
        url,
        filename,
        status: 'success',
        size: stats.size,
        time: downloadTime,
        path: filePath
      });
      successCount++;
    } catch (err) {
      console.log(`  ✗ 失败 | 错误: ${err.message}`);
      
      results.push({
        url,
        filename,
        status: 'failed',
        error: err.message
      });
      failCount++;
    }
  }

  // 输出汇总
  console.log('\n========== 下载测试结果汇总 ==========');
  console.log(`总资源数: ${testUrls.length}`);
  console.log(`成功: ${successCount}`);
  console.log(`失败: ${failCount}`);
  console.log(`成功率: ${((successCount / testUrls.length) * 100).toFixed(1)}%`);

  // 按域名统计
  console.log('\n按域名统计:');
  const domainStats = new Map();
  results.forEach(r => {
    try {
      const domain = new URL(r.url).hostname;
      if (!domainStats.has(domain)) {
        domainStats.set(domain, { success: 0, failed: 0 });
      }
      if (r.status === 'success') {
        domainStats.get(domain).success++;
      } else {
        domainStats.get(domain).failed++;
      }
    } catch (e) {}
  });

  for (const [domain, stats] of domainStats) {
    console.log(`  ${domain}: 成功 ${stats.success}, 失败 ${stats.failed}`);
  }

  // 验证文件完整性
  console.log('\n文件完整性检查:');
  results.filter(r => r.status === 'success').forEach(r => {
    const ext = path.extname(r.filename).toLowerCase();
    let valid = true;
    
    // 简单检查文件头（magic number）
    const buffer = fs.readFileSync(r.path);
    if (ext === '.png') {
      valid = buffer[0] === 0x89 && buffer[1] === 0x50; // PNG signature
    } else if (ext === '.jpg' || ext === '.jpeg') {
      valid = buffer[0] === 0xFF && buffer[1] === 0xD8; // JPEG signature
    }
    
    console.log(`  ${r.filename}: ${valid ? '✓ 文件格式正确' : '⚠ 文件格式可能异常'} (${(r.size / 1024).toFixed(2)} KB)`);
  });

  console.log('\n========== 测试完成 ==========');
}

runDownloadTest().catch(console.error);
