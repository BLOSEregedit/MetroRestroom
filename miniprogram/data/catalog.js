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

function getBranchActionLabel(terminalName) {
  const name = String(terminalName || '').trim();
  if (!name) return '点击切换支线';
  const stationName = /站$/.test(name) ? name : `${name}站`;
  return `点击切换至${stationName}支线`;
}

function getBranchTrackActionLabel(branchRole, terminalName) {
  const roleLabel = branchRole === 'main' ? '主线' : '支线';
  const name = String(terminalName || '').trim();
  return name ? `切换至${roleLabel} · ${name}方向` : `切换至${roleLabel}`;
}

function compareLineIds(left, right) {
  return String(left).localeCompare(String(right), 'zh-CN', { numeric: true });
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
        branchRole: route.branchRole || '',
        terminalName: route.terminalName || '',
        actionLabel: getBranchActionLabel(route.terminalName),
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
    return {
      stationIds: [],
      lineIds: [],
      transferStationIds: [],
      segmentCount: 0,
      transferCount: 0,
    };
  }
  if (originId === targetId) {
    return {
      stationIds: [originId],
      lineIds: [recordById[originId].lineId],
      transferStationIds: [],
      segmentCount: 0,
      transferCount: 0,
    };
  }

  const distances = Object.create(null);
  const previous = Object.create(null);
  const queue = [{ id: originId, cost: 0, segmentCount: 0, transferCount: 0 }];
  distances[originId] = 0;

  while (queue.length) {
    queue.sort((left, right) => left.cost - right.cost);
    const current = queue.shift();
    if (current.cost !== distances[current.id]) continue;
    if (current.id === targetId) {
      const stationIds = [];
      const transferStationIds = [];
      let cursorId = targetId;
      while (cursorId) {
        stationIds.push(cursorId);
        const step = previous[cursorId];
        if (step && step.kind === 'transfer') {
          transferStationIds.push(cursorId, step.from);
        }
        cursorId = step && step.from;
      }
      stationIds.reverse();
      transferStationIds.reverse();
      const lineIds = stationIds.reduce((result, stationId) => {
        const record = recordById[stationId];
        if (record && !result.includes(record.lineId)) result.push(record.lineId);
        return result;
      }, []);
      return {
        stationIds,
        lineIds,
        transferStationIds: transferStationIds.filter(
          (stationId, index, all) => all.indexOf(stationId) === index,
        ),
        segmentCount: current.segmentCount,
        transferCount: current.transferCount,
      };
    }

    (graph[current.id] || []).forEach((edge) => {
      const isTransfer = edge.kind === 'transfer';
      const cost = current.cost + (isTransfer ? 6 : 3);
      if (distances[edge.to] !== undefined && distances[edge.to] <= cost) return;
      distances[edge.to] = cost;
      previous[edge.to] = { from: current.id, kind: edge.kind };
      queue.push({
        id: edge.to,
        cost,
        segmentCount: current.segmentCount + (isTransfer ? 0 : 1),
        transferCount: current.transferCount + (isTransfer ? 1 : 0),
      });
    });
  }

  return {
    stationIds: [],
    lineIds: [],
    transferStationIds: [],
    segmentCount: 0,
    transferCount: 0,
  };
}

function normalizeAccess(accessRaw) {
  if (!accessRaw) return '';
  return String(accessRaw)
    .replace(/费区内/g, '闸内')
    .replace(/费区外/g, '闸外');
}

