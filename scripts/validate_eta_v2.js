const assert = require('assert');
const catalog = require('../miniprogram/data/catalog');
const { estimateEta, roundEtaMinutes } = require('../miniprogram/utils/eta');

function stationByName(view, stationName) {
  const station = view.stations.find((item) => item.name === stationName);
  assert(station, `未找到站点：${view.line.name} ${stationName}`);
  return station;
}

function breakdownSeconds(eta, key) {
  const item = eta.breakdown.find((entry) => entry.key === key);
  return item ? item.seconds : 0;
}

const calibrated = estimateEta({
  segmentCount: 27,
  rideSeconds: 65 * 60,
  initialWaitSeconds: 150,
  restroomWalkSeconds: 150,
  access: '闸内',
});
assert.strictEqual(calibrated.totalSeconds, 70 * 60, '65 分钟车程加候车和步行应为 70 分钟');
assert.strictEqual(calibrated.label, '约 70 分钟', 'ETA 应显示单值，不再显示宽区间');
assert(!/[–—~-]/.test(calibrated.label), 'ETA 文案不得包含时间范围');
assert.strictEqual(roundEtaMinutes(9.4), 9, '10 分钟内按 1 分钟取整');
assert.strictEqual(roundEtaMinutes(9.5), 10, '9.5 分钟应按半入规则取整为 10 分钟');
assert.strictEqual(roundEtaMinutes(11), 12, '11 分钟应按 2 分钟档半入到 12 分钟');
assert.strictEqual(roundEtaMinutes(19), 20, '10–30 分钟按 2 分钟取整');
assert.strictEqual(roundEtaMinutes(31), 30, '31 分钟应按 5 分钟档取整为 30 分钟');
assert.strictEqual(roundEtaMinutes(32.5), 35, '32.5 分钟应按半入规则取整为 35 分钟');
assert.strictEqual(roundEtaMinutes(33), 35, '30 分钟以上按 5 分钟取整');

const line1View = catalog.buildHomeView({
  lineId: '1',
  routeId: 'l1-main',
  direction: 'reverse',
  originStationId: 'l1-s028',
});
const fujinRoad = stationByName(line1View, '富锦路');
assert.strictEqual(fujinRoad.path.segmentCount, 27, '莘庄到富锦路应经过 27 个相邻区间');
assert.strictEqual(fujinRoad.path.rideSeconds, 65 * 60, '莘庄到富锦路官方乘车时分应为 65 分钟');
assert.strictEqual(fujinRoad.path.initialWaitSeconds, 150, '1 号线首次平均候车应为 2.5 分钟');
assert.strictEqual(fujinRoad.etaLabel, '约 70 分钟', '莘庄到富锦路 ETA 应收敛到约 70 分钟');

const peopleSquareView = catalog.buildHomeView({
  lineId: '1',
  routeId: 'l1-main',
  direction: 'forward',
  originStationId: 'l2-s019',
});
const peopleSquare = stationByName(peopleSquareView, '人民广场');
const line1Restroom = peopleSquare.restrooms.find((item) => item.lineId === '1');
assert(line1Restroom, '人民广场应包含 1 号线卫生间');
assert.strictEqual(breakdownSeconds({ breakdown: line1Restroom.etaBreakdown }, 'initialWait'), 0,
  '同物理站跨线前往卫生间不应计算首次候车');
assert.strictEqual(breakdownSeconds({ breakdown: line1Restroom.etaBreakdown }, 'transferWait'), 0,
  '同物理站跨线前往卫生间不应计算换线候车');
assert.strictEqual(
  breakdownSeconds({ breakdown: line1Restroom.etaBreakdown }, 'transferWalk'),
  180,
  '同物理站跨线只计算换乘步行',
);

const line4Outer = catalog.buildHomeView({
  lineId: '4',
  routeId: 'l4-loop',
  direction: 'outer',
  originStationId: 'l4-s001',
});
assert.strictEqual(stationByName(line4Outer, '虹桥路').path.segmentCount, 1,
  '4 号线外圈应从宜山路直接到虹桥路');
