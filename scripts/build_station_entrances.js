const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const restroomData = require('../miniprogram/data/generated/restrooms');
const stationLocationData = require('../miniprogram/data/station-locations');

const projectRoot = path.resolve(__dirname, '..');
const snapshotPath = path.join(
  projectRoot,
  'data',
  'osm-shanghai-metro-entrances.snapshot.json',
);
const outputPath = path.join(projectRoot, 'miniprogram', 'data', 'station-entrances.js');
const MIN_OSM_ENTRANCES = 1400;
const MIN_RUNTIME_ENTRANCES = 1400;
const MIN_PHYSICAL_STATIONS = 360;
const MIN_LINE_STATIONS = 400;
const MAX_RUNTIME_FILE_BYTES = 200 * 1024;
const ASSOCIATIONS = Object.freeze(['unknown', 'unique', 'multiple']);

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function matchName(value) {
  return String(value || '')
    .normalize('NFKC')
    .trim()
    .replace(/[（(][^）)]*(?:号线|线)[^）)]*[）)]/g, '')
    .replace(/[・•]/g, '·')
    .replace(/\s+/g, '')
    .replace(/地铁站$|站$/g, '');
}

function memberKey(member) {
  const types = { n: 'node', w: 'way', r: 'relation' };
  return member && types[member[0]] ? `${types[member[0]]}/${member[1]}` : '';
}

function normalizeRouteRef(value) {
  const ref = String(value || '').trim();
  if (/^\d{1,2}$/.test(ref)) {
    const numeric = Number(ref);
    return numeric >= 1 && numeric <= 18 ? String(numeric) : '';
  }
  return /浦江/.test(ref) ? 'pujiang' : '';
}

function activeRecords() {
  return restroomData.lines.reduce((records, line) => records.concat(line.records || []), [])
    .filter((record) => record.status === 'active');
}

function addToSetMap(map, key, value) {
  if (!map.has(key)) map.set(key, new Set());
  map.get(key).add(value);
}

function indexPhysicalStations(stations) {
  const byId = new Map();
  const byElement = new Map();
  const byName = new Map();
  stations.forEach((station) => {
    byId.set(station.physicalStationId, station);
    (station.osmElements || []).forEach((element) => {
      addToSetMap(byElement, element, station.physicalStationId);
    });
    [station.canonicalName].concat(station.matchNames || []).forEach((name) => {
      const normalized = matchName(name);
      if (normalized) addToSetMap(byName, normalized, station.physicalStationId);
    });
  });
  return { byId, byElement, byName };
}

function physicalIdsForStopArea(stopArea, index) {
  const matches = new Set();
  (stopArea[2] || []).forEach((member) => {
    const elementMatches = index.byElement.get(memberKey(member));
    if (elementMatches) {
      elementMatches.forEach((physicalStationId) => matches.add(physicalStationId));
    }
  });

  const nameMatches = index.byName.get(matchName(stopArea[1]));
  if (nameMatches && nameMatches.size === 1) {
    nameMatches.forEach((physicalStationId) => matches.add(physicalStationId));
  }
  return matches;
}

