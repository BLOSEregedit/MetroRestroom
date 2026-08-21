#!/usr/bin/env node

// 从上海地铁官方乘客服务接口离线采集计划站间时分。
// 运行时不会联网；本脚本只在开发阶段生成本地数据模块。

const fs = require('fs');
const https = require('https');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUTPUT_FILE = path.join(ROOT, 'miniprogram/data/generated/segment-times.js');
const TOPOLOGY = require(path.join(ROOT, 'miniprogram/data/topology.js'));
const RESTROOMS = require(path.join(ROOT, 'miniprogram/data/generated/restrooms.js'));

const CITY_ID = 'shanghai';
const SCHEMA_VERSION = 1;
const DEFAULTS = Object.freeze({ segmentSeconds: 180, headwaySeconds: 360 });
const LINE_API_IDS = Object.freeze({ pujiang: '41' });
const MAX_REDIRECTS = 5;
const MAX_CONCURRENCY = 2;
const MAX_JSON_ATTEMPTS = 3;

const SOURCES = Object.freeze({
  lineStations: 'https://m.shmetro.com/interface/metromap/metromap.aspx?func=lineStations&line={line}',
  planTrip: 'https://m.shmetro.com/interface/plantrip/pt.aspx?func=plantrip&startId={startId}&endId={endId}&planTime=12%3A00&week=1&ticket=oneWay&type=1',
  firstLastTimes: 'https://m.shmetro.com/interface/metromap/metromap.aspx?func=fltime&line={line}',
  timetable: 'https://service.shmetro.com/hcskb/index.htm',
  journeyPlanner: 'https://service.shmetro.com/jhndcx/index.htm',
  serviceStandard: 'https://jtw.sh.gov.cn/2025ngfxwj/20250122/45e2177ec30648c696ad6f5b5b9739a1.html',
});

// 拓扑仍保留部分历史名；这里只处理官方接口当前名称，不改业务展示名。
const OFFICIAL_STATION_ALIASES = Object.freeze({
  '2': Object.freeze({
    '浦东国际机场': '浦东1号2号航站楼',
    '东昌路': '浦东南路',
    '徐泾东（国家会展中心）': '国家会展中心',
  }),
  '4': Object.freeze({ '浦电路': '向城路' }),
  '9': Object.freeze({ '松江南站': '上海松江站' }),
  '10': Object.freeze({
    '高桥站': '高桥',
    '高桥西站': '高桥西',
  }),
  '11': Object.freeze({ '嘉定西站': '嘉定西' }),
  '15': Object.freeze({
    '紫竹高新园区': '紫竹高新区',
    '华泾西': '景洪路',
  }),
  '17': Object.freeze({ '诸光路（国家会展中心）': '国家会展中心' }),
});

// 代表间隔取官方时刻表中的工作日平峰值。支线按能够完整走完该 route 的班次取值。
const REPRESENTATIVE_HEADWAY_BY_ROUTE = Object.freeze({
  '1:l1-main': Object.freeze({ seconds: 300, basis: '工作日平峰莘庄—富锦路平均5分钟' }),
  '2:l2-main': Object.freeze({ seconds: 300, basis: '工作日平峰全线平均5分钟' }),
  '3:l3-main': Object.freeze({ seconds: 480, basis: '工作日平峰平均8分钟' }),
  '4:l4-loop': Object.freeze({ seconds: 480, basis: '工作日平峰内外圈平均8分钟' }),
  '5:l5-fengxian': Object.freeze({ seconds: 720, basis: '工作日平峰东川路—奉贤新城平均12分钟' }),
  '5:l5-minhang-development-zone': Object.freeze({ seconds: 720, basis: '工作日平峰东川路—闵行开发区平均12分钟' }),
  '6:l6-main': Object.freeze({ seconds: 390, basis: '工作日平峰平均6分30秒' }),
  '7:l7-main': Object.freeze({ seconds: 420, basis: '工作日平峰美兰湖—花木路平均7分钟' }),
  '8:l8-main': Object.freeze({ seconds: 520, basis: '工作日平峰两端区段平均8分40秒' }),
  '9:l9-main': Object.freeze({ seconds: 360, basis: '工作日平峰上海松江站—曹路平均6分钟' }),
  '10:l10-hongqiao-railway-station': Object.freeze({ seconds: 360, basis: '工作日平峰虹桥火车站—龙溪路平均6分钟' }),
  '10:l10-hangzhong-road': Object.freeze({ seconds: 720, basis: '工作日平峰航中路—龙溪路平均12分钟' }),
  '11:l11-huaqiao-disney': Object.freeze({ seconds: 720, basis: '工作日平峰花桥—嘉定新城平均12分钟' }),
  '11:l11-jiading-north-disney': Object.freeze({ seconds: 720, basis: '工作日平峰嘉定北—嘉定新城平均12分钟' }),
  '12:l12-main': Object.freeze({ seconds: 420, basis: '工作日平峰平均7分钟' }),
  '13:l13-main': Object.freeze({ seconds: 420, basis: '工作日平峰平均7分钟' }),
  '14:l14-main': Object.freeze({ seconds: 510, basis: '工作日平峰平均8分30秒' }),
  '15:l15-main': Object.freeze({ seconds: 480, basis: '工作日平峰平均8分钟' }),
  '16:l16-main': Object.freeze({ seconds: 420, basis: '工作日平峰平均7分钟' }),
  '17:l17-main': Object.freeze({ seconds: 600, basis: '工作日平峰平均10分钟' }),
  '18:l18-main': Object.freeze({ seconds: 480, basis: '工作日平峰平均8分钟' }),
  'pujiang:pujiang-main': Object.freeze({ seconds: 600, basis: '工作日平峰平均10分钟' }),
});

