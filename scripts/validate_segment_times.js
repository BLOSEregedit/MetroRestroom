#!/usr/bin/env node

const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TOPOLOGY = require(path.join(ROOT, 'miniprogram/data/topology.js'));
const RESTROOMS = require(path.join(ROOT, 'miniprogram/data/generated/restrooms.js'));
const DATA = require(path.join(ROOT, 'miniprogram/data/generated/segment-times.js'));

const errors = [];

function fail(message) { errors.push(message); }
function lines() { return Array.isArray(RESTROOMS.lines) ? RESTROOMS.lines : Object.values(RESTROOMS.lines || {}); }
function lineRecords(lineId) {
  const line = lines().find((item) => String(item.lineId) === lineId);
  return line && line.records || [];
}
function comparable(value) {
  return String(value || '').trim().replace(/\s+/g, '').replace(/[・•]/g, '·');
}
function stationId(lineId, stationName) {
  const row = stationRecord(lineId, stationName);
  return row && row.lineStationId;
}
function stationRecord(lineId, stationName) {
  const normalized = comparable(TOPOLOGY.normalizeStationName(stationName, lineId));
  return lineRecords(lineId).find((item) => (
    comparable(item.stationName) === comparable(stationName)
    || comparable(TOPOLOGY.normalizeStationName(item.stationName, lineId)) === normalized
  ));
}
function expectedEdges() {
  const edges = new Map();
  Object.keys(TOPOLOGY.LINES).forEach((lineId) => {
    const line = TOPOLOGY.LINES[lineId];
    (line.routes || []).forEach((route) => {
      const names = (route.stationNames || []).filter((stationName) => {
        const record = stationRecord(lineId, stationName);
        const explicitStatus = route.stationStatusByName && route.stationStatusByName[stationName];
        const status = explicitStatus || (record && record.status) || 'active';
        return Boolean(record && record.status === 'active' && status === 'active');
      });
      function add(from, to) {
        const fromId = stationId(lineId, from);
        const toId = stationId(lineId, to);
        if (!fromId || !toId) {
          fail(`无法建立当前 ID 边：${lineId} ${from}—${to}`);
          return;
        }
        edges.set(`${fromId}>${toId}`, { lineId, routeId: route.id, from, to });
      }
      for (let index = 0; index < names.length - 1; index += 1) {
        add(names[index], names[index + 1]);
        add(names[index + 1], names[index]);
      }
      if (route.closed && names.length > 1) {
        add(names[names.length - 1], names[0]);
        add(names[0], names[names.length - 1]);
      }
    });
  });
  return edges;
}

function sumRoute(lineId, routeId, directionId) {
  const line = TOPOLOGY.LINES[lineId];
  const route = line.routes.find((item) => item.id === routeId);
  const names = directionId === 'forward' ? route.stationNames.slice() : route.stationNames.slice().reverse();
  let total = 0;
  for (let index = 0; index < names.length - 1; index += 1) {
    total += DATA.getSegmentSeconds(stationId(lineId, names[index]), stationId(lineId, names[index + 1]));
  }
  return total;
}

function validateContract() {
  if (DATA.schemaVersion !== 1) fail('schemaVersion 必须为 1');
  if (DATA.cityId !== 'shanghai') fail('cityId 必须为 shanghai');
  if (!DATA.defaults || DATA.defaults.segmentSeconds !== 180 || DATA.defaults.headwaySeconds !== 360) {
    fail('defaults 必须为 segmentSeconds=180、headwaySeconds=360');
  }
  for (const field of ['segments', 'headways', 'metadata', 'sources', 'coverage']) {
    if (!DATA[field] || typeof DATA[field] !== 'object') fail(`缺少数据字段：${field}`);
  }
  if (DATA.metadata && DATA.metadata.runtimeNetworkPolicy !== 'offline-only') fail('运行时网络策略必须为 offline-only');
  if (!String(DATA.sources && DATA.sources.planTrip || '').startsWith('https://m.shmetro.com/')) {
    fail('planTrip 来源必须是上海地铁官方域名');
  }
}

function validateSegments(edges) {
  const dataKeys = Object.keys(DATA.segments || {});
  dataKeys.forEach((key) => {
    if (!edges.has(key)) fail(`存在非当前拓扑相邻边：${key}`);
    const seconds = DATA.segments[key];
    if (!Number.isInteger(seconds) || seconds < 30 || seconds > 1200) fail(`站间秒数非法：${key}=${seconds}`);
  });
  const missing = Array.from(edges.keys()).filter((key) => !Object.prototype.hasOwnProperty.call(DATA.segments, key));
  if (DATA.coverage.expectedDirectedSegments !== edges.size) fail('coverage.expectedDirectedSegments 与拓扑不一致');
  if (DATA.coverage.sourcedDirectedSegments !== dataKeys.length) fail('coverage.sourcedDirectedSegments 与数据不一致');
  if (DATA.coverage.missingDirectedSegments !== missing.length) fail('coverage.missingDirectedSegments 与实际缺失不一致');
  if (DATA.getSegmentSeconds('__missing_a__', '__missing_b__') !== DATA.defaults.segmentSeconds) fail('站间回退值无效');
  if (DATA.hasSourcedSegment('__missing_a__', '__missing_b__')) fail('缺失边被错误标记为有来源值');
  return missing;
}

