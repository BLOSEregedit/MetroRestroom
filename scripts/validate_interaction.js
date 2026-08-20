#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const catalog = require('../miniprogram/data/catalog');
const stationMotion = require('../miniprogram/pages/index/station-motion.wxs');

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
    lineOptions: catalog.getLineOptions(),
    showRestroomDrawer: false,
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
  page.setData = function setData(patch) {
    this.data = Object.assign({}, this.data, patch);
  };
  page._cancelPendingLocation = () => {};
  page._saveCurrentPreferences = (patch) => { page._savedPreferences = patch || {}; };
  page._addRecentRecord = () => {};
  return { page, view, station: view.stations[currentIndex] };
}

const line2 = catalog.buildHomeView({ lineId: '2', direction: 'forward' });
const peopleSquare = line2.stations.find((station) => station.name === '人民广场');
const directionCase = createPage('2', 'forward', '南京东路', peopleSquare.id);
const directionVisibleId = directionCase.page._visibleStationId();
const directionOriginId = directionCase.page._state.originStationId;
directionCase.page._refreshHomeView = (stationId) => {
  directionCase.page._refreshedStationId = stationId;
};
directionCase.page.onSwitchDirection();
assert.strictEqual(directionCase.page._state.direction, 'reverse', '顶部方向按钮必须切换到反向');
assert.strictEqual(directionCase.page._state.originStationId, directionOriginId, '方向切换不得修改起点');
assert.strictEqual(
  directionCase.page._refreshedStationId,
  directionVisibleId,
  '方向切换必须保持当前浏览站',
);
assert.strictEqual(directionCase.page._directionMode, 'manual', '方向切换后应进入手动方向模式');

['3', '4'].forEach((targetLineId) => {
  const transferCase = createPage('1', 'forward', '上海火车站');
  const originId = transferCase.page._state.originStationId;
  const transfer = transferCase.station.transfers.find((item) => item.lineId === targetLineId);
  assert(transfer, `上海火车站缺少 ${targetLineId} 号线换乘入口`);
  transferCase.page._refreshHomeView = (stationId) => {
    transferCase.page._refreshedStationId = stationId;
  };
  transferCase.page.onSelectTransferLine({
    currentTarget: { dataset: { stationId: transfer.stationId, lineId: targetLineId } },
  });
  assert.strictEqual(transferCase.page._state.lineId, targetLineId, '点击应切换指定换乘线路');
  assert.strictEqual(transferCase.page._refreshedStationId, transfer.stationId, '换乘后应保持同一物理站');
  assert.strictEqual(transferCase.page._state.originStationId, originId, '换乘浏览不得修改起点');
});

const leftSwipeCase = createPage('3', 'forward', '上海火车站');
leftSwipeCase.page._switchToTransfer = (transfer) => { leftSwipeCase.page._selectedTransfer = transfer; };
leftSwipeCase.page.onWheelTouchStart({ touches: [{ clientX: 100, clientY: 100 }] });
leftSwipeCase.page.onWheelTouchMove({ touches: [{ clientX: 30, clientY: 104 }] });
leftSwipeCase.page.onWheelTouchEnd({ changedTouches: [{ clientX: 0, clientY: 105 }] });
assert.strictEqual(leftSwipeCase.page._selectedTransfer.lineId, '4', '左滑应选择数值相邻的下一线路');

const rightSwipeCase = createPage('3', 'forward', '上海火车站');
rightSwipeCase.page._switchToTransfer = (transfer) => { rightSwipeCase.page._selectedTransfer = transfer; };
rightSwipeCase.page.onWheelTouchStart({ touches: [{ clientX: 100, clientY: 100 }] });
rightSwipeCase.page.onWheelTouchMove({ touches: [{ clientX: 170, clientY: 96 }] });
rightSwipeCase.page.onWheelTouchEnd({ changedTouches: [{ clientX: 200, clientY: 95 }] });
assert.strictEqual(rightSwipeCase.page._selectedTransfer.lineId, '1', '右滑应选择数值相邻的上一线路');

