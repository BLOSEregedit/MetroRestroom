#!/usr/bin/env node

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  getShareAppMessage,
  getShareTimeline,
  resolveShareEntry,
} = require('../miniprogram/utils/share');
const { getCity } = require('../miniprogram/data/cities');
const stationLocationData = require('../miniprogram/data/station-locations');
const storage = require('../miniprogram/utils/storage');

const friendShare = getShareAppMessage('shanghai');
assert.deepStrictEqual(friendShare, {
  title: '先收藏吃灰，真急时一路畅通～',
  path: '/pages/index/index?cityId=shanghai',
  imageUrl: '/images/share/share-friend.png',
});
assert.deepStrictEqual(getShareTimeline('shanghai'), {
  title: '查个地铁卫生间，何必翻那么多页',
  query: 'cityId=shanghai',
  imageUrl: '/images/share/share-timeline.png',
});
assert(friendShare.path.includes('cityId=shanghai'), '好友分享必须携带当前城市');
assert.strictEqual(getShareTimeline('shanghai').query, 'cityId=shanghai', '朋友圈分享必须携带当前城市');
assert(!/[?&](?:lineId|stationId|origin|latitude|longitude|location|preference)=/.test(
  `${friendShare.path}&${getShareTimeline('shanghai').query}`,
), '分享参数不得携带线路、站点、起点、坐标或偏好');
assert.strictEqual(getShareAppMessage('unknown').path, '/pages/index/index?cityId=shanghai');
assert.strictEqual(getShareTimeline('unknown').query, 'cityId=shanghai');
assert.strictEqual(getCity('shanghai').landmarkStationId, 'l2-s019');

assert.deepStrictEqual(resolveShareEntry({ scene: 1007 }), {
  scene: 1007,
  cityId: 'shanghai',
  hasSharedCity: false,
  isShareEntry: false,
  isTimelineSinglePage: false,
});
assert.deepStrictEqual(resolveShareEntry({ scene: 1154, query: { cityId: 'shanghai' } }), {
  scene: 1154,
  cityId: 'shanghai',
  hasSharedCity: true,
  isShareEntry: true,
  isTimelineSinglePage: true,
});
assert.deepStrictEqual(resolveShareEntry({ scene: 1155 }), {
  scene: 1155,
  cityId: 'shanghai',
  hasSharedCity: false,
  isShareEntry: true,
  isTimelineSinglePage: false,
});
assert.deepStrictEqual(resolveShareEntry({ scene: 1001 }), {
  scene: 1001,
  cityId: 'shanghai',
  hasSharedCity: false,
  isShareEntry: false,
  isTimelineSinglePage: false,
});
assert.deepStrictEqual(resolveShareEntry(
  { scene: 1007 },
  { cityId: 'shanghai' },
), {
  scene: 1007,
  cityId: 'shanghai',
  hasSharedCity: true,
  isShareEntry: true,
  isTimelineSinglePage: false,
});

