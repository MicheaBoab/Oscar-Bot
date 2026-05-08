const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const IMAGES_DIR = path.join(__dirname, '../storage/images');

// 确保 /storage/images/ 目录存在
function ensureImagesDir() {
  if (!fs.existsSync(IMAGES_DIR)) {
    fs.mkdirSync(IMAGES_DIR, { recursive: true });
  }
}

// 从 URL 下载图片，返回本地存储路径
// filename: 可选，默认用 URL 的文件名或生成随机名
async function downloadImage(imageUrl, filename = null) {
  return new Promise((resolve, reject) => {
    try {
      ensureImagesDir();

      // 解析 URL 获取文件扩展名
      const urlObj = new URL(imageUrl);
      const urlPath = urlObj.pathname;
      const ext = path.extname(urlPath) || '.webp';

      // 如果未提供文件名，则生成一个
      const finalFilename = filename
        ? (filename.includes('.') ? filename : `${filename}${ext}`)
        : `img_${Date.now()}${ext}`;

      const filePath = path.join(IMAGES_DIR, finalFilename);

      // 选择合适的协议
      const protocol = imageUrl.startsWith('https') ? https : http;

      const request = protocol.get(imageUrl, { timeout: 10000 }, (response) => {
        // 检查是否成功
        if (response.statusCode !== 200) {
          reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
          return;
        }

        // 检查文件大小（限制 50MB）
        const contentLength = parseInt(response.headers['content-length'] || '0', 10);
        if (contentLength > 50 * 1024 * 1024) {
          reject(new Error(`文件过大：${(contentLength / 1024 / 1024).toFixed(2)}MB（限制 50MB）`));
          return;
        }

        const fileStream = fs.createWriteStream(filePath);

        response.pipe(fileStream);

        fileStream.on('finish', () => {
          fileStream.close();
          // 返回相对于 storage 的路径
          const relativePath = path.relative(path.join(__dirname, '../storage'), filePath);
          resolve(relativePath);
        });

        fileStream.on('error', (err) => {
          fs.unlink(filePath, () => {}); // 删除失败的文件
          reject(err);
        });
      });

      request.on('timeout', () => {
        request.destroy();
        reject(new Error('请求超时（10秒）'));
      });

      request.on('error', (err) => {
        reject(err);
      });
    } catch (error) {
      reject(error);
    }
  });
}

module.exports = {
  downloadImage,
  ensureImagesDir,
};
