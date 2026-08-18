const restroomData = require('./generated/restrooms');
const {
  LINES,
  canGenerateSameNameTransfer,
  normalizeStationName,
} = require('./topology');
const { estimateEta } = require('../utils/eta');
const { getPreferences, getLastLocationStation } = require('../utils/storage');

const records = restroomData.lines.reduce(
  (result, line) => result.concat(line.records || []),
  [],
);
const recordById = Object.create(null);
const recordsByLineAndName = Object.create(null);
const transferTargetsById = Object.create(null);
const browsableStationIds = Object.create(null);

function canonicalKey(lineId, stationName) {
  return `${lineId}:${normalizeStationName(stationName, lineId)}`;
}

records.forEach((record) => {
  recordById[record.lineStationId] = record;
  const key = canonicalKey(record.lineId, record.stationName);
  if (!recordsByLineAndName[key]) recordsByLineAndName[key] = [];
  recordsByLineAndName[key].push(record);
  transferTargetsById[record.lineStationId] = [];
});

for (let leftIndex = 0; leftIndex < records.length; leftIndex += 1) {
  const left = records[leftIndex];
  for (let rightIndex = leftIndex + 1; rightIndex < records.length; rightIndex += 1) {
    const right = records[rightIndex];
    if (!canGenerateSameNameTransfer(
      left.lineId,
      left.stationName,
      right.lineId,
      right.stationName,
    )) continue;
    transferTargetsById[left.lineStationId].push(right.lineStationId);
    transferTargetsById[right.lineStationId].push(left.lineStationId);
  }
}

function findRecord(lineId, stationName) {
  const matches = recordsByLineAndName[canonicalKey(lineId, stationName)] || [];
  return matches[0] || null;
}

function getRouteStatus(route, stationName, record) {
  const explicit = route.stationStatusByName
    && route.stationStatusByName[stationName];
  return explicit || (record && record.status) || 'active';
}

function routeStations(line, route, includeUnavailable) {
  return (route.stationNames || []).map((stationName) => {
    const record = findRecord(line.id, stationName);
    return {
      id: record ? record.lineStationId : `${line.id}:${stationName}`,
      lineId: line.id,
      name: stationName,
      sourceName: record ? record.stationName : stationName,
      record,
      status: getRouteStatus(route, stationName, record),
    };
  }).filter((station) => includeUnavailable || station.status === 'active');
}

function directionReversesRoute(line, route, directionId) {
  if (line.type === 'loop') return directionId === 'inner';
  const names = route.stationNames || [];
  const firstName = names[0] || '';
  const direction = line.directions[directionId] || {};
  return direction.label === `往${firstName}` || directionId === 'reverse';
}

function routeDirectionIds(line, route) {
  const ids = route.directionIds || Object.keys(line.directions || {});
  return ids.filter((id) => Boolean(line.directions[id]));
}

function routeLabel(route) {
  if (route.name) return route.name;
  if (route.terminalName) return `往${route.terminalName}`;
  const names = route.stationNames || [];
  return names.length > 1 ? `${names[0]}—${names[names.length - 1]}` : route.id;
}

function getLineOptions() {
  return Object.keys(LINES).map((lineId) => {
    const line = LINES[lineId];
    const directions = Object.keys(line.directions).map((directionId) => ({
      id: directionId,
      label: line.directions[directionId].label,
    }));
    return {
      id: line.id,
      name: line.name,
      color: line.color,
      type: line.type,
      defaultRouteId: line.defaultRouteId || line.routes[0].id,
      defaultDirection: line.defaultDirection || directions[0].id,
      directions,
      routes: line.routes.map((route) => ({
        id: route.id,
        name: routeLabel(route),
        terminalName: route.terminalName || '',
        splitStationName: route.splitStationName || '',
        stationNames: (route.stationNames || []).slice(),
        directions: routeDirectionIds(line, route).map((directionId) => ({
          id: directionId,
          label: line.directions[directionId].label,
        })),
      })),
    };
  });
}

const graph = Object.create(null);

function addGraphEdge(from, to, kind) {
  if (!from || !to || from === to) return;
  if (!graph[from]) graph[from] = [];
  if (!graph[to]) graph[to] = [];
  if (!graph[from].some((edge) => edge.to === to && edge.kind === kind)) {
    graph[from].push({ to, kind });
    graph[to].push({ to: from, kind });
  }
}

