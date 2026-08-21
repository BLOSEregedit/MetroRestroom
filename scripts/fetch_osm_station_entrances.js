const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const queryPath = path.join(projectRoot, 'data', 'osm-shanghai-metro-entrances.overpass');
const outputPath = path.join(projectRoot, 'data', 'osm-shanghai-metro-entrances.snapshot.json');
const contact = String(process.env.METRO_RESTROOM_CONTACT || '').trim();
const endpoint = new URL(
  process.env.METRO_RESTROOM_OVERPASS_ENDPOINT
    || 'https://overpass-api.de/api/interpreter',
);

if (!contact) {
  throw new Error('请先设置 METRO_RESTROOM_CONTACT，用于 Overpass User-Agent 联系信息。');
}
if (endpoint.protocol !== 'https:') {
  throw new Error('Overpass 端点必须使用 HTTPS。');
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function snapshotDate(timestamp) {
  return /^\d{4}-\d{2}-\d{2}T/.test(String(timestamp || ''))
    ? String(timestamp).slice(0, 10)
    : '';
}

function memberCode(type) {
  if (type === 'node') return 'n';
  if (type === 'way') return 'w';
  if (type === 'relation') return 'r';
  return '';
}

function compactMembers(members) {
  const seen = new Set();
  return (members || []).map((member) => {
    const code = memberCode(member.type);
    const id = Number(member.ref);
    return code && Number.isSafeInteger(id) ? [code, id] : null;
  }).filter((member) => {
    if (!member) return false;
    const key = `${member[0]}:${member[1]}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((left, right) => (
    left[0].localeCompare(right[0]) || left[1] - right[1]
  ));
}

function compactSnapshot(raw, query, rawBuffer) {
  const elements = Array.isArray(raw.elements) ? raw.elements : [];
  const entrances = elements.filter((element) => (
    element.type === 'node'
      && element.tags
      && element.tags.railway === 'subway_entrance'
  )).map((element) => [
    Number(element.id),
    Number(element.lat),
    Number(element.lon),
    String(element.tags.ref || ''),
  ]).filter((row) => (
    Number.isSafeInteger(row[0])
      && Number.isFinite(row[1])
      && Number.isFinite(row[2])
  )).sort((left, right) => left[0] - right[0]);

  const stopAreas = elements.filter((element) => (
    element.type === 'relation'
      && element.tags
      && element.tags.public_transport === 'stop_area'
  )).map((element) => [
    Number(element.id),
    String(element.tags['name:zh'] || element.tags.name || ''),
    compactMembers(element.members),
  ]).filter((row) => Number.isSafeInteger(row[0]))
    .sort((left, right) => left[0] - right[0]);

  const routes = elements.filter((element) => (
    element.type === 'relation'
      && element.tags
      && element.tags.type === 'route'
      && /^(subway|light_rail)$/.test(String(element.tags.route || ''))
  )).map((element) => [
    Number(element.id),
    String(element.tags.ref || ''),
    String(element.tags.route || ''),
    compactMembers(element.members),
  ]).filter((row) => Number.isSafeInteger(row[0]))
    .sort((left, right) => left[0] - right[0]);

  const osmTimestamp = String(raw.osm3s && raw.osm3s.timestamp_osm_base || '');
  if (!snapshotDate(osmTimestamp)) throw new Error('Overpass 返回缺少有效 OSM 时间戳。');
  if (!entrances.length || !stopAreas.length || !routes.length) {
    throw new Error('Overpass 返回缺少入口、stop_area 或 route 元素。');
  }

  return {
    schemaVersion: 1,
    source: {
      name: 'OpenStreetMap',
      license: 'ODbL-1.0',
      url: 'https://www.openstreetmap.org/copyright',
      attribution: '© OpenStreetMap contributors',
      endpoint: endpoint.origin + endpoint.pathname,
      querySha256: sha256(query),
      rawSha256: sha256(rawBuffer),
      osmTimestamp,
      generator: String(raw.generator || ''),
      copyright: String(raw.osm3s && raw.osm3s.copyright || ''),
    },
    snapshotDate: snapshotDate(osmTimestamp),
    entrances,
    stopAreas,
    routes,
  };
}

function requestOverpass(query) {
  const body = `data=${encodeURIComponent(query)}`;
  return new Promise((resolve, reject) => {
    const request = https.request({
      protocol: endpoint.protocol,
      hostname: endpoint.hostname,
      port: endpoint.port || undefined,
      path: `${endpoint.pathname}${endpoint.search}`,
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
          reject(new Error(`Overpass 请求失败：HTTP ${response.statusCode}`));
          return;
        }
        resolve(buffer);
      });
    });
    request.setTimeout(260000, () => request.destroy(new Error('Overpass 请求超时。')));
    request.on('error', reject);
    request.end(body);
  });
}

async function main() {
  const query = fs.readFileSync(queryPath, 'utf8').trim();
  const rawBuffer = await requestOverpass(query);
  let raw;
  try {
    raw = JSON.parse(rawBuffer.toString('utf8'));
  } catch (error) {
    throw new Error(`Overpass 返回不是有效 JSON：${error.message}`);
  }
  const compact = compactSnapshot(raw, query, rawBuffer);
  const serialized = `${JSON.stringify(compact)}\n`;
  fs.writeFileSync(outputPath, serialized);
  console.log(`入口快照已写入 ${path.relative(projectRoot, outputPath)}`);
  console.log(`OSM 时间 ${compact.source.osmTimestamp}`);
  console.log(
    `精简元素：${compact.entrances.length} 个入口，`
      + `${compact.stopAreas.length} 个 stop_area，${compact.routes.length} 条 route。`,
  );
  console.log(`快照 SHA-256 ${sha256(serialized)}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
