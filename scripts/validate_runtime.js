#!/usr/bin/env node

const assert = require('assert');
const catalog = require('../miniprogram/data/catalog');
const restroomData = require('../miniprogram/data/generated/restrooms');
const { normalizeFacilityTerms } = require('../miniprogram/utils/display-copy');

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
          assert(Array.isArray(restroom.wayfindingTags), `${restroom.id} 缺少结构化导视标签`);
          assert(
            restroom.wayfindingTags.length >= 1 && restroom.wayfindingTags.length <= 2,
            `${restroom.id} 导视标签必须控制在 1—2 个`,
          );
          const labels = restroom.wayfindingTags.map((tag) => tag.label);
          ['站厅', '站厅层', '候车厅', '候车区', '地面', '通道', '连接通道'].forEach((label) => {
            assert(!labels.includes(label), `${restroom.id} 不得展示不够直观的空间标签 ${label}`);
          });
          if (labels.includes('站台')) {
            assert(!restroom.orientationLabel, `${restroom.id} 已有方向信息时不得重复显示站台`);
          }
          if (labels.includes('换乘通道')) {
            assert(/换乘通道/.test(restroom.detailLocation), `${restroom.id} 只能从明确原文派生换乘通道`);
          }
          assert.strictEqual(
            restroom.detailLocation,
            normalizeFacilityTerms(restroom.locationRaw).replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim(),
            `${restroom.id} 完整位置描述除用户术语归一外不得丢失`,
          );
          assert(!restroom.location.includes('厕所'), `${restroom.id} 位置摘要不得显示“厕所”`);
          assert(!restroom.detailLocation.includes('厕所'), `${restroom.id} 完整位置不得显示“厕所”`);
          assert.strictEqual(restroom.facility, '卫生间', `${restroom.id} 设施名称必须统一为“卫生间”`);
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

function getRestroomPresentation(lineId, stationName) {
  const station = catalog.buildHomeView({ lineId }).stations.find((item) => item.name === stationName);
  assert(station, `${lineId}号线缺少结构化展示测试站点 ${stationName}`);
  const restroom = station.restrooms.find((item) => item.lineId === lineId);
  assert(restroom, `${lineId}号线${stationName}缺少本线路厕所记录`);
  return restroom;
}

assert.deepStrictEqual(
  getRestroomPresentation('1', '富锦路').wayfindingTags.map((tag) => tag.label),
  ['闸内', '近2号口'],
  '站厅描述必须收敛为闸区与出口，不展示专业空间术语',
);
assert.deepStrictEqual(
  getRestroomPresentation('3', '东宝兴路').wayfindingTags.map((tag) => tag.label),
  ['闸内／闸外', '近1／2号口'],
  '混合闸区与多个出口必须保留完整语义',
);
assert.deepStrictEqual(
  getRestroomPresentation('10', '三门路').wayfindingTags.map((tag) => tag.label),
  ['闸区待确认', '往基隆路·车尾'],
  '有明确方向时必须省略重复站台标签，且不得默认推断闸区',
);
assert.deepStrictEqual(
  getRestroomPresentation('14', '蓝天路').wayfindingTags.map((tag) => tag.label),
  ['闸内', '双向·车头／车尾'],
  '双向不同车厢位置必须作为组合事实展示',
);
assert.deepStrictEqual(
  getRestroomPresentation('16', '鹤沙航城').wayfindingTags.map((tag) => tag.label),
  ['闸外／站外', '近1／2号口'],
  '闸外与站外必须保留，地面与出口语义重复时不得展示',
);
const accessConflict = getRestroomPresentation('9', '合川路');
assert.strictEqual(accessConflict.accessConflict, true, '源闸区与明确站外位置冲突时必须标记冲突');
assert.deepStrictEqual(
  accessConflict.wayfindingTags.map((tag) => tag.label),
  ['闸区待确认', '1号口外'],
  '冲突记录不得展示确定的闸内结论',
);
assert.deepStrictEqual(
  getRestroomPresentation('1', '上海南站').wayfindingTags.map((tag) => tag.label),
  ['闸内', '换乘通道'],
  '原文明示换乘通道时必须保留该导视信息',
);
assert.deepStrictEqual(
  getRestroomPresentation('3', '江杨北路').wayfindingTags.map((tag) => tag.label),
  ['闸内', '近1号口'],
  '已有出口锚点时不得重复显示站台',
);
assert.deepStrictEqual(
  getRestroomPresentation('3', '宜山路').wayfindingTags.map((tag) => tag.label),
  ['闸内', '站台'],
  '同时缺少方向和出口锚点时允许保留地铁站台作为兜底位置',
);
assert.deepStrictEqual(
  getRestroomPresentation('18', '康文路').wayfindingTags.map((tag) => tag.label),
  ['闸内', '位置待补充'],
  '位置为空时必须保留闸区事实并明确待补充',
);

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
assert.strictEqual(line4.line.type, 'loop', '4号线必须作为闭合环线进入首页');
assert.strictEqual(line4.directionLabel, '外圈', '4号线外圈方向不得再追加固定锚点的下一站');
assert.strictEqual(
  catalog.buildHomeView({ lineId: '4', direction: 'inner' }).directionLabel,
  '内圈',
  '4号线内圈方向不得再追加固定锚点的下一站',
);
const line4Pudian = line4.stations.find((station) => station.sourceName === '浦电路');
assert(line4Pudian && !line4Pudian.transfers.some((item) => item.lineId === '6'), '4/6 浦电路不可换乘');

