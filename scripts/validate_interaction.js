#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const catalog = require('../miniprogram/data/catalog');
const stationLocationData = require('../miniprogram/data/station-locations');
const storage = require('../miniprogram/utils/storage');
const wheelPhysics = require('../miniprogram/utils/wheel-physics');
const { createStationFeedback } = require('../miniprogram/utils/feedback');

let pageDefinition = null;
const app = { globalData: { cloudReady: false, pendingCorrectionContext: null } };
const navigationCalls = [];
const toastCalls = [];

global.getApp = () => app;
global.wx = {
  navigateTo(options) { navigationCalls.push(options); },
  showToast(options) { toastCalls.push(options); },
};
global.Page = (definition) => { pageDefinition = definition; };

const pagePath = path.resolve(__dirname, '../miniprogram/pages/index/index.js');
delete require.cache[pagePath];
require(pagePath);
assert(pageDefinition, '首页 Page 配置未加载');

function createPage(lineId, direction, stationName, originStationId) {
  const view = catalog.buildHomeView({ lineId, direction, originStationId });
  const currentIndex = view.stations.findIndex((station) => station.name === stationName);
  assert(currentIndex >= 0, `${lineId}号线缺少测试站点 ${stationName}`);

  const page = Object.assign({}, pageDefinition);
  page.data = {
    currentIndex,
    drawerStation: null,
    isManualAnchor: true,
    lineColor: view.line.color,
    lineTextColor: page._getReadableLineColor(view.line.color),
    lineName: view.line.name,
    directionLabel: view.directionLabel,
    lineOptions: catalog.getLineOptions(),
    locationCandidates: [],
    locationIssue: '',
    locationStatus: 'cached',
    isManualSelectionGuide: false,
    manualStationOptions: [],
    nearbyStationCandidates: [],
    showLinePicker: false,
    showNearbyStationPicker: false,
    showLocationCandidates: false,
    showStationPicker: false,
    showCityPicker: false,
    showRestroomDrawer: false,
    syncTone: 'blue',
    stations: view.stations,
  };
  page._state = {
    lineId: view.line.id,
    direction: view.direction,
    originStationId: view.originStationId,
    routeId: view.line.routeId,
  };
  page._rawStations = view.stations;
  page._systemOriginStationId = view.originStationId;
  page._directionMode = 'default';
  page._explicitLineId = '';
  page._lineViewStateById = Object.create(null);
  page.setData = function setData(patch, callback) {
    this.data = Object.assign({}, this.data, patch);
    if (callback) callback();
  };
  page._cancelPendingLocation = () => {};
  page._saveCurrentPreferences = (patch) => { page._savedPreferences = patch || {}; };
  page._addRecentRecord = () => {};
  return { page, view, station: view.stations[currentIndex] };
}

const line2 = catalog.buildHomeView({ lineId: '2', direction: 'forward' });
const peopleSquare = line2.stations.find((station) => station.name === '人民广场');
const directionCase = createPage('2', 'forward', '南京东路', peopleSquare.id);
const directionOriginId = directionCase.page._state.originStationId;
directionCase.page._wheelPosition = { value: directionCase.page.data.currentIndex + .5 };
directionCase.page._wheelLastDirection = { value: 1 };
directionCase.page._refreshHomeView = (stationId, options) => {
  directionCase.page._refreshedStationId = stationId;
  directionCase.page._refreshOptions = options;
};
directionCase.page.onSwitchDirection();
assert.strictEqual(directionCase.page._state.direction, 'reverse', '顶部方向按钮必须切换到反向');
assert.strictEqual(directionCase.page._state.originStationId, directionOriginId, '方向切换不得修改起点');
assert.strictEqual(
  directionCase.page._refreshedStationId,
  directionCase.view.stations[directionCase.page.data.currentIndex + 1].id,
  '两卡正中且向上滑时，方向切换必须锚定正在进入第二位的下方卡片',
);
assert.deepStrictEqual(
  directionCase.page._refreshOptions.wheelRebase,
  {
    oldPosition: directionCase.page.data.currentIndex + .5,
    oldAnchorIndex: directionCase.page.data.currentIndex + 1,
  },
  '方向切换必须携带当前连续位置，不得退回已吸附 currentIndex',
);
assert.strictEqual(directionCase.page._directionMode, 'manual', '方向切换后应进入手动方向模式');

const branchSelectionCase = createPage('2', 'forward', '南京东路', peopleSquare.id);
branchSelectionCase.page._refreshHomeView = () => {};
branchSelectionCase.page.onSelectLine({ currentTarget: { dataset: { lineId: '10' } } });
assert.strictEqual(branchSelectionCase.page._state.lineId, '10', '线路选择必须切换到 10 号线');
assert.strictEqual(
  branchSelectionCase.page._state.routeId,
  'l10-hongqiao-railway-station',
  '进入支线线路必须立即选择默认主线路径',
);
assert.strictEqual(branchSelectionCase.page._directionMode, 'default', '显式切换线路后方向模式必须重置为默认');

const branchSlotCase = createPage('10', 'to-hongqiao-railway-station', '龙溪路');
branchSlotCase.page._scheduleStationWheelLayout = () => {};
branchSlotCase.page._scheduleSyncForVisibleStation = () => {};
branchSlotCase.page._updateSyncStatus = () => {};
const decoratedBranchStations = branchSlotCase.page._decorateStations(
  branchSlotCase.view.stations,
  branchSlotCase.page.data.currentIndex,
  branchSlotCase.view.line.color,
);
const branchSplitIndex = decoratedBranchStations.findIndex((station) => station.name === '龙溪路');
assert(branchSplitIndex >= 0 && decoratedBranchStations[branchSplitIndex].branchHint, '10 号线龙溪路必须生成支线切换提示');
assert.strictEqual(
  decoratedBranchStations[branchSplitIndex + 1].incomingBranchHint.routeId,
  'l10-hangzhong-road',
  '支线切换提示必须挂载到下一站定高行的顶部点击层',
);
const branchOriginId = branchSlotCase.page._state.originStationId;
branchSlotCase.page.onSelectRoute({
  currentTarget: { dataset: { routeId: 'l10-hangzhong-road' } },
});
assert.strictEqual(branchSlotCase.page._state.routeId, 'l10-hangzhong-road', '点击站间入口必须切换至航中路支线');
assert.strictEqual(
  branchSlotCase.page._rawStations[branchSlotCase.page.data.currentIndex].name,
  '龙溪路',
  '支线切换后必须保持分叉站居中',
);
assert.strictEqual(branchSlotCase.page._state.originStationId, branchOriginId, '支线切换不得修改计算起点');

const loopBoundaryCase = createPage('4', 'outer', '宜山路', peopleSquare.id);
loopBoundaryCase.page.data.isLoopLine = true;
loopBoundaryCase.page.data.wheelSlotHeight = 80;
loopBoundaryCase.page._decorateStations = (stations, currentIndex) => stations.map((station, index) => (
  Object.assign({}, station, { isActive: index === currentIndex })
));
loopBoundaryCase.page._updateSyncStatus = () => {};
loopBoundaryCase.page._scheduleSyncForVisibleStation = () => {};
const loopLastIndex = loopBoundaryCase.page._rawStations.length - 1;
loopBoundaryCase.page.onLoopBoundaryTap({ currentTarget: { dataset: { targetIndex: loopLastIndex } } });
assert.strictEqual(loopBoundaryCase.page.data.currentIndex, loopLastIndex, '环线顶部闭环入口必须跳到列表末站');
assert.strictEqual(loopBoundaryCase.page.data.wheelScrollTop, loopLastIndex * 80, '环线闭环跳转必须同步轮盘滚动位置');

assert.strictEqual(
  directionCase.page._getWheelCandidateIndex(0, .54, 10),
  0,
  '候选站在进入阈值前必须保持原站',
);
assert.strictEqual(
  directionCase.page._getWheelCandidateIndex(0, .56, 10),
  1,
  '候选站越过 0.55 站距后必须进入下一站',
);
assert.strictEqual(
  directionCase.page._getWheelCandidateIndex(1, .46, 10),
  1,
  '候选站进入下一站后，在 0.45—0.55 稳定带内不得跳回',
);
assert.strictEqual(
  directionCase.page._getWheelCandidateIndex(1, .44, 10),
  0,
  '候选站退回 0.45 以下后必须恢复上一站',
);
assert.strictEqual(
  directionCase.page._resolveWheelSnapTarget(.08, 0, 0, .4, 1, 10),
  0,
  '小于 0.10 站距的低速抖动必须回原站',
);
assert.strictEqual(
  directionCase.page._resolveWheelSnapTarget(.52, 0, 0, 1.2, 1, 10),
  1,
  '临界稳定带内有明确向前速度时必须选择正在进入的站点',
);
assert.strictEqual(
  directionCase.page._resolveWheelSnapTarget(.52, 0, 0, .4, 1, 10),
  0,
  '临界稳定带内接近静止时必须保持已有候选站',
);
assert.strictEqual(
  directionCase.page._resolveWheelSnapTarget(.2, 0, 0, 4.5, 1, 10),
  1,
  '明确快甩但原生惯性未跨阈值时必须至少前进一站',
);
assert.strictEqual(
  directionCase.page._getWheelAnchorIndex(4.5, 1, 4, 10),
  5,
  '两卡正中且列表向前移动时必须锚定进入焦点的下方卡片',
);
assert.strictEqual(
  directionCase.page._getWheelAnchorIndex(4.5, -1, 5, 10),
  4,
  '两卡正中且列表向后移动时必须锚定进入焦点的上方卡片',
);
assert(
  Math.abs(directionCase.page._getWheelRebasePosition(4.35, 4, 12, 20) - 12.35) < 1e-10,
  '方向重映射必须保持锚点卡片相对第二位的屏幕偏移',
);

const snapLifecycleCase = createPage('2', 'forward', '南京东路', peopleSquare.id);
snapLifecycleCase.page._wheelPhase = { value: 3 };
snapLifecycleCase.page._wheelSnapping = { value: 1 };
snapLifecycleCase.page.onWheelScrollStart({ detail: { isDrag: false } });
assert.strictEqual(
  snapLifecycleCase.page._wheelPhase.value,
  3,
  '程序化吸附产生的 scrollstart 不得清除 SNAPPING 状态',
);
assert.strictEqual(
  snapLifecycleCase.page._wheelSnapping.value,
  1,
  '程序化吸附开始后必须继续锁定同一个吸附目标',
);

const snapFallbackCase = createPage('2', 'forward', '南京东路', peopleSquare.id);
const fallbackTarget = snapFallbackCase.page.data.currentIndex + 1;
snapFallbackCase.page.data.wheelSlotHeight = 100;
snapFallbackCase.page._wheelFeedbackSession = 7;
snapFallbackCase.page._wheelSettledSession = -1;
snapFallbackCase.page._wheelPosition = { value: fallbackTarget - .2 };
snapFallbackCase.page._wheelLastPosition = { value: fallbackTarget - .2 };
snapFallbackCase.page._wheelSettledIndex = { value: fallbackTarget - 1 };
snapFallbackCase.page._wheelCandidateIndex = { value: fallbackTarget };
snapFallbackCase.page._wheelGestureStartPosition = { value: fallbackTarget - 1 };
snapFallbackCase.page._wheelDetentIndex = { value: fallbackTarget - 1 };
snapFallbackCase.page._wheelPhase = { value: 3 };
snapFallbackCase.page._wheelSuppressDetents = { value: 0 };
snapFallbackCase.page._wheelSnapping = { value: 1 };
snapFallbackCase.page._wheelSnapTarget = { value: fallbackTarget };
snapFallbackCase.page._wheelSnapAttempts = { value: 1 };
snapFallbackCase.page._updateSyncStatus = () => {};
snapFallbackCase.page._scheduleSyncForVisibleStation = () => {};
snapFallbackCase.page.onWheelSnapFallback(fallbackTarget, 7);
assert.strictEqual(snapFallbackCase.page._wheelSnapTarget.value, -1, '吸附兜底完成后必须清除旧目标');
assert.strictEqual(snapFallbackCase.page._wheelSnapping.value, 0, '吸附兜底完成后必须退出吸附状态');
assert.strictEqual(
  snapFallbackCase.page.data.wheelScrollTop,
  fallbackTarget * 100,
  '吸附兜底必须把真实 scrollTop 收敛到目标站位',
);

const transferPresentationCase = createPage('3', 'forward', '上海火车站');
const transferPresentation = transferPresentationCase.page._decorateStations(
  transferPresentationCase.view.stations,
  transferPresentationCase.page.data.currentIndex,
  transferPresentationCase.page.data.lineColor,
);
const presentedTransferStation = transferPresentation.find((station) => station.name === '上海火车站');
assert.deepStrictEqual(
  presentedTransferStation.transferLineOptions.map((item) => item.lineId),
  ['1', '3', '4'],
  '换乘卡必须静态展示当前线路与所有可换乘线路',
);
assert.strictEqual(
  presentedTransferStation.transferSwipeLeft.lineId,
  '4',
  '手指向左拖动时必须提示全局顺序中的下一条线',
);
assert.strictEqual(
  presentedTransferStation.transferSwipeRight.lineId,
  '1',
  '手指向右拖动时必须提示全局顺序中的上一条线',
);