function requestText(url, redirectCount) {
  const redirects = redirectCount || 0;
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      headers: {
        Accept: 'application/json,text/plain,*/*',
        'User-Agent': 'MetroRestroom-data-collector/1.0',
      },
      timeout: 20000,
    }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        if (redirects >= MAX_REDIRECTS) {
          reject(new Error(`重定向次数过多：${url}`));
          return;
        }
        resolve(requestText(new URL(response.headers.location, url).toString(), redirects + 1));
        return;
      }

      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`HTTP ${response.statusCode}：${url}`));
          return;
        }
        resolve(body.replace(/^\uFEFF/, ''));
      });
    });
    request.on('timeout', () => request.destroy(new Error(`请求超时：${url}`)));
    request.on('error', reject);
  });
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function requestJson(url, attempt) {
  const currentAttempt = attempt || 1;
  const body = await requestText(url);
  try {
    return JSON.parse(body);
  } catch (error) {
    if (currentAttempt < MAX_JSON_ATTEMPTS) {
      await wait(currentAttempt * 500);
      return requestJson(url, currentAttempt + 1);
    }
    throw new Error(`官方接口连续${MAX_JSON_ATTEMPTS}次没有返回 JSON：${url}；${error.message}`);
  }
}

function normalizeComparableName(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, '')
    .replace(/[・•]/g, '·')
    .replace(/（/g, '(')
    .replace(/）/g, ')');
}

function sourceUrl(template, replacements) {
  return Object.keys(replacements).reduce((result, key) => (
    result.replace(`{${key}}`, encodeURIComponent(replacements[key]))
  ), template);
}

function officialLineId(lineId) {
  return LINE_API_IDS[lineId] || lineId;
}

function officialStationName(lineId, topologyStationName) {
  const aliases = OFFICIAL_STATION_ALIASES[lineId] || {};
  return aliases[topologyStationName] || topologyStationName;
}

function listRestroomLines() {
  return Array.isArray(RESTROOMS.lines) ? RESTROOMS.lines : Object.values(RESTROOMS.lines || {});
}

function buildRuntimeStationIndex(lineId) {
  const line = listRestroomLines().find((item) => String(item.lineId) === lineId);
  const index = new Map();
  (line && line.records || []).forEach((record) => {
    const rawName = String(record.stationName || '');
    index.set(normalizeComparableName(rawName), record);
    index.set(normalizeComparableName(TOPOLOGY.normalizeStationName(rawName, lineId)), record);
  });
  return index;
}