Object.keys(LINES).forEach((lineId) => {
  const line = LINES[lineId];
  line.routes.forEach((route) => {
    const stations = routeStations(line, route, true);
    stations.forEach((station) => {
      if (station.record && station.status === 'active' && station.record.status === 'active') {
        browsableStationIds[station.id] = true;
      }
    });
    for (let index = 0; index < stations.length - 1; index += 1) {
      addGraphEdge(stations[index].id, stations[index + 1].id, 'train');
    }
    if (route.closed && stations.length > 2) {
      addGraphEdge(stations[stations.length - 1].id, stations[0].id, 'train');
    }
  });
});

Object.keys(transferTargetsById).forEach((fromId) => {
  transferTargetsById[fromId].forEach((toId) => addGraphEdge(fromId, toId, 'transfer'));
});

function shortestMetrics(originId, targetId) {
  if (!recordById[originId] || !recordById[targetId]) {
    return { segmentCount: 0, transferCount: 0 };
  }
  if (originId === targetId) return { segmentCount: 0, transferCount: 0 };

  const distances = Object.create(null);
  const queue = [{ id: originId, cost: 0, segmentCount: 0, transferCount: 0 }];
  distances[originId] = 0;

  while (queue.length) {
    queue.sort((left, right) => left.cost - right.cost);
    const current = queue.shift();
    if (current.cost !== distances[current.id]) continue;
    if (current.id === targetId) return current;

    (graph[current.id] || []).forEach((edge) => {
      const isTransfer = edge.kind === 'transfer';
      const cost = current.cost + (isTransfer ? 6 : 3);
      if (distances[edge.to] !== undefined && distances[edge.to] <= cost) return;
      distances[edge.to] = cost;
      queue.push({
        id: edge.to,
        cost,
        segmentCount: current.segmentCount + (isTransfer ? 0 : 1),
        transferCount: current.transferCount + (isTransfer ? 1 : 0),
      });
    });
  }

  return { segmentCount: 0, transferCount: 0 };
}

function normalizeAccess(accessRaw) {
  if (!accessRaw) return '';
  return String(accessRaw)
    .replace(/费区内/g, '闸内')
    .replace(/费区外/g, '闸外');
}

function accessCategory(access) {
  if (access.indexOf('车站外') >= 0) return '车站外';
  if (access.indexOf('闸外') >= 0) return '闸外';
  return '闸内';
}

function restroomRecordsForStation(station) {
  if (!station.record) return [];
  const recordIds = [station.id].concat(transferTargetsById[station.id] || []);
  return recordIds.map((id) => recordById[id]).filter((record) => record && record.status === 'active');
}

function buildRestroom(record, originStationId, isReverse) {
  const access = normalizeAccess(record.accessRaw);
  const metrics = shortestMetrics(originStationId, record.lineStationId);
  const eta = estimateEta({
    segmentCount: metrics.segmentCount,
    transferCount: metrics.transferCount,
    isReverse,
    access: accessCategory(access),
  });
  return {
    id: `${record.lineStationId}-restroom`,
    lineId: record.lineId,
    lineName: record.lineName,
    location: record.locationRaw || '',
    locationRaw: record.locationRaw,
    access,
    accessRaw: record.accessRaw,
    facility: '厕所',
    sourceSheet: record.sourceSheet,
    sourceRow: record.sourceRow,
    etaLabel: eta.label,
    etaBreakdown: eta.breakdown,
  };
}

function resolveInput(input) {
  const request = input || {};
  const line = LINES[request.lineId] || LINES['2'];
  const route = line.routes.find((item) => item.id === request.routeId)
    || line.routes.find((item) => item.id === line.defaultRouteId)
    || line.routes[0];
  const allowedDirectionIds = routeDirectionIds(line, route);
  const directionId = allowedDirectionIds.includes(request.direction)
    ? request.direction
    : (allowedDirectionIds.includes(line.defaultDirection)
      ? line.defaultDirection
      : allowedDirectionIds[0]);
  const routeConfirmed = line.type !== 'branched'
    || line.routes.some((item) => item.id === request.routeId);
  return { line, route, directionId, routeConfirmed };
}