const nonFocusTransfer = transferPresentation.find(
  (station, index) => index !== transferPresentationCase.page.data.currentIndex
    && station.transferLineOptions.length > 1,
);
assert(nonFocusTransfer, '测试线路必须有非焦点换乘站');
assert(
  nonFocusTransfer.transferSummaryAriaLabel.includes('经过'),
  '非焦点换乘卡也必须输出完整静态线路摘要',
);

const leftSwipeCase = createPage('3', 'forward', '上海火车站');
leftSwipeCase.page._switchToTransfer = (transfer) => { leftSwipeCase.page._selectedTransfer = transfer; };
leftSwipeCase.page.onWheelHorizontalSwipe(-100, 5);
assert.strictEqual(leftSwipeCase.page._selectedTransfer.lineId, '4', '左滑应选择数值相邻的下一线路');

const rightSwipeCase = createPage('3', 'forward', '上海火车站');
rightSwipeCase.page._switchToTransfer = (transfer) => { rightSwipeCase.page._selectedTransfer = transfer; };
rightSwipeCase.page.onWheelHorizontalSwipe(100, -5);
assert.strictEqual(rightSwipeCase.page._selectedTransfer.lineId, '1', '右滑应选择数值相邻的上一线路');

const thresholdRollbackCase = createPage('3', 'forward', '上海火车站');
thresholdRollbackCase.page._switchToTransfer = (transfer) => { thresholdRollbackCase.page._selectedTransfer = transfer; };
thresholdRollbackCase.page.onWheelHorizontalSwipe(-47, 0);
assert.strictEqual(thresholdRollbackCase.page._selectedTransfer, undefined, '横滑未达 48px 门槛时必须回退当前线路');
thresholdRollbackCase.page.onWheelHorizontalDragStart();
assert(Date.now() < thresholdRollbackCase.page._suppressCardTapUntil, '有效横向拖动必须立即抑制卡片点击');

const twoLineSwipeCase = createPage('1', 'forward', '呼兰路');
twoLineSwipeCase.page._switchToTransfer = (transfer) => {
  twoLineSwipeCase.page._selectedTransfer = transfer;
};
twoLineSwipeCase.page.onWheelHorizontalSwipe(-100, 5);
assert.strictEqual(twoLineSwipeCase.page._selectedTransfer.lineId, '18', '两线换乘站左滑必须切至唯一另一线路');
twoLineSwipeCase.page._selectedTransfer = null;
twoLineSwipeCase.page.onWheelHorizontalSwipe(100, 5);
assert.strictEqual(twoLineSwipeCase.page._selectedTransfer.lineId, '18', '两线换乘站右滑也必须切至唯一另一线路');

const transferBoundaryCase = createPage('1', 'forward', '上海火车站');
transferBoundaryCase.page._switchToTransfer = (transfer) => {
  transferBoundaryCase.page._selectedTransfer = transfer;
};
transferBoundaryCase.page.onWheelHorizontalSwipe(100, 5);
assert.strictEqual(transferBoundaryCase.page._selectedTransfer, undefined, '多线换乘站位于首项时右滑不得循环到末项');

const unsettledTransferCase = createPage('3', 'forward', '上海火车站');
unsettledTransferCase.page._wheelPhase = { value: 1 };
unsettledTransferCase.page._wheelPosition = { value: unsettledTransferCase.page.data.currentIndex + .3 };
unsettledTransferCase.page._wheelSettledIndex = { value: unsettledTransferCase.page.data.currentIndex };
unsettledTransferCase.page._switchToTransfer = (transfer) => {
  unsettledTransferCase.page._selectedTransfer = transfer;
};
unsettledTransferCase.page.onWheelHorizontalSwipe(-100, 5);
assert.strictEqual(unsettledTransferCase.page._selectedTransfer, undefined, '纵向拨轮未停稳时不得按旧中心站横切线路');

const centuryAvenueLine2 = createPage('2', 'forward', '世纪大道');
const centuryAvenueLine6 = createPage('6', 'forward', '世纪大道');
const line2TransferOrder = centuryAvenueLine2.page
  ._buildTransferLineOptions(centuryAvenueLine2.station, centuryAvenueLine2.view.line.color)
  .map((item) => item.lineId);
const line6TransferOrder = centuryAvenueLine6.page
  ._buildTransferLineOptions(centuryAvenueLine6.station, centuryAvenueLine6.view.line.color)
  .map((item) => item.lineId);
assert.deepStrictEqual(line2TransferOrder, ['2', '4', '6', '9'], '世纪大道换乘线路必须按全局线路顺序排列');
assert.deepStrictEqual(line6TransferOrder, line2TransferOrder, '同站切线后换乘胶囊位置不得因当前线路变化而重排');

const transferDirectionMemoryCase = createPage('3', 'reverse', '上海火车站');
transferDirectionMemoryCase.page._directionMode = 'manual';
transferDirectionMemoryCase.page._scheduleStationWheelLayout = () => {};
transferDirectionMemoryCase.page._scheduleSyncForVisibleStation = () => {};
transferDirectionMemoryCase.page._updateSyncStatus = () => {};
const transferToastCount = toastCalls.length;
const transferToLine1 = transferDirectionMemoryCase.station.transfers.find(
  (item) => item.lineId === '1',
);
transferDirectionMemoryCase.page._switchToTransfer(transferToLine1);
const line1ActiveStation = transferDirectionMemoryCase.page
  ._rawStations[transferDirectionMemoryCase.page.data.currentIndex];
const transferBackToLine3 = line1ActiveStation.transfers.find((item) => item.lineId === '3');
transferDirectionMemoryCase.page._switchToTransfer(transferBackToLine3);
assert.strictEqual(transferDirectionMemoryCase.page._state.direction, 'reverse', '切回线路时必须恢复该线路本次使用中的手动方向');
assert.strictEqual(transferDirectionMemoryCase.page._directionMode, 'manual', '恢复手动方向时必须同时恢复方向来源状态');
assert.strictEqual(
  transferDirectionMemoryCase.page._rawStations[transferDirectionMemoryCase.page.data.currentIndex].name,
  '上海火车站',
  '恢复线路方向后仍须保持同一物理站居中',
);
assert.strictEqual(toastCalls.length, transferToastCount, '动态滑动提示已给出去向，切线后不得再弹 Toast');

const loopDirectionMemoryCase = createPage('4', 'inner', '上海体育馆');
loopDirectionMemoryCase.page._directionMode = 'manual';
loopDirectionMemoryCase.page._scheduleStationWheelLayout = () => {};
loopDirectionMemoryCase.page._scheduleSyncForVisibleStation = () => {};
loopDirectionMemoryCase.page._updateSyncStatus = () => {};
loopDirectionMemoryCase.page._switchToTransfer(
  loopDirectionMemoryCase.station.transfers.find((item) => item.lineId === '1'),
);
const line1Stadium = loopDirectionMemoryCase.page
  ._rawStations[loopDirectionMemoryCase.page.data.currentIndex];
loopDirectionMemoryCase.page._switchToTransfer(
  line1Stadium.transfers.find((item) => item.lineId === '4'),
);
assert.strictEqual(loopDirectionMemoryCase.page._state.direction, 'inner', '切回 4 号线必须恢复本次使用中的内圈方向');
assert.strictEqual(loopDirectionMemoryCase.page._directionMode, 'manual', '4 号线圈向记忆必须保留手动状态');

const branchMemoryCase = createPage('1', 'forward', '陕西南路');
branchMemoryCase.page._scheduleStationWheelLayout = () => {};
branchMemoryCase.page._scheduleSyncForVisibleStation = () => {};
branchMemoryCase.page._updateSyncStatus = () => {};
branchMemoryCase.page._lineViewStateById['10'] = {
  lineId: '10',
  routeId: 'l10-hangzhong-road',
  direction: 'to-hangzhong-road',
  directionMode: 'manual',
};
branchMemoryCase.page._switchToTransfer(
  branchMemoryCase.station.transfers.find((item) => item.lineId === '10'),
);
assert.strictEqual(branchMemoryCase.page._state.routeId, 'l10-hangzhong-road', '公共区段切入 10 号线必须恢复该线支线路径');
assert.strictEqual(branchMemoryCase.page._state.direction, 'to-hangzhong-road', '恢复 10 号线路径时必须恢复与路径匹配的方向');

const invalidBranchMemoryCase = createPage('2', 'forward', '虹桥火车站');
invalidBranchMemoryCase.page._scheduleStationWheelLayout = () => {};
invalidBranchMemoryCase.page._scheduleSyncForVisibleStation = () => {};
invalidBranchMemoryCase.page._updateSyncStatus = () => {};
invalidBranchMemoryCase.page._lineViewStateById['10'] = {
  lineId: '10',
  routeId: 'l10-hangzhong-road',
  direction: 'to-hangzhong-road',
  directionMode: 'manual',
};
invalidBranchMemoryCase.page._switchToTransfer(
  invalidBranchMemoryCase.station.transfers.find((item) => item.lineId === '10'),
);
assert.strictEqual(
  invalidBranchMemoryCase.page._state.routeId,
  'l10-hongqiao-railway-station',
  '记忆路径不包含目标换乘站时必须回退到包含该站的合法默认路径',
);
assert.strictEqual(invalidBranchMemoryCase.page._directionMode, 'default', '失效路径回退后不得保留手动方向来源');

const verticalSwipeCase = createPage('3', 'forward', '上海火车站');
verticalSwipeCase.page._switchToTransfer = (transfer) => {
  verticalSwipeCase.page._selectedTransfer = transfer;
};
verticalSwipeCase.page.onWheelHorizontalSwipe(12, 110);
assert.strictEqual(verticalSwipeCase.page._selectedTransfer, undefined, '纵滑站点不得误触线路切换');

const shortSwipeCase = createPage('3', 'forward', '上海火车站');
shortSwipeCase.page._switchToTransfer = (transfer) => {
  shortSwipeCase.page._selectedTransfer = transfer;
};
shortSwipeCase.page.onWheelHorizontalSwipe(-39, 4);
assert.strictEqual(shortSwipeCase.page._selectedTransfer, undefined, '不足阈值的横向移动不得切线');

const manualAnchorCase = createPage('2', 'forward', '南京东路', peopleSquare.id);
const manualVisibleId = manualAnchorCase.page._visibleStationId();
const manualOrigin = manualAnchorCase.view.stations.find((station) => station.name === '陆家嘴');
assert(manualOrigin && manualOrigin.id !== manualVisibleId, '手动起点测试站必须区别于浏览站');
manualAnchorCase.page._refreshHomeView = (stationId) => {
  manualAnchorCase.page._refreshedStationId = stationId;
};
manualAnchorCase.page.onSetManualAnchor({
  currentTarget: { dataset: { stationId: manualOrigin.id } },
});
assert.strictEqual(manualAnchorCase.page._state.originStationId, manualOrigin.id, '点击圆点应锁定该站为起点');
assert.strictEqual(manualAnchorCase.page.data.isManualAnchor, true, '点击圆点后应进入手动起点模式');
assert.strictEqual(
  manualAnchorCase.page._refreshedStationId,
  manualVisibleId,
  '点击其他站点圆点不得改变当前可见目标站',
);
assert.strictEqual(manualAnchorCase.page._savedPreferences.originMode, 'manual');

let restoreLocationCalls = 0;
manualAnchorCase.page._hasConfirmedLocation = true;
manualAnchorCase.page._systemOriginStationId = peopleSquare.id;
manualAnchorCase.page.data.locationStatus = 'cached';
manualAnchorCase.page.onRequestLocation = () => { restoreLocationCalls += 1; };
manualAnchorCase.page.onRestoreSmartLocation();
assert.strictEqual(restoreLocationCalls, 1, '恢复定位入口必须重新请求系统定位');
assert.strictEqual(
  manualAnchorCase.page.data.isManualAnchor,
  false,
  '已有上次定位站时应立即退出自选起点状态',
);
assert.strictEqual(
  manualAnchorCase.page._state.originStationId,
  peopleSquare.id,
  '已有上次定位站时应立即恢复系统计算起点',
);
assert.strictEqual(
  manualAnchorCase.page._refreshedStationId,
  manualVisibleId,
  '恢复系统计算起点时不得改变当前浏览站',
);
assert.strictEqual(manualAnchorCase.page._savedPreferences.originMode, 'smart');

