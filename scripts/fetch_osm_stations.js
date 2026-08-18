const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const queryPath = path.join(projectRoot, 'data', 'osm-shanghai-metro.overpass');
const outputPath = path.join(projectRoot, 'data', 'osm-shanghai-metro.snapshot.json');
const contact = String(process.env.METRO_RESTROOM_CONTACT || '').trim();

if (!contact) {
  throw new Error('请先设置 METRO_RESTROOM_CONTACT，用于 Overpass User-Agent 联系信息。');
}

const query = fs.readFileSync(queryPath, 'utf8').trim();
const body = `data=${encodeURIComponent(query)}`;
const request = https.request({
  hostname: 'overpass-api.de',
  path: '/api/interpreter',
  method: 'POST',
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded',
    'Content-Length': Buffer.byteLength(body),
    'User-Agent': `MetroRestroom/1.0 contact:${contact}`,
  },
}, (response) => {
  const chunks = [];
  response.on('data', (chunk) => chunks.push(chunk));
  response.on('end', () => {
    const buffer = Buffer.concat(chunks);
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new Error(`Overpass 请求失败：HTTP ${response.statusCode}`);
    }
    JSON.parse(buffer.toString('utf8'));
    fs.writeFileSync(outputPath, buffer);
    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
    console.log(`已写入 ${path.relative(projectRoot, outputPath)}`);
    console.log(`SHA-256 ${sha256}`);
  });
});

request.setTimeout(130000, () => request.destroy(new Error('Overpass 请求超时。')));
request.on('error', (error) => {
  throw error;
});
request.end(body);