async function fetchOfficialStations(lineId) {
  const apiLineId = officialLineId(lineId);
  const url = sourceUrl(SOURCES.lineStations, { line: apiLineId });
  const payload = await requestJson(url);
  const levels = payload && payload.levels;
  const locations = levels && levels[0] && levels[0].locations;
  if (!Array.isArray(locations) || !locations.length) {
    throw new Error(`${lineId} 线路站点接口为空：${url}`);
  }

  const stations = locations.map((location) => ({
    id: String(location.id || '').replace(/^station/, ''),
    name: String(location.title || location.description || '').trim(),
  })).filter((station) => station.id && station.name);
  const byName = new Map();
  stations.forEach((station) => byName.set(normalizeComparableName(station.name), station));
  return { stations, byName, url };
}

function topologyRoutes(line) {
  return Array.isArray(line.routes) ? line.routes : Object.values(line.routes || {});
}

function buildLineEdges(lineId, line, officialStations, runtimeStationIndex) {
  const unique = new Map();
  const missingStationMappings = new Map();
  const excludedInactiveStations = new Map();
  const excludedInactiveDirectedEdges = new Map();

  function runtimeRecord(stationName) {
    return runtimeStationIndex.get(normalizeComparableName(stationName))
      || runtimeStationIndex.get(normalizeComparableName(
        TOPOLOGY.normalizeStationName(stationName, lineId),
      ));
  }

  function stationMapping(stationName) {
    const record = runtimeRecord(stationName);
    const runtimeId = record && record.lineStationId;
    const targetOfficialName = officialStationName(lineId, stationName);
    const officialStation = officialStations.byName.get(normalizeComparableName(targetOfficialName));
    if (!runtimeId || !officialStation) {
      missingStationMappings.set(stationName, {
        stationName,
        runtimeId: runtimeId || null,
        requestedOfficialName: targetOfficialName,
        officialStationId: officialStation ? officialStation.id : null,
      });
    }
    return {
      stationName,
      runtimeId: runtimeId || null,
      officialId: officialStation ? officialStation.id : null,
      officialName: officialStation ? officialStation.name : null,
    };
  }

  function addDirectedEdge(fromName, toName, routeId, skippedStationNames) {
    const from = stationMapping(fromName);
    const to = stationMapping(toName);
    const key = `${from.runtimeId || `${lineId}:${fromName}`}>${to.runtimeId || `${lineId}:${toName}`}`;
    if (!unique.has(key)) {
      unique.set(key, {
        lineId,
        routeIds: [],
        from,
        to,
        skippedStationNames: [],
      });
    }
    const edge = unique.get(key);
    if (!edge.routeIds.includes(routeId)) edge.routeIds.push(routeId);
    (skippedStationNames || []).forEach((stationName) => {
      if (!edge.skippedStationNames.includes(stationName)) edge.skippedStationNames.push(stationName);
    });
  }

  topologyRoutes(line).forEach((route) => {
    const names = route.stationNames || [];
    const entries = names.map((stationName, index) => {
      const record = runtimeRecord(stationName);
      const explicitStatus = route.stationStatusByName && route.stationStatusByName[stationName];
      const status = explicitStatus || (record && record.status) || 'active';
      const active = Boolean(record && record.status === 'active' && status === 'active');
      if (!active) {
        const auditKey = (record && record.lineStationId) || `${lineId}:${stationName}`;
        const existing = excludedInactiveStations.get(auditKey) || {
          stationName,
          runtimeId: record && record.lineStationId || null,
          status,
          routeIds: [],
        };
        if (!existing.routeIds.includes(route.id)) existing.routeIds.push(route.id);
        excludedInactiveStations.set(auditKey, existing);
      }
      return { stationName, index, record, status, active };
    });

    for (let index = 0; index < entries.length - 1; index += 1) {
      const pair = [entries[index], entries[index + 1]];
      if (pair.every((entry) => entry.active)) continue;
      [[pair[0], pair[1]], [pair[1], pair[0]]].forEach(([fromEntry, toEntry]) => {
        const fromId = fromEntry.record && fromEntry.record.lineStationId
          || `${lineId}:${fromEntry.stationName}`;
        const toId = toEntry.record && toEntry.record.lineStationId
          || `${lineId}:${toEntry.stationName}`;
        const key = `${fromId}>${toId}`;
        const existing = excludedInactiveDirectedEdges.get(key) || {
          key,
          fromStationName: fromEntry.stationName,
          toStationName: toEntry.stationName,
          routeIds: [],
          reason: '运行时仅连接 active 站点，含未开通站的原始拓扑边不进入 ETA 图',
        };
        if (!existing.routeIds.includes(route.id)) existing.routeIds.push(route.id);
        excludedInactiveDirectedEdges.set(key, existing);
      });
    }

    const activeEntries = entries.filter((entry) => entry.active);
    for (let index = 0; index < activeEntries.length - 1; index += 1) {
      const from = activeEntries[index];
      const to = activeEntries[index + 1];
      const skipped = entries.slice(from.index + 1, to.index)
        .filter((entry) => !entry.active)
        .map((entry) => entry.stationName);
      addDirectedEdge(from.stationName, to.stationName, route.id, skipped);
      addDirectedEdge(to.stationName, from.stationName, route.id, skipped.slice().reverse());
    }
    if (route.closed && activeEntries.length > 1) {
      addDirectedEdge(
        activeEntries[activeEntries.length - 1].stationName,
        activeEntries[0].stationName,
        route.id,
        [],
      );
      addDirectedEdge(
        activeEntries[0].stationName,
        activeEntries[activeEntries.length - 1].stationName,
        route.id,
        [],
      );
    }
  });

  return {
    edges: Array.from(unique.values()),
    missingStationMappings: Array.from(missingStationMappings.values()),
    excludedInactiveStations: Array.from(excludedInactiveStations.values()),
    excludedInactiveDirectedEdges: Array.from(excludedInactiveDirectedEdges.values()),
  };
}