const noCachedLocationCase = createPage('2', 'forward', '南京东路', peopleSquare.id);
noCachedLocationCase.page._hasConfirmedLocation = false;
noCachedLocationCase.page._systemOriginStationId = '';
noCachedLocationCase.page.data.locationStatus = 'notRequested';
let noCachedLocationCalls = 0;
noCachedLocationCase.page.onRequestLocation = () => { noCachedLocationCalls += 1; };
noCachedLocationCase.page.onRestoreSmartLocation();
assert.strictEqual(noCachedLocationCalls, 1, '没有上次定位站时仍应发起系统定位');
assert.strictEqual(
  noCachedLocationCase.page.data.isManualAnchor,
  true,
  '没有上次定位站时必须等待定位成功后再退出自选起点状态',
);

const deniedLocationCase = createPage('2', 'forward', '南京东路', peopleSquare.id);
deniedLocationCase.page.data.locationStatus = 'denied';
deniedLocationCase.page.data.locationIssue = 'permissionDenied';
deniedLocationCase.page.data.locationCandidates = [];
let deniedLocationActionCalls = 0;
deniedLocationCase.page.onLocationAction = () => { deniedLocationActionCalls += 1; };
deniedLocationCase.page.onRestoreSmartLocation();
assert.strictEqual(deniedLocationActionCalls, 1, '拒绝定位后恢复入口必须转入重新授权流程');
assert.strictEqual(deniedLocationCase.page.data.isManualAnchor, true, '重新授权前应保留自选起点');

const transferPhysical = stationLocationData.stations.find(
  (station) => (station.lineStationIds || []).includes(peopleSquare.id),
);
assert(transferPhysical && transferPhysical.lineStationIds.length === 3, '人民广场应为三线换乘物理站');
function pendingTransfer(physicalStationId) {
  return Object.assign({}, transferPhysical, {
    physicalStationId,
    distanceMeters: 880,
    proximity: 'nearby',
    position: { latitude: 31.232687, longitude: 121.475108, accuracy: 20 },
  });
}

const explicitLineCase = createPage('2', 'forward', '人民广场', peopleSquare.id);
explicitLineCase.page._explicitLineId = '2';
explicitLineCase.page._applyLocationCandidate = (candidate) => {
  explicitLineCase.page._appliedCandidate = candidate;
};
explicitLineCase.page._resolveLocationLineCandidate(pendingTransfer('physical-no-entrance-explicit'));
assert.strictEqual(
  explicitLineCase.page._appliedCandidate.lineId,
  '2',
  '没有稳定入口证据时应优先沿用本会话显式当前线',
);

const savedLineCase = createPage('4', 'outer', '世纪大道', peopleSquare.id);
savedLineCase.page._explicitLineId = '';
savedLineCase.page._applyLocationCandidate = (candidate) => {
  savedLineCase.page._appliedCandidate = candidate;
};
const savedPhysicalId = 'physical-no-entrance-saved';
storage.saveStationLineChoice(savedPhysicalId, { lineStationId: peopleSquare.id });
savedLineCase.page._resolveLocationLineCandidate(pendingTransfer(savedPhysicalId));
assert.strictEqual(
  savedLineCase.page._appliedCandidate.lineStationId,
  peopleSquare.id,
  '无显式当前线时应复用同物理站用户确认过的线路',
);

const requiredLineCase = createPage('2', 'forward', '人民广场', peopleSquare.id);
requiredLineCase.page._explicitLineId = '';
requiredLineCase.page._resolveLocationLineCandidate(pendingTransfer('physical-no-entrance-required'));
assert.strictEqual(requiredLineCase.page.data.locationStatus, 'lineRequired');
assert.strictEqual(requiredLineCase.page.data.showLocationCandidates, true);
assert.strictEqual(requiredLineCase.page.data.locationCandidates.length, 3);
const requiredOriginalOrigin = requiredLineCase.page._state.originStationId;
requiredLineCase.page.onCloseLocationCandidates();
assert.strictEqual(requiredLineCase.page.data.showLocationCandidates, false);
assert.strictEqual(requiredLineCase.page._state.originStationId, requiredOriginalOrigin, '关闭线路选择不得提交待确认起点');
requiredLineCase.page.onLocationAction();
assert.strictEqual(requiredLineCase.page.data.showLocationCandidates, true, '线路待确认入口应能重新打开同站线路选择');
requiredLineCase.page._applyLocationCandidate = (candidate) => {
  requiredLineCase.page._appliedCandidate = candidate;
};
requiredLineCase.page.onSelectLocationCandidate({
  currentTarget: { dataset: { stationId: peopleSquare.id } },
});
const savedExplicitChoice = storage.getStationLineChoice('physical-no-entrance-required');
assert.strictEqual(requiredLineCase.page._appliedCandidate.lineStationId, peopleSquare.id);
assert.strictEqual(savedExplicitChoice.lineStationId, peopleSquare.id, '用户明确选线后必须写入站点级偏好');
assert.strictEqual(requiredLineCase.page._explicitLineId, '2', '用户明确选择换乘线路后应成为本会话显式线路');

const explicitSourceCase = createPage('2', 'forward', '人民广场', peopleSquare.id);
explicitSourceCase.page._explicitLineId = '2';
explicitSourceCase.page._refreshHomeView = () => {};
explicitSourceCase.page._applyLocationCandidate({
  lineStationId: 'l4-s013',
  physicalStationId: 'physical-l4-s013',
  lineId: '4',
  routeId: 'l4-loop',
  direction: 'outer',
  directionMode: 'default',
  stationName: '世纪大道',
  proximity: 'nearby',
  resolutionSource: 'nearestEntrance',
});
assert.strictEqual(explicitSourceCase.page._explicitLineId, '', '入口自动切到其他线路后不得沿用旧显式线路标记');

const cancelPendingCase = createPage('2', 'forward', '人民广场', peopleSquare.id);
cancelPendingCase.page._cancelPendingLocation = pageDefinition._cancelPendingLocation;
cancelPendingCase.page._pendingLocationMatch = pendingTransfer('physical-cancel-pending');
cancelPendingCase.page.data.locationStatus = 'lineRequired';
cancelPendingCase.page.data.showLocationCandidates = true;
cancelPendingCase.page.data.locationCandidates = [peopleSquare];
cancelPendingCase.page.data.locationPendingStationName = '人民广场';
cancelPendingCase.page.onChooseManualLocation();
assert.strictEqual(cancelPendingCase.page._pendingLocationMatch, null, '改为手动选站时必须取消待确认定位');
assert.strictEqual(cancelPendingCase.page.data.isManualSelectionGuide, true);
assert.strictEqual(cancelPendingCase.page.data.showLinePicker, true);
assert.strictEqual(cancelPendingCase.page.data.showStationPicker, false);
assert.strictEqual(cancelPendingCase.page.data.showLocationCandidates, false);
assert.strictEqual(cancelPendingCase.page.data.locationPendingStationName, '');

const manualGuideCase = createPage('2', 'forward', '人民广场', peopleSquare.id);
const manualGuideOrigin = manualGuideCase.page._state.originStationId;
manualGuideCase.page._refreshHomeView = () => {};
manualGuideCase.page.onChooseManualLocation();
assert.strictEqual(manualGuideCase.page.data.isManualSelectionGuide, true);
assert.strictEqual(manualGuideCase.page.data.showLinePicker, true, '手动选择必须先复用线路面板');
assert.strictEqual(manualGuideCase.page.data.showStationPicker, false);
manualGuideCase.page.onSelectLine({ currentTarget: { dataset: { lineId: '11' } } });
assert.strictEqual(manualGuideCase.page._state.lineId, '11');
assert.strictEqual(manualGuideCase.page.data.showLinePicker, false);
assert.strictEqual(manualGuideCase.page.data.showStationPicker, true, '选线后必须自动衔接站点面板');
assert.strictEqual(manualGuideCase.page.data.isManualSelectionGuide, true);
assert(manualGuideCase.page.data.manualStationOptions.some(
  (station) => station.name === '嘉定北',
), '11 号线手动站点列表必须覆盖嘉定北支线');
assert(manualGuideCase.page.data.manualStationOptions.some(
  (station) => station.name === '花桥',
), '11 号线手动站点列表必须覆盖花桥支线');
assert.deepStrictEqual(
  manualGuideCase.page.data.manualStationOptions
    .filter((station) => station.sectionLabel)
    .map((station) => station.sectionLabel),
  ['共线段', '主线', '支线'],
  '11 号线手动站点列表必须按共线段、主线和支线分组',
);
const sharedManualStation = manualGuideCase.page.data.manualStationOptions.find(
  (station) => station.name === '嘉定新城',
);
const huaqiaoManualStation = manualGuideCase.page.data.manualStationOptions.find(
  (station) => station.name === '花桥',
);
const jiadingManualStation = manualGuideCase.page.data.manualStationOptions.find(
  (station) => station.name === '嘉定北',
);
assert.strictEqual(sharedManualStation.contextLabel, '', '共线站不得重复说明两条路径均可');
assert.strictEqual(sharedManualStation.branchRoleLabel, '', '共线站不得标成主线或支线');
assert.strictEqual(sharedManualStation.routeId, '', '共线站不得强制覆盖当前支线路径');
assert.strictEqual(huaqiaoManualStation.branchRoleLabel, '支线', '花桥方向必须使用官方支线归属');
assert.strictEqual(huaqiaoManualStation.contextLabel, '花桥方向', '花桥支线站必须标明方向');
assert.strictEqual(huaqiaoManualStation.routeId, 'l11-huaqiao-disney', '花桥独有站必须携带所属路径');
assert.strictEqual(jiadingManualStation.branchRoleLabel, '主线', '嘉定北方向必须使用官方主线归属');
assert.strictEqual(jiadingManualStation.contextLabel, '嘉定北方向', '嘉定北主线站必须标明方向');
assert.strictEqual(jiadingManualStation.routeId, 'l11-jiading-north-disney', '嘉定北独有站必须携带所属路径');
[
  {
    lineId: '5',
    count: 19,
    sections: ['共线段', '主线', '支线'],
  },
  {
    lineId: '10',
    count: 37,
    sections: ['共线段', '主线', '支线'],
  },
  {
    lineId: '11',
    count: 38,
    sections: ['共线段', '主线', '支线'],
  },
].forEach((branchLine) => {
  const options = manualGuideCase.page._getManualStationOptions(branchLine.lineId);
  assert.strictEqual(options.length, branchLine.count, `${branchLine.lineId} 号线必须覆盖全部唯一站点`);
  assert.strictEqual(new Set(options.map((station) => station.id)).size, options.length, `${branchLine.lineId} 号线站点不得重复`);
  assert.deepStrictEqual(
    options.filter((station) => station.sectionLabel).map((station) => station.sectionLabel),
    branchLine.sections,
    `${branchLine.lineId} 号线必须按共线段、主线和支线分组`,
  );
  assert(options.filter((station) => station.routeId).every(
    (station) => station.contextLabel && station.branchRoleLabel,
  ), `${branchLine.lineId} 号线主线与支线独有站必须带归属和方向`);
  assert(options.filter((station) => !station.routeId).every(
    (station) => !station.contextLabel && !station.branchRoleLabel,
  ), `${branchLine.lineId} 号线共线站不得重复显示路径说明`);
});
assert.strictEqual(
  new Set(manualGuideCase.page.data.manualStationOptions.map((station) => station.id)).size,
  manualGuideCase.page.data.manualStationOptions.length,
  '手动站点列表必须按线路站 ID 去重',
);
assert.strictEqual(manualGuideCase.page._state.originStationId, manualGuideOrigin, '只完成选线时不得修改原计算起点');
manualGuideCase.page.onBackToManualLinePicker();
assert.strictEqual(manualGuideCase.page.data.showStationPicker, false, '返回选线时必须关闭站点面板');
assert.strictEqual(manualGuideCase.page.data.showLinePicker, true, '返回选线时必须重新打开线路面板');
assert.strictEqual(manualGuideCase.page.data.isManualSelectionGuide, true, '返回选线后必须保留手动选择流程');
assert.deepStrictEqual(manualGuideCase.page.data.manualStationOptions, [], '返回选线后必须清空旧线路站点');
assert.strictEqual(manualGuideCase.page._state.originStationId, manualGuideOrigin, '返回选线不得修改原计算起点');

manualGuideCase.page.onSelectLine({ currentTarget: { dataset: { lineId: '4' } } });
const line4ManualNames = manualGuideCase.page.data.manualStationOptions.map((station) => station.name);
assert.strictEqual(manualGuideCase.page.data.manualStationOptions.length, 26, '4 号线手动站点列表必须包含 26 个真实车站');
assert.strictEqual(new Set(manualGuideCase.page.data.manualStationOptions.map((station) => station.id)).size, 26, '4 号线不得出现重复线路站 ID');
assert.strictEqual(line4ManualNames.filter((name) => name === '上海体育场').length, 1, '上海体育场必须显示一次');
assert.strictEqual(line4ManualNames.filter((name) => name === '上海体育馆').length, 1, '上海体育馆必须显示一次且不得与上海体育场合并');
manualGuideCase.page.onCloseStationPicker();
assert.strictEqual(manualGuideCase.page.data.showStationPicker, false);
assert.strictEqual(manualGuideCase.page.data.isManualSelectionGuide, false, '关闭第二步必须结束手动选择引导');
assert.deepStrictEqual(manualGuideCase.page.data.manualStationOptions, []);

