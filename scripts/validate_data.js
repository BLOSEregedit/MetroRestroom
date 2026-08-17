#!/usr/bin/env node

// 上海地铁本地数据验收脚本。仅依赖 Node 标准库。
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const RESTROOMS_FILE = path.join(ROOT, "miniprogram/data/generated/restrooms.js");
const TOPOLOGY_FILE = path.join(ROOT, "miniprogram/data/topology.js");
const EXPECTED_LINES = Array.from({ length: 18 }, (_, i) => String(i + 1)).concat("浦江线");
const errors = [];
const warnings = [];

function fail(message) { errors.push(message); }
function text(value) { return value === undefined || value === null ? "" : String(value).trim(); }
function lineId(value) {
  const raw = text(value && (value.lineId ?? value.id ?? value.line ?? value.lineName ?? value.sheet));
  if (raw === "pujiang" || raw === "浦江") return "浦江线";
  return raw.replace(/号线$/, "");
}
function stationName(value) {
  return text(value && (value.stationName ?? value.station ?? value.name));
}
function load(file) {
  if (!fs.existsSync(file)) { fail(`缺少输入文件：${path.relative(ROOT, file)}`); return {}; }
  try { return require(file); } catch (error) { fail(`无法加载 ${path.relative(ROOT, file)}：${error.message}`); return {}; }
}
function values(value) {
  if (Array.isArray(value)) return value;
  return value && typeof value === "object" ? Object.entries(value).map(([id, item]) => ({ id, ...(item || {}) })) : [];
}
function normalizeFactory(topology) {
  return typeof topology.normalizeStationName === "function"
    ? topology.normalizeStationName
    : (name) => text(name).replace(/\s+/g, "");
}
function routeStations(route) { return Array.isArray(route && route.stationNames) ? route.stationNames.map(text) : []; }
function hasEdge(names, first, second, closed) {
  for (let i = 0; i < names.length - 1; i += 1) {
    if ((names[i] === first && names[i + 1] === second) || (names[i] === second && names[i + 1] === first)) return true;
  }
  return Boolean(closed && ((names[0] === first && names[names.length - 1] === second)
    || (names[0] === second && names[names.length - 1] === first)));
}

function flattenRows(restrooms) {
  return values(restrooms.lines).flatMap((line) => values(line.records));
}

function validateRows(rows) {
  const ids = new Set();
  const counts = new Map();
  const names = new Map();
  for (const [index, row] of rows.entries()) {
    const prefix = `源站行 ${index + 1}`;
    const id = lineId(row);
    const name = stationName(row);
    if (!id || !name) fail(`${prefix} 缺少 lineId 或 stationName`);
    if (!text(row.sourceSheet)) fail(`${prefix} 缺少 sourceSheet`);
    if (!Number.isInteger(row.sourceRow) || row.sourceRow < 1) fail(`${prefix} 的 sourceRow 无效`);
    for (const field of ["accessRaw", "locationRaw"]) if (!(field in row)) fail(`${prefix} 缺少 ${field}`);
    if (row.status !== "active" && row.status !== "inactive") fail(`${prefix} 的 status 非法：${text(row.status)}`);
    if (ids.has(row.lineStationId)) fail(`lineStationId 重复：${text(row.lineStationId)}`);
    if (!text(row.lineStationId)) fail(`${prefix} 缺少 lineStationId`);
    ids.add(row.lineStationId);
    counts.set(id, (counts.get(id) || 0) + 1);
    const key = `${id}:${name}`;
    if (!names.has(key)) names.set(key, row);
  }
  return { ids, counts, names };
}

function validateLines(restrooms, counts) {
  const lines = values(restrooms.lines);
  const ids = lines.map(lineId);
  if (ids.length !== new Set(ids).size) fail("restrooms.lines 线路 ID 不唯一");
  for (const expected of EXPECTED_LINES) {
    if (!ids.includes(expected)) fail(`缺少线路：${expected}`);
    if (!counts.has(expected)) fail(`线路 ${expected} 没有 records`);
  }
  for (const id of ids) if (!EXPECTED_LINES.includes(id)) fail(`存在未知线路：${id}`);
  return lines;
}

function buildSourceIndex(rows, normalize) {
  const index = new Map();
  for (const row of rows) {
    const id = lineId(row);
    const canonical = normalize(stationName(row), id);
    for (const name of [canonical, canonical.replace(/站$/, "")]) {
      const key = `${id}:${name}`;
      if (!index.has(key)) index.set(key, row);
    }
  }
  return index;
}