function normalizeLocationText(locationRaw) {
  return String(locationRaw || '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function uniqueValues(values) {
  return values.filter((value, index, all) => value && all.indexOf(value) === index);
}

function extractExitLabel(location) {
  const expanded = String(location || '').replace(
    /([东南西北]?\d+(?:\s*[、，,\/／.]\s*[东南西北]?\d+)+)号口/g,
    (match, numbers) => numbers
      .split(/[、，,\/／.]/)
      .map((number) => `${number.trim()}号口`)
      .join('、'),
  );
  const exits = [];
  const exitPattern = /([东南西北]?\d+)号口/g;
  let match = exitPattern.exec(expanded);
  while (match) {
    exits.push(match[1]);
    match = exitPattern.exec(expanded);
  }
  const uniqueExits = uniqueValues(exits);
  if (!uniqueExits.length) return '';
  if (uniqueExits.length === 1 && new RegExp(`${uniqueExits[0]}号口外`).test(expanded)) {
    return `${uniqueExits[0]}号口外`;
  }
  const prefix = /近|靠近|附近/.test(location) ? '近' : '';
  return `${prefix}${uniqueExits.join('／')}号口`;
}

function extractOrientationLabel(location) {
  const anchors = [];
  const directionPattern = /往([^、，,。；;]{1,18}?)方向(?:站台)?(?:的)?(车头|车尾|中部|中间)/g;
  let match = directionPattern.exec(location);
  while (match) {
    anchors.push({
      destination: match[1].trim(),
      position: match[2] === '中间' ? '中部' : match[2],
    });
    match = directionPattern.exec(location);
  }
  const uniqueAnchors = anchors.filter((anchor, index, all) => (
    all.findIndex((item) => (
      item.destination === anchor.destination && item.position === anchor.position
    )) === index
  ));
  if (uniqueAnchors.length === 1) {
    return `往${uniqueAnchors[0].destination}·${uniqueAnchors[0].position}`;
  }
  if (uniqueAnchors.length > 1) {
    return `双向·${uniqueValues(uniqueAnchors.map((anchor) => anchor.position)).join('／')}`;
  }

  const standalonePosition = location.match(/车头|车尾|中部|中间|两端/);
  if (!standalonePosition) return '';
  const position = standalonePosition[0] === '中间' ? '中部' : standalonePosition[0];
  return `方向待确认·${position}`;
}

function deriveRestroomPresentation(record) {
  const location = normalizeLocationText(record.locationRaw);
  const accessSource = String(record.accessRaw || '');
  const normalizedAccess = normalizeAccess(accessSource);
  const hasInside = /费区内|闸内/.test(accessSource);
  const hasOutside = /费区外|闸外/.test(accessSource)
    || /(?:费区内|闸内)\s*[\/／、，,]\s*外/.test(accessSource);
  const hasStationOutside = /车站外|站外/.test(accessSource);
  const locationSaysOutside = /站外|[东南西北]?\d+号口外/.test(location);
  const accessConflict = hasInside && !hasOutside && !hasStationOutside && locationSaysOutside;

  let accessLabel = '闸区待确认';
  let accessTone = 'unknown';
  if (!accessConflict) {
    if (hasStationOutside && hasOutside) {
      accessLabel = '闸外／站外';
      accessTone = 'outside';
    } else if (hasStationOutside && hasInside) {
      accessLabel = '闸内／站外';
      accessTone = 'mixed';
    } else if (hasInside && hasOutside) {
      accessLabel = '闸内／闸外';
      accessTone = 'mixed';
    } else if (hasStationOutside || (!normalizedAccess && locationSaysOutside)) {
      accessLabel = '站外';
      accessTone = 'outside';
    } else if (hasOutside) {
      accessLabel = '闸外';
      accessTone = 'outside';
    } else if (hasInside) {
      accessLabel = '闸内';
      accessTone = 'inside';
    }
  }

  const exitLabel = extractExitLabel(location);
  const orientationLabel = extractOrientationLabel(location);
  const hasPlatform = /站台|候车/.test(location);
  let zoneLabel = '';
  if (/换乘通道/.test(location)) zoneLabel = '换乘通道';
  else if (hasPlatform && !orientationLabel && !exitLabel) zoneLabel = '站台';
  const tags = [{ label: accessLabel, tone: accessTone }];
  if (zoneLabel) tags.push({ label: zoneLabel, tone: 'neutral' });
  if (orientationLabel || exitLabel) {
    tags.push({ label: orientationLabel || exitLabel, tone: 'anchor' });
  }
  if (!location) tags.push({ label: '位置待补充', tone: 'unknown' });

  return {
    accessLabel,
    accessConflict,
    zoneLabel,
    exitLabel,
    orientationLabel,
    wayfindingTags: tags.slice(0, 2),
    wayfindingSummary: tags.slice(0, 2).map((tag) => tag.label).join('，'),
    detailLocation: location,
  };
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
  const presentation = deriveRestroomPresentation(record);
  const metrics = shortestMetrics(originStationId, record.lineStationId);
  const eta = estimateEta({
    segmentCount: metrics.segmentCount,
    transferCount: metrics.transferCount,
    isReverse,
    access: accessCategory(access),
  });
  return {
    id: `${record.lineStationId}-restroom`,
    stationId: record.lineStationId,
    lineId: record.lineId,
    lineName: record.lineName,
    location: record.locationRaw || '',
    locationRaw: record.locationRaw,
    access,
    accessRaw: record.accessRaw,
    facility: '厕所',
    accessLabel: presentation.accessLabel,
    accessConflict: presentation.accessConflict,
    zoneLabel: presentation.zoneLabel,
    exitLabel: presentation.exitLabel,
    orientationLabel: presentation.orientationLabel,
    wayfindingTags: presentation.wayfindingTags,
    wayfindingSummary: presentation.wayfindingSummary,
    detailLocation: presentation.detailLocation,
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
  return { line, route, directionId };
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

function getStationContext(stationId, preferred) {
  const record = recordById[stationId];
  if (!record || !browsableStationIds[stationId]) return null;

  const line = LINES[record.lineId];
  const normalizedName = normalizeStationName(record.stationName, record.lineId);
  const matchingRoutes = line.routes.filter((route) => (route.stationNames || []).some(
    (stationName) => normalizeStationName(stationName, line.id) === normalizedName,
  ));
  const preferredState = preferred || {};
  const sameLine = preferredState.lineId === line.id;
  const route = (sameLine && matchingRoutes.find((item) => item.id === preferredState.routeId))
    || matchingRoutes.find((item) => item.id === line.defaultRouteId)
    || matchingRoutes[0]
    || routeForRecord(line, record);
  const directionIds = routeDirectionIds(line, route);
  const keepsPreferredDirection = sameLine && directionIds.includes(preferredState.direction);
  const direction = keepsPreferredDirection
    ? preferredState.direction
    : (directionIds.includes(line.defaultDirection) ? line.defaultDirection : directionIds[0]);
  return {
    lineStationId: stationId,
    lineId: line.id,
    lineName: line.name,
    stationName: record.stationName,
    routeId: route.id,
    direction,
    directionMode: keepsPreferredDirection && preferredState.directionMode === 'manual'
      ? 'manual'
      : 'default',
  };
}

function getLocationCandidateOptions(candidate, preferred) {
  const source = candidate || {};
  return (source.lineStationIds || []).map((stationId) => {
    const context = getStationContext(stationId, preferred);
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
  const stations = routeStations(resolved.line, resolved.route, false);
  if (reverseRoute) stations.reverse();
  const alternateRoute = resolved.line.type === 'branched'
    ? resolved.line.routes.find((route) => route.id !== resolved.route.id)
    : null;

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
    const path = shortestMetrics(originStationId, station.id);
    const syncLineIds = path.lineIds.slice();
    restrooms.forEach((restroom) => {
      if (!syncLineIds.includes(restroom.lineId)) syncLineIds.push(restroom.lineId);
    });
    return {
      id: station.id,
      name: station.name,
      sourceName: station.sourceName,
      status: station.status,
      etaLabel: restrooms.length ? restrooms[0].etaLabel : '',
      restrooms,
      path,
      syncLineIds,
      transfers: (transferTargetsById[station.id] || []).map((targetId) => {
        const targetRecord = recordById[targetId];
        const targetLine = targetRecord && LINES[targetRecord.lineId];
        return {
          lineId: targetRecord.lineId,
          lineName: targetLine.name,
          lineColor: targetLine.color,
          stationId: targetId,
        };
      }).sort((left, right) => compareLineIds(left.lineId, right.lineId)),
      isReverse: Boolean(directMetrics && directMetrics.isReverse),
      hasRestroom: restrooms.length > 0,
      isOrigin: station.id === originStationId,
      dataState: station.record ? 'available' : 'unavailable',
      branchHint: alternateRoute && station.name === resolved.route.splitStationName
        ? {
          routeId: alternateRoute.id,
          terminalName: alternateRoute.terminalName,
          actionLabel: getBranchTrackActionLabel(
            alternateRoute.branchRole,
            alternateRoute.terminalName,
          ),
        }
        : null,
    };
  });

  return {
    line: {
      id: resolved.line.id,
      name: resolved.line.name,
      color: resolved.line.color,
      type: resolved.line.type,
      routeId: resolved.route.id,
      routeName: routeLabel(resolved.route),
    },
    direction: resolved.directionId,
    directionLabel: direction.label,
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
  getPathMetadata: shortestMetrics,
};