function buildRuntime(snapshot, snapshotBuffer) {
  if (snapshot.schemaVersion !== 1) throw new Error('入口快照 schemaVersion 必须为 1。');
  if (!snapshot.source || snapshot.source.license !== 'ODbL-1.0') {
    throw new Error('入口快照缺少 ODbL-1.0 元数据。');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(snapshot.snapshotDate || ''))) {
    throw new Error('入口快照缺少有效 snapshotDate。');
  }

  const entrances = Array.isArray(snapshot.entrances) ? snapshot.entrances : [];
  const stopAreas = Array.isArray(snapshot.stopAreas) ? snapshot.stopAreas : [];
  const routes = Array.isArray(snapshot.routes) ? snapshot.routes : [];
  if (entrances.length < MIN_OSM_ENTRANCES) {
    throw new Error(`OSM 入口仅 ${entrances.length} 个，低于 ${MIN_OSM_ENTRANCES}。`);
  }

  const stationLocations = stationLocationData.stations || [];
  const physicalIndex = indexPhysicalStations(stationLocations);
  const records = activeRecords();
  const recordByLineStationId = new Map(records.map((record) => [record.lineStationId, record]));
  stationLocations.forEach((station) => {
    (station.lineStationIds || []).forEach((lineStationId) => {
      if (!recordByLineStationId.has(lineStationId)) {
        throw new Error(`物理站引用未知 active lineStationId：${lineStationId}`);
      }
    });
  });

  const entranceIds = new Set(entrances.map((row) => Number(row[0])));
  const routeLinesByMember = new Map();
  let recognizedRoutes = 0;
  routes.forEach((route) => {
    const lineId = normalizeRouteRef(route[1]);
    if (!lineId) return;
    recognizedRoutes += 1;
    (route[3] || []).forEach((member) => {
      addToSetMap(routeLinesByMember, memberKey(member), lineId);
    });
  });

  const stopAreaByEntrance = new Map();
  let mappedStopAreas = 0;
  let stopAreasWithRoutes = 0;
  stopAreas.forEach((stopArea) => {
    const physicalIds = physicalIdsForStopArea(stopArea, physicalIndex);
    const lineIds = new Set();
    (stopArea[2] || []).forEach((member) => {
      const routeLines = routeLinesByMember.get(memberKey(member));
      if (routeLines) routeLines.forEach((lineId) => lineIds.add(lineId));
    });
    if (physicalIds.size) mappedStopAreas += 1;
    if (lineIds.size) stopAreasWithRoutes += 1;
    const info = { physicalIds, lineIds };
    (stopArea[2] || []).forEach((member) => {
      if (member[0] !== 'n' || !entranceIds.has(Number(member[1]))) return;
      const entranceId = Number(member[1]);
      if (!stopAreaByEntrance.has(entranceId)) stopAreaByEntrance.set(entranceId, []);
      stopAreaByEntrance.get(entranceId).push(info);
    });
  });

  let unmappedPhysicalEntrances = 0;
  let ambiguousPhysicalEntrances = 0;
  const runtimeEntrances = [];
  entrances.forEach((entrance) => {
    const linked = stopAreaByEntrance.get(Number(entrance[0])) || [];
    const physicalIds = new Set();
    linked.forEach((info) => {
      info.physicalIds.forEach((physicalStationId) => physicalIds.add(physicalStationId));
    });
    if (!physicalIds.size) {
      unmappedPhysicalEntrances += 1;
      return;
    }
    if (physicalIds.size !== 1) {
      ambiguousPhysicalEntrances += 1;
      return;
    }

    const physicalStationId = Array.from(physicalIds)[0];
    const station = physicalIndex.byId.get(physicalStationId);
    const linkedLineIds = new Set();
    linked.forEach((info) => {
      if (!info.physicalIds.has(physicalStationId)) return;
      info.lineIds.forEach((lineId) => linkedLineIds.add(lineId));
    });
    const lineStationIds = (station.lineStationIds || []).filter((lineStationId) => {
      const record = recordByLineStationId.get(lineStationId);
      return record && linkedLineIds.has(record.lineId);
    }).sort();
    const association = lineStationIds.length === 1
      ? 'unique'
      : (lineStationIds.length > 1 ? 'multiple' : 'unknown');
    runtimeEntrances.push({
      osmNodeId: Number(entrance[0]),
      ref: String(entrance[3] || ''),
      lat: Number(entrance[1]),
      lon: Number(entrance[2]),
      physicalStationId,
      lineStationIds,
      association,
      snapshotDate: snapshot.snapshotDate,
    });
  });
  runtimeEntrances.sort((left, right) => left.osmNodeId - right.osmNodeId);

  const coveredPhysicalStations = new Set(
    runtimeEntrances.map((entrance) => entrance.physicalStationId),
  );
  const coveredLineStations = new Set();
  const associationCounts = { unknown: 0, unique: 0, multiple: 0 };
  runtimeEntrances.forEach((entrance) => {
    associationCounts[entrance.association] += 1;
    entrance.lineStationIds.forEach((lineStationId) => coveredLineStations.add(lineStationId));
  });

  if (runtimeEntrances.length < MIN_RUNTIME_ENTRANCES) {
    throw new Error(`运行时入口仅 ${runtimeEntrances.length} 个，低于 ${MIN_RUNTIME_ENTRANCES}。`);
  }
  if (coveredPhysicalStations.size < MIN_PHYSICAL_STATIONS) {
    throw new Error(`入口仅覆盖 ${coveredPhysicalStations.size} 个物理站。`);
  }
  if (coveredLineStations.size < MIN_LINE_STATIONS) {
    throw new Error(`入口线路关系仅覆盖 ${coveredLineStations.size} 个线路站。`);
  }
  if (!associationCounts.unknown || !associationCounts.multiple) {
    throw new Error('入口构建不得消除 unknown 或 multiple 关系。');
  }

  return {
    output: {
      schemaVersion: 1,
      source: {
        name: 'OpenStreetMap',
        coordinateSystem: 'WGS84',
        license: 'ODbL-1.0',
        url: 'https://www.openstreetmap.org/copyright',
        attribution: '© OpenStreetMap contributors',
        relationship: 'stop_area-route-member-intersection',
        snapshotSha256: sha256(snapshotBuffer),
        querySha256: String(snapshot.source.querySha256 || ''),
        osmTimestamp: String(snapshot.source.osmTimestamp || ''),
        totalOsmEntrances: entrances.length,
        runtimeEntrances: runtimeEntrances.length,
        unmappedPhysicalEntrances,
        ambiguousPhysicalEntrances,
        mappedPhysicalStations: coveredPhysicalStations.size,
        mappedLineStations: coveredLineStations.size,
        stopAreas: stopAreas.length,
        mappedStopAreas,
        stopAreasWithRoutes,
        routes: routes.length,
        recognizedRoutes,
        associationCounts,
      },
      snapshotDate: snapshot.snapshotDate,
      entrances: runtimeEntrances,
    },
    stats: {
      associationCounts,
      coveredPhysicalStations: coveredPhysicalStations.size,
      coveredLineStations: coveredLineStations.size,
    },
  };
}