function pngSize(filePath) {
  const buffer = fs.readFileSync(filePath);
  assert.strictEqual(buffer.subarray(1, 4).toString(), 'PNG', `${filePath} 必须是 PNG`);
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

const friendImagePath = path.resolve(__dirname, '../miniprogram/images/share/share-friend.png');
const timelineImagePath = path.resolve(__dirname, '../miniprogram/images/share/share-timeline.png');

assert.deepStrictEqual(
  pngSize(friendImagePath),
  { width: 600, height: 480 },
  '好友分享图必须是 5:4',
);
assert.deepStrictEqual(
  pngSize(timelineImagePath),
  { width: 256, height: 256 },
  '朋友圈分享图必须是适配小缩略图的 1:1 尺寸',
);
assert.strictEqual(
  sha256(friendImagePath),
  'c48c9592f85b2896c7f79372f5136dbde8d3a920159f66ec121c38fddb20252f',
  '好友分享图已经定版，不得继续修改',
);

const shareGenerator = fs.readFileSync(
  path.resolve(__dirname, './generate_share_assets.swift'),
  'utf8',
);
[
  '急用！',
  '就别绕圈～',
  '打开即用 · 位置一眼看清',
].forEach((copy) => assert(shareGenerator.includes(copy), `分享图生成脚本缺少文案：${copy}`));

const timelineGenerator = shareGenerator.slice(
  shareGenerator.indexOf('func makeTimelineImage()'),
  shareGenerator.indexOf('\ndo {'),
);
assert(timelineGenerator.includes('NSRect(x: 75, y: 75, width: 850, height: 850)'), '朋友圈分享图 Logo 必须占据约 85% 画布');
[
  '先别出闸',
  '查清再走',
  '不用搜 · 不用猜 · 直接就能用',
  '闸内外 · 出入口 · 车头车尾 · 换乘通道',
  '人民广场',
  '1号线',
  '约 3 分钟',
].forEach((copy) => assert(!shareGenerator.includes(copy), `分享图生成脚本不得保留旧文案：${copy}`));
[
  'Metro 洗手间',
  '一打开，',
  '答案就在眼前',
  '想知道的就在眼前',
  '位置在哪 · 多久能到',
].forEach((copy) => assert(!timelineGenerator.includes(copy), `朋友圈缩略图不得包含小尺寸文案：${copy}`));

let pageDefinition = null;
const toastCalls = [];
global.getApp = () => ({ globalData: {} });
global.wx = {
  showToast(options) { toastCalls.push(options); },
};
global.Page = (definition) => { pageDefinition = definition; };

const pagePath = path.resolve(__dirname, '../miniprogram/pages/index/index.js');
delete require.cache[pagePath];
require(pagePath);
assert(pageDefinition, '首页 Page 配置未加载');
assert.deepStrictEqual(pageDefinition.onShareAppMessage(), friendShare);
assert.deepStrictEqual(pageDefinition.onShareTimeline(), getShareTimeline('shanghai'));

const singlePage = Object.assign({}, pageDefinition, {
  data: {},
  _isTimelineSinglePage: true,
});
singlePage.onRequestLocation();
assert.strictEqual(toastCalls.at(-1).title, '进入小程序后可定位附近站点');

const wxml = fs.readFileSync(
  path.resolve(__dirname, '../miniprogram/pages/index/index.wxml'),
  'utf8',
);
[
  '当前展示人民广场',
  '进入小程序后可定位附近站点',
  '默认展示 · ',
].forEach((copy) => assert(wxml.includes(copy), `首页缺少分享入口文案：${copy}`));
[
  'showShareLocationInvite',
  '查找你附近的地铁站',
  '先看看',
].forEach((copy) => assert(!wxml.includes(copy), `普通分享打开不得出现定位邀请：${copy}`));

function nextTask() {
  return new Promise((resolve) => setImmediate(resolve));
}

function createHomePage(enterOptions, locationHandlers) {
  global.wx.getEnterOptionsSync = () => enterOptions;
  global.wx.getWindowInfo = () => ({ statusBarHeight: 20 });
  global.wx.showShareMenu = () => {};
  global.wx.getSetting = locationHandlers.getSetting;
  global.wx.getLocation = locationHandlers.getLocation || (() => {});
  const page = Object.assign({}, pageDefinition, {
    data: Object.assign({}, pageDefinition.data),
  });
  page.setData = function setData(patch, callback) {
    Object.assign(this.data, patch);
    if (callback) callback();
  };
  return page;
}

async function validateShareLifecycle() {
  storage.resetPreferences();
  storage.saveLastLocationStation({
    cityId: 'shanghai',
    lineStationId: 'l2-s017',
    physicalStationId: 'physical-lujiazui',
  });
  let singlePageSettingCalls = 0;
  const timelinePage = createHomePage(
    { scene: 1154, query: { cityId: 'shanghai' } },
    {
      getSetting: () => { singlePageSettingCalls += 1; },
    },
  );
  timelinePage.onLoad({ cityId: 'shanghai' });
  timelinePage.onShow();
  await nextTask();
  assert.strictEqual(timelinePage._state.originStationId, 'l2-s019');
  assert.strictEqual(timelinePage.data.soundEnabled, false);
  assert.strictEqual(timelinePage.data.vibrationEnabled, false);
  assert.strictEqual(singlePageSettingCalls, 0, '朋友圈单页不得读取权限或请求 GPS');

  global.wx.getEnterOptionsSync = () => ({
    scene: 1155,
    query: { cityId: 'shanghai' },
  });
  global.wx.getSetting = ({ success }) => success({ authSetting: {} });
  timelinePage.onShow();
  await nextTask();
  assert.strictEqual(timelinePage.data.isTimelineSinglePage, false);
  assert.strictEqual(timelinePage._state.originStationId, 'l2-s017');
  assert.strictEqual(timelinePage.data.locationStatus, 'cached');

  storage.savePreferences({
    cityId: 'shanghai',
    lineId: '2',
    routeId: 'l2-main',
    direction: 'to-pudong-airport',
    originStationId: 'l2-s021',
    originMode: 'manual',
  });
  timelinePage.onShow();
  assert.strictEqual(timelinePage._state.originStationId, 'l2-s021');
  assert.strictEqual(timelinePage.data.isManualAnchor, true, '朋友圈转完整模式后不得反复覆盖用户操作');
  timelinePage.onUnload();

  storage.resetPreferences();
  storage.clearLastLocationStation();
  const freshPage = createHomePage(
    { scene: 1007, query: { cityId: 'shanghai' } },
    {
      getSetting: ({ success }) => success({ authSetting: {} }),
    },
  );
  freshPage.onLoad({ cityId: 'shanghai' });
  freshPage.onShow();
  await nextTask();
  assert.strictEqual(freshPage._state.originStationId, 'l2-s019');
  assert.strictEqual(freshPage.data.locationStatus, 'notRequested');
  assert.strictEqual(freshPage.data.showDefaultOriginLabel, true);
  freshPage.onUnload();

  storage.savePreferences({
    cityId: 'shanghai',
    lineId: '2',
    routeId: 'l2-main',
    direction: 'to-pudong-airport',
    originStationId: 'l2-s021',
    originMode: 'manual',
  });
  storage.saveLastLocationStation({
    cityId: 'shanghai',
    lineStationId: 'l2-s017',
    physicalStationId: 'physical-lujiazui',
  });
  const fallbackPage = createHomePage(
    { scene: 1007, query: { cityId: 'shanghai' } },
    {
      getSetting: ({ success }) => success({
        authSetting: { 'scope.userLocation': true },
      }),
      getLocation: ({ fail }) => fail({ errMsg: 'getLocation:fail timeout' }),
    },
  );
  fallbackPage.onLoad({ cityId: 'shanghai' });
  assert.strictEqual(fallbackPage._state.originStationId, 'l2-s017');
  assert.strictEqual(fallbackPage.data.isManualAnchor, false);
  fallbackPage.onShow();
  await nextTask();
  assert.strictEqual(fallbackPage._state.originStationId, 'l2-s017');
  assert.strictEqual(fallbackPage.data.locationStatus, 'cached');
  fallbackPage.onUnload();

  const currentStation = stationLocationData.stations.find(
    (station) => station.lineStationIds.length === 1,
  );
  const locatedPage = createHomePage(
    { scene: 1007, query: { cityId: 'shanghai' } },
    {
      getSetting: ({ success }) => success({
        authSetting: { 'scope.userLocation': true },
      }),
      getLocation: ({ success }) => success({
        latitude: currentStation.latitude,
        longitude: currentStation.longitude,
        accuracy: 20,
      }),
    },
  );
  const toastCountBeforeLocation = toastCalls.length;
  locatedPage.onLoad({ cityId: 'shanghai' });
  locatedPage.onShow();
  await nextTask();
  assert.strictEqual(locatedPage._state.originStationId, currentStation.lineStationIds[0]);
  assert.strictEqual(locatedPage.data.locationStatus, 'success');
  assert.strictEqual(toastCalls.length, toastCountBeforeLocation, '分享静默定位成功不得弹 Toast');
  locatedPage.onUnload();

  storage.resetPreferences();
  storage.clearLastLocationStation();
}

validateShareLifecycle().then(() => {
  console.log('分享功能验证通过：仅携带城市、老用户静默定位入口、单页模式兼容和分享图尺寸正确');
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
