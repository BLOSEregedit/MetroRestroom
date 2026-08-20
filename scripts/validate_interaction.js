#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const catalog = require('../miniprogram/data/catalog');
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
leftSwipeCase.page.onWheelHorizontalSwipe(-100, 5);
assert.strictEqual(leftSwipeCase.page._selectedTransfer.lineId, '4', '左滑应选择数值相邻的下一线路');

const rightSwipeCase = createPage('3', 'forward', '上海火车站');
rightSwipeCase.page._switchToTransfer = (transfer) => { rightSwipeCase.page._selectedTransfer = transfer; };
rightSwipeCase.page.onWheelHorizontalSwipe(100, -5);
assert.strictEqual(rightSwipeCase.page._selectedTransfer.lineId, '1', '右滑应选择数值相邻的上一线路');

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
assert.strictEqual(halfMotion.scaleX, 1.0325, '半程横向缩放必须连续插值');
assert.strictEqual(halfMotion.scaleY, 1.0275, '半程纵向缩放必须连续插值');
assert.strictEqual(halfMotion.translateY, 5.5, '半程让位必须连续插值');

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
assert(homepageWxml.includes('class="station-card-shell'), '卡片必须使用统一圆角阴影壳层');
assert(homepageWxml.includes('当前计算起点'), '首页必须显式标注计算起点');
assert(homepageWxml.includes('bindtap="onSelectTransferLine"'), '换乘线路胶囊必须可点击');
assert(!homepageJs.includes('_applyStationMotionByDy'), '逻辑层 touchmove 不得继续写卡片动效');
assert(homepageJs.includes('this.applyAnimatedStyle'), '卡片 transform 必须通过 Worklet 动画样式更新');
assert(homepageJs.includes('getCardMotion(stationIndex - position.value'), '卡片尺寸必须只依赖连续虚拟焦点位置');
assert(homepageJs.includes('runOnJS(this.onWheelDetents.bind(this))'), '跨站时必须仅把离散反馈事件送回逻辑层');
assert(homepageJs.includes('scrollViewContext.scrollTo'), '惯性结束后必须在 UI 线程完成站点吸附');
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
assert(/\.home-content\s*\{[^}]*padding:\s*8rpx\s+28rpx\s+16rpx/.test(homepageWxss), '首页主体必须保留紧凑底部空间');
assert(!homepageWxss.includes('inline-flex'), 'Skyline 首页不得使用不稳定的 inline-flex 布局');

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

console.log('首页交互验收通过：Skyline 连续轮盘、逐站反馈、速度惯性、横滑换乘、定位针、抽屉分组和跨线路纠错上下文。');