function buildPlanTripUrl(startId, endId) {
  return sourceUrl(SOURCES.planTrip, { startId, endId });
}

async function fetchPlanTrip(startId, endId) {
  return requestJson(buildPlanTripUrl(startId, endId));
}

async function fetchFirstLastTimes(lineId) {
  const url = sourceUrl(SOURCES.firstLastTimes, { line: officialLineId(lineId) });
  const payload = await requestJson(url);
  if (!Array.isArray(payload) || !payload.length) {
    throw new Error(`${lineId} 首末班接口为空：${url}`);
  }
  return { rows: payload, url };
}

function clockMinutes(value) {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function forwardClockDifference(fromValue, toValue) {
  const from = clockMinutes(fromValue);
  const to = clockMinutes(toValue);
  if (from === null || to === null) return null;
  const difference = (to - from + 1440) % 1440;
  return difference > 0 && difference <= 60 ? difference : null;
}

function deriveSegmentFromFirstLastTimes(rows, edge, source) {
  const fromRows = rows.filter((row) => String(row.stat_id || '') === edge.from.officialId);
  const toRows = rows.filter((row) => String(row.stat_id || '') === edge.to.officialId);
  const candidates = [];
  fromRows.forEach((fromRow) => {
    const toRow = toRows.find((row) => String(row.direction) === String(fromRow.direction));
    if (!toRow || Number(fromRow.firstarrival_time || 0) !== 0
      || Number(toRow.firstarrival_time || 0) !== 0
      || Number(fromRow.lastarrival_time || 0) !== 0
      || Number(toRow.lastarrival_time || 0) !== 0) return;
    const firstDifferenceMinutes = forwardClockDifference(
      fromRow.first_time,
      toRow.first_time,
    );
    const lastDifferenceMinutes = forwardClockDifference(
      fromRow.last_time,
      toRow.last_time,
    );
    if (!firstDifferenceMinutes || firstDifferenceMinutes !== lastDifferenceMinutes) return;
    candidates.push({
      seconds: firstDifferenceMinutes * 60,
      method: 'timetable_derived',
      sourceUrl: source.url,
      evidence: {
        direction: fromRow.direction,
        description: fromRow.description || toRow.description || '',
        from: {
          stationId: edge.from.officialId,
          stationName: fromRow.name,
          firstTime: fromRow.first_time,
          lastTime: fromRow.last_time,
        },
        to: {
          stationId: edge.to.officialId,
          stationName: toRow.name,
          firstTime: toRow.first_time,
          lastTime: toRow.last_time,
        },
        firstDifferenceMinutes,
        lastDifferenceMinutes,
      },
    });
  });
  return candidates.length === 1 ? candidates[0] : null;
}

function collectAcceptedPairs(
  payload,
  acceptedOfficialPairKeys,
  secondsByOfficialPair,
  requestedPair,
  collapsedPathByOfficialPair,
) {
  const paths = payload && payload.pathList;
  if (!Array.isArray(paths)) return;
  paths.forEach((routePath) => {
    const stations = routePath.passStationList || [];
    for (let index = 1; index < stations.length; index += 1) {
      const from = stations[index - 1];
      const to = stations[index];
      const key = `${from.stationId}>${to.stationId}`;
      const minutes = Number(to.waitTime);
      if (acceptedOfficialPairKeys.has(key) && Number.isFinite(minutes) && minutes > 0) {
        secondsByOfficialPair.set(key, Math.round(minutes * 60));
      }
    }
  });

  if (!requestedPair || !acceptedOfficialPairKeys.has(requestedPair)
    || secondsByOfficialPair.has(requestedPair)) return;
  const requestedIds = requestedPair.split('>');
  const directPath = paths.find((routePath) => {
    const stations = routePath.passStationList || [];
    const transferTimes = (routePath.transferStationList || []).map((item) => Number(item.transferStationTime || 0));
    return stations.length >= 2
      && String(stations[0].stationId) === requestedIds[0]
      && String(stations[stations.length - 1].stationId) === requestedIds[1]
      && Number(routePath.passLineCount || 0) === 0
      && transferTimes.every((seconds) => seconds === 0)
      && Number(routePath.time) > 0;
  });
  if (!directPath) return;

  secondsByOfficialPair.set(requestedPair, Math.round(Number(directPath.time) * 60));
  if (collapsedPathByOfficialPair) {
    collapsedPathByOfficialPair.set(requestedPair, {
      officialStationIds: directPath.passStationList.map((station) => String(station.stationId)),
      officialStationNames: directPath.passStationList.map((station) => String(station.stationName)),
      seconds: Math.round(Number(directPath.time) * 60),
      reason: '当前拓扑相邻边在官方路径中经过共享线路或新增中间站，按官方整段计划时间折叠',
    });
  }
}

async function mapWithConcurrency(items, worker, concurrency) {
  let cursor = 0;
  const results = new Array(items.length);
  async function run() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  }
  const runners = [];
  const count = Math.min(concurrency, items.length);
  for (let index = 0; index < count; index += 1) runners.push(run());
  await Promise.all(runners);
  return results;
}

