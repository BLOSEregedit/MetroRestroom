const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const queryPath = path.join(projectRoot, 'data', 'osm-shanghai-metro-entrances.overpass');
const snapshotPath = path.join(
  projectRoot,
  'data',
  'osm-shanghai-metro-entrances.snapshot.json',
);
const runtimePath = path.join(projectRoot, 'miniprogram', 'data', 'station-entrances.js');
const stationLocationData = require('../miniprogram/data/station-locations');
const stationEntranceData = require('../miniprogram/data/station-entrances');

const MIN_RUNTIME_ENTRANCES = 1400;
const MIN_PHYSICAL_STATIONS = 360;
const MIN_LINE_STATIONS = 400;
const MAX_RUNTIME_FILE_BYTES = 200 * 1024;

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function validate() {
  const query = fs.readFileSync(queryPath, 'utf8').trim();
  const snapshotBuffer = fs.readFileSync(snapshotPath);
  const snapshot = JSON.parse(snapshotBuffer.toString('utf8'));
  const runtimeBytes = fs.statSync(runtimePath).size;

  assert.strictEqual(snapshot.schemaVersion, 1);
  assert.strictEqual(snapshot.source.name, 'OpenStreetMap');
  assert.strictEqual(snapshot.source.license, 'ODbL-1.0');
  assert.strictEqual(snapshot.source.url, 'https://www.openstreetmap.org/copyright');
  assert.strictEqual(snapshot.source.attribution, '© OpenStreetMap contributors');
  assert.strictEqual(snapshot.source.querySha256, sha256(query));
  assert(/^\d{4}-\d{2}-\d{2}T/.test(snapshot.source.osmTimestamp));
  assert.strictEqual(snapshot.snapshotDate, snapshot.source.osmTimestamp.slice(0, 10));
  assert(Array.isArray(snapshot.entrances) && snapshot.entrances.length >= MIN_RUNTIME_ENTRANCES);
  assert(Array.isArray(snapshot.stopAreas) && snapshot.stopAreas.length > 0);
  assert(Array.isArray(snapshot.routes) && snapshot.routes.length > 0);

  assert.strictEqual(stationEntranceData.schemaVersion, 1);
  assert.strictEqual(stationEntranceData.source.name, 'OpenStreetMap');
  assert.strictEqual(stationEntranceData.source.coordinateSystem, 'WGS84');
  assert.strictEqual(stationEntranceData.source.license, 'ODbL-1.0');
  assert.strictEqual(
    stationEntranceData.source.url,
    'https://www.openstreetmap.org/copyright',
  );
  assert.strictEqual(
    stationEntranceData.source.attribution,
    '© OpenStreetMap contributors',
  );
  assert.strictEqual(
    stationEntranceData.source.relationship,
    'stop_area-route-member-intersection',
  );
  assert.strictEqual(stationEntranceData.source.snapshotSha256, sha256(snapshotBuffer));
  assert.strictEqual(stationEntranceData.source.querySha256, sha256(query));
  assert.strictEqual(stationEntranceData.snapshotDate, snapshot.snapshotDate);
  assert(runtimeBytes <= MAX_RUNTIME_FILE_BYTES);

  const stationById = new Map(
    (stationLocationData.stations || []).map((station) => [station.physicalStationId, station]),
  );
  const snapshotEntranceById = new Map(
    snapshot.entrances.map((entrance) => [Number(entrance[0]), entrance]),
  );
  const seenIds = new Set();
  const coveredPhysicalStations = new Set();
  const coveredLineStations = new Set();
  const associationCounts = { unknown: 0, unique: 0, multiple: 0 };

  assert(Array.isArray(stationEntranceData.entrances));
  assert(stationEntranceData.entrances.length >= MIN_RUNTIME_ENTRANCES);
  stationEntranceData.entrances.forEach((entrance) => {
    assert(Number.isSafeInteger(entrance.osmNodeId) && entrance.osmNodeId > 0);
    assert(!seenIds.has(entrance.osmNodeId), `入口重复：${entrance.osmNodeId}`);
    seenIds.add(entrance.osmNodeId);
    assert.strictEqual(typeof entrance.ref, 'string');
    assert(Number.isFinite(entrance.lat) && entrance.lat >= -90 && entrance.lat <= 90);
    assert(Number.isFinite(entrance.lon) && entrance.lon >= -180 && entrance.lon <= 180);
    assert.strictEqual(entrance.snapshotDate, stationEntranceData.snapshotDate);
    assert(['unknown', 'unique', 'multiple'].includes(entrance.association));
    assert(Array.isArray(entrance.lineStationIds));

    const snapshotEntrance = snapshotEntranceById.get(entrance.osmNodeId);
    assert(snapshotEntrance, `运行时入口不在快照：${entrance.osmNodeId}`);
    assert.strictEqual(entrance.lat, Number(snapshotEntrance[1]));
    assert.strictEqual(entrance.lon, Number(snapshotEntrance[2]));
    assert.strictEqual(entrance.ref, String(snapshotEntrance[3] || ''));

    const station = stationById.get(entrance.physicalStationId);
    assert(station, `入口引用未知物理站：${entrance.physicalStationId}`);
    const allowedLineStationIds = new Set(station.lineStationIds || []);
    entrance.lineStationIds.forEach((lineStationId) => {
      assert(
        allowedLineStationIds.has(lineStationId),
        `${entrance.osmNodeId} 的线路站不属于 ${entrance.physicalStationId}：${lineStationId}`,
      );
      coveredLineStations.add(lineStationId);
    });
    coveredPhysicalStations.add(entrance.physicalStationId);
    associationCounts[entrance.association] += 1;
    if (entrance.association === 'unknown') assert.strictEqual(entrance.lineStationIds.length, 0);
    if (entrance.association === 'unique') assert.strictEqual(entrance.lineStationIds.length, 1);
    if (entrance.association === 'multiple') assert(entrance.lineStationIds.length > 1);
  });

  assert(coveredPhysicalStations.size >= MIN_PHYSICAL_STATIONS);
  assert(coveredLineStations.size >= MIN_LINE_STATIONS);
  assert(associationCounts.unknown > 0);
  assert(associationCounts.multiple > 0);
  assert.strictEqual(
    stationEntranceData.source.totalOsmEntrances,
    snapshot.entrances.length,
  );
  assert.strictEqual(
    stationEntranceData.source.runtimeEntrances,
    stationEntranceData.entrances.length,
  );
  assert.strictEqual(
    stationEntranceData.source.mappedPhysicalStations,
    coveredPhysicalStations.size,
  );
  assert.strictEqual(
    stationEntranceData.source.mappedLineStations,
    coveredLineStations.size,
  );
  assert.deepStrictEqual(stationEntranceData.source.associationCounts, associationCounts);
  assert.strictEqual(
    stationEntranceData.source.unmappedPhysicalEntrances
      + stationEntranceData.source.ambiguousPhysicalEntrances
      + stationEntranceData.source.runtimeEntrances,
    stationEntranceData.source.totalOsmEntrances,
  );

  console.log(
    `入口数据验收通过：${stationEntranceData.entrances.length}`
      + `/${stationEntranceData.source.totalOsmEntrances} 个 OSM 入口，`
      + `${coveredPhysicalStations.size}/411 个物理站，`
      + `${coveredLineStations.size}/518 个线路站。`,
  );
  console.log(
    `关系：unique ${associationCounts.unique}，multiple ${associationCounts.multiple}，`
      + `unknown ${associationCounts.unknown}；运行时文件 ${runtimeBytes} 字节。`,
  );
}

validate();