const verticalSwipeCase = createPage('3', 'forward', '上海火车站');
verticalSwipeCase.page._switchToTransfer = (transfer) => {
  verticalSwipeCase.page._selectedTransfer = transfer;
};
verticalSwipeCase.page.onWheelTouchStart({ touches: [{ clientX: 100, clientY: 100 }] });
verticalSwipeCase.page.onWheelTouchMove({ touches: [{ clientX: 110, clientY: 180 }] });
verticalSwipeCase.page.onWheelTouchEnd({ changedTouches: [{ clientX: 112, clientY: 210 }] });
assert.strictEqual(verticalSwipeCase.page._selectedTransfer, undefined, '纵滑站点不得误触线路切换');

const shortSwipeCase = createPage('3', 'forward', '上海火车站');
shortSwipeCase.page._switchToTransfer = (transfer) => {
  shortSwipeCase.page._selectedTransfer = transfer;
};
shortSwipeCase.page.onWheelTouchStart({ touches: [{ clientX: 100, clientY: 100 }] });
shortSwipeCase.page.onWheelTouchMove({ touches: [{ clientX: 65, clientY: 103 }] });
shortSwipeCase.page.onWheelTouchEnd({ changedTouches: [{ clientX: 61, clientY: 104 }] });
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

const invalidAnchorOrigin = manualAnchorCase.page._state.originStationId;
manualAnchorCase.page.onSetManualAnchor({ currentTarget: { dataset: { stationId: 'missing' } } });
assert.strictEqual(
  manualAnchorCase.page._state.originStationId,
  invalidAnchorOrigin,
  '不存在的圆点站点不得改变起点',
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
assert.strictEqual(stationMotion.getFocusStrength(0), 1, '第二卡位中心必须是固定最大焦点');
assert.strictEqual(stationMotion.getFocusStrength(1), 0, '离开第二卡位一个站距后必须恢复常规尺寸');
const approachSamples = [1, .75, .5, .25, 0].map(stationMotion.getFocusStrength);
approachSamples.slice(1).forEach((strength, index) => {
  assert(strength > approachSamples[index], '卡片接近第二卡位时焦点强度必须连续单调增加');
});
[-.75, -.5, -.25, 0, .25, .5, .75].forEach((distance) => {
  assert.strictEqual(
    stationMotion.getFocusStrength(distance),
    stationMotion.getFocusStrength(-distance),
    '焦点放大曲线必须围绕第二卡位对称',
  );
});
const halfMotion = stationMotion.getCardMotion(.5);
assert.deepStrictEqual(
  halfMotion,
  { focus: .5, scaleX: 1.0325, scaleY: 1.0275, translateY: 7 },
  '半程卡片必须使用连续的缩放和让位插值',
);

const transitionCase = createPage('2', 'forward', '南京东路', peopleSquare.id);
transitionCase.page.data.stations = transitionCase.page._decorateStations(
  transitionCase.view.stations,
  transitionCase.page.data.currentIndex,
  transitionCase.page.data.lineColor,
);
transitionCase.page.data.motionCommitVersion = 3;
transitionCase.page._updateSyncStatus = () => { transitionCase.page._syncUpdated = true; };
transitionCase.page._scheduleSyncForVisibleStation = () => { transitionCase.page._syncScheduled = true; };
const transitionCurrentIndex = transitionCase.page.data.currentIndex;
transitionCase.page.onStationAnimationFinish({ currentIndex: transitionCurrentIndex + 1 });
assert.strictEqual(transitionCase.page.data.currentIndex, transitionCurrentIndex + 1, '吸附结束后才可提交最终焦点站');
assert.strictEqual(transitionCase.page.data.motionCommitVersion, 4, '每次吸附结束必须通知 WXS 清理视图层样式');
assert.strictEqual(transitionCase.page.data.stations[transitionCurrentIndex + 1].isActive, true, '最终焦点卡必须在吸附结束后激活');
assert.strictEqual(transitionCase.page.data.stations[transitionCurrentIndex].isActive, false, '原焦点卡必须在吸附结束后恢复常规状态');
assert.strictEqual(transitionCase.page._syncUpdated, true, '焦点切换完成后必须刷新同步状态');
assert.strictEqual(transitionCase.page._syncScheduled, true, '焦点切换完成后必须调度站点同步');
transitionCase.page.onStationAnimationFinish({ currentIndex: transitionCurrentIndex + 1 });
assert.strictEqual(transitionCase.page.data.motionCommitVersion, 5, '回弹到原站也必须通知 WXS 清理视图层样式');

const drawerCase = createPage('3', 'forward', '上海火车站');
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
const stationMotionWxs = fs.readFileSync(
  path.resolve(__dirname, '../miniprogram/pages/index/station-motion.wxs'),
  'utf8',
);
assert(homepageWxml.includes('display-multiple-items="4"'), '首页焦点之后必须展示 4 个站点行');
assert(homepageWxml.includes('previous-margin="{{stationPreviousMargin}}"'), '首页必须动态露出一个前置站点，使焦点位于第二位');
assert(homepageWxml.includes('<wxs module="stationMotion"'), '首页必须加载站点 WXS 动效模块');
assert(homepageWxml.includes('data-current-index="{{currentIndex}}"'), 'WXS 每次手势必须从原生 swiper 数据集锁定当前锚点');
assert(homepageWxml.includes('motionstate="{{motionCommitVersion}}"'), '每次吸附提交必须触发独立的 WXS 状态观察属性');
assert(homepageWxml.includes('change:motionstate="{{stationMotion.onSettledStateChange}}"'), '吸附提交后必须清理视图层临时样式');
assert(homepageWxml.includes('bindtransition="{{stationMotion.onTransition}}"'), '站点轮播必须在视图层更新焦点动效');
assert(homepageWxml.includes('bindanimationfinish="{{stationMotion.onAnimationFinish}}"'), '站点轮播吸附结束必须由 WXS 提交最终焦点');
assert(!homepageWxml.includes('bindchange='), '站点轮播不得在 change 阶段回写受控 current');
assert(!homepageWxml.includes('station-focus-lens'), '第二卡位不得保留固定背景光场');
assert(!homepageWxml.includes('station.contentMotionStyle'), '卡片内容不得通过逻辑层逐帧修改布局');
assert(!homepageWxml.includes('station.motionStyle'), '卡片壳层不得通过逻辑层逐帧 setData');
assert(homepageWxml.includes('style="color: {{lineTextColor}};"'), '首页 ETA 必须使用当前线路的可读文字色');
assert(homepageWxml.includes('style="color: {{group.lineTextColor}};"'), '抽屉 ETA 必须使用厕所所属线路的可读文字色');
assert(homepageWxml.includes('class="line-picker-pill'), '线路选择器必须使用胶囊结构');
assert(homepageWxml.includes('background-color: {{line.color}};'), '线路选择器胶囊必须显示官方线路色标记');
assert(homepageWxml.includes('class="station-card-shell'), '卡片必须使用统一圆角阴影壳层');
assert(homepageWxml.includes('station-motion-card'), '卡片必须暴露 WXS 视图层选择器');
assert(homepageWxml.includes('data-motion-index="{{index}}"'), '卡片必须向 WXS 暴露连续站点索引');
assert(homepageWxml.includes('当前计算起点'), '首页必须显式标注计算起点');
assert(homepageWxml.includes('bindtap="onSelectTransferLine"'), '换乘线路胶囊必须可点击');
assert(homepageWxml.includes('capture-bind:touchstart="onWheelTouchStart"'), '站点区域必须保留横滑换乘起点识别');
assert(homepageWxml.includes('capture-bind:touchmove="onWheelTouchMove"'), 'touchmove 只能识别横纵手势，不得驱动动画');
assert(homepageWxml.includes('capture-bind:touchend="onWheelTouchEnd"'), '站点区域必须处理横滑结束');
assert(homepageWxml.includes('capture-bind:touchcancel="onWheelTouchCancel"'), '站点区域必须处理 touchcancel');
assert(!homepageJs.includes('_applyStationMotionByDy'), '逻辑层 touchmove 不得继续写卡片动效');
assert(homepageWxml.includes('wx:for="{{drawerGroups}}"'), '多厕所抽屉必须按线路分组');
assert(homepageWxml.includes('信息有误？反馈'), '抽屉必须保留弱化反馈入口');
assert(homepageWxml.includes('bindtap="onSetManualAnchor"'), '站点圆点必须可锁定手动起点');
assert(homepageWxml.includes('station.isSystemOrigin'), '站点圆点必须由智能定位状态驱动定位针');
assert(homepageWxml.includes('station.showReverse'), '需掉头标签必须只读取当前高亮卡字段');
assert(!homepageWxml.includes('>纠错<'), '首页主列表不得显示红色纠错入口');
assert(!homepageWxss.includes('.station-row--active'), '整行不得设置选中态样式');
const stationRowRule = homepageWxss.match(/\.station-row\s*\{([^}]*)\}/);
assert(stationRowRule, '缺少站点行样式');
assert(!/opacity|transform/.test(stationRowRule[1]), '站点行不得缩放或改变透明度');
assert(/\.station-card-shell\s*\{[^}]*width:\s*calc\(100%\s*-\s*104rpx\)/.test(homepageWxss), '常规卡片必须使用独立宽度');
assert(/\.station-card-shell--before-focus[^}]*translateY\(-14rpx\)/.test(homepageWxss), '焦点上方卡片必须增加间距');
assert(/\.station-card-shell--after-focus[^}]*translateY\(14rpx\)/.test(homepageWxss), '焦点下方卡片必须增加间距');
assert(/\.station-card-shell--active[^}]*scale3d\(1\.065,1\.055,1\)/.test(homepageWxss), '焦点卡片必须具有肉眼可见的 Dock 式横纵放大幅度');
assert(!/\.station-card-shell--active[^}]*width:/.test(homepageWxss), '焦点动效不得再逐级切换真实宽度');
assert(!/\.station-card-shell\s*\{[^}]*transition:/.test(homepageWxss), '视图层逐帧 transform 不得叠加 CSS transition');
assert(!homepageWxss.includes('.station-focus-lens'), '样式中不得残留固定背景光场');
assert(/\.line-picker-pill\s*\{[^}]*border-radius:\s*999rpx/.test(homepageWxss), '线路选择项必须使用胶囊样式');
assert(!homepageWxss.includes('0 0 30rpx rgba(85,181,190'), '焦点卡片不得使用会被轮盘裁成矩形的外扩背光');
assert(!/\.eta-label\s*\{[^}]*color:/.test(homepageWxss), 'ETA 不得继续使用固定红色');
const appConfig = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../miniprogram/app.json'), 'utf8'));
const customTabBarWxml = fs.readFileSync(
  path.resolve(__dirname, '../miniprogram/custom-tab-bar/index.wxml'),
  'utf8',
);
const customTabBarWxss = fs.readFileSync(
  path.resolve(__dirname, '../miniprogram/custom-tab-bar/index.wxss'),
  'utf8',
);
assert.strictEqual(appConfig.tabBar.custom, true, '底部导航必须启用自定义实现，才能控制高度与图标垂直位置');
assert(/\.page\s*\{[^}]*padding:\s*24rpx\s+28rpx\s+calc\(96rpx\s+\+\s+env\(safe-area-inset-bottom\)\)/.test(homepageWxss), '首页必须为自定义底部导航预留精确空间');
assert(customTabBarWxml.includes('class="tab-bar__item'), '自定义底部导航必须保留可点击的 Tab 项');
assert(!customTabBarWxml.includes('tab-bar__label'), '图标足以表达入口时，底部导航不得保留冗余文字');
assert(/\.tab-bar__content\s*\{[^}]*height:\s*80rpx/.test(customTabBarWxss), '自定义底部导航主视觉区必须压缩为 80rpx');
assert(/\.tab-bar__item\s*\{[^}]*align-items:\s*center[^}]*justify-content:\s*center/.test(customTabBarWxss), '底部导航图标必须在可视区域内居中');
assert(stationMotionWxs.includes('requestAnimationFrame'), 'WXS 必须按最新进度合并到视图帧');
assert(stationMotionWxs.includes("setStyle({"), 'WXS 必须直接在视图层更新卡片 transform');
assert(!stationMotionWxs.includes('setData'), '拖动过程不得回到逻辑层 setData');
assert(stationMotionWxs.includes("callMethod('onStationAnimationFinish'"), 'WXS 只能在吸附结束后提交业务索引');

console.log('首页交互验收通过：方向保持、圆点锁定、横纵手势、三线换乘、定位针、抽屉分组和跨线路纠错上下文。');