function commonBranchStationNames(line, route) {
  if (line.type !== 'branched' || line.routes.length < 2) return route.stationNames;
  const otherRouteNames = line.routes
    .filter((item) => item.id !== route.id)
    .map((item) => new Set(item.stationNames));
  return route.stationNames.filter((stationName) => (
    otherRouteNames.every((stationNames) => stationNames.has(stationName))
  ));
}

const systemOriginRecord = findRecord('2', '人民广场');
const SYSTEM_ORIGIN_STATION_ID = systemOriginRecord && systemOriginRecord.lineStationId;
const LEGACY_STATION_NAMES = Object.freeze({
  'l2-jingan-temple': Object.freeze(['2', '静安寺']),
  'l2-west-nanjing-road': Object.freeze(['2', '南京西路']),
  'l2-renmin-square': Object.freeze(['2', '人民广场']),
  'l2-east-nanjing-road': Object.freeze(['2', '南京东路']),
  'l2-lujiazui': Object.freeze(['2', '陆家嘴']),
  'l2-dongchang-road': Object.freeze(['2', '东昌路']),
  'l2-century-avenue': Object.freeze(['2', '世纪大道']),
  'l8-qufu-road': Object.freeze(['8', '曲阜路']),
  'l8-renmin-square': Object.freeze(['8', '人民广场']),
  'l8-dashijie': Object.freeze(['8', '大世界']),
  'l8-laoximen': Object.freeze(['8', '老西门']),
});

function resolveStationId(stationId) {
  if (browsableStationIds[stationId]) return stationId;
  const legacy = LEGACY_STATION_NAMES[stationId];
  if (!legacy) return SYSTEM_ORIGIN_STATION_ID;
  const record = findRecord(legacy[0], legacy[1]);
  return record && browsableStationIds[record.lineStationId]
    ? record.lineStationId
    : SYSTEM_ORIGIN_STATION_ID;
}

function routeForRecord(line, record) {
  const normalizedName = normalizeStationName(record.stationName, record.lineId);
  return line.routes.find((route) => (route.stationNames || []).some((stationName) => (
    normalizeStationName(stationName, line.id) === normalizedName
  ))) || line.routes[0];
}

function getStationContext(stationId) {
  const record = recordById[stationId];
  if (!record || !browsableStationIds[stationId]) return null;

  const line = LINES[record.lineId];
  const route = routeForRecord(line, record);
  const directionIds = routeDirectionIds(line, route);
  const direction = directionIds.includes(line.defaultDirection)
    ? line.defaultDirection
    : directionIds[0];
  return {
    lineStationId: stationId,
    lineId: line.id,
    lineName: line.name,
    stationName: record.stationName,
    routeId: route.id,
    direction,
  };
}

function getLocationCandidateOptions(candidate) {
  const source = candidate || {};
  return (source.lineStationIds || []).map((stationId) => {
    const context = getStationContext(stationId);
    return context && Object.assign({}, context, {
      physicalStationId: source.physicalStationId || '',
      distanceMeters: Number(source.distanceMeters) || 0,
    });
  }).filter(Boolean).sort((left, right) => {
    const lineDifference = String(left.lineId).localeCompare(String(right.lineId), 'zh-CN', {
      numeric: true,
    });
    return lineDifference || left.lineStationId.localeCompare(right.lineStationId);
  });
}

function visibleOriginIndex(stations, originStationId) {
  const directIndex = stations.findIndex((station) => station.id === originStationId);
  if (directIndex >= 0) return directIndex;
  const transferIds = transferTargetsById[originStationId] || [];
  const transferIndex = stations.findIndex((station) => transferIds.includes(station.id));
  return transferIndex >= 0 ? transferIndex : Math.floor(stations.length / 2);
}

function directRouteMetrics(line, stations, originIndex, targetIndex) {
  if (originIndex < 0 || targetIndex < 0) return null;
  if (line.type !== 'loop') {
    return {
      segmentCount: Math.abs(targetIndex - originIndex),
      isReverse: targetIndex < originIndex,
    };
  }

  const forwardCount = (targetIndex - originIndex + stations.length) % stations.length;
  const reverseCount = (originIndex - targetIndex + stations.length) % stations.length;
  const reverseWins = reverseCount + 2 < forwardCount;
  return {
    segmentCount: reverseWins ? reverseCount : forwardCount,
    isReverse: reverseWins,
  };
}