async function collectLine(lineId, line) {
  const officialStations = await fetchOfficialStations(lineId);
  const runtimeStationIndex = buildRuntimeStationIndex(lineId);
  const built = buildLineEdges(lineId, line, officialStations, runtimeStationIndex);
  const mappedEdges = built.edges.filter((edge) => (
    edge.from.runtimeId && edge.to.runtimeId && edge.from.officialId && edge.to.officialId
  ));
  const acceptedOfficialPairKeys = new Set(mappedEdges.map((edge) => (
    `${edge.from.officialId}>${edge.to.officialId}`
  )));
  const secondsByOfficialPair = new Map();
  const queryFailureByOfficialPair = new Map();
  const collapsedPathByOfficialPair = new Map();

  // 先用每条 route 的端到端路径一次性获取大部分站间值。
  const endpointQueries = [];
  topologyRoutes(line).forEach((route) => {
    const names = route.stationNames || [];
    if (names.length < 2) return;
    const firstName = names[0];
    const lastName = names[names.length - 1];
    const first = mappedEdges.flatMap((edge) => [edge.from, edge.to])
      .find((station) => station.stationName === firstName);
    const last = mappedEdges.flatMap((edge) => [edge.from, edge.to])
      .find((station) => station.stationName === lastName);
    if (!first || !last) return;
    endpointQueries.push([first.officialId, last.officialId]);
    endpointQueries.push([last.officialId, first.officialId]);
  });

  for (const query of endpointQueries) {
    try {
      const payload = await fetchPlanTrip(query[0], query[1]);
      collectAcceptedPairs(
        payload,
        acceptedOfficialPairKeys,
        secondsByOfficialPair,
        `${query[0]}>${query[1]}`,
        collapsedPathByOfficialPair,
      );
    } catch (error) {
      // 端到端查询只是批量优化，失败后仍会逐条补查，不能中断整线生成。
    }
  }

  // 端到端 pathList 的 waitTime 只代表其返回站序中的相邻项。若本地 active 边
  // 跨过未开通站，不能把该拆解值当作整段聚合时间，必须再做起终点直接查询。
  mappedEdges.filter((edge) => edge.skippedStationNames.length).forEach((edge) => {
    const officialKey = `${edge.from.officialId}>${edge.to.officialId}`;
    secondsByOfficialPair.delete(officialKey);
    collapsedPathByOfficialPair.delete(officialKey);
  });

  // 环线、支线或被官方规划器改道的少量边，再按相邻站补查。
  const unresolved = mappedEdges.filter((edge) => !secondsByOfficialPair.has(
    `${edge.from.officialId}>${edge.to.officialId}`,
  ));
  await mapWithConcurrency(unresolved, async (edge) => {
    const officialKey = `${edge.from.officialId}>${edge.to.officialId}`;
    try {
      const payload = await fetchPlanTrip(edge.from.officialId, edge.to.officialId);
      collectAcceptedPairs(
        payload,
        acceptedOfficialPairKeys,
        secondsByOfficialPair,
        officialKey,
        collapsedPathByOfficialPair,
      );
    } catch (error) {
      queryFailureByOfficialPair.set(officialKey, error.message);
    }
  }, MAX_CONCURRENCY);

  // 运行时会跳过未开通站并连接相邻 active 站。若路径规划接口不给该聚合边，
  // 仅在首班与末班的同方向站间时差完全一致时，才采用官方时刻表推导值。
  const timetableCandidates = mappedEdges.filter((edge) => (
    edge.skippedStationNames.length
      && !secondsByOfficialPair.has(`${edge.from.officialId}>${edge.to.officialId}`)
  ));
  if (timetableCandidates.length) {
    try {
      const firstLastTimes = await fetchFirstLastTimes(lineId);
      timetableCandidates.forEach((edge) => {
        const officialKey = `${edge.from.officialId}>${edge.to.officialId}`;
        const derived = deriveSegmentFromFirstLastTimes(firstLastTimes.rows, edge, firstLastTimes);
        if (!derived) {
          queryFailureByOfficialPair.set(
            officialKey,
            '首班与末班的同方向时差未形成唯一且一致的推导结果',
          );
          return;
        }
        secondsByOfficialPair.set(officialKey, derived.seconds);
        collapsedPathByOfficialPair.set(officialKey, {
          officialStationIds: [edge.from.officialId, edge.to.officialId],
          officialStationNames: [edge.from.officialName, edge.to.officialName],
          skippedLocalStationNames: edge.skippedStationNames,
          seconds: derived.seconds,
          reason: '运行时跳过未开通站，按官方首班与末班同方向时差交叉一致后折算 active 聚合区间',
          method: derived.method,
          sourceUrl: derived.sourceUrl,
          evidence: derived.evidence,
        });
      });
    } catch (error) {
      timetableCandidates.forEach((edge) => {
        const officialKey = `${edge.from.officialId}>${edge.to.officialId}`;
        queryFailureByOfficialPair.set(officialKey, `官方首末班请求失败：${error.message}`);
      });
    }
  }

  const segments = {};
  const missing = [];
  const collapsedPaths = [];
  built.edges.forEach((edge) => {
    const runtimeKey = `${edge.from.runtimeId || `${lineId}:${edge.from.stationName}`}>${edge.to.runtimeId || `${lineId}:${edge.to.stationName}`}`;
    if (!edge.from.runtimeId || !edge.to.runtimeId) {
      missing.push({ key: runtimeKey, reason: '当前 lineStationId 无法匹配', routeIds: edge.routeIds });
      return;
    }
    if (!edge.from.officialId || !edge.to.officialId) {
      missing.push({ key: runtimeKey, reason: '官方站点 ID 无法匹配', routeIds: edge.routeIds });
      return;
    }
    const officialKey = `${edge.from.officialId}>${edge.to.officialId}`;
    const seconds = secondsByOfficialPair.get(officialKey);
    if (!seconds) {
      missing.push({
        key: runtimeKey,
        reason: queryFailureByOfficialPair.has(officialKey)
          ? `官方请求失败：${queryFailureByOfficialPair.get(officialKey)}`
          : '官方路径未返回同线相邻时分',
        routeIds: edge.routeIds,
        officialPair: officialKey,
      });
      return;
    }
    segments[runtimeKey] = seconds;
    if (collapsedPathByOfficialPair.has(officialKey)) {
      collapsedPaths.push(Object.assign({ key: runtimeKey }, collapsedPathByOfficialPair.get(officialKey)));
    } else if (edge.skippedStationNames.length) {
      collapsedPaths.push({
        key: runtimeKey,
        officialStationIds: [edge.from.officialId, edge.to.officialId],
        officialStationNames: [edge.from.officialName, edge.to.officialName],
        skippedLocalStationNames: edge.skippedStationNames,
        seconds,
        reason: '运行时跳过未开通站，官方路径规划接口直接返回 active 聚合区间',
        method: 'plantrip_path',
        sourceUrl: SOURCES.planTrip,
      });
    }
  });

  return {
    lineId,
    segments,
    missing,
    expected: built.edges.length,
    officialStationsUrl: officialStations.url,
    missingStationMappings: built.missingStationMappings,
    collapsedPaths,
    excludedInactiveStations: built.excludedInactiveStations,
    excludedInactiveDirectedEdges: built.excludedInactiveDirectedEdges,
  };
}