assert.strictEqual(stationByName(line4Outer, '上海体育馆').path.segmentCount, 25,
  '4 号线外圈不得偷走内圈闭环邻边');
const line4Inner = catalog.buildHomeView({
  lineId: '4',
  routeId: 'l4-loop',
  direction: 'inner',
  originStationId: 'l4-s001',
});
assert.strictEqual(stationByName(line4Inner, '上海体育馆').path.segmentCount, 1,
  '4 号线内圈应从宜山路直接到上海体育馆');

const line10View = catalog.buildHomeView({
  lineId: '10',
  routeId: 'l10-hongqiao-railway-station',
  direction: 'to-hongqiao-railway-station',
  originStationId: 'l10-s037',
});
const hongqiaoRailwayStation = stationByName(line10View, '虹桥火车站');
assert.strictEqual(hongqiaoRailwayStation.path.transferCount, 0,
  '10 号线两支线之间不应伪装成跨线换乘');
assert.strictEqual(hongqiaoRailwayStation.path.sameLineChangeCount, 1,
  '航中路到虹桥火车站应计算一次同线换车');
assert(hongqiaoRailwayStation.path.sameLineChangeWaitSeconds > 0,
  '同线换车应包含新服务方向的平均候车');

const line5View = catalog.buildHomeView({
  lineId: '5',
  routeId: 'l5-fengxian',
  direction: 'to-fengxian-new-city',
  originStationId: 'l5-s019',
});
assert.strictEqual(stationByName(line5View, '奉贤新城').path.sameLineChangeCount, 1,
  '5 号线闵行开发区到奉贤新城应在东川路同线换车');

const line11View = catalog.buildHomeView({
  lineId: '11',
  routeId: 'l11-jiading-north-disney',
  direction: 'to-jiading-north',
  originStationId: 'l11-s001',
});
assert.strictEqual(stationByName(line11View, '嘉定北').path.sameLineChangeCount, 1,
  '11 号线花桥到嘉定北应在嘉定新城同线换车');

const line18Skip = catalog.getPathMetadata('l18-s003', 'l18-s005', {
  lineId: '18',
  routeId: 'l18-main',
  direction: 'forward',
});
assert.deepStrictEqual(line18Skip.stationIds, ['l18-s003', 'l18-s005'],
  '18 号线路径应跳过未开通的江杨南路');
assert.strictEqual(catalog.__test.lineSegmentMedianSeconds['18'], 120,
  '18 号线已采集有向区间的中位数应为 120 秒');
assert.strictEqual(line18Skip.rideSeconds, 240,
  '18 号线爱辉路到长江西路应使用官方时刻表推导的 240 秒 active 聚合边');
const line18SkipReverse = catalog.getPathMetadata('l18-s005', 'l18-s003', {
  lineId: '18',
  routeId: 'l18-main',
  direction: 'reverse',
});
assert.strictEqual(line18SkipReverse.rideSeconds, 300,
  '18 号线长江西路到爱辉路应使用官方时刻表推导的 300 秒 active 聚合边');
assert.strictEqual(catalog.__test.directedSegmentSeconds('unknown-a', 'unknown-b'), 180,
  '无法识别线路且缺少区间数据时才应回退到全局 180 秒');

const benchmarkInput = {
  lineId: '10',
  routeId: 'l10-hongqiao-railway-station',
  direction: 'to-hongqiao-railway-station',
  originStationId: 'l2-s019',
};
const benchmarkSamples = [];
for (let index = 0; index < 5; index += 1) {
  const startedAt = process.hrtime.bigint();
  catalog.buildHomeView(benchmarkInput);
  benchmarkSamples.push(Number(process.hrtime.bigint() - startedAt) / 1e6);
}
benchmarkSamples.sort((left, right) => left - right);
const benchmarkMedianMs = benchmarkSamples[Math.floor(benchmarkSamples.length / 2)];
assert(benchmarkMedianMs < 50, `典型跨线首页热态耗时过高：${benchmarkMedianMs.toFixed(1)}ms`);

console.log(`ETA V2 validation passed; buildHomeView median ${benchmarkMedianMs.toFixed(1)}ms`);