function validateHeadways() {
  Object.keys(TOPOLOGY.LINES).forEach((lineId) => {
    (TOPOLOGY.LINES[lineId].routes || []).forEach((route) => {
      (route.directionIds || []).forEach((directionId) => {
        const key = `${lineId}:${route.id}:${directionId}`;
        const seconds = DATA.headways[key];
        if (!Number.isInteger(seconds) || seconds < 120 || seconds > 1200) fail(`代表间隔缺失或非法：${key}`);
        if (DATA.getExpectedWaitSeconds(lineId, route.id, directionId) !== Math.round(seconds / 2)) {
          fail(`平均候车时间不是代表间隔的一半：${key}`);
        }
      });
    });
  });
  if (DATA.getHeadwaySeconds('__missing__', '__missing__', '__missing__') !== DATA.defaults.headwaySeconds) {
    fail('代表间隔回退值无效');
  }
}

function validateSpecialTopology(edges) {
  const line4ClosedA = `${stationId('4', '上海体育馆')}>${stationId('4', '宜山路')}`;
  const line4ClosedB = `${stationId('4', '宜山路')}>${stationId('4', '上海体育馆')}`;
  if (!edges.has(line4ClosedA) || !edges.has(line4ClosedB)) fail('4号线闭环边未进入期望集合');
  if (!DATA.hasSourcedSegment(...line4ClosedA.split('>')) || !DATA.hasSourcedSegment(...line4ClosedB.split('>'))) {
    fail('4号线闭环边缺少有来源的区间值');
  }

  TOPOLOGY.FORBIDDEN_ADJACENCIES.forEach((entry) => {
    const firstId = stationId(entry.lineId, entry.stationNames[0]);
    const secondId = stationId(entry.lineId, entry.stationNames[1]);
    if (firstId && secondId && (
      DATA.hasSourcedSegment(firstId, secondId) || DATA.hasSourcedSegment(secondId, firstId)
    )) fail(`生成了禁止的假边：${entry.lineId} ${entry.stationNames.join('—')}`);
  });

  const line18ActiveForward = `${stationId('18', '爱辉路')}>${stationId('18', '长江西路')}`;
  const line18ActiveReverse = `${stationId('18', '长江西路')}>${stationId('18', '爱辉路')}`;
  const line18UnopenedId = stationId('18', '江杨南路');
  if (!edges.has(line18ActiveForward) || !edges.has(line18ActiveReverse)) {
    fail('18号线运行时 active 聚合边未进入期望集合');
  }
  if (DATA.segments[line18ActiveForward] !== 240 || DATA.segments[line18ActiveReverse] !== 300) {
    fail('18号线爱辉路↔长江西路应为时刻表推导的 240/300 秒');
  }
  if (Array.from(edges.keys()).some((key) => key.includes(line18UnopenedId))) {
    fail('18号线未开通江杨南路仍进入运行时期望边');
  }
  const line18Coverage = DATA.coverage.byLine && DATA.coverage.byLine['18'];
  if (!line18Coverage || (line18Coverage.excludedInactiveDirectedEdges || []).length !== 4) {
    fail('18号线应保留4条未开通原始边的排除审计');
  }
  const derived = (line18Coverage && line18Coverage.collapsedOfficialPaths || []).filter(
    (item) => item.method === 'timetable_derived',
  );
  if (derived.length !== 2 || derived.some((item) => (
    !item.sourceUrl || !item.evidence
      || item.evidence.firstDifferenceMinutes !== item.evidence.lastDifferenceMinutes
  ))) fail('18号线时刻表推导区间缺少方法、来源或首末班交叉证据');
}

function main() {
  validateContract();
  const edges = expectedEdges();
  const missing = validateSegments(edges);
  validateHeadways();
  validateSpecialTopology(edges);

  const line1ToXinzhuang = sumRoute('1', 'l1-main', 'forward');
  const line1ToFujinRoad = sumRoute('1', 'l1-main', 'reverse');
  if (line1ToXinzhuang !== 3840) fail(`1号线富锦路→莘庄应为3840秒，实际${line1ToXinzhuang}`);
  if (line1ToFujinRoad !== 3900) fail(`1号线莘庄→富锦路应为3900秒，实际${line1ToFujinRoad}`);

  console.log(`上海官方 ETA 数据：${Object.keys(DATA.segments).length}/${edges.size} 条有向相邻边，缺失 ${missing.length} 条。`);
  Object.keys(DATA.coverage.byLine || {}).forEach((lineId) => {
    const item = DATA.coverage.byLine[lineId];
    console.log(`- ${lineId === 'pujiang' ? '浦江线' : `${lineId}号线`}：${item.sourcedDirectedSegments}/${item.expectedDirectedSegments}`);
  });
  console.log(`- 1号线富锦路→莘庄：${line1ToXinzhuang / 60} 分钟`);
  console.log(`- 1号线莘庄→富锦路：${line1ToFujinRoad / 60} 分钟`);
  if (missing.length) {
    console.log('回退边：');
    missing.forEach((key) => console.log(`! ${key}`));
  }

  if (errors.length) {
    console.error(`\nETA 数据校验失败（${errors.length} 项）：`);
    errors.forEach((message) => console.error(`✗ ${message}`));
    process.exitCode = 1;
    return;
  }
  console.log('ETA 数据校验通过。');
}

main();