function buildHeadways() {
  const headways = {};
  const headwayMetadata = {};
  Object.keys(TOPOLOGY.LINES).forEach((lineId) => {
    topologyRoutes(TOPOLOGY.LINES[lineId]).forEach((route) => {
      const profile = REPRESENTATIVE_HEADWAY_BY_ROUTE[`${lineId}:${route.id}`];
      if (!profile) throw new Error(`缺少常态平峰代表间隔：${lineId}:${route.id}`);
      (route.directionIds || []).forEach((directionId) => {
        const key = `${lineId}:${route.id}:${directionId}`;
        headways[key] = profile.seconds;
        headwayMetadata[key] = {
          expectedWaitSeconds: Math.round(profile.seconds / 2),
          basis: profile.basis,
          sourceUrl: SOURCES.timetable,
        };
      });
    });
  });
  return { headways, headwayMetadata };
}

function sortObject(value) {
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = value[key];
    return result;
  }, {});
}

function renderModule(data) {
  const json = JSON.stringify(data, null, 2);
  return `// 此文件由 scripts/collect_shanghai_segment_times.js 从上海地铁官方公开接口生成，请勿手工编辑。\n`
    + `const DATA = ${json};\n\n`
    + `function segmentKey(fromLineStationId, toLineStationId) {\n`
    + `  return String(fromLineStationId || '') + '>' + String(toLineStationId || '');\n`
    + `}\n\n`
    + `function headwayKey(lineId, routeId, directionId) {\n`
    + `  return [lineId, routeId, directionId].map(function (value) { return String(value || ''); }).join(':');\n`
    + `}\n\n`
    + `function hasSourcedSegment(fromLineStationId, toLineStationId) {\n`
    + `  return Object.prototype.hasOwnProperty.call(DATA.segments, segmentKey(fromLineStationId, toLineStationId));\n`
    + `}\n\n`
    + `function getSegmentSeconds(fromLineStationId, toLineStationId) {\n`
    + `  const key = segmentKey(fromLineStationId, toLineStationId);\n`
    + `  return hasSourcedSegment(fromLineStationId, toLineStationId)\n`
    + `    ? DATA.segments[key]\n`
    + `    : DATA.defaults.segmentSeconds;\n`
    + `}\n\n`
    + `function getHeadwaySeconds(lineId, routeId, directionId) {\n`
    + `  const key = headwayKey(lineId, routeId, directionId);\n`
    + `  return Object.prototype.hasOwnProperty.call(DATA.headways, key)\n`
    + `    ? DATA.headways[key]\n`
    + `    : DATA.defaults.headwaySeconds;\n`
    + `}\n\n`
    + `function getExpectedWaitSeconds(lineId, routeId, directionId) {\n`
    + `  return Math.round(getHeadwaySeconds(lineId, routeId, directionId) / 2);\n`
    + `}\n\n`
    + `module.exports = {\n`
    + `  schemaVersion: DATA.schemaVersion,\n`
    + `  cityId: DATA.cityId,\n`
    + `  defaults: DATA.defaults,\n`
    + `  segments: DATA.segments,\n`
    + `  headways: DATA.headways,\n`
    + `  metadata: DATA.metadata,\n`
    + `  sources: DATA.sources,\n`
    + `  coverage: DATA.coverage,\n`
    + `  headwayMetadata: DATA.headwayMetadata,\n`
    + `  hasSourcedSegment,\n`
    + `  getSegmentSeconds,\n`
    + `  getHeadwaySeconds,\n`
    + `  getExpectedWaitSeconds,\n`
    + `};\n`;
}