const confirmManualGuideCase = createPage('2', 'forward', '人民广场', peopleSquare.id);
const manualGuideStation = confirmManualGuideCase.view.stations.find(
  (station) => station.name === '南京东路',
);
confirmManualGuideCase.page.data.isManualSelectionGuide = true;
confirmManualGuideCase.page.data.showStationPicker = true;
confirmManualGuideCase.page._refreshHomeView = () => {};
confirmManualGuideCase.page.onSelectOriginStation({
  currentTarget: { dataset: { stationId: manualGuideStation.id } },
});
assert.strictEqual(confirmManualGuideCase.page._state.originStationId, manualGuideStation.id);
assert.strictEqual(confirmManualGuideCase.page.data.isManualAnchor, true);
assert.strictEqual(confirmManualGuideCase.page.data.isManualSelectionGuide, false, '确认起点后必须结束引导');
assert.strictEqual(confirmManualGuideCase.page.data.showStationPicker, false);

const branchManualOriginCase = createPage('11', 'to-huaqiao', '迪士尼');
branchManualOriginCase.page.data.isManualSelectionGuide = true;
branchManualOriginCase.page.data.manualStationOptions = branchManualOriginCase.page
  ._getManualStationOptions('11');
branchManualOriginCase.page.data.showStationPicker = true;
branchManualOriginCase.page._refreshHomeView = () => {};
const branchOrigin = branchManualOriginCase.page.data.manualStationOptions.find(
  (station) => station.name === '嘉定北',
);
branchManualOriginCase.page.onSelectOriginStation({
  currentTarget: {
    dataset: { stationId: branchOrigin.id, routeId: branchOrigin.routeId },
  },
});
assert.strictEqual(branchManualOriginCase.page._state.originStationId, branchOrigin.id);
assert.strictEqual(branchManualOriginCase.page._state.routeId, 'l11-jiading-north-disney', '支线独有站必须自动切换所属路径');
assert.strictEqual(branchManualOriginCase.page._state.direction, 'to-jiading-north', '原方向不适用时必须切换到所属路径的默认方向');

const sharedManualOriginCase = createPage('11', 'to-huaqiao', '迪士尼');
sharedManualOriginCase.page._state.routeId = 'l11-jiading-north-disney';
sharedManualOriginCase.page._state.direction = 'to-disney';
sharedManualOriginCase.page._directionMode = 'manual';
sharedManualOriginCase.page.data.isManualSelectionGuide = true;
sharedManualOriginCase.page._refreshHomeView = () => {};
const sharedOrigin = sharedManualOriginCase.page._getManualStationOptions('11').find(
  (station) => station.name === '嘉定新城',
);
sharedManualOriginCase.page.onSelectOriginStation({
  currentTarget: {
    dataset: { stationId: sharedOrigin.id, routeId: sharedOrigin.routeId },
  },
});
assert.strictEqual(sharedManualOriginCase.page._state.routeId, 'l11-jiading-north-disney', '选择共线站必须保留当前支线路径');
assert.strictEqual(sharedManualOriginCase.page._state.direction, 'to-disney', '选择共线站必须保留当前合法方向');

const preserveManualRouteCase = createPage('11', 'to-huaqiao', '迪士尼');
preserveManualRouteCase.page._state.routeId = 'l11-jiading-north-disney';
preserveManualRouteCase.page._state.direction = 'to-disney';
preserveManualRouteCase.page._directionMode = 'manual';
preserveManualRouteCase.page.data.isManualSelectionGuide = true;
preserveManualRouteCase.page._refreshHomeView = () => {};
preserveManualRouteCase.page.onSelectLine({ currentTarget: { dataset: { lineId: '11' } } });
assert.strictEqual(preserveManualRouteCase.page._state.routeId, 'l11-jiading-north-disney', '手动流程重新选择当前线路时必须保留当前支线');
assert.strictEqual(preserveManualRouteCase.page._state.direction, 'to-disney', '手动流程重新选择当前线路时必须保留合法方向');
assert.strictEqual(preserveManualRouteCase.page._directionMode, 'manual', '保留合法方向时不得丢失用户方向模式');

const closeManualLineGuideCase = createPage('2', 'forward', '人民广场', peopleSquare.id);
closeManualLineGuideCase.page.onChooseManualLocation();
closeManualLineGuideCase.page.onCloseLinePicker();
assert.strictEqual(closeManualLineGuideCase.page.data.showLinePicker, false);
assert.strictEqual(closeManualLineGuideCase.page.data.isManualSelectionGuide, false, '关闭第一步不得残留引导状态');

const nearbyStationCase = createPage('2', 'forward', '人民广场', peopleSquare.id);
const nearbyPhysical = Object.assign({}, transferPhysical, {
  physicalStationId: 'physical-nearby-choice',
  stationName: '人民广场',
  lineNames: '1号线／2号线／8号线',
  distanceMeters: 3800,
  distanceLabel: '约 3.8 公里',
});
nearbyStationCase.page.data.locationStatus = 'stationRequired';
nearbyStationCase.page.data.nearbyStationCandidates = [nearbyPhysical];
nearbyStationCase.page.data.showNearbyStationPicker = true;
nearbyStationCase.page._pendingLocationPosition = {
  latitude: 31.2,
  longitude: 121.4,
  accuracy: 20,
};
const nearbyOriginalOrigin = nearbyStationCase.page._state.originStationId;
nearbyStationCase.page.onCloseNearbyStationPicker();
assert.strictEqual(nearbyStationCase.page.data.showNearbyStationPicker, false);
assert.strictEqual(nearbyStationCase.page._state.originStationId, nearbyOriginalOrigin, '关闭附近站选择不得提交起点');
nearbyStationCase.page.onLocationAction();
assert.strictEqual(nearbyStationCase.page.data.showNearbyStationPicker, true, '附近站待选择入口应能重新打开列表');
nearbyStationCase.page._resolveLocationLineCandidate = (pending) => {
  nearbyStationCase.page._resolvedPending = pending;
};
nearbyStationCase.page.onSelectNearbyStation({
  currentTarget: { dataset: { physicalStationId: 'physical-nearby-choice' } },
});
assert.strictEqual(nearbyStationCase.page.data.showNearbyStationPicker, false);
assert.strictEqual(nearbyStationCase.page._resolvedPending.physicalStationId, 'physical-nearby-choice');
assert.strictEqual(nearbyStationCase.page._resolvedPending.proximity, 'selectedNearby');
assert.deepStrictEqual(
  nearbyStationCase.page._resolvedPending.position,
  nearbyStationCase.page._pendingLocationPosition,
  '附近站选中后必须继续使用本次定位坐标解析换乘线路',
);

const unmatchedLocationCase = createPage('2', 'forward', '人民广场', peopleSquare.id);
unmatchedLocationCase.page.data.locationStatus = 'unmatched';
unmatchedLocationCase.page.onLocationAction();
assert.strictEqual(unmatchedLocationCase.page.data.isManualSelectionGuide, true);
assert.strictEqual(unmatchedLocationCase.page.data.showLinePicker, true, '5 公里内无站时必须先引导选择线路');
assert.strictEqual(unmatchedLocationCase.page.data.showStationPicker, false);

const applyLocationCase = createPage('2', 'reverse', '人民广场', peopleSquare.id);
applyLocationCase.page._directionMode = 'manual';
applyLocationCase.page._refreshHomeView = (stationId) => {
  applyLocationCase.page._refreshedStationId = stationId;
};
const applyPending = pendingTransfer(transferPhysical.physicalStationId);
applyPending.proximity = 'nearest';
applyPending.distanceMeters = 2600;
const applyCandidate = applyLocationCase.page._locationOptionsForMatch(applyPending).find(
  (candidate) => candidate.lineId === '2',
);
applyLocationCase.page._applyLocationCandidate(applyCandidate);
assert.strictEqual(applyLocationCase.page._state.originStationId, peopleSquare.id);
assert.strictEqual(applyLocationCase.page._state.direction, 'reverse', '同线路定位必须保留有效的手动方向');
assert.strictEqual(applyLocationCase.page._directionMode, 'manual');
assert.strictEqual(applyLocationCase.page._refreshedStationId, peopleSquare.id);
assert.strictEqual(applyLocationCase.page.data.locationStatus, 'nearest');
assert.strictEqual(applyLocationCase.page.data.locationLabel, '最近站 · 约 2.6 公里');
const appliedLastLocation = storage.getLastLocationStation();
assert.strictEqual(appliedLastLocation.lineStationId, peopleSquare.id);
assert.strictEqual(appliedLastLocation.physicalStationId, transferPhysical.physicalStationId);
assert(appliedLastLocation.locatedAt > 0);

const selectedNearbyCase = createPage('2', 'reverse', '人民广场', peopleSquare.id);
selectedNearbyCase.page._refreshHomeView = () => {};
const selectedNearbyPending = pendingTransfer(transferPhysical.physicalStationId);
selectedNearbyPending.proximity = 'selectedNearby';
selectedNearbyPending.distanceMeters = 3800;
const selectedNearbyCandidate = selectedNearbyCase.page._locationOptionsForMatch(
  selectedNearbyPending,
).find((candidate) => candidate.lineId === '2');
selectedNearbyCase.page._applyLocationCandidate(selectedNearbyCandidate);
assert.strictEqual(selectedNearbyCase.page.data.locationStatus, 'selectedNearby');
assert.strictEqual(selectedNearbyCase.page.data.locationLabel, '已选站 · 约 3.8 公里');

const invalidAnchorOrigin = manualAnchorCase.page._state.originStationId;
manualAnchorCase.page.onSetManualAnchor({ currentTarget: { dataset: { stationId: 'missing' } } });
assert.strictEqual(
  manualAnchorCase.page._state.originStationId,
  invalidAnchorOrigin,
  '不存在的圆点站点不得改变起点',
);

const cityPickerCase = createPage('2', 'forward', '人民广场', peopleSquare.id);
cityPickerCase.page.onOpenCityPicker();
assert.strictEqual(cityPickerCase.page.data.showCityPicker, true, '点击城市胶囊必须打开城市面板');
cityPickerCase.page.onSelectCity();
assert.strictEqual(cityPickerCase.page.data.showCityPicker, false, '选择当前城市后必须关闭城市面板');

const syncPresentationCase = createPage('2', 'forward', '人民广场', peopleSquare.id);
const syncNow = Date.UTC(2026, 7, 20, 6, 30);
const syncedPresentation = syncPresentationCase.page._buildHomeSyncPresentation({
  phase: 'success', tone: 'green', lastAlignedAt: syncNow,
}, syncNow);
assert.deepStrictEqual(syncedPresentation, {
  tone: 'green', message: '已同步 · 08-20 14:30', actionLabel: '更新',
});
syncPresentationCase.page.data.syncTone = 'green';
const checkingPresentation = syncPresentationCase.page._buildHomeSyncPresentation({
  phase: 'checking', tone: 'orange', lastAlignedAt: syncNow,
}, syncNow);
assert.strictEqual(checkingPresentation.tone, 'green', '检查期间必须保留请求前的新鲜度圆点');
assert.strictEqual(checkingPresentation.actionLabel, '更新中');
const failedPresentation = syncPresentationCase.page._buildHomeSyncPresentation({
  phase: 'failed', tone: 'gray', lastAlignedAt: syncNow,
}, syncNow);
assert.deepStrictEqual(failedPresentation, {
  tone: 'blue', message: '本地数据 · 上次 08-20 14:30', actionLabel: '重试',
});
const unsyncedPresentation = syncPresentationCase.page._buildHomeSyncPresentation({
  phase: 'idle', tone: 'gray', lastAlignedAt: 0,
}, syncNow);
assert.strictEqual(unsyncedPresentation.message, '本地数据 · 尚未同步');
const priorYearPresentation = syncPresentationCase.page._buildHomeSyncPresentation({
  phase: 'idle',
  tone: 'gray',
  lastAlignedAt: Date.UTC(2025, 11, 31, 15, 59),
}, syncNow);
assert.strictEqual(
  priorYearPresentation.message,
  '本地数据 · 上次 2025-12-31 23:59',
  '跨年份同步时间必须保留完整年份',
);