const defaultLine10 = catalog.buildHomeView({ lineId: '10' });
assert.strictEqual(
  defaultLine10.line.routeId,
  'l10-hongqiao-railway-station',
  '进入支线线路必须直接选择默认主线路径',
);
assert.strictEqual(defaultLine10.directionLabel, '往虹桥火车站', '默认主线不得继续显示“支线待确认”');
assert(defaultLine10.stations.some((station) => station.name === '虹桥火车站'), '10号线默认路径必须展示虹桥火车站');
assert(!defaultLine10.stations.some((station) => station.name === '航中路'), '10号线默认路径不得混入航中路支线站点');
const line10Split = defaultLine10.stations.find((station) => station.name === '龙溪路');
assert.deepStrictEqual(
  line10Split.branchHint,
  {
    routeId: 'l10-hangzhong-road',
    terminalName: '航中路',
    actionLabel: '切换至支线 · 航中路方向',
  },
  '分支站必须暴露另一条路径的弱提示与切换目标',
);
const hangzhongLine10 = catalog.buildHomeView({
  lineId: '10',
  routeId: 'l10-hangzhong-road',
  direction: 'to-hangzhong-road',
});
assert(hangzhongLine10.stations.some((station) => station.name === '航中路'), '切换支线后必须展示航中路终点');
assert(!hangzhongLine10.stations.some((station) => station.name === '虹桥火车站'), '切换支线后不得残留主线独占站点');
assert.strictEqual(
  hangzhongLine10.stations.find((station) => station.name === '龙溪路').branchHint.terminalName,
  '虹桥火车站',
  '切换支线后分支提示必须反向指向主线路径',
);
assert.strictEqual(
  hangzhongLine10.stations.find((station) => station.name === '龙溪路').branchHint.actionLabel,
  '切换至主线 · 虹桥火车站方向',
  '站间切换位必须明确切回主线及其方向',
);

[
  {
    lineId: '5',
    routeId: 'l5-fengxian',
    direction: 'to-fengxian-new-city',
    splitStationName: '东川路',
    expected: '切换至支线 · 闵行开发区方向',
  },
  {
    lineId: '5',
    routeId: 'l5-minhang-development-zone',
    direction: 'to-minhang-development-zone',
    splitStationName: '东川路',
    expected: '切换至主线 · 奉贤新城方向',
  },
  {
    lineId: '10',
    routeId: 'l10-hongqiao-railway-station',
    direction: 'to-hongqiao-railway-station',
    splitStationName: '龙溪路',
    expected: '切换至支线 · 航中路方向',
  },
  {
    lineId: '10',
    routeId: 'l10-hangzhong-road',
    direction: 'to-hangzhong-road',
    splitStationName: '龙溪路',
    expected: '切换至主线 · 虹桥火车站方向',
  },
  {
    lineId: '11',
    routeId: 'l11-jiading-north-disney',
    direction: 'to-jiading-north',
    splitStationName: '嘉定新城',
    expected: '切换至支线 · 花桥方向',
  },
  {
    lineId: '11',
    routeId: 'l11-huaqiao-disney',
    direction: 'to-huaqiao',
    splitStationName: '嘉定新城',
    expected: '切换至主线 · 嘉定北方向',
  },
].forEach((branchCase) => {
  const view = catalog.buildHomeView(branchCase);
  assert.strictEqual(
    view.stations.find((station) => station.name === branchCase.splitStationName).branchHint.actionLabel,
    branchCase.expected,
    `${branchCase.lineId}号线站间切换位必须说明目标路径归属与方向`,
  );
});

const line10Options = lineOptions.find((line) => line.id === '10');
assert.strictEqual(
  line10Options.routes.find((route) => route.id === 'l10-hangzhong-road').actionLabel,
  '点击切换至航中路站支线',
  '顶部切换入口必须保持现有文案，不受站间切换位调整影响',
);

const line18 = catalog.buildHomeView({ lineId: '18', direction: 'forward' });
assert(!line18.stations.some((station) => station.name === '江杨南路'), '江杨南路暂未开通，不应展示');

['5', '10', '11'].forEach((lineId) => {
  const option = lineOptions.find((line) => line.id === lineId);
  assert.strictEqual(option.routes.length, 2, `${lineId}号线必须有两条支线路径`);
  option.routes.forEach((route) => assert.strictEqual(route.directions.length, 2));
  const defaultRoute = option.routes.find((route) => route.id === option.defaultRouteId);
  const defaultView = catalog.buildHomeView({ lineId });
  assert.strictEqual(defaultView.line.routeId, option.defaultRouteId, `${lineId}号线必须直接进入默认主线路径`);
  assert(
    defaultView.stations.some((station) => station.name === defaultRoute.terminalName),
    `${lineId}号线默认路径必须展示自身终点`,
  );
});

console.log(`运行时验收通过：19 条线路，${visibleStationIds.size} 个可浏览站点，${visibleSourceRows.size} 条源厕所记录。`);
