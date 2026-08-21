const restroomData = require('./generated/restrooms');
const {
  LINES,
  canGenerateSameNameTransfer,
  normalizeStationName,
} = require('./topology');
const { ETA_DEFAULTS, estimateEta } = require('../utils/eta');
const { getPreferences, getLastLocationStation } = require('../utils/storage');
const { normalizeFacilityTerms } = require('../utils/display-copy');

let segmentTimeData = {};
try {
  // 时分数据由离线脚本生成；开发期缺失时继续使用 ETA_DEFAULTS，避免阻塞本地查询。
  segmentTimeData = require('./generated/segment-times');
} catch (error) {
  if (!error || error.code !== 'MODULE_NOT_FOUND'
    || String(error.message || '').indexOf('segment-times') < 0) {
    throw error;
  }
}

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
const routeInfoById = Object.create(null);

function ensureGraphStation(stationId) {
  if (!graph[stationId]) graph[stationId] = [];
}

function addTrainGraphEdge(from, to, lineId, routeId) {
  if (!from || !to || from === to) return;
  ensureGraphStation(from);
  ensureGraphStation(to);
  const forward = graph[from].find((edge) => edge.to === to && edge.kind === 'train');
  const backward = graph[to].find((edge) => edge.to === from && edge.kind === 'train');
  if (forward) {
    if (!forward.routeIds.includes(routeId)) forward.routeIds.push(routeId);
    if (!backward.routeIds.includes(routeId)) backward.routeIds.push(routeId);
    return;
  }
  graph[from].push({ to, kind: 'train', lineId, routeIds: [routeId] });
  graph[to].push({ to: from, kind: 'train', lineId, routeIds: [routeId] });
}

function addTransferGraphEdge(from, to) {
  if (!from || !to || from === to) return;
  ensureGraphStation(from);
  ensureGraphStation(to);
  if (graph[from].some((edge) => edge.to === to && edge.kind === 'transfer')) return;
  graph[from].push({ to, kind: 'transfer' });
  graph[to].push({ to: from, kind: 'transfer' });
}

Object.keys(LINES).forEach((lineId) => {
  const line = LINES[lineId];
  line.routes.forEach((route) => {
    const stations = routeStations(line, route, true);
    const activeStations = stations.filter((station) => (
      station.record && station.status === 'active' && station.record.status === 'active'
    ));
    routeInfoById[route.id] = {
      line,
      route,
      stationIds: activeStations.map((station) => station.id),
    };
    stations.forEach((station) => {
      if (station.record && station.status === 'active' && station.record.status === 'active') {
        browsableStationIds[station.id] = true;
      }
    });
    for (let index = 0; index < activeStations.length - 1; index += 1) {
      addTrainGraphEdge(
        activeStations[index].id,
        activeStations[index + 1].id,
        line.id,
        route.id,
      );
    }
    if (route.closed && activeStations.length > 2) {
      addTrainGraphEdge(
        activeStations[activeStations.length - 1].id,
        activeStations[0].id,
        line.id,
        route.id,
      );
    }
  });
});

Object.keys(transferTargetsById).forEach((fromId) => {
  transferTargetsById[fromId].forEach((toId) => addTransferGraphEdge(fromId, toId));
});

function secondsValue(value, fallback) {
  if (value && typeof value === 'object') {
    const objectValue = value.seconds !== undefined
      ? value.seconds
      : (value.travelSeconds !== undefined ? value.travelSeconds : value.headwaySeconds);
    const seconds = Number(objectValue);
    return Number.isFinite(seconds) && seconds >= 0 ? seconds : fallback;
  }
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : fallback;
}

function defaultTimeSeconds(key, fallback) {
  const defaults = segmentTimeData.defaults || segmentTimeData.defaultSeconds || {};
  return secondsValue(defaults[key], fallback);
}