const decorationCase = createPage('2', 'forward', '南京东路', peopleSquare.id);
const decorationStations = [
  { id: peopleSquare.id, name: '人民广场', isReverse: true, restrooms: [] },
  { id: 'test-target', name: '测试目标', isReverse: true, restrooms: [] },
];
decorationCase.page.data.isManualAnchor = false;
decorationCase.page._systemOriginStationId = peopleSquare.id;
let decorated = decorationCase.page._decorateStations(decorationStations, 0, '#87CEEB');
assert.strictEqual(decorated[0].isSystemOrigin, true, '智能定位起点应输出定位针状态');
assert.strictEqual(decorated[0].restroomCapsuleLabel, '', '暂无记录卡不得生成卫生间状态胶囊文案');
assert.strictEqual(decorated[1].isSystemOrigin, false, '非智能定位起点不得输出定位针状态');
assert.strictEqual(decorated[0].showReverse, true, '当前高亮卡可显示需掉头');
assert.strictEqual(decorated[1].showReverse, false, '非当前卡不得显示需掉头');
assert.strictEqual(decorated[0].isActive, true, '当前站必须输出焦点卡状态');
assert.strictEqual(decorated[1].isAfterFocus, true, '焦点下一站必须输出向下让位状态');
decorationCase.page.data.isManualAnchor = true;
decorationCase.page._state.originStationId = 'test-target';
decorated = decorationCase.page._decorateStations(decorationStations, 1, '#87CEEB');
assert.strictEqual(decorated.some((station) => station.isSystemOrigin), false, '手动起点模式应隐藏智能定位针');
assert.strictEqual(decorated[1].isOrigin, true, '手动锁定站应输出起点状态');
assert.strictEqual(decorated[0].showReverse, false, '切走后原卡不得继续显示需掉头');
assert.strictEqual(decorated[1].showReverse, true, '新高亮卡可显示需掉头');
assert.strictEqual(decorated[0].isBeforeFocus, true, '焦点上一站必须输出向上让位状态');
assert.strictEqual(decorated[1].isActive, true, '切换后的当前站必须输出焦点卡状态');

assert.strictEqual(decorationCase.page._getReadableLineColor('#FFD100'), '#897616', '3号线亮黄色文字必须自动压暗');
assert.strictEqual(decorationCase.page._getReadableLineColor('#E3002B'), '#E3002B', '已具备可读性的线路色不应被修改');
assert.strictEqual(wheelPhysics.getFocusStrength(0), 1, '第二卡位中心必须是固定最大焦点');
assert.strictEqual(wheelPhysics.getFocusStrength(1), 0, '离开第二卡位一个站距后必须恢复常规尺寸');
const approachSamples = [1, .75, .5, .25, 0].map(wheelPhysics.getFocusStrength);
approachSamples.slice(1).forEach((strength, index) => {
  assert(strength > approachSamples[index], '卡片接近第二卡位时焦点强度必须连续单调增加');
});
[-.75, -.5, -.25, 0, .25, .5, .75].forEach((distance) => {
  assert.strictEqual(
    wheelPhysics.getFocusStrength(distance),
    wheelPhysics.getFocusStrength(-distance),
    '焦点放大曲线必须围绕第二卡位对称',
  );
});
const halfMotion = wheelPhysics.getCardMotion(.5, 100);
assert(Math.abs(halfMotion.focus - .5) < 1e-10, '半程焦点强度必须为 0.5');
assert.strictEqual(halfMotion.scaleX, 1.04, '半程横向缩放必须连续插值');
assert.strictEqual(halfMotion.scaleY, 1.0275, '半程纵向缩放必须连续插值');
assert.strictEqual(halfMotion.translateY, 5.5, '半程让位必须连续插值');

const partialTransferSwipe = wheelPhysics.getTransferSwipeMotion(24, 0, 1, 48, 1.2);
assert(partialTransferSwipe.progress > 0 && partialTransferSwipe.progress < 1, '未达门槛的横滑必须连续显示中间进度');
assert.strictEqual(partialTransferSwipe.ready, 0, '未达 48px 时提示不得进入可切换高亮态');
const readyTransferSwipe = wheelPhysics.getTransferSwipeMotion(48, 0, 1, 48, 1.2);
assert.strictEqual(readyTransferSwipe.progress, 1, '达到门槛时动态提示必须完整显示');
assert.strictEqual(readyTransferSwipe.ready, 1, '达到门槛时必须进入可切换高亮态');
assert.strictEqual(
  wheelPhysics.getTransferSwipeMotion(-48, 0, -1, 48, 1.2).ready,
  1,
  '向左拖动必须使右侧提示进入可切换态',
);
assert.strictEqual(
  wheelPhysics.getTransferSwipeMotion(24, 30, 1, 48, 1.2).progress,
  0,
  '纵向或斜向手势不得误触发换乘遮罩',
);

assert.deepStrictEqual(
  [-1, 0, 1, 2].map((index) => Number(wheelPhysics.getFocusStrength(index - .5).toFixed(4))),
  [0, .5, .5, 0],
  '半站拖动时只能由离开和进入第二卡位的两张卡片共享缩放',
);
assert.strictEqual(wheelPhysics.getDetentIndex(0, .2, 10), 0, '未跨过站点中心时不得触发反馈');
assert.strictEqual(wheelPhysics.getDetentIndex(0, 0, 10), 0, '首端回弹不得重复触发反馈');
assert.strictEqual(wheelPhysics.getDetentIndex(0, 3.2, 10), 3, '单帧跨多站必须完整计算反馈数量');
assert.strictEqual(wheelPhysics.getDetentIndex(3, 2.8, 10), 3, '反向但未跨中心时不得提前反馈');
assert.strictEqual(wheelPhysics.getDetentIndex(3, 2, 10), 2, '反向跨回站点中心时必须反馈一次');
assert.strictEqual(wheelPhysics.clampWheelVelocity(5000, 100), 2200, '高速甩动必须限制为可感知的最大站速');

const transitionCase = createPage('2', 'forward', '南京东路', peopleSquare.id);
transitionCase.page.data.stations = transitionCase.page._decorateStations(
  transitionCase.view.stations,
  transitionCase.page.data.currentIndex,
  transitionCase.page.data.lineColor,
);
transitionCase.page._updateSyncStatus = () => { transitionCase.page._syncUpdated = true; };
transitionCase.page._scheduleSyncForVisibleStation = () => { transitionCase.page._syncScheduled = true; };
const transitionCurrentIndex = transitionCase.page.data.currentIndex;
transitionCase.page.onWheelSettled(transitionCurrentIndex + 1);
assert.strictEqual(transitionCase.page.data.currentIndex, transitionCurrentIndex + 1, '吸附结束后才可提交最终焦点站');
assert.strictEqual(transitionCase.page.data.stations[transitionCurrentIndex + 1].isActive, true, '最终焦点卡必须在吸附结束后激活');
assert.strictEqual(transitionCase.page.data.stations[transitionCurrentIndex].isActive, false, '原焦点卡必须在吸附结束后恢复常规状态');
assert.strictEqual(transitionCase.page._syncUpdated, true, '焦点切换完成后必须刷新同步状态');
assert.strictEqual(transitionCase.page._syncScheduled, true, '焦点切换完成后必须调度站点同步');
transitionCase.page._syncUpdated = false;
transitionCase.page.onWheelSettled(transitionCurrentIndex + 1);
assert.strictEqual(transitionCase.page._syncUpdated, false, '重复吸附到同一站不得重复提交业务状态');

const drawerCase = createPage('3', 'forward', '上海火车站');
const multipleRestroomCard = drawerCase.page._decorateStations(
  [drawerCase.station],
  0,
  drawerCase.page.data.lineColor,
)[0];
assert.strictEqual(
  multipleRestroomCard.restroomCapsuleLabel,
  '卫生间 · 多处',
  '同站区域聚合多条厕所记录时必须显示多处卫生间胶囊',
);
const groups = drawerCase.page._buildDrawerGroups(drawerCase.station.restrooms);
assert.deepStrictEqual(groups.map((group) => group.lineId), ['3', '1', '4'], '抽屉应当前线路优先、其余数值排序');
groups.forEach((group) => {
  const option = drawerCase.page.data.lineOptions.find((line) => line.id === group.lineId);
  assert.strictEqual(group.lineName, option.name, '抽屉分组必须使用线路名称');
  assert.strictEqual(group.lineColor, option.color, '抽屉分组必须使用官方线路色');
  assert.strictEqual(
    group.lineTextColor,
    drawerCase.page._getReadableLineColor(option.color),
    '抽屉 ETA 必须使用自动优化后的可读线路色',
  );
  assert.strictEqual(group.isCurrent, group.lineId === '3', '抽屉当前线路标记错误');
  assert(group.stationId, '抽屉线路分组必须携带自身线路站点 ID');
  group.restrooms.forEach((restroom) => {
    assert.strictEqual(restroom.lineId, group.lineId, '厕所必须保留自身 lineId');
    assert.strictEqual(restroom.lineName, option.name, '厕所必须保留自身 lineName');
    assert(restroom.stationId, '厕所必须保留自身线路站点 ID');
  });
});

drawerCase.page.onOpenRestroomDrawer({
  currentTarget: { dataset: { stationId: drawerCase.station.id } },
});
assert.deepStrictEqual(
  drawerCase.page.data.drawerGroups.map((group) => group.lineId),
  ['3', '1', '4'],
  '打开抽屉时必须生成分组数据',
);
assert.strictEqual(drawerCase.page.data.drawerRestrooms.length, drawerCase.station.restrooms.length);

const nonFocusStation = drawerCase.view.stations.find((station) => (
  station.id !== drawerCase.station.id && station.restrooms.length > 1
));
assert(nonFocusStation, '3号线必须存在用于非焦点整卡点击的多位置站点');
const drawerCurrentIndex = drawerCase.page.data.currentIndex;
drawerCase.page.data.wheelScrollTop = 246;
drawerCase.page.onCloseRestroomDrawer();
drawerCase.page.onOpenRestroomDrawer({
  currentTarget: { dataset: { stationId: nonFocusStation.id } },
});
assert.strictEqual(drawerCase.page.data.drawerStation.id, nonFocusStation.id, '任意卡位整卡点击必须直接打开对应站点');
assert.strictEqual(drawerCase.page.data.currentIndex, drawerCurrentIndex, '打开非焦点卡抽屉不得改变轮盘焦点');
assert.strictEqual(drawerCase.page.data.wheelScrollTop, 246, '打开非焦点卡抽屉不得改变轮盘位置');

const currentDrawerGroup = drawerCase.page.data.drawerGroups.find((group) => group.isCurrent);
drawerCase.page._selectedDrawerTransfer = null;
drawerCase.page._switchToTransfer = (transfer) => {
  drawerCase.page._selectedDrawerTransfer = transfer;
};
drawerCase.page.onSelectDrawerLine({
  currentTarget: {
    dataset: {
      lineId: currentDrawerGroup.lineId,
      stationId: currentDrawerGroup.stationId,
    },
  },
});
assert.strictEqual(drawerCase.page._selectedDrawerTransfer, null, '抽屉当前线路标题不得重复触发切线');
assert.strictEqual(drawerCase.page.data.showRestroomDrawer, true, '点击当前线路标题不得关闭抽屉');

const otherDrawerGroup = drawerCase.page.data.drawerGroups.find((group) => !group.isCurrent);
drawerCase.page.onSelectDrawerLine({
  currentTarget: {
    dataset: {
      lineId: otherDrawerGroup.lineId,
      stationId: otherDrawerGroup.stationId,
    },
  },
});
assert.deepStrictEqual(
  drawerCase.page._selectedDrawerTransfer,
  { lineId: otherDrawerGroup.lineId, stationId: otherDrawerGroup.stationId },
  '非中心卡打开的抽屉必须使用分组自身线路站点 ID 切线',
);
assert.strictEqual(drawerCase.page.data.showRestroomDrawer, false, '从抽屉切线前必须先关闭抽屉');

const drawerSwitchCase = createPage('3', 'forward', '东宝兴路', peopleSquare.id);
const drawerSwitchStation = drawerSwitchCase.view.stations.find(
  (station) => station.name === '上海火车站',
);
const drawerSwitchOriginId = drawerSwitchCase.page._state.originStationId;
drawerSwitchCase.page._scheduleStationWheelLayout = () => {};
drawerSwitchCase.page._scheduleSyncForVisibleStation = () => {};
drawerSwitchCase.page._updateSyncStatus = () => {};
drawerSwitchCase.page.onOpenRestroomDrawer({
  currentTarget: { dataset: { stationId: drawerSwitchStation.id } },
});
const drawerLine1Group = drawerSwitchCase.page.data.drawerGroups.find(
  (group) => group.lineId === '1',
);
drawerSwitchCase.page.onSelectDrawerLine({
  currentTarget: {
    dataset: {
      lineId: drawerLine1Group.lineId,
      stationId: drawerLine1Group.stationId,
    },
  },
});
assert.strictEqual(drawerSwitchCase.page._state.lineId, '1', '抽屉线路标题必须实际切至目标线路');
assert.strictEqual(
  drawerSwitchCase.page._rawStations[drawerSwitchCase.page.data.currentIndex].name,
  '上海火车站',
  '非中心卡抽屉切线后必须将该卡对应的物理站置于中心',
);
assert.strictEqual(
  drawerSwitchCase.page._state.originStationId,
  drawerSwitchOriginId,
  '抽屉切线不得修改计算起点',
);