function checkedAtFromArgs() {
  const prefix = '--checked-at=';
  const explicit = process.argv.find((argument) => argument.startsWith(prefix));
  return explicit ? explicit.slice(prefix.length) : new Date().toISOString();
}

async function main() {
  const checkedAt = checkedAtFromArgs();
  const lineIds = Object.keys(TOPOLOGY.LINES);
  const lineResults = [];
  for (const lineId of lineIds) {
    process.stdout.write(`采集 ${lineId === 'pujiang' ? '浦江线' : `${lineId}号线`}... `);
    const result = await collectLine(lineId, TOPOLOGY.LINES[lineId]);
    lineResults.push(result);
    console.log(`${Object.keys(result.segments).length}/${result.expected}`);
  }

  const segments = {};
  const byLine = {};
  const missing = [];
  lineResults.forEach((result) => {
    Object.assign(segments, result.segments);
    missing.push(...result.missing.map((item) => Object.assign({ lineId: result.lineId }, item)));
    const collected = Object.keys(result.segments).length;
    byLine[result.lineId] = {
      expectedDirectedSegments: result.expected,
      sourcedDirectedSegments: collected,
      missingDirectedSegments: result.expected - collected,
      percent: result.expected ? Number(((collected / result.expected) * 100).toFixed(1)) : 100,
      stationSourceUrl: result.officialStationsUrl,
      missingStationMappings: result.missingStationMappings,
      collapsedOfficialPaths: result.collapsedPaths,
      excludedInactiveStations: result.excludedInactiveStations,
      excludedInactiveDirectedEdges: result.excludedInactiveDirectedEdges,
    };
  });

  const expected = lineResults.reduce((sum, result) => sum + result.expected, 0);
  const collected = Object.keys(segments).length;
  const headwayData = buildHeadways();
  const data = {
    schemaVersion: SCHEMA_VERSION,
    cityId: CITY_ID,
    defaults: DEFAULTS,
    segments: sortObject(segments),
    headways: sortObject(headwayData.headways),
    metadata: {
      checkedAt,
      generatedBy: 'scripts/collect_shanghai_segment_times.js',
      runtimeNetworkPolicy: 'offline-only',
      segmentUnit: 'seconds',
      segmentSemantics: 'segments 的键是当前运行时 active 拓扑有向边；值来自官方路径或严格交叉核验的首末班时差推导',
      collapsedPathSemantics: 'collapsedOfficialPaths 保存缺少中间新站、共享线路或跳过未开通站时的 active 聚合区间及证据',
      segmentFallback: '缺失边由运行层优先使用同线路中位值，仍不可用时才使用 defaults.segmentSeconds，并通过 hasSourcedSegment 区分',
      headwayBasis: '官方工作日平峰代表间隔；平均候车时间为代表间隔的一半',
    },
    sources: SOURCES,
    coverage: {
      expectedDirectedSegments: expected,
      sourcedDirectedSegments: collected,
      missingDirectedSegments: expected - collected,
      percent: expected ? Number(((collected / expected) * 100).toFixed(1)) : 100,
      byLine: sortObject(byLine),
      missing,
    },
    headwayMetadata: sortObject(headwayData.headwayMetadata),
  };

  fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, renderModule(data), 'utf8');
  console.log(`\n已生成 ${path.relative(ROOT, OUTPUT_FILE)}：${collected}/${expected} 条有向相邻边。`);
  if (missing.length) {
    console.log('缺失项：');
    missing.forEach((item) => console.log(`- ${item.lineId} ${item.key}：${item.reason}`));
  }
}

main().catch((error) => {
  console.error(`采集失败：${error.stack || error.message}`);
  process.exitCode = 1;
});