function serializeRuntime(output) {
  const physicalStationIds = Array.from(new Set(
    output.entrances.map((entrance) => entrance.physicalStationId),
  )).sort();
  const physicalIndex = new Map(physicalStationIds.map((id, index) => [id, index]));
  const lineStationIdSetKeys = Array.from(new Set(
    output.entrances.map((entrance) => JSON.stringify(entrance.lineStationIds)),
  )).sort();
  const lineStationIdSets = lineStationIdSetKeys.map((key) => JSON.parse(key));
  const lineStationIdSetIndex = new Map(
    lineStationIdSetKeys.map((key, index) => [key, index]),
  );
  const rows = output.entrances.map((entrance) => [
    entrance.osmNodeId,
    entrance.ref,
    entrance.lat,
    entrance.lon,
    physicalIndex.get(entrance.physicalStationId),
    lineStationIdSetIndex.get(JSON.stringify(entrance.lineStationIds)),
    ASSOCIATIONS.indexOf(entrance.association),
  ]);

  return [
    '// 此文件由 scripts/build_station_entrances.js 确定性生成，请勿手工编辑。',
    `const snapshotDate=${JSON.stringify(output.snapshotDate)};`,
    `const physicalStationIds=${JSON.stringify(physicalStationIds)};`,
    `const lineStationIdSets=${JSON.stringify(lineStationIdSets)};`,
    `const associations=${JSON.stringify(ASSOCIATIONS)};`,
    `const rows=${JSON.stringify(rows)};`,
    'module.exports={',
    `schemaVersion:${output.schemaVersion},`,
    `source:${JSON.stringify(output.source)},`,
    'snapshotDate,',
    'entrances:rows.map((row)=>({',
    'osmNodeId:row[0],ref:row[1],lat:row[2],lon:row[3],',
    'physicalStationId:physicalStationIds[row[4]],',
    'lineStationIds:lineStationIdSets[row[5]].slice(),',
    'association:associations[row[6]],snapshotDate,',
    '})),',
    '};',
    '',
  ].join('\n');
}

function main() {
  const snapshotBuffer = fs.readFileSync(snapshotPath);
  const snapshot = JSON.parse(snapshotBuffer.toString('utf8'));
  const result = buildRuntime(snapshot, snapshotBuffer);
  const serialized = serializeRuntime(result.output);
  const bytes = Buffer.byteLength(serialized);
  if (bytes > MAX_RUNTIME_FILE_BYTES) {
    throw new Error(`运行时入口文件 ${bytes} 字节，超过 ${MAX_RUNTIME_FILE_BYTES} 字节。`);
  }
  fs.writeFileSync(outputPath, serialized);
  console.log(
    `入口构建通过：${result.output.entrances.length}/${result.output.source.totalOsmEntrances} 个入口，`
      + `${result.stats.coveredPhysicalStations}/411 个物理站，`
      + `${result.stats.coveredLineStations}/518 个线路站。`,
  );
  console.log(
    `关系：unique ${result.stats.associationCounts.unique}，`
      + `multiple ${result.stats.associationCounts.multiple}，`
      + `unknown ${result.stats.associationCounts.unknown}。`,
  );
  console.log(`运行时文件 ${bytes} 字节，SHA-256 ${sha256(serialized)}`);
}

main();
