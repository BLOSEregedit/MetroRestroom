const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const restroomData = require('../miniprogram/data/generated/restrooms');
const {
  canGenerateSameNameTransfer,
  normalizeStationName,
} = require('../miniprogram/data/topology');

const projectRoot = path.resolve(__dirname, '..');
const snapshotPath = path.join(projectRoot, 'data', 'osm-shanghai-metro.snapshot.json');
const overridePath = path.join(projectRoot, 'data', 'station-coordinate-overrides.json');
const outputPath = path.join(projectRoot, 'miniprogram', 'data', 'station-locations.js');
const EXPECTED_ACTIVE_LINE_STATIONS = 518;
const EXPECTED_PHYSICAL_STATIONS = 411;

function matchName(value) {
  return String(value || '')
    .normalize('NFKC')
    .trim()
    .replace(/[・•]/g, '·')
    .replace(/\s+/g, '')
    .replace(/地铁站$|站$/g, '');
}

function candidateNames(element) {
  const tags = element.tags || {};
  return [tags['name:zh'], tags.name, tags.official_name, tags.old_name, tags.alt_name]
    .filter(Boolean)
    .flatMap((name) => String(name).split(/[;；]/))
    .map(matchName)
    .filter(Boolean);
}

function activeRecords() {
  return restroomData.lines.reduce((records, line) => records.concat(line.records || []), [])
    .filter((record) => record.status === 'active');
}

function physicalGroups(records) {
  const parent = records.map((record, index) => index);
  function find(index) {
    if (parent[index] !== index) parent[index] = find(parent[index]);
    return parent[index];
  }
  function union(left, right) {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parent[rightRoot] = leftRoot;
  }

  for (let left = 0; left < records.length; left += 1) {
    for (let right = left + 1; right < records.length; right += 1) {
      if (canGenerateSameNameTransfer(
        records[left].lineId,
        records[left].stationName,
        records[right].lineId,
        records[right].stationName,
      )) union(left, right);
    }
  }

  const byRoot = Object.create(null);
  records.forEach((record, index) => {
    const root = find(index);
    if (!byRoot[root]) byRoot[root] = [];
    byRoot[root].push(record);
  });
  return Object.keys(byRoot).map((root) => {
    const members = byRoot[root].slice().sort((left, right) => (
      left.lineStationId.localeCompare(right.lineStationId)
    ));
    const canonicalNames = members.map((record) => (
      normalizeStationName(record.stationName, record.lineId)
    ));
    return {
      physicalStationId: `physical-${members[0].lineStationId}`,
      canonicalName: canonicalNames[0],
      matchNames: Array.from(new Set(canonicalNames.concat(members.map((record) => record.stationName))))
        .map(matchName),
      lineStationIds: members.map((record) => record.lineStationId),
    };
  }).sort((left, right) => left.physicalStationId.localeCompare(right.physicalStationId));
}

function elementPosition(element) {
  const center = element.center || element;
  return { latitude: Number(center.lat), longitude: Number(center.lon) };
}

function elementKey(element) {
  return `${element.type}/${element.id}`;
}

function sourceDate(snapshot) {
  const timestamp = snapshot.osm3s && snapshot.osm3s.timestamp_osm_base || '';
  return timestamp ? String(timestamp).slice(0, 10) : '';
}

function build() {
  const snapshotBuffer = fs.readFileSync(snapshotPath);
  const snapshot = JSON.parse(snapshotBuffer.toString('utf8'));
  const overrides = JSON.parse(fs.readFileSync(overridePath, 'utf8'));
  const records = activeRecords();
  const groups = physicalGroups(records);
  const elements = (snapshot.elements || []).filter((element) => {
    const position = elementPosition(element);
    return Number.isFinite(position.latitude) && Number.isFinite(position.longitude);
  }).sort((left, right) => elementKey(left).localeCompare(elementKey(right)));
  const byElementKey = Object.create(null);
  elements.forEach((element) => { byElementKey[elementKey(element)] = element; });

  if (records.length !== EXPECTED_ACTIVE_LINE_STATIONS) {
    throw new Error(`active 线路站应为 ${EXPECTED_ACTIVE_LINE_STATIONS}，实际 ${records.length}。`);
  }
  if (groups.length !== EXPECTED_PHYSICAL_STATIONS) {
    throw new Error(`物理站应为 ${EXPECTED_PHYSICAL_STATIONS}，实际 ${groups.length}。`);
  }

  const usedElements = Object.create(null);
  const unmatched = [];
  const ambiguous = [];
  const stations = groups.map((group) => {
    const overrideKey = overrides[group.physicalStationId];
    let matches = overrideKey ? [byElementKey[overrideKey]].filter(Boolean) : elements.filter((element) => (
      candidateNames(element).some((name) => group.matchNames.includes(name))
    ));
    matches = matches.filter((element) => !usedElements[elementKey(element)] || overrideKey);
    if (!matches.length) {
      unmatched.push(group);
      return null;
    }
    if (matches.length > 1) {
      ambiguous.push({ group, matches: matches.map(elementKey) });
      return null;
    }
    const element = matches[0];
    usedElements[elementKey(element)] = true;
    return Object.assign({}, group, elementPosition(element), {
      coordinateSystem: 'WGS84',
      osmType: element.type,
      osmId: element.id,
    });
  }).filter(Boolean);

  if (unmatched.length || ambiguous.length) {
    console.error('未匹配：', unmatched.map((group) => `${group.physicalStationId}:${group.canonicalName}`));
    console.error('多候选：', ambiguous);
    throw new Error('坐标未达到 411/411，请补充 station-coordinate-overrides.json。');
  }
  const coveredLineStations = stations.reduce(
    (count, station) => count + station.lineStationIds.length,
    0,
  );
  if (coveredLineStations !== EXPECTED_ACTIVE_LINE_STATIONS) {
    throw new Error(`坐标仅覆盖 ${coveredLineStations}/${EXPECTED_ACTIVE_LINE_STATIONS} 条 active 线路站。`);
  }

  const sha256 = crypto.createHash('sha256').update(snapshotBuffer).digest('hex');
  const output = {
    schemaVersion: 1,
    dataReady: true,
    source: {
      name: 'OpenStreetMap',
      coordinateSystem: 'WGS84',
      license: 'ODbL-1.0',
      url: 'https://www.openstreetmap.org/copyright',
      snapshotSha256: sha256,
      snapshotDate: sourceDate(snapshot),
    },
    stations,
  };
  const serialized = `// 此文件由 scripts/build_station_locations.js 确定性生成，请勿手工编辑。\nmodule.exports = ${JSON.stringify(output, null, 2)};\n`;
  fs.writeFileSync(outputPath, serialized);
  console.log(`坐标验收通过：${stations.length}/411 个物理站，${coveredLineStations}/518 条线路站。`);
  console.log(`输出 SHA-256 ${crypto.createHash('sha256').update(serialized).digest('hex')}`);
}

build();