function medianSeconds(values) {
  const sorted = values.filter((value) => Number.isFinite(value) && value > 0)
    .sort((left, right) => left - right);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function buildLineSegmentMedians(values) {
  const secondsByLineId = Object.create(null);
  Object.keys(values).forEach((key) => {
    const fromId = key.split('>')[0];
    const record = recordById[fromId];
    const seconds = secondsValue(values[key], NaN);
    if (!record || !Number.isFinite(seconds) || seconds <= 0) return;
    if (!secondsByLineId[record.lineId]) secondsByLineId[record.lineId] = [];
    secondsByLineId[record.lineId].push(seconds);
  });
  return Object.keys(secondsByLineId).reduce((result, lineId) => {
    result[lineId] = medianSeconds(secondsByLineId[lineId]);
    return result;
  }, Object.create(null));
}

const directedSegmentValues = segmentTimeData.segments
  || segmentTimeData.directedSegments
  || segmentTimeData.segmentSecondsByDirection
  || {};
const lineSegmentMedianSeconds = buildLineSegmentMedians(directedSegmentValues);

function directedSegmentSeconds(fromId, toId) {
  const key = `${fromId}>${toId}`;
  const exactSeconds = secondsValue(directedSegmentValues[key], NaN);
  if (Number.isFinite(exactSeconds) && exactSeconds > 0) return exactSeconds;
  const fromRecord = recordById[fromId];
  const lineMedian = fromRecord && lineSegmentMedianSeconds[fromRecord.lineId];
  return Number.isFinite(lineMedian) && lineMedian > 0
    ? lineMedian
    : defaultTimeSeconds('segmentSeconds', ETA_DEFAULTS.segmentSeconds);
}

function serviceHeadwaySeconds(lineId, routeId, directionId) {
  const values = segmentTimeData.headways
    || segmentTimeData.headwaySecondsByService
    || {};
  const keys = [
    `${lineId}:${routeId}:${directionId}`,
    `${lineId}:${directionId}`,
    `${lineId}:${routeId}`,
    lineId,
  ];
  for (let index = 0; index < keys.length; index += 1) {
    if (values[keys[index]] !== undefined) {
      return secondsValue(values[keys[index]], ETA_DEFAULTS.headwaySeconds);
    }
  }
  return defaultTimeSeconds('headwaySeconds', ETA_DEFAULTS.headwaySeconds);
}

function transferWalkSeconds(fromId, toId) {
  const values = segmentTimeData.transferWalkSeconds
    || segmentTimeData.transferWalks
    || {};
  return secondsValue(
    values[`${fromId}>${toId}`] !== undefined
      ? values[`${fromId}>${toId}`]
      : values[`${toId}>${fromId}`],
    defaultTimeSeconds('transferWalkSeconds', ETA_DEFAULTS.transferWalkSeconds),
  );
}

function routeStepDirection(routeInfo, fromId, toId) {
  const ids = routeInfo.stationIds;
  const fromIndex = ids.indexOf(fromId);
  const toIndex = ids.indexOf(toId);
  if (fromIndex < 0 || toIndex < 0) return '';
  const isClosedForward = routeInfo.route.closed
    && fromIndex === ids.length - 1
    && toIndex === 0;
  const isClosedReverse = routeInfo.route.closed
    && fromIndex === 0
    && toIndex === ids.length - 1;
  const reversesRoute = isClosedReverse || (!isClosedForward && toIndex < fromIndex);
  const directionIds = routeDirectionIds(routeInfo.line, routeInfo.route);
  return directionIds.find((directionId) => (
    directionReversesRoute(routeInfo.line, routeInfo.route, directionId) === reversesRoute
  )) || directionIds[0] || '';
}

function emptyMetrics(originId) {
  const record = recordById[originId];
  return {
    stationIds: record ? [originId] : [],
    lineIds: record ? [record.lineId] : [],
    transferStationIds: [],
    segmentCount: 0,
    transferCount: 0,
    sameLineChangeCount: 0,
    rideSeconds: 0,
    initialWaitSeconds: 0,
    transferWalkSeconds: 0,
    transferWaitSeconds: 0,
    sameLineChangeWalkSeconds: 0,
    sameLineChangeWaitSeconds: 0,
    reverseWalkSeconds: 0,
    isReverse: false,
    totalSeconds: 0,
  };
}

function comparePathCost(left, right) {
  if (left.totalSeconds !== right.totalSeconds) return left.totalSeconds - right.totalSeconds;
  if (left.transferCount !== right.transferCount) {
    return left.transferCount - right.transferCount;
  }
  if (left.sameLineChangeCount !== right.sameLineChangeCount) {
    return left.sameLineChangeCount - right.sameLineChangeCount;
  }
  return left.segmentCount - right.segmentCount;
}

function priorityPush(queue, item) {
  queue.push(item);
  let index = queue.length - 1;
  while (index > 0) {
    const parentIndex = Math.floor((index - 1) / 2);
    if (comparePathCost(queue[parentIndex], item) <= 0) break;
    queue[index] = queue[parentIndex];
    index = parentIndex;
  }
  queue[index] = item;
}

function priorityPop(queue) {
  if (queue.length === 1) return queue.pop();
  const first = queue[0];
  const last = queue.pop();
  let index = 0;
  while (true) {
    const leftIndex = index * 2 + 1;
    if (leftIndex >= queue.length) break;
    const rightIndex = leftIndex + 1;
    const childIndex = rightIndex < queue.length
      && comparePathCost(queue[rightIndex], queue[leftIndex]) < 0
      ? rightIndex
      : leftIndex;
    if (comparePathCost(last, queue[childIndex]) <= 0) break;
    queue[index] = queue[childIndex];
    index = childIndex;
  }
  queue[index] = last;
  return first;
}

function routeStateKey(item) {
  return [
    item.stationId,
    item.routeId || '',
    item.direction || '',
    item.started ? '1' : '0',
  ].join('|');
}

function buildMetricsFromResult(result, previous) {
  const stationIds = [];
  const transferStationIds = [];
  let cursorKey = routeStateKey(result);
  while (cursorKey) {
    const step = previous[cursorKey];
    const stationId = step ? step.to : result.originId;
    stationIds.push(stationId);
    if (step && step.kind === 'transfer') {
      transferStationIds.push(step.to, step.from);
    }
    cursorKey = step && step.fromKey;
  }
  stationIds.reverse();
  transferStationIds.reverse();
  const lineIds = stationIds.reduce((values, stationId) => {
    const record = recordById[stationId];
    if (record && !values.includes(record.lineId)) values.push(record.lineId);
    return values;
  }, []);
  return Object.assign({}, result, {
    stationIds,
    lineIds,
    transferStationIds: transferStationIds.filter(
      (stationId, index, all) => all.indexOf(stationId) === index,
    ),
  });
}

function runShortestPaths(originId, journeyContext, allowTransfers) {
  const context = journeyContext || {};
  const bestByState = Object.create(null);
  const bestResultByStationId = Object.create(null);
  const previous = Object.create(null);
  const initial = Object.assign(emptyMetrics(originId), {
    stationId: originId,
    originId,
    routeId: '',
    direction: '',
    started: false,
  });
  const initialKey = routeStateKey(initial);
  const queue = [initial];
  bestByState[initialKey] = initial;

  while (queue.length) {
    const current = priorityPop(queue);
    const currentKey = routeStateKey(current);
    if (bestByState[currentKey] !== current) continue;
    if (!bestResultByStationId[current.stationId]) {
      bestResultByStationId[current.stationId] = current;
    }

    (graph[current.stationId] || []).forEach((edge) => {
      if (edge.kind === 'transfer') {
        if (!allowTransfers) return;
        const walkingSeconds = transferWalkSeconds(current.stationId, edge.to);
        const next = Object.assign({}, current, {
          stationId: edge.to,
          routeId: '',
          direction: '',
          transferCount: current.transferCount + 1,
          transferWalkSeconds: current.transferWalkSeconds + walkingSeconds,
          totalSeconds: current.totalSeconds + walkingSeconds,
        });
        const nextKey = routeStateKey(next);
        if (bestByState[nextKey] && comparePathCost(bestByState[nextKey], next) <= 0) return;
        bestByState[nextKey] = next;
        previous[nextKey] = {
          from: current.stationId,
          to: edge.to,
          fromKey: currentKey,
          kind: 'transfer',
        };
        priorityPush(queue, next);
        return;
      }

      edge.routeIds.forEach((routeId) => {
        const routeInfo = routeInfoById[routeId];
        if (!routeInfo) return;
        const directionId = routeStepDirection(routeInfo, current.stationId, edge.to);
        if (current.routeId === routeId
          && current.direction
          && current.direction !== directionId) return;
        const firstBoarding = !current.routeId;
        const isSelectedLoop = routeInfo.line.type === 'loop'
          && String(context.lineId || '') === routeInfo.line.id
          && context.routeId === routeId;
        if (isSelectedLoop && context.direction && context.direction !== directionId) return;

        const switchesSameLine = Boolean(current.routeId && current.routeId !== routeId);
        const headwaySeconds = serviceHeadwaySeconds(routeInfo.line.id, routeId, directionId);
        let addedInitialWait = 0;
        let addedTransferWait = 0;
        let addedSameLineWalk = 0;
        let addedSameLineWait = 0;
        if (firstBoarding) {
          if (current.started) addedTransferWait = headwaySeconds / 2;
          else addedInitialWait = headwaySeconds / 2;
        } else if (switchesSameLine) {
          addedSameLineWalk = defaultTimeSeconds(
            'sameLineChangeWalkSeconds',
            ETA_DEFAULTS.sameLineChangeWalkSeconds,
          );
          addedSameLineWait = headwaySeconds / 2;
        }
        const rideSeconds = directedSegmentSeconds(current.stationId, edge.to);
        const isReverse = !current.started
          && String(context.lineId || '') === routeInfo.line.id
          && context.routeId === routeId
          && Boolean(context.direction)
          && context.direction !== directionId;
        const addedSeconds = rideSeconds
          + addedInitialWait
          + addedTransferWait
          + addedSameLineWalk
          + addedSameLineWait;
        const next = Object.assign({}, current, {
          stationId: edge.to,
          routeId,
          direction: directionId,
          started: true,
          segmentCount: current.segmentCount + 1,
          sameLineChangeCount: current.sameLineChangeCount + (switchesSameLine ? 1 : 0),
          rideSeconds: current.rideSeconds + rideSeconds,
          initialWaitSeconds: current.initialWaitSeconds + addedInitialWait,
          transferWaitSeconds: current.transferWaitSeconds + addedTransferWait,
          sameLineChangeWalkSeconds: current.sameLineChangeWalkSeconds + addedSameLineWalk,
          sameLineChangeWaitSeconds: current.sameLineChangeWaitSeconds + addedSameLineWait,
          isReverse: current.isReverse || isReverse,
          totalSeconds: current.totalSeconds + addedSeconds,
        });
        const nextKey = routeStateKey(next);
        if (bestByState[nextKey] && comparePathCost(bestByState[nextKey], next) <= 0) return;
        bestByState[nextKey] = next;
        previous[nextKey] = {
          from: current.stationId,
          to: edge.to,
          fromKey: currentKey,
          kind: 'train',
          lineId: edge.lineId,
        };
        priorityPush(queue, next);
      });
    });
  }

  return { bestResultByStationId, previous };
}

function createPathResolver(originId, journeyContext) {
  if (!recordById[originId]) return () => emptyMetrics('');
  const indexes = Object.create(null);
  return (targetId) => {
    if (!recordById[targetId]) return emptyMetrics('');
    if (originId === targetId) return emptyMetrics(originId);
    const sameLineJourney = recordById[originId].lineId === recordById[targetId].lineId;
    const mode = sameLineJourney ? 'sameLine' : 'network';
    if (!indexes[mode]) {
      indexes[mode] = runShortestPaths(originId, journeyContext, !sameLineJourney);
    }
    const result = indexes[mode].bestResultByStationId[targetId];
    return result
      ? buildMetricsFromResult(result, indexes[mode].previous)
      : emptyMetrics('');
  };
}

function shortestMetrics(originId, targetId, journeyContext) {
  return createPathResolver(originId, journeyContext)(targetId);
}

function normalizeAccess(accessRaw) {
  if (!accessRaw) return '';
  return String(accessRaw)
    .replace(/费区内/g, '闸内')
    .replace(/费区外/g, '闸外');
}

function normalizeLocationText(locationRaw) {
  return normalizeFacilityTerms(locationRaw)
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

function accessCategory(access, presentation) {
  const source = `${access || ''} ${(presentation && presentation.accessLabel) || ''}`;
  if (/车站外|站外/.test(source)) return '车站外';
  if (source.indexOf('闸外') >= 0) return '闸外';
  return '闸内';
}

function restroomRecordsForStation(station) {
  if (!station.record) return [];
  const recordIds = [station.id].concat(transferTargetsById[station.id] || []);
  return recordIds.map((id) => recordById[id]).filter((record) => record && record.status === 'active');
}

function buildRestroom(record, metrics) {
  const access = normalizeAccess(record.accessRaw);
  const presentation = deriveRestroomPresentation(record);
  const eta = estimateEta({
    segmentCount: metrics.segmentCount,
    transferCount: metrics.transferCount,
    sameLineChangeCount: metrics.sameLineChangeCount,
    isReverse: metrics.isReverse,
    rideSeconds: metrics.rideSeconds,
    initialWaitSeconds: metrics.initialWaitSeconds,
    transferWalkSeconds: metrics.transferWalkSeconds,
    transferWaitSeconds: metrics.transferWaitSeconds,
    sameLineChangeWalkSeconds: metrics.sameLineChangeWalkSeconds,
    sameLineChangeWaitSeconds: metrics.sameLineChangeWaitSeconds,
    reverseWalkSeconds: metrics.reverseWalkSeconds,
    access: accessCategory(access, presentation),
  });
  return {
    id: `${record.lineStationId}-restroom`,
    stationId: record.lineStationId,
    lineId: record.lineId,
    lineName: record.lineName,
    location: normalizeFacilityTerms(record.locationRaw),
    locationRaw: record.locationRaw,
    access,
    accessRaw: record.accessRaw,
    facility: '卫生间',
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
  const originRecord = recordById[originStationId];
  const journeyContext = {
    lineId: resolved.line.id,
    routeId: resolved.route.id,
    direction: resolved.directionId,
  };
  const pathForTarget = createPathResolver(originStationId, journeyContext);

  const viewStations = stations.map((station) => {
    const restroomRecords = restroomRecordsForStation(station);
    const restrooms = restroomRecords.map((record) => buildRestroom(
      record,
      pathForTarget(record.lineStationId),
    ));
    const path = pathForTarget(station.id);
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
      isReverse: path.isReverse,
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
  __test: {
    directedSegmentSeconds,
    lineSegmentMedianSeconds,
    medianSeconds,
  },
};