const singleRestroomCase = createPage('3', 'forward', '东宝兴路');
const singleRestroomCard = singleRestroomCase.page._decorateStations(
  [singleRestroomCase.station],
  0,
  singleRestroomCase.page.data.lineColor,
)[0];
assert.strictEqual(
  singleRestroomCard.restroomCapsuleLabel,
  '卫生间',
  '同站区域只有一条厕所记录时必须显示单一卫生间胶囊',
);
singleRestroomCase.page.onOpenRestroomDrawer({
  currentTarget: { dataset: { stationId: singleRestroomCase.station.id } },
});
assert.strictEqual(singleRestroomCase.page.data.showRestroomDrawer, true, '单条记录卡也必须能核对被精简的完整原文');
assert.strictEqual(singleRestroomCase.page.data.drawerRestrooms.length, 1, '单条记录详情不得混入其他站点记录');

const suppressedTapCase = createPage('3', 'forward', '上海火车站');
suppressedTapCase.page._suppressCardTapUntil = Date.now() + 1000;
suppressedTapCase.page.onOpenRestroomDrawer({
  currentTarget: { dataset: { stationId: suppressedTapCase.station.id } },
});
assert.strictEqual(suppressedTapCase.page.data.showRestroomDrawer, false, '轮盘或横滑手势结束后不得误开卡片抽屉');

const line4Restroom = groups.find((group) => group.lineId === '4').restrooms[0];
app.globalData.pendingCorrectionContext = null;
drawerCase.page.onCorrectRestroom({
  currentTarget: {
    dataset: {
      stationId: drawerCase.station.id,
      restroomId: line4Restroom.id,
    },
  },
});
assert.strictEqual(app.globalData.pendingCorrectionContext.lineId, '4', '纠错必须使用厕所自身线路');
assert.strictEqual(
  app.globalData.pendingCorrectionContext.stationId,
  line4Restroom.stationId,
  '纠错必须使用厕所自身线路站点 ID',
);
assert.strictEqual(navigationCalls.at(-1).url, '/pages/correction/index');