function buildHomeView(input) {
  const resolved = resolveInput(input);
  const direction = resolved.line.directions[resolved.directionId];
  const reverseRoute = directionReversesRoute(
    resolved.line,
    resolved.route,
    resolved.directionId,
  );
  const visibleRoute = resolved.routeConfirmed
    ? resolved.route
    : Object.assign({}, resolved.route, {
      stationNames: commonBranchStationNames(resolved.line, resolved.route),
    });
  const stations = routeStations(resolved.line, visibleRoute, false);
  if (reverseRoute) stations.reverse();

  const requestedOriginId = input && input.originStationId;
  const originStationId = resolveStationId(requestedOriginId);
  const currentIndex = visibleOriginIndex(stations, originStationId);
  const directOriginIndex = stations.findIndex((station) => station.id === originStationId);
  const originRecord = recordById[originStationId];

  const viewStations = stations.map((station, index) => {
    const directMetrics = directOriginIndex >= 0
      ? directRouteMetrics(resolved.line, stations, directOriginIndex, index)
      : null;
    const restroomRecords = restroomRecordsForStation(station);
    const restrooms = restroomRecords.map((record) => buildRestroom(
      record,
      originStationId,
      Boolean(directMetrics && directMetrics.isReverse),
    ));
    return {
      id: station.id,
      name: station.name,
      sourceName: station.sourceName,
      status: station.status,
      etaLabel: restrooms.length ? restrooms[0].etaLabel : '',
      restrooms,
      transfers: (transferTargetsById[station.id] || []).map((targetId) => ({
        lineId: recordById[targetId].lineId,
        stationId: targetId,
      })),
      isReverse: Boolean(directMetrics && directMetrics.isReverse),
      hasRestroom: restrooms.length > 0,
      isOrigin: station.id === originStationId,
      dataState: station.record ? 'available' : 'unavailable',
    };
  });

  let directionLabel = resolved.routeConfirmed ? direction.label : '支线待确认';
  if (resolved.line.type === 'loop' && stations.length) {
    const nextIndex = (currentIndex + 1) % stations.length;
    directionLabel = `${direction.label} · 下一站${stations[nextIndex].name}`;
  }

  return {
    line: {
      id: resolved.line.id,
      name: resolved.line.name,
      color: resolved.line.color,
      type: resolved.line.type,
      routeId: resolved.routeConfirmed ? resolved.route.id : '',
      routeName: routeLabel(resolved.route),
    },
    direction: resolved.directionId,
    directionLabel,
    originStationId,
    originStationName: originRecord ? originRecord.stationName : '人民广场',
    stations: viewStations,
    currentIndex,
  };
}

function getInitialHomeState() {
  const preferences = getPreferences();
  const lastLocation = getLastLocationStation();
  const lastLocationStationId = lastLocation
    && browsableStationIds[lastLocation.lineStationId]
    ? lastLocation.lineStationId
    : '';
  const systemOriginStationId = lastLocationStationId || SYSTEM_ORIGIN_STATION_ID;
  const manualOriginId = resolveStationId(preferences.originStationId);
  const originStationId = preferences.originMode === 'manual'
    ? manualOriginId
    : systemOriginStationId;
  const view = buildHomeView({
    lineId: preferences.lineId,
    routeId: preferences.routeId,
    direction: preferences.direction,
    originStationId,
  });
  return {
    cityName: '上海',
    lineId: view.line.id,
    routeId: view.line.routeId,
    direction: view.direction,
    originStationId: view.originStationId,
    originMode: preferences.originMode === 'manual' ? 'manual' : 'smart',
    systemOriginStationId,
    lastLocationStation: lastLocationStationId ? lastLocation : null,
    visibleStationId: view.stations[view.currentIndex] && view.stations[view.currentIndex].id,
    locationStatus: 'notRequested',
    directionMode: preferences.directionMode === 'manual' ? 'manual' : 'default',
    soundEnabled: preferences.soundEnabled !== false,
    vibrationEnabled: preferences.vibrationEnabled !== false,
  };
}

module.exports = {
  getInitialHomeState,
  getLineOptions,
  buildHomeView,
  getStationContext,
  getLocationCandidateOptions,
};
