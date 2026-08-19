#!/usr/bin/env node

const assert = require('assert');
const catalog = require('../miniprogram/data/catalog');
const restroomData = require('../miniprogram/data/generated/restrooms');

const lineOptions = catalog.getLineOptions();
assert.strictEqual(lineOptions.length, 19, '运行时必须暴露 19 条线路');

const initial = catalog.getInitialHomeState();
assert.strictEqual(initial.lineId, '2');
assert.strictEqual(initial.direction, 'reverse');
assert.strictEqual(initial.originStationId, 'l2-s019');
assert.strictEqual(
  catalog.buildHomeView({ lineId: '8', originStationId: 'l8-laoximen' }).originStationName,
  '老西门',
  '旧原型站点 ID 必须迁移到全量数据 ID',
);
assert.strictEqual(
  catalog.buildHomeView({ lineId: '18', originStationId: 'l18-s004' }).originStationId,
  'l2-s019',
  '未开通站点不可恢复为计算起点',
);

const visibleStationIds = new Set();
const visibleSourceRows = new Set();

lineOptions.forEach((line) => {
  assert(line.routes.length > 0, `${line.name} 缺少 route`);
  line.routes.forEach((route) => {
    assert(route.directions.length > 0, `${route.id} 缺少合法方向`);
    route.directions.forEach((direction) => {
      const view = catalog.buildHomeView({
        lineId: line.id,
        routeId: route.id,
        direction: direction.id,
      });
      assert(view.stations.length > 0, `${route.id}/${direction.id} 没有可浏览站点`);
      view.stations.forEach((station) => {
        visibleStationIds.add(station.id);
        assert.notStrictEqual(station.status, 'unopened', `${station.name} 未开通却进入首页`);
        station.restrooms.forEach((restroom) => {
          visibleSourceRows.add(`${restroom.sourceSheet}:${restroom.sourceRow}`);
        });
      });
    });
  });
});

const sourceRecords = restroomData.lines.flatMap((line) => line.records);
const activeSourceRows = new Set(sourceRecords
  .filter((record) => record.status === 'active')
  .map((record) => `${record.sourceSheet}:${record.sourceRow}`));
assert.strictEqual(visibleStationIds.size, activeSourceRows.size, '可浏览站点未完整覆盖 active 源行');
activeSourceRows.forEach((key) => assert(visibleSourceRows.has(key), `源记录未进入厕所卡片：${key}`));

const line2 = catalog.buildHomeView({ lineId: '2', direction: 'reverse' });
const peopleSquare = line2.stations.find((station) => station.name === '人民广场');
assert(peopleSquare && peopleSquare.restrooms.length === 3, '人民广场应聚合 1/2/8 号线三条厕所记录');
assert.deepStrictEqual(
  peopleSquare.syncLineIds.sort(),
  ['1', '2', '8'],
  '换乘站同步范围必须包含当前展示厕所所属线路',
);
const xujing = line2.stations.find((station) => station.name === '徐泾东（国家会展中心）');
assert(xujing && !xujing.transfers.some((item) => item.lineId === '17'), '2/17 国家会展中心不可合并');

const forwardLine2 = catalog.buildHomeView({
  lineId: '2',
  direction: 'forward',
  originStationId: peopleSquare.id,
});
const reverseLine2 = catalog.buildHomeView({
  lineId: '2',
  direction: 'reverse',
  originStationId: peopleSquare.id,
});
assert.deepStrictEqual(
  forwardLine2.stations.map((station) => station.id),
  reverseLine2.stations.map((station) => station.id).reverse(),
  '普通线切换方向必须只反转展示序列',
);
assert.strictEqual(forwardLine2.originStationId, reverseLine2.originStationId, '切换方向不得修改起点');
['陆家嘴', '南京西路'].forEach((stationName) => {
  const forwardStation = forwardLine2.stations.find((station) => station.name === stationName);
  const reverseStation = reverseLine2.stations.find((station) => station.name === stationName);
  const forwardOriginIndex = forwardLine2.stations.findIndex((station) => station.id === peopleSquare.id);
  const reverseOriginIndex = reverseLine2.stations.findIndex((station) => station.id === peopleSquare.id);
  assert.strictEqual(
    forwardStation.isReverse,
    forwardLine2.stations.indexOf(forwardStation) < forwardOriginIndex,
    `${stationName} 正向掉头状态必须由展示序列决定`,
  );
  assert.strictEqual(
    reverseStation.isReverse,
    reverseLine2.stations.indexOf(reverseStation) < reverseOriginIndex,
    `${stationName} 反向掉头状态必须由展示序列决定`,
  );
  assert.notStrictEqual(forwardStation.isReverse, reverseStation.isReverse, `${stationName} 两向状态应互换`);
});

const line1AtRailwayStation = catalog.buildHomeView({ lineId: '1', direction: 'forward' })
  .stations.find((station) => station.name === '上海火车站');
assert.deepStrictEqual(
  line1AtRailwayStation.transfers.map((transfer) => transfer.lineId),
  ['3', '4'],
  '上海火车站应提供确定性排序的 3/4 号线换乘入口',
);
line1AtRailwayStation.transfers.forEach((transfer) => {
  const option = lineOptions.find((line) => line.id === transfer.lineId);
  assert.strictEqual(transfer.lineName, option.name, '换乘入口必须带线路名称');
  assert.strictEqual(transfer.lineColor, option.color, '换乘入口必须带官方线路色');
});

const lujiazui = line2.stations.find((station) => station.name === '陆家嘴');
const sameLinePath = catalog.getPathMetadata(peopleSquare.id, lujiazui.id);
assert.deepStrictEqual(sameLinePath.lineIds, ['2'], '同线路径只应返回当前线路');
assert.strictEqual(sameLinePath.segmentCount, 2, '人民广场至陆家嘴应为 2 个乘车区间');
assert.strictEqual(sameLinePath.transferCount, 0, '同线路径不应包含换乘');

const line8 = catalog.buildHomeView({ lineId: '8', direction: 'forward' });
const qufuRoad = line8.stations.find((station) => station.name === '曲阜路');
const crossLinePath = catalog.getPathMetadata(qufuRoad.id, lujiazui.id);
assert.deepStrictEqual(crossLinePath.lineIds, ['8', '2'], '跨线路径必须按行程顺序返回线路');
assert.strictEqual(crossLinePath.transferCount, 1, '曲阜路至陆家嘴应换乘 1 次');
assert.deepStrictEqual(
  crossLinePath.transferStationIds,
  ['l8-s015', 'l2-s019'],
  '跨线路径必须保留换乘两侧的线路站点 ID',
);

const line4 = catalog.buildHomeView({ lineId: '4', direction: 'outer' });
const line4Pudian = line4.stations.find((station) => station.sourceName === '浦电路');
assert(line4Pudian && !line4Pudian.transfers.some((item) => item.lineId === '6'), '4/6 浦电路不可换乘');

const line18 = catalog.buildHomeView({ lineId: '18', direction: 'forward' });
assert(!line18.stations.some((station) => station.name === '江杨南路'), '江杨南路暂未开通，不应展示');

['5', '10', '11'].forEach((lineId) => {
  const option = lineOptions.find((line) => line.id === lineId);
  assert.strictEqual(option.routes.length, 2, `${lineId}号线必须有两条支线路径`);
  option.routes.forEach((route) => assert.strictEqual(route.directions.length, 2));
});

console.log(`运行时验收通过：19 条线路，${visibleStationIds.size} 个可浏览站点，${visibleSourceRows.size} 条源厕所记录。`);