const homepageWxml = fs.readFileSync(
  path.resolve(__dirname, '../miniprogram/pages/index/index.wxml'),
  'utf8',
);
const homepageJs = fs.readFileSync(
  path.resolve(__dirname, '../miniprogram/pages/index/index.js'),
  'utf8',
);
const homepageWxss = fs.readFileSync(
  path.resolve(__dirname, '../miniprogram/pages/index/index.wxss'),
  'utf8',
);
const homepageJson = JSON.parse(fs.readFileSync(
  path.resolve(__dirname, '../miniprogram/pages/index/index.json'),
  'utf8',
));
const projectConfig = JSON.parse(fs.readFileSync(
  path.resolve(__dirname, '../project.config.json'),
  'utf8',
));
assert.strictEqual(homepageJson.renderer, 'skyline', '首页必须使用 Skyline 渲染器');
assert.strictEqual(homepageJson.componentFramework, 'glass-easel', 'Skyline 首页必须使用 glass-easel');
assert.strictEqual(homepageJson.navigationStyle, 'custom', 'Skyline 首页必须使用自定义导航栏');
assert.strictEqual(projectConfig.setting.compileWorklet, true, '项目必须开启 Worklet 编译');
assert(!homepageWxml.includes('<swiper'), '首页不得继续使用无法控制惯性的 swiper');
assert(!homepageWxml.includes('<wxs '), 'Skyline 首页不得继续加载 WebView WXS 动效');
assert(homepageWxml.includes('class="station-wheel-scroll"'), '首页必须使用独立纵向 scroll-view 轮盘');
assert(homepageWxml.includes('type="list"'), 'Skyline scroll-view 必须显式声明 list 类型');
assert(homepageWxml.includes('wheelTopSpacerHeight'), '轮盘必须预留一个顶部站位，使焦点固定在第二位');
assert(homepageWxml.includes('wheelBottomSpacerHeight'), '轮盘必须为末站保留第二卡位后的空间');
assert(homepageWxml.includes('worklet:onscrollupdate="onWheelScrollUpdate"'), '连续缩放必须由 UI 线程滚动坐标驱动');
assert(homepageWxml.includes('worklet:onscrollend="onWheelScrollEnd"'), '惯性结束后必须在 UI 线程吸附');
assert(homepageWxml.includes('worklet:adjust-deceleration-velocity="adjustWheelDecelerationVelocity"'), '高速甩动必须保留原生速度惯性并限制极端速度');
assert(homepageWxml.includes('horizontal-drag-gesture-handler'), '横滑换乘必须迁移到 Skyline 手势系统');
assert(/<horizontal-drag-gesture-handler[^>]*tag="wheel-horizontal"[^>]*simultaneous-handlers="\{\{\['wheel-vertical'\]\}\}"[^>]*worklet:ongesture="onWheelHorizontalGesture"/.test(homepageWxml), '横滑换乘必须与纵向轮盘显式协商手势');
assert(/<vertical-drag-gesture-handler[^>]*tag="wheel-vertical"[^>]*simultaneous-handlers="\{\{\['wheel-horizontal'\]\}\}"[^>]*native-view="scroll-view"/.test(homepageWxml), '纵向滚动代理必须按 scroll-view 实际方向配置');
assert(!/<horizontal-drag-gesture-handler[^>]*native-view="scroll-view"/.test(homepageWxml), '横向识别器不得错误代理纵向 scroll-view');
assert(!homepageWxml.includes('capture-bind:touchmove'), '逻辑层不得继续接收每一帧 touchmove');
assert(homepageWxml.includes('id="station-card-{{index}}"'), '每张卡片必须暴露独立 Worklet 动画节点');
assert(homepageWxml.includes('class="custom-nav"'), '自定义导航栏不得因 Skyline 迁移丢失');
assert(!homepageWxml.includes('station-focus-lens'), '第二卡位不得保留固定背景光场');
assert(!homepageWxml.includes('station.contentMotionStyle'), '卡片内容不得通过逻辑层逐帧修改布局');
assert(!homepageWxml.includes('station.motionStyle'), '卡片壳层不得通过逻辑层逐帧 setData');
assert(homepageWxml.includes('style="color: {{lineTextColor}};"'), '首页 ETA 必须使用当前线路的可读文字色');
assert(homepageWxml.includes('style="color: {{group.lineTextColor}};"'), '抽屉 ETA 必须使用厕所所属线路的可读文字色');
assert(homepageWxml.includes('class="line-picker-pill'), '线路选择器必须使用胶囊结构');
assert(homepageWxml.includes('background-color: {{line.color}};'), '线路选择器胶囊必须显示官方线路色标记');
assert(homepageWxml.includes('class="line-picker-grid" list-item'), '线路选择弹层内容必须声明为 Skyline 列表项');
assert(/wx:for="\{\{drawerGroups\}\}"[^>]*list-item/.test(homepageWxml), '厕所详情分组必须声明为 Skyline 列表项');
assert(homepageWxml.includes('class="station-card-shell'), '卡片必须使用统一圆角阴影壳层');
assert(homepageWxml.includes('class="city-control"'), '城市必须使用独立胶囊入口');
assert(homepageWxml.includes('bindtap="onOpenCityPicker"'), '城市胶囊必须可打开城市面板');
assert(homepageWxml.includes('更多城市陆续开放'), '第一版城市面板必须说明后续城市计划');
assert(homepageWxml.includes('class="origin-name-control"'), '起点站名必须是独立点击区');
assert(/class="origin-control origin-control--actionable" role="button"[^>]*bindtap="onLocationAction"/.test(homepageWxml), '待确认站点与操作必须合并为单一大点击区');
assert(homepageWxml.includes('bindtap="onOpenStationPicker"'), '普通起点站名必须可打开站点选择器');
assert(homepageWxml.includes("!isManualAnchor && !showLocationAction ? locationLabel + '，' : ''"), '非操作型定位状态必须合并进站名按钮的可访问名称');
assert(homepageWxml.includes("locationStatus === 'nearest' ? '直线距离，到站路程未计入预计时间，' : ''"), '最近站的可访问名称必须说明直线距离不计入到站路程');
assert(homepageWxml.includes('自选起点'), '手动起点必须使用已确认的用户文案');
assert(homepageWxml.includes('恢复定位'), '自选起点必须提供恢复定位入口');
assert(!homepageWxml.includes('当前计算起点</text>'), '顶部不得继续常驻旧计算起点标签');
assert(!homepageWxml.includes('>更换</text>'), '顶部不得继续常驻旧更换按钮');
assert(!homepageJs.includes("locationLabel: '尚未开启定位'"), '首次进入不得继续使用旧定位状态文案');
assert(!homepageJs.includes("locationActionLabel: '开启智能定位'"), '首次进入不得继续使用旧定位操作文案');
assert(homepageWxml.includes('class="control-chevron" aria-hidden="true"'), '线路选择器必须使用独立居中的下拉符号');
assert(!homepageWxml.includes('class="control-chevron">⌄</text>'), '线路选择器不得继续使用受文字基线影响的下拉字符');
assert(/\.control-chevron\s*\{[^}]*display:\s*flex;[^}]*align-items:\s*center;[^}]*justify-content:\s*center;/.test(homepageWxss), '线路选择器下拉符号容器必须水平垂直居中');
assert(homepageWxml.includes('sync-action__icon'), '更新入口必须包含刷新图标');
assert(homepageWxml.includes('sync-action__icon--spinning'), '刷新图标必须在更新期间进入旋转状态');
assert(!homepageWxml.includes('>检查更新</button>'), '同步入口不得继续使用旧长胶囊文案');
assert(!homepageWxml.includes('onSelectTransferLine'), '卡内换乘胶囊必须保持静态，不得抢占整卡详情热区');
assert(/wx:elif="\{\{station\.hasRestroom\}\}"[^>]*data-station-id="\{\{station\.id\}\}"[^>]*bindtap="onOpenRestroomDrawer"/.test(homepageWxml), '任意有厕卡片必须保留整卡热区打开位置抽屉');
assert(homepageWxml.includes('class="station-card__accessible-detail" role="button"'), '厕所详情必须提供与换乘控件平级的独立无障碍按钮');
assert(!/wx:elif="\{\{station\.hasRestroom\}\}"[^>]*role="button"/.test(homepageWxml), '包含换乘控件的整卡容器不得继续形成嵌套按钮语义');
assert(!homepageWxml.includes('左右滑动换线'), '卡片内不得再常驻重复的左右滑动文案');
assert(homepageWxml.includes('<text class="wheel-tip">点圆点定起点</text><text class="wheel-tip">横滑换线</text>'), '轮盘标题两侧必须使用同级弱提示，并精炼说明圆点与横滑两种操作');
assert(homepageWxml.includes('station.transferLineOptions'), '换乘区域必须使用包含当前线路的固定顺序选项');
assert(!homepageWxml.includes('station.isActive && station.transferLineOptions'), '非焦点换乘卡也必须常态显示线路胶囊');
assert(!homepageJs.includes('transferNodePrototype'), 'V1 不得残留世纪大道地图式换乘节点逻辑');
assert(!homepageWxml.includes('transfer-node-map'), 'V1 不得渲染世纪大道地图式换乘节点');
assert(!homepageWxss.includes('.transfer-node-map'), 'V1 不得残留地图式换乘节点样式');
assert(!homepageWxml.includes('transfer-pill__mark'), '换乘胶囊不得继续显示线路短横线');
assert(!homepageWxss.includes('.transfer-pill__mark'), '换乘胶囊不得残留短横线样式');
assert(homepageWxml.includes('role="text" aria-label="{{station.transferSummaryAriaLabel}}"'), '静态换乘胶囊组必须提供一个完整的无障碍摘要');
assert(homepageWxml.includes('color: {{transferLine.lineTextColor}};'), '换乘胶囊边框和文字必须使用线路可读色');
assert(!homepageWxml.includes('transfer-pill--current'), '换乘胶囊不得再设置灰色选中态');
assert(!homepageWxss.includes('.transfer-pill--current'), '样式层不得残留当前线路选中态');
assert(homepageWxml.includes('class="transfer-swipe-cue transfer-swipe-cue--left"'), '手指右滑时必须在左侧显示错位提示');
assert(homepageWxml.includes('class="transfer-swipe-cue transfer-swipe-cue--right"'), '手指左滑时必须在右侧显示错位提示');
assert(homepageWxml.includes('<text class="transfer-swipe-cue__action">右滑切至</text>'), '左侧动态提示必须说明右滑结果');
assert(homepageWxml.includes('<text class="transfer-swipe-cue__action">左滑切至</text>'), '右侧动态提示必须说明左滑结果');
assert(homepageJs.includes('workletTiming(0, timingConfig)'), '未达门槛或手势结束后必须用 Worklet 平滑回退');
assert(homepageJs.includes('getTransferSwipeMotion'), '换乘遮罩必须在 UI 线程连续跟随横滑进度');
assert(!homepageJs.includes('已切至${option.name}'), '滑动动画已说明目标线路，切换后不得重复弹出提示');
assert(homepageWxml.includes('class="station-anchor-hit" role="button"'), '圆点必须有独立的透明放大热区');
assert(!/class="station-dot"[^>]*tap="onSetManualAnchor"/.test(homepageWxml), '可见圆点不得继续承担狭小点击区');
assert(/\.station-anchor-hit\s*\{[^}]*width:\s*112rpx;/.test(homepageWxss), '起点热区必须宽于 88rpx 无障碍最小尺寸');
assert(homepageJs.includes('_lineViewStateById'), '同站切线必须按线路保存本次会话的路径与方向');
assert(homepageWxml.includes('{{station.restroomCapsuleLabel}}'), '有厕卡片必须显示卫生间状态胶囊');
assert(homepageJs.includes("hasMultipleRestroomRecords ? '卫生间 · 多处' : '卫生间'"), '卫生间胶囊必须按同站区域聚合记录区分单处与多处');
assert(!homepageWxml.includes('>WC</text>'), '卫生间胶囊不得继续使用 WC 文案');
assert(!homepageWxml.includes('restroomActionLabel'), '卫生间胶囊不得继续拼接旧的多个位置文案');
assert(!homepageWxml.includes('wc-status'), '卫生间胶囊不得残留旧 WC 样式结构');
assert(homepageWxml.includes('<text class="empty-text">暂无卫生间记录</text>'), '暂无记录卡必须保留准确的文字状态');
assert(!homepageWxml.includes('厕所'), '首页模板不得向用户显示“厕所”');
assert(homepageWxml.includes('station.primaryRestroom.wayfindingTags'), '主卡必须改用结构化导视标签');
assert(!homepageWxml.includes('共 {{station.restroomCount}} 处'), '线路位置记录数不得冒充物理厕所数量');
assert(!homepageWxml.includes('共 {{drawerRestrooms.length}} 处厕所'), '抽屉不得把线路位置记录数冒充物理厕所数量');
assert(homepageWxml.includes('class="route-switch"'), '支线线路顶部必须使用单一当前路径与切换入口');
assert(homepageWxml.includes('alternateRouteActionLabel'), '顶部支线入口必须使用目录统一生成的操作文案');
assert(homepageJs.includes('alternateRouteActionLabel:'), '首页状态必须向顶部支线入口提供统一操作文案');
assert(!homepageWxml.includes('class="route-pill'), '支线路径不得继续用两枚并列胶囊占用顶部空间');
assert(homepageJs.includes('incomingBranchHint:'), '弱分叉提示必须从上一站拓扑数据派生到下一站行');
assert(homepageWxml.includes('<block wx:for="{{stations}}"'), '站点循环必须保持固定站点行结构');
assert(/wx:if="\{\{station\.incomingBranchHint\}\}" class="branch-switch-anchor"/.test(homepageWxml), '支线入口必须挂载在下一站的定高行顶部，避免 Skyline 零高度列表项丢失点击');
assert(homepageWxml.includes('class="branch-switch-slot"'), '支线入口必须使用独立半高切换位');
assert(homepageWxml.includes('class="branch-switch-slot__diagonal"'), '支线切换位必须先从主轨向右下引出 45 度斜线');
assert(homepageWxml.includes('class="branch-switch-slot__horizontal"'), '支线切换位必须在斜线后继续水平延伸');
assert(homepageWxml.includes('class="branch-switch-slot__label"'), '支线切换位必须显示另一端点名称');
assert(homepageWxml.includes('{{station.incomingBranchHint.actionLabel}}'), '站间支线入口必须使用目录统一生成的操作文案');
assert(!homepageWxml.includes('切换至{{station.incomingBranchHint.terminalName}}'), '站间支线入口不得继续自行拼接旧文案');
assert(/class="branch-switch-slot"[^>]*bindtap="onSelectRoute"/.test(homepageWxml), '站间支线入口必须绑定可触发的普通点击事件');
assert(homepageWxml.includes('hover-class="branch-switch-slot--pressed"'), '支线快捷入口必须提供按压反馈');
assert(homepageWxml.includes('class="route-end-cap'), '非环线必须在轨道真实端点显示同心圆收口');
assert((homepageWxml.match(/class="route-end-cap route-end-cap--(?:top|bottom)"[^>]*style="height: \{\{wheelSlotHeight\}\}px;"/g) || []).length === 2, '普通线路两端必须各延伸一个完整站间距');
assert(homepageWxml.includes('class="route-end-cap__marker"'), '普通线路端点必须保留与站点一致的空心外圈');
assert(homepageWxml.includes('class="route-end-cap__core"'), '普通线路端点空心外圈内必须显示同心实心点');
assert(homepageWxml.includes('class="loop-boundary'), '环线首尾必须显示闭环连接入口');
assert((homepageWxml.match(/class="loop-boundary loop-boundary--(?:top|bottom)"[^>]*style="height: \{\{wheelSlotHeight\}\}px;"/g) || []).length === 2, '环线两端必须与普通线路一致，各占用一个完整站间距');
assert(homepageWxml.includes('catchtap="onLoopBoundaryTap"'), '环线闭环入口必须可以首尾跳转');
assert(homepageWxml.includes('环线 · 首尾相接'), '环线顶部边界必须用淡文案明确说明首尾相接');
assert(homepageWxml.includes('继续循环'), '环线底部边界必须提示线路仍会继续循环');
assert(homepageWxml.includes('loop-boundary__arrow--forward'), '环线符号必须包含正向循环箭头');
assert(homepageWxml.includes('loop-boundary__arrow--return'), '环线符号必须包含回向循环箭头');
assert(!homepageJs.includes('_applyStationMotionByDy'), '逻辑层 touchmove 不得继续写卡片动效');
assert(homepageJs.includes('this.applyAnimatedStyle'), '卡片 transform 必须通过 Worklet 动画样式更新');
assert(homepageJs.includes('getCardMotion(stationIndex - position.value'), '卡片尺寸必须只依赖连续虚拟焦点位置');
assert(homepageJs.includes('runOnJS(this.onWheelDetents.bind(this))'), '跨站时必须仅把离散反馈事件送回逻辑层');
assert(homepageJs.includes('scrollViewContext.scrollTo'), '惯性结束后必须在 UI 线程完成站点吸附');
assert(homepageJs.includes('this._wheelSnapTarget.value = targetIndex'), '补间开始后必须锁定唯一吸附目标');
assert(homepageJs.includes('this._wheelPhase.value !== WHEEL_PHASE_SNAPPING'), '程序化滚动不得误清除吸附阶段');
assert(homepageJs.includes('wheelRebase'), '方向切换必须使用连续位置重映射而非离散索引复位');
assert(!homepageJs.includes("option.type === 'branched' ? '' : option.defaultRouteId"), '进入支线线路不得再清空默认路径');
assert(homepageJs.includes('onLoopBoundaryTap'), '首页必须实现环线首尾跳转');
assert(homepageWxml.includes('wx:for="{{drawerGroups}}"'), '多厕所抽屉必须按线路分组');
assert(homepageWxml.includes('drawer-count">卫生间位置信息 · 完整来源描述</text>'), '详情弹窗必须统一使用卫生间文案');
assert(!homepageWxml.includes('drawer-count">厕所位置信息'), '详情弹窗不得继续混用厕所文案');
assert(/class="drawer-item__switch"[^>]*catchtap="onSelectDrawerLine"/.test(homepageWxml), '卫生间详情卡右上角必须支持直接切线');
assert(homepageWxml.includes('data-station-id="{{group.stationId}}"'), '抽屉切线必须使用分组自身线路站点 ID');
assert(homepageWxml.includes('wx:if="{{!group.isCurrent && restroomIndex === 0}}" class="drawer-item__switch"'), '每个非当前线路分组只在第一张灰色详情卡显示切换入口');
assert(!homepageWxml.includes('drawer-group__header--action'), '线路分组标题必须保持静态，不得把切换入口放在灰色卡片外');
assert(homepageWxml.includes('hover-class="drawer-item__switch--pressed"'), '灰色详情卡内切换入口必须提供明确按压反馈');
assert(homepageJs.includes('onSelectDrawerLine(event)'), '首页必须实现独立的抽屉线路切换处理');
assert(homepageWxml.includes('信息有误？反馈'), '抽屉必须保留弱化反馈入口');
assert(homepageWxml.includes('class="station-anchor-hit" role="button" aria-label="将{{station.name}}设为计算起点" data-station-id="{{station.id}}" catchtap="onSetManualAnchor"'), '圆点放大热区必须可锁定手动起点且阻止误开卡片详情');
assert(homepageWxml.includes('station.isSystemOrigin'), '站点圆点必须由智能定位状态驱动定位针');
assert(homepageWxml.includes('选择起始线路'), '同一物理站无法稳定判定线路时必须弹出线路选择');
assert(homepageWxml.includes("isManualSelectionGuide ? '先选择线路' : '选择浏览线路'"), '手动选择第一步必须复用线路面板并提供明确引导');
assert(homepageWxml.includes("isManualSelectionGuide ? '再选择起点站' : '选择计算起点'"), '手动选择第二步必须复用站点面板并提供明确引导');
assert(homepageWxml.includes('wx:for="{{manualStationOptions}}"'), '手动选择时必须使用覆盖全部支线的专用站点列表');
assert(homepageWxml.includes('{{station.sectionLabel}}'), '支线手动站点列表必须显示分组标题');
assert(homepageWxml.includes(' · {{station.contextLabel}}'), '支线方向必须以中点号接在站名同一行');
assert(homepageWxml.includes('data-route-id="{{station.routeId}}"'), '支线独有站必须提交所属路径');
assert(homepageWxml.includes('aria-label="返回选择线路"'), '手动选择第二步必须提供返回线路选择的入口');
assert(homepageWxml.includes('bindtap="onBackToManualLinePicker"'), '返回线路选择入口必须绑定独立处理函数');
assert(/class="manual-station-back"[^>]*>上一步<\/view>/.test(homepageWxml), '手动选择第二步必须在标题区显示“上一步”');
assert(/\.manual-station-header\s*\{[^}]*display:\s*flex[^}]*justify-content:\s*space-between/.test(homepageWxss), '第二步标题和上一步必须分列左右');
assert(/\.manual-station-back\s*\{[^}]*height:\s*88rpx[^}]*color:\s*#007aff/.test(homepageWxss), '右上角上一步必须使用可点击高度和蓝色强调');
assert(/\.manual-station-item\s*\{[^}]*min-height:\s*94rpx/.test(homepageWxss), '支线站点说明改为同一行后必须恢复标准行高');
assert(/\.manual-station-copy\s*\{[^}]*display:\s*flex[^}]*align-items:\s*baseline[^}]*white-space:\s*nowrap/.test(homepageWxss), '站名与支线方向必须在同一基线保持单行');
assert(/\.manual-station-meta\s*\{[^}]*color:\s*#7c858e[^}]*font-size:\s*21rpx/.test(homepageWxss), '支线方向必须使用较弱的小字层级');
assert(!homepageWxml.includes('两条支线均可'), '共线站不得继续显示冗余的两条支线均可');
assert(homepageWxml.includes('aria-label="选择其他线路和起点站"'), '候选列表兜底入口必须说明会选择其他线路和站点');
assert.strictEqual((homepageWxml.match(/>选择其他<\/view>/g) || []).length, 2, '两个候选面板底部都必须显示“选择其他”');
assert(homepageWxml.includes('选择附近站'), '3 至 5 公里必须展示附近站选择');
assert(homepageWxml.includes('5 公里内的站点，按直线距离由近到远'), '附近站列表必须说明排序与范围');
assert(homepageWxml.includes('wx:for="{{nearbyStationCandidates}}"'), '附近站列表必须渲染全部候选物理站');
assert(homepageWxml.includes('data-physical-station-id="{{candidate.physicalStationId}}"'), '附近站选择必须按物理站提交');
assert(homepageWxml.includes("locationStatus === 'lineRequired' || locationStatus === 'stationRequired'"), '待确认定位必须区分附近站和同站线路选择');
assert(homepageWxml.includes('role="dialog" aria-label="为{{locationPendingStationName}}选择起始线路"'), '线路选择层必须具有可读对话框名称');
assert(homepageWxml.includes('aria-label="关闭线路选择，不更改起点"'), '线路选择层必须提供可感知关闭操作');
assert(homepageWxml.includes('aria-label="关闭附近站选择，不更改起点"'), '附近站选择层必须提供可感知关闭操作');
assert(homepageJs.includes('当前定位 5 公里内无站点，请手动选择'), '5 公里内无站点时必须提示手动选择');
assert(!homepageWxml.includes('确认最近站'), '不得残留旧的单站确认交互');
assert(homepageWxml.includes('station.showReverse'), '需掉头标签必须只读取当前高亮卡字段');
assert(!homepageWxml.includes('>纠错<'), '首页主列表不得显示红色纠错入口');
assert(!homepageWxss.includes('.station-row--active'), '整行不得设置选中态样式');
const stationRowRule = homepageWxss.match(/\.station-row\s*\{([^}]*)\}/);
assert(stationRowRule, '缺少站点行样式');
assert(!/opacity|transform/.test(stationRowRule[1]), '站点行不得缩放或改变透明度');
assert(/position:\s*relative/.test(stationRowRule[1]), '站点行必须建立分支线路径的完整行定位基准');
assert(/\.station-card-shell\s*\{[^}]*width:\s*calc\(100%\s*-\s*112rpx\)/.test(homepageWxss), '非焦点卡片必须略短于原宽度，以突出第二焦点卡');
assert(/\.station-card-shell--before-focus[^}]*translateY\(-14rpx\)/.test(homepageWxss), '焦点上方卡片必须增加间距');
assert(/\.station-card-shell--after-focus[^}]*translateY\(14rpx\)/.test(homepageWxss), '焦点下方卡片必须增加间距');
assert(/\.station-card-shell--active[^}]*scale3d\(1\.08,1\.055,1\)/.test(homepageWxss), '焦点卡片必须补偿基础宽度收窄并保持肉眼可见的 Dock 式横纵放大幅度');
assert(/\.branch-switch-anchor\s*\{[^}]*position:\s*absolute[^}]*z-index:\s*7[^}]*top:\s*0[^}]*left:\s*0[^}]*width:\s*100%[^}]*height:\s*56rpx[^}]*pointer-events:\s*none/.test(homepageWxss), '支线锚点必须固定在下一站定高行顶部，并覆盖圆点起点热区');
assert(/\.branch-switch-slot\s*\{[^}]*top:\s*0[^}]*left:\s*36rpx[^}]*width:\s*310rpx[^}]*height:\s*56rpx[^}]*pointer-events:\s*auto/.test(homepageWxss), '支线切换位必须在非零高度站点行内恢复独立点击命中');
assert(/\.branch-switch-slot__diagonal\s*\{[^}]*width:\s*28rpx[^}]*height:\s*5rpx[^}]*rotate\(45deg\)[^}]*transform-origin:\s*left center[^}]*opacity:\s*\.38/.test(homepageWxss), '支线起始段必须以左端为轴向右下旋转 45 度');
assert(/\.branch-switch-slot__horizontal\s*\{[^}]*top:\s*33rpx[^}]*left:\s*20rpx[^}]*width:\s*200rpx[^}]*height:\s*5rpx[^}]*opacity:\s*\.38/.test(homepageWxss), '斜线末端必须无缝接入足够长的水平支线');
assert(/\.branch-switch-slot__label\s*\{[^}]*font-size:\s*19rpx[^}]*white-space:\s*nowrap/.test(homepageWxss), '支线线目标文案必须保持简洁且不换行');
assert(/\.station-card-shell\s*\{[^}]*z-index:\s*1/.test(homepageWxss), '普通站点卡片必须覆盖卡片下层分支线路径');
assert(!homepageWxml.includes('class="branch-fork'), '不得继续渲染依赖卡片层级的旧覆盖式分叉');
assert(!homepageWxss.includes('.branch-fork'), '不得残留依赖卡片层级的旧覆盖式分叉样式');
assert(!homepageWxml.includes('class="branch-switch-slot__line"'), '不得继续使用缺少分叉方向感的单段水平线');
assert(/\.route-end-cap__marker\s*\{[^}]*width:\s*24rpx[^}]*height:\s*24rpx[^}]*border:\s*5rpx solid[^}]*border-radius:\s*50%/.test(homepageWxss), '普通线路端点外圈必须复用普通站点圆圈尺寸');
assert(/\.route-end-cap__core\s*\{[^}]*width:\s*8rpx[^}]*height:\s*8rpx[^}]*border-radius:\s*50%/.test(homepageWxss), '普通线路端点内点必须与外圈同心并保留可见间距');
assert(/\.route-end-cap--top \.route-end-cap__line\s*\{[^}]*top:\s*50%[^}]*bottom:\s*0/.test(homepageWxss), '普通线路顶部端点轨道必须连接同心端点与首站');
assert(/\.route-end-cap--bottom \.route-end-cap__line\s*\{[^}]*top:\s*0[^}]*height:\s*50%/.test(homepageWxss), '普通线路底部端点轨道必须连接末站与同心端点');
assert(/\.loop-boundary__ring\s*\{[^}]*width:\s*34rpx[^}]*height:\s*34rpx[^}]*border:\s*4rpx solid[^}]*border-radius:\s*50%/.test(homepageWxss), '环线首尾必须使用醒目的双箭头闭环符号而非掉头标志');
assert(/\.loop-boundary__label\s*\{[^}]*color:\s*#8b949d[^}]*font-size:\s*20rpx/.test(homepageWxss), '环线说明必须使用低对比度短文案，不抢占站点信息层级');
assert(/\.loop-boundary--top \.loop-boundary__line\s*\{[^}]*top:\s*50%[^}]*bottom:\s*0/.test(homepageWxss), '环线顶部轨道必须使用半个边界槽并接续首站，形成完整站间距');
assert(/\.loop-boundary--bottom \.loop-boundary__line\s*\{[^}]*top:\s*0[^}]*height:\s*50%/.test(homepageWxss), '环线底部轨道必须接续末站并使用半个边界槽，形成完整站间距');
assert(!/\.station-card-shell--active[^}]*width:/.test(homepageWxss), '焦点动效不得再逐级切换真实宽度');
assert(!/\.station-card-shell\s*\{[^}]*transition:/.test(homepageWxss), '视图层逐帧 transform 不得叠加 CSS transition');
assert(!homepageWxss.includes('.station-focus-lens'), '样式中不得残留固定背景光场');
assert(/\.line-picker-pill\s*\{[^}]*border-radius:\s*999rpx/.test(homepageWxss), '线路选择项必须使用胶囊样式');
assert(/\.line-picker-list\s*\{[^}]*height:\s*55vh/.test(homepageWxss), '线路选择弹层列表必须具有明确高度');
assert(/\.picker-list\s*\{[^}]*height:\s*55vh/.test(homepageWxss), '站点选择弹层列表必须具有明确高度');
assert(/\.drawer-list\s*\{[^}]*height:\s*57vh/.test(homepageWxss), '厕所详情抽屉列表必须具有明确高度');
assert(/\.drawer-item__switch\s*\{[^}]*position:\s*absolute[^}]*top:\s*8rpx[^}]*right:\s*12rpx[^}]*height:\s*64rpx[^}]*font-size:\s*25rpx/.test(homepageWxss), '切换入口必须位于灰色详情卡右上角，并使用更大的字号和点击高度');
assert(/\.city-control\s*\{[^}]*border-radius:\s*999rpx/.test(homepageWxss), '城市入口必须使用胶囊样式');
assert(/\.sync-bar--blue\s+\.sync-bar__dot[^}]*#007aff/.test(homepageWxss), '本地数据状态必须使用蓝色圆点');
assert(/\.sync-bar--green\s+\.sync-bar__dot[^}]*#29a36a/.test(homepageWxss), '已同步状态必须使用绿色圆点');
assert(/\.sync-bar__action\s*\{[^}]*background:\s*transparent/.test(homepageWxss), '更新入口不得使用胶囊底色');
assert(/\.sync-bar__action\s*\{[^}]*position:\s*absolute[^}]*right:\s*0[^}]*margin:\s*0[^}]*padding:\s*0/.test(homepageWxss), '更新图标与文字必须贴齐同步栏右边界');
assert(homepageWxml.includes('class="sync-action__label"'), '更新文字必须保留可单独核对的右对齐边界');
assert(/\.sync-bar\s*\{[^}]*margin:\s*6rpx 10rpx 0/.test(homepageWxss), '更新入口右边界必须与轮盘右侧提示对齐');
assert(/\.wheel-heading\s*\{[^}]*margin:\s*10rpx 10rpx 4rpx/.test(homepageWxss), '轮盘两侧辅助提示必须使用一致的左右边界');
assert(homepageWxss.includes('@keyframes sync-spin'), '更新图标必须具有旋转关键帧');
assert(!homepageWxss.includes('0 0 30rpx rgba(85,181,190'), '焦点卡片不得使用会被轮盘裁成矩形的外扩背光');
assert(!/\.eta-label\s*\{[^}]*color:/.test(homepageWxss), 'ETA 不得继续使用固定红色');
assert(/\.restroom-facts__tags\s*\{[^}]*min-width:\s*0[^}]*overflow:\s*hidden[^}]*white-space:\s*nowrap/.test(homepageWxss), '结构化标签行必须保持单行且不撑高卡片');
assert(/\.restroom-facts__eta\s*\{[^}]*flex:\s*none/.test(homepageWxss), 'ETA 必须固定宽度，不得被长位置标签压缩');
assert(!homepageWxss.includes('.restroom-meta__more'), '旧右下角小点击入口必须移除');
assert(/\.home-content\s*\{[^}]*padding:\s*8rpx\s+28rpx\s+16rpx/.test(homepageWxss), '原生底部导航会自动占位，首页主体只应保留常规底部间距');
assert(!homepageWxss.includes('inline-flex'), 'Skyline 首页不得使用不稳定的 inline-flex 布局');
const appConfig = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../miniprogram/app.json'), 'utf8'));
const profileJs = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/profile/index.js'), 'utf8');
const profileWxss = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/profile/index.wxss'), 'utf8');
const customTabBarPath = path.resolve(__dirname, '../miniprogram/custom-tab-bar');
assert.notStrictEqual(appConfig.tabBar.custom, true, '真机底部导航必须由微信原生 TabBar 渲染');
assert.strictEqual(appConfig.tabBar.list.length, 2, '原生底部导航必须保留首页和我的两个入口');
assert.deepStrictEqual(
  appConfig.tabBar.list.map(({ pagePath, text, iconPath, selectedIconPath }) => ({
    pagePath, text, iconPath, selectedIconPath,
  })),
  [
    { pagePath: 'pages/index/index', text: '首页', iconPath: 'images/icons/home.png', selectedIconPath: 'images/icons/home-active.png' },
    { pagePath: 'pages/profile/index', text: '我的', iconPath: 'images/icons/usercenter.png', selectedIconPath: 'images/icons/usercenter-active.png' },
  ],
  '原生底部导航的页面、文字和图标路径不得偏移',
);
assert(!fs.existsSync(customTabBarPath), '恢复原生 TabBar 后不得残留 custom-tab-bar 目录');
assert(!homepageJs.includes('getTabBar'), '首页不得再操作自定义 TabBar 实例');
assert(!profileJs.includes('getTabBar'), '个人页不得再操作自定义 TabBar 实例');
assert(/\.profile-page\s*\{[^}]*padding:\s*12rpx\s+32rpx\s+56rpx/.test(profileWxss), '原生底部导航会自动占位，个人页只应保留常规底部间距');

const audioCreateOptions = [];
let audioPlayCount = 0;
let audioDestroyCount = 0;
let hapticCount = 0;
global.wx = {
  createInnerAudioContext(options) {
    audioCreateOptions.push(options);
    return {
      play() { audioPlayCount += 1; },
      destroy() { audioDestroyCount += 1; },
      onError() {},
    };
  },
  vibrateShort() { hapticCount += 1; },
};
const feedback = createStationFeedback({ soundEnabled: true, vibrationEnabled: true });
assert.strictEqual(audioCreateOptions.length, 2, '短音效必须预创建双实例池');
assert(audioCreateOptions.every((option) => option.useWebAudioImplement === true), '高频短音效必须开启 WebAudio 底层');
feedback.playDetents(1);
assert.strictEqual(audioPlayCount, 1, '每个正常速率站点 detent 必须立即播放一次音效');
assert.strictEqual(hapticCount, 1, '首个站点 detent 必须触发一次轻触感');
feedback.destroy();
assert.strictEqual(audioDestroyCount, 2, '页面卸载必须释放完整音频池');

console.log('首页交互验收通过：顶部两行控制、城市面板、自选起点、同步状态、Skyline 连续轮盘、逐站反馈、速度惯性、横滑换乘和抽屉分组。');