function validateTopology(topology, rows, sourceIndex) {
  const lines = values(topology.LINES);
  const normalize = normalizeFactory(topology);
  const lineIds = new Set(lines.map(lineId));
  for (const expected of EXPECTED_LINES) if (!lineIds.has(expected)) fail(`拓扑缺少线路：${expected}`);

  for (const line of lines) {
    const id = lineId(line);
    for (const route of values(line.routes)) {
      const names = routeStations(route);
      if (route.stationStatusByName !== undefined) {
        const statuses = route.stationStatusByName;
        for (const name of names) {
          if (!Object.prototype.hasOwnProperty.call(statuses || {}, name)) {
            fail(`${id} 号线 route ${text(route.id)} 缺少站点状态：${name}`);
          } else if (!["active", "unopened", "inactive"].includes(statuses[name])) {
            fail(`${id} 号线 route ${text(route.id)} 的状态非法：${name}=${statuses[name]}`);
          }
        }
        for (const name of Object.keys(statuses || {})) {
          if (!names.includes(name)) fail(`${id} 号线 route ${text(route.id)} 存在多余站点状态：${name}`);
        }
      }
      const seen = new Set();
      for (const name of names) {
        if (seen.has(name)) fail(`${id} 号线 route ${text(route.id)} 存在重复站：${name}`);
        seen.add(name);
        const canonical = normalize(name, id);
        const key = `${id}:${canonical}`;
        const aliasKey = `${id}:${canonical.replace(/站$/, "")}`;
        if (!sourceIndex.has(key) && !sourceIndex.has(aliasKey)) fail(`拓扑 active 站无法匹配源站：${id} / ${name}`);
      }
    }
  }

  const line4 = lines.find((line) => lineId(line) === "4");
  if (!line4 || !line4.routes.some((route) => route.closed === true)) fail("4 号线未声明 closed=true");
  for (const route of values(line4 && line4.routes)) {
    const names = routeStations(route);
    if (names.length > 1 && names[0] === names[names.length - 1]) fail(`4 号线 route ${text(route.id)} 首尾重复存储`);
    if (route.closed && route.closedEdge && !hasEdge(names, route.closedEdge[0], route.closedEdge[1], true)) {
      fail(`4 号线闭环边不存在：${route.closedEdge.join("—")}`);
    }
  }

  const line18 = lines.find((line) => lineId(line) === "18");
  const line18Status = line18 && values(line18.routes)[0] && values(line18.routes)[0].stationStatusByName;
  if (!line18Status || line18Status["江杨南路"] !== "unopened") {
    fail("18 号线江杨南路必须标记为 unopened");
  }

  for (const forbidden of values(topology.FORBIDDEN_ADJACENCIES)) {
    const line = lines.find((item) => lineId(item) === lineId(forbidden));
    const pair = forbidden.stationNames || [];
    if (line && pair.length === 2 && values(line.routes).some((route) => hasEdge(routeStations(route), pair[0], pair[1], route.closed))) {
      fail(`${lineId(forbidden)} 号线存在已知假边：${pair.join("—")}`);
    }
  }

  return { lines, normalize };
}

function validateTransfers(topology, rows, normalize) {
  const byName = new Map();
  for (const row of rows) {
    const id = lineId(row);
    const canonical = normalize(stationName(row), id);
    const key = `${id}:${canonical}`;
    if (!byName.has(key)) byName.set(key, { id, name: canonical });
  }
  const groups = new Map();
  for (const item of byName.values()) {
    if (!groups.has(item.name)) groups.set(item.name, []);
    groups.get(item.name).push(item.id);
  }
  const excluded = typeof topology.isExcludedSameNameTransfer === "function"
    ? topology.isExcludedSameNameTransfer
    : (a, na, b, nb) => a === "4" && b === "6" && na === "浦电路" && nb === "浦电路";
  const seen = new Set();
  const candidatePairs = new Set();
  let candidates = 0;
  for (const [name, ids] of groups.entries()) {
    for (let i = 0; i < ids.length; i += 1) for (let j = i + 1; j < ids.length; j += 1) {
      const pair = [ids[i], ids[j]].sort();
      if (excluded(pair[0], name, pair[1], name)) continue;
      const key = `${pair.join("/")}:${name}`;
      if (seen.has(key)) fail(`同名换乘候选重复：${key}`);
      seen.add(key);
      candidatePairs.add(`${pair.join("/")}:${name}`);
      candidates += 1;
    }
  }
  if (candidatePairs.has("4/6:浦电路") || candidatePairs.has("4/6:向城路")) fail("4/6 浦电路换乘候选未排除");
  if (candidatePairs.has("2/17:国家会展中心")
    || candidatePairs.has("2/17:国家会展中心（2号线）")
    || candidatePairs.has("2/17:国家会展中心（17号线）")) {
    fail("2/17 国家会展中心换乘候选未排除");
  }
  return candidates;
}

function reportDirectionGaps(topology) {
  for (const line of values(topology.LINES)) {
    const directions = Object.values(line.directions || {});
    if (directions.length < 2 || line.type === "linear") continue;
    for (const route of values(line.routes)) {
      const hasDirectionField = route.directionIds || route.directions || route.directionId;
      if (!hasDirectionField) {
        warnings.push(`${lineId(line)} 号线 route ${text(route.id)} 未显式声明可用方向（directions/directionIds）`);
      }
    }
  }
}

function main() {
  const restrooms = load(RESTROOMS_FILE);
  const topology = load(TOPOLOGY_FILE);
  const rows = flattenRows(restrooms);
  if (!rows.length) fail("restrooms.lines[].records 为空或未导出");
  const { ids, counts } = validateRows(rows);
  validateLines(restrooms, counts);
  const normalize = normalizeFactory(topology);
  const sourceIndex = buildSourceIndex(rows, normalize);
  const result = validateTopology(topology, rows, sourceIndex);
  const transferCount = validateTransfers(topology, rows, result.normalize);
  reportDirectionGaps(topology);

  console.log("逐线源站统计：");
  for (const expected of EXPECTED_LINES) console.log(`- ${expected}：${counts.get(expected) || 0} 行`);
  console.log(`- 同名换乘候选：${transferCount} 条（已去重，已排除 4/6 浦电路）`);
  if (warnings.length) {
    console.log("\n拓扑方向表达告警：");
    warnings.forEach((message) => console.log(`! ${message}`));
  }
  if (errors.length) {
    console.error(`\n数据验收失败（${errors.length} 项）：`);
    errors.forEach((message) => console.error(`✗ ${message}`));
    process.exitCode = 1;
    return;
  }
  console.log(`\n数据验收通过：${rows.length} 条源站行，${ids.size} 个唯一 lineStationId。`);
}

main();
