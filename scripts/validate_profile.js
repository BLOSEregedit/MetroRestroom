#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const catalog = require('../miniprogram/data/catalog');
const { getCorrectionOptions } = require('../miniprogram/data/correction-options');
const storage = require('../miniprogram/utils/storage');

let pageDefinition = null;
const app = { globalData: { pendingCorrectionContext: null } };
const navigationCalls = [];
const navigateBackCalls = [];
const switchTabCalls = [];
const clipboardCalls = [];
const toastCalls = [];
let pageStackDepth = 2;

global.getApp = () => app;
global.getCurrentPages = () => Array.from({ length: pageStackDepth }, () => ({}));
global.wx = {
  switchTab(options) { switchTabCalls.push(options); },
  navigateBack(options) { navigateBackCalls.push(options); },
  navigateTo(options) { navigationCalls.push(options); },
  setClipboardData(options) {
    clipboardCalls.push(options);
    if (typeof options.success === 'function') options.success();
  },
  showToast(options) { toastCalls.push(options); },
  getAccountInfoSync() {
    return { miniProgram: { envVersion: 'release', version: '1.2.3' } };
  },
};
global.Page = (definition) => { pageDefinition = definition; };

const pagePath = path.resolve(__dirname, '../miniprogram/pages/profile/index.js');
delete require.cache[pagePath];
require(pagePath);
assert(pageDefinition, '个人中心 Page 配置未加载');

function createPage() {
  const page = Object.assign({}, pageDefinition);
  page.data = Object.assign({}, pageDefinition.data);
  page.setData = function setData(patch) {
    this.data = Object.assign({}, this.data, patch);
  };
  return page;
}

function findStation(lineId, stationName) {
  const view = catalog.buildHomeView({ lineId, direction: 'forward' });
  const station = view.stations.find((item) => item.name === stationName);
  assert(station, `${lineId} 号线缺少测试站点 ${stationName}`);
  return station;
}

storage.clearRecentRecords();
storage.clearStationLineChoices();

// 定位换乘线路偏好必须按物理站隔离，并且只保存用户明确确认的线路站。
storage.saveStationLineChoice('physical-people-square', {
  lineStationId: 'l2-s019',
});
assert.strictEqual(
  storage.getStationLineChoice('physical-people-square').lineStationId,
  'l2-s019',
);
assert.strictEqual(
  storage.getStationLineChoice('physical-century-avenue'),
  null,
  '一个换乘站的线路偏好不得串用到另一个物理站',
);
storage.saveStationLineChoice('physical-people-square', {
  lineStationId: 'l8-s015',
});
assert.strictEqual(
  storage.getStationLineChoice('physical-people-square').lineStationId,
  'l8-s015',
  '同站后续明确选择应覆盖旧线路',
);
storage.clearStationLineChoices();
assert.strictEqual(storage.getStationLineChoice('physical-people-square'), null);

// 场景一：同线路同站多次访问只保留最新一次并置顶。
const zhenpingLine3 = findStation('3', '镇坪路');
storage.addRecentRecord({
  lineId: '3', lineName: '3号线', stationId: zhenpingLine3.id,
  stationName: '镇坪路', direction: 'forward', routeId: 'l3-main', action: '查看卫生间',
});
const nanjingWest = findStation('2', '南京西路');
storage.addRecentRecord({
  lineId: '2', lineName: '2号线', stationId: nanjingWest.id,
  stationName: '南京西路', direction: 'forward', routeId: 'l2-main', action: '查看厕所',
});
storage.addRecentRecord({
  lineId: '3', lineName: '3号线', stationId: zhenpingLine3.id,
  stationName: '镇坪路', direction: 'reverse', routeId: 'l3-main', action: '设置起点',
});

let page = createPage();
page.onShow();
assert.strictEqual(page.data.recentRecords.length, 2, '同线路同站重复访问不得重复展示');
assert.strictEqual(page.data.recentRecords[0].stationName, '镇坪路', '最新一次访问应置顶');
assert.strictEqual(page.data.recentRecords[0].action, '设置起点', '置顶记录应携带最新操作');
assert.strictEqual(page.data.recentRecords[1].action, '查看卫生间', '旧版最近记录不得继续显示“厕所”');
assert.strictEqual(page.data.recentTotal, 2);

// 场景二：同一物理站跨线路访问只保留最新线路上下文。
const zhenpingLine4 = findStation('4', '镇坪路');
assert.notStrictEqual(zhenpingLine4.id, zhenpingLine3.id, '镇坪路在 3/4 号线应是不同线路站 ID');
storage.addRecentRecord({
  lineId: '4', lineName: '4号线', stationId: zhenpingLine4.id,
  stationName: '镇坪路', direction: 'inner', routeId: 'l4-loop', action: '换乘浏览',
});

page = createPage();
page.onShow();
assert.strictEqual(page.data.recentRecords.length, 2, '同一物理站跨线路不得重复展示');
assert.strictEqual(page.data.recentRecords[0].lineId, '4', '跨线路访问后应保留最新线路上下文');
assert.strictEqual(page.data.recentRecords[1].stationName, '南京西路');

// 场景三：未知 stationId 回退到线路站去重，避免误合并。
storage.addRecentRecord({
  lineId: '4', lineName: '4号线', stationId: 'l4-pudianlu',
  stationName: '浦电路', direction: 'forward', routeId: 'l4-loop', action: '查看卫生间',
});
storage.addRecentRecord({
  lineId: '6', lineName: '6号线', stationId: 'l6-pudianlu',
  stationName: '浦电路', direction: 'forward', routeId: 'l6-main', action: '查看卫生间',
});

page = createPage();
page.onShow();
assert.strictEqual(
  page.data.recentRecords.filter((item) => item.stationName === '浦电路').length,
  2,
  '无法归并物理站的同名记录不得被误去重',
);

// 场景四：超过默认 5 条时折叠展示，展开后显示全部。
storage.clearRecentRecords();
['中山公园', '江苏路', '静安寺', '南京西路', '人民广场', '陆家嘴', '世纪大道'].forEach((name) => {
  const station = findStation('2', name);
  storage.addRecentRecord({
    lineId: '2', lineName: '2号线', stationId: station.id,
    stationName: station.name, direction: 'forward', routeId: 'l2-main', action: '查看卫生间',
  });
});

page = createPage();
page.onShow();
assert.strictEqual(page.data.recentRecords.length, 5, '默认只展示 5 条最近记录');
assert.strictEqual(page.data.recentTotal, 7, '总数应统计去重后的全部记录');
assert.strictEqual(page.data.recentRecords[0].stationName, '世纪大道', '折叠时也应保留最新置顶');
assert.strictEqual(page.data.recentExpanded, false);

page.onToggleRecent();
assert.strictEqual(page.data.recentRecords.length, 7, '展开后应显示全部记录');
assert.strictEqual(page.data.recentExpanded, true);

page.onToggleRecent();
assert.strictEqual(page.data.recentRecords.length, 5, '收起后应恢复 5 条');
assert.strictEqual(page.data.recentExpanded, false);

// 场景五：展开状态下点击尾部记录应打开对应站点。
page.onToggleRecent();
page.onOpenRecent({ currentTarget: { dataset: { index: 6 } } });
const preferences = storage.getPreferences();
assert.strictEqual(preferences.lineId, '2', '点击最近记录应恢复线路');
assert.strictEqual(preferences.originStationId, page.data.recentRecords[6].stationId, '点击最近记录应恢复对应起点');

// 场景六：清空后回到空态。
page.onClearRecent();
assert.strictEqual(page.data.recentRecords.length, 0);
assert.strictEqual(page.data.recentTotal, 0);
assert.strictEqual(page.data.recentExpanded, false);
assert.strictEqual(storage.getRecentRecords().length, 0, '清空必须移除本地存储');

storage.clearRecentRecords();

// 场景七：数据同步状态位于个人页，保持单行且不重复提供手动更新入口。
const syncNow = Date.UTC(2026, 7, 20, 6, 30);
assert.deepStrictEqual(page._buildSyncPresentation({
  phase: 'success', tone: 'green', lastAlignedAt: syncNow,
}, syncNow), {
  tone: 'green', message: '已同步 · 08-20 14:30',
});
assert.deepStrictEqual(page._buildSyncPresentation({
  phase: 'failed', tone: 'gray', lastAlignedAt: syncNow,
}, syncNow), {
  tone: 'blue', message: '本地数据 · 上次 08-20 14:30',
});
assert.strictEqual(
  page._buildSyncPresentation({
    phase: 'idle', tone: 'gray', lastAlignedAt: Date.UTC(2025, 11, 31, 15, 59),
  }, syncNow).message,
  '本地数据 · 上次 2025-12-31 23:59',
  '个人页跨年份同步时间必须保留完整年份',
);
const profileWxml = fs.readFileSync(
  path.resolve(__dirname, '../miniprogram/pages/profile/index.wxml'),
  'utf8',
);
const profileWxss = fs.readFileSync(
  path.resolve(__dirname, '../miniprogram/pages/profile/index.wxss'),
  'utf8',
);
assert(profileWxml.includes('<view class="setting-title">数据同步</view>'), '个人页必须展示数据同步状态');
assert(profileWxml.includes('<view class="setting-title">关于 Metro 洗手间</view>'), '个人页必须保留原关于入口');
assert(profileWxml.includes('<view class="setting-description">数据来源与版本信息</view>'), '原关于入口必须继续说明数据来源与版本职责');
assert(profileWxml.includes('<view class="setting-title">作者寄语</view>'), '个人页必须新增独立作者寄语入口');
assert(profileWxml.includes('bindtap="openDeveloperNote"'), '作者寄语入口必须绑定独立导航');
assert(!profileWxml.includes('bindtap="onRefreshSync"'), '个人页同步状态不得重复提供手动更新入口');
assert(
  /\.sync-value__message\s*\{[^}]*white-space:\s*nowrap;/.test(profileWxss),
  '个人页同步状态必须保持单行',
);
const profileNavigationPage = createPage();
profileNavigationPage.openAbout();
profileNavigationPage.openDeveloperNote();
assert.deepStrictEqual(
  navigationCalls.slice(-2).map((item) => item.url),
  ['/pages/profile/about/index', '/pages/profile/developer-note/index'],
  '关于与作者寄语必须进入两个独立页面',
);

// 场景八：关于页只在正式版显示真实版本号，不显示开发版占位或数据同步状态。
pageDefinition = null;
const aboutPagePath = path.resolve(__dirname, '../miniprogram/pages/profile/about/index.js');
delete require.cache[aboutPagePath];
require(aboutPagePath);
assert(pageDefinition, '关于页 Page 配置未加载');
assert.strictEqual(pageDefinition.onRefreshSync, undefined, '关于页不得保留手动数据检查入口');
assert.strictEqual(pageDefinition._buildSyncPresentation, undefined, '关于页不得继续承载卫生间数据同步状态');

const aboutPage = createPage();
aboutPage.onLoad();
assert.strictEqual(aboutPage.data.version, '1.2.3', '正式版必须显示微信账号信息接口返回的真实版本号');
global.wx.getAccountInfoSync = () => ({
  miniProgram: { envVersion: 'develop', version: '9.9.9' },
});
aboutPage.onLoad();
assert.strictEqual(aboutPage.data.version, '', '开发版不得显示环境占位或伪版本号');

const aboutWxml = fs.readFileSync(
  path.resolve(__dirname, '../miniprogram/pages/profile/about/index.wxml'),
  'utf8',
);
const aboutWxss = fs.readFileSync(
  path.resolve(__dirname, '../miniprogram/pages/profile/about/index.wxss'),
  'utf8',
);
assert(aboutWxml.includes('src="/images/logo.png"'), '关于页必须展示小程序正式 Logo');
assert(!aboutWxml.includes('about-subtitle'), '关于页标题下不得保留重复产品副标题');
assert(aboutWxml.includes('<view class="privacy-title">隐私与数据</view>'), '关于页必须提供独立隐私与数据模块');
assert(aboutWxml.includes('<view class="source-title">数据来源</view>'), '关于页必须提供数据来源一级入口');
assert(aboutWxml.includes('bindtap="onOpenDataSources"'), '数据来源入口必须绑定独立导航');
assert(aboutWxml.includes('官方及公开资料，按城市查看'), '数据来源入口必须说明按城市组织');
assert(!aboutWxml.includes('站点坐标来源'), '关于页不得继续只展示单一坐标来源');
assert(aboutWxml.includes('日常查询不要求注册或登录'), '隐私模块必须说明无需登录和日常查询不主动采集个人信息');
assert(aboutWxml.includes('打开即用，用完即走'), '隐私模块必须说明轻量工具的使用方式');
assert(aboutWxml.includes('基础数据全部随小程序保存在本地'), '隐私模块必须说明基础数据保存在本地');
assert(aboutWxml.includes('用于在本机匹配并更新附近站点'), '隐私模块必须说明定位用途和处理位置');
assert(aboutWxml.includes('只在小程序保持前台使用期间接收位置变化'), '隐私模块必须说明持续定位仅在前台运行');
assert(aboutWxml.includes('切换到后台后立即停止'), '隐私模块必须说明进入后台后停止定位');
assert(aboutWxml.includes('也可以手动选择线路和站点'), '隐私模块必须说明拒绝定位后的手动方案');
assert(aboutWxml.includes('只有你主动提交站点纠错时'), '隐私模块必须说明纠错是唯一主动上传入口');
assert(aboutWxml.includes('自愿填写的联系方式'), '隐私模块必须说明联系方式仅在用户自愿填写时上传');
assert(aboutWxml.includes('不可逆哈希'), '隐私模块必须如实说明匿名防滥用处理');
assert(aboutWxml.includes('不保存原始 OPENID'), '隐私模块必须说明不保存原始微信身份标识');
assert(!aboutWxml.includes('厕所'), '关于页不得向用户显示“厕所”');
assert(!profileWxml.includes('厕所'), '个人页不得向用户显示“厕所”');
getCorrectionOptions().forEach((line) => line.stations.forEach((station) => {
  assert(!station.location.includes('厕所'), `${line.name}${station.name}纠错上下文不得显示“厕所”`);
}));
assert(aboutWxml.includes('wx:if="{{version}}"'), '关于页版本行必须只在真实版本号可用时显示');
assert(aboutWxml.includes('<text>版本</text>'), '关于页版本标签必须保持简洁');
assert(!aboutWxml.includes('开发版'), '关于页不得显示开发版占位');
assert(!aboutWxml.includes('数据同步'), '关于页不得继续展示厕所数据同步状态');
assert(!aboutWxml.includes('检查最新数据'), '关于页不得展示检查最新数据行');
assert(!aboutWxml.includes('bindtap="onRefreshSync"'), '关于页不得展示手动数据检查按钮');
assert(!aboutWxml.includes('作者寄语'), '原关于页不得混入作者寄语');
assert(!aboutWxss.includes('.developer-card'), '原关于页不得残留开发者说明样式');
assert(/\.privacy-item__copy\s*\{[^}]*font-size:\s*24rpx[^}]*line-height:\s*1\.7/.test(aboutWxss), '隐私说明必须使用适合移动端阅读的字号与行距');
assert(aboutWxml.includes('bindtap="onBack"'), '关于页必须提供明确的返回操作');
assert(aboutWxml.includes('aria-label="返回我的"'), '关于页返回操作必须提供读屏名称');

aboutPage.onOpenDataSources();
assert.strictEqual(
  navigationCalls.slice(-1)[0].url,
  '/pages/profile/data-sources/index',
  '关于页数据来源入口必须进入城市来源列表',
);

pageStackDepth = 2;
aboutPage.onBack();
assert.deepStrictEqual(navigateBackCalls.slice(-1)[0], { delta: 1 }, '关于页存在上一页时必须正常返回');
pageStackDepth = 1;
aboutPage.onBack();
assert.strictEqual(switchTabCalls.slice(-1)[0].url, '/pages/profile/index', '关于页单独打开时必须回到“我的”');

// 场景九：数据来源按“城市列表 → 上海详情”两级组织，并公开说明官方数据与 AI 推导边界。
const appConfig = JSON.parse(fs.readFileSync(
  path.resolve(__dirname, '../miniprogram/app.json'),
  'utf8',
));
assert(appConfig.pages.includes('pages/profile/data-sources/index'), 'app.json 必须注册数据来源城市列表页');
assert(appConfig.pages.includes('pages/profile/data-sources/shanghai/index'), 'app.json 必须注册上海来源详情页');

pageDefinition = null;
const sourcesPagePath = path.resolve(__dirname, '../miniprogram/pages/profile/data-sources/index.js');
delete require.cache[sourcesPagePath];
require(sourcesPagePath);
assert(pageDefinition, '数据来源城市列表 Page 配置未加载');
const sourcesPage = createPage();
sourcesPage.onOpenShanghai();
assert.strictEqual(
  navigationCalls.slice(-1)[0].url,
  '/pages/profile/data-sources/shanghai/index',
  '城市来源列表必须进入上海详情页',
);
const sourcesWxml = fs.readFileSync(
  path.resolve(__dirname, '../miniprogram/pages/profile/data-sources/index.wxml'),
  'utf8',
);
assert(sourcesWxml.includes('<view class="city-card__name">上海</view>'), '当前城市列表必须提供上海入口');
assert(sourcesWxml.includes('每座城市，单独说明'), '城市来源页必须明确按城市组织数据来源');
assert(!sourcesWxml.includes('我们'), '城市数据来源页应使用个人独立开发者语气');
assert(!sourcesWxml.includes('产品推导'), '城市数据来源页应统一使用“AI 推导”');
assert(!sourcesWxml.includes('厕所'), '数据来源城市列表不得向用户显示“厕所”');

pageDefinition = null;
const shanghaiSourcesPagePath = path.resolve(
  __dirname,
  '../miniprogram/pages/profile/data-sources/shanghai/index.js',
);
delete require.cache[shanghaiSourcesPagePath];
require(shanghaiSourcesPagePath);
assert(pageDefinition, '上海数据来源 Page 配置未加载');
const shanghaiSourcesPage = createPage();
assert(/^\d{4}\.\d{2}\.\d{2}$/.test(shanghaiSourcesPage.data.checkedDate), '上海来源页必须显示数据核对日期');
assert.strictEqual(shanghaiSourcesPage.data.sourceLinks.length, 5, '上海来源页必须保留五类可复制公开来源');
shanghaiSourcesPage.onCopySource({ currentTarget: { dataset: { index: 1 } } });
assert.strictEqual(
  clipboardCalls.slice(-1)[0].data,
  'https://service.shmetro.com/hcskb/index.htm',
  '点击首末班来源必须复制上海地铁官方链接',
);
assert.strictEqual(toastCalls.slice(-1)[0].title, '来源链接已复制', '复制来源后必须提供明确反馈');

const shanghaiSourcesWxml = fs.readFileSync(
  path.resolve(__dirname, '../miniprogram/pages/profile/data-sources/shanghai/index.wxml'),
  'utf8',
);
const shanghaiSourcesJson = JSON.parse(fs.readFileSync(
  path.resolve(__dirname, '../miniprogram/pages/profile/data-sources/shanghai/index.json'),
  'utf8',
));
assert.strictEqual(
  shanghaiSourcesJson.navigationBarTitleText,
  '上海地铁数据来源',
  '上海详情页导航标题应明确为上海地铁数据来源',
);
[
  '线路与站点',
  '主线、支线与环线',
  '站间预估时间',
  '卫生间位置',
  '站点与入口坐标',
  '官方计划＋AI 推导',
  '它不是实时到站时间',
  'OpenStreetMap contributors',
].forEach((copy) => {
  assert(shanghaiSourcesWxml.includes(copy), `上海来源页缺少说明：${copy}`);
});
assert(!shanghaiSourcesWxml.includes('我们'), '上海数据来源页应使用个人独立开发者语气');
assert(!shanghaiSourcesWxml.includes('产品推导'), '上海数据来源页应统一使用“AI 推导”');
assert(!shanghaiSourcesWxml.includes('根据 Excel 行顺序'), '上海主支线说明不应展示 Excel 实现细节');
assert(!shanghaiSourcesWxml.includes('厕所'), '上海来源页不得向用户显示“厕所”');
assert(shanghaiSourcesWxml.includes('bindtap="onCopySource"'), '上海来源页必须允许复制公开来源链接');
assert(shanghaiSourcesWxml.includes('aria-label="返回数据来源"'), '上海来源页必须提供明确返回入口');

assert(!appConfig.permission['scope.userLocation'].desc.includes('厕所'), '定位授权说明不得混用“厕所”');
assert(appConfig.pages.includes('pages/profile/developer-note/index'), '作者寄语页必须注册到小程序路由');
const developerWxml = fs.readFileSync(
  path.resolve(__dirname, '../miniprogram/pages/profile/developer-note/index.wxml'),
  'utf8',
);
const developerWxss = fs.readFileSync(
  path.resolve(__dirname, '../miniprogram/pages/profile/developer-note/index.wxss'),
  'utf8',
);
const developerJson = JSON.parse(fs.readFileSync(
  path.resolve(__dirname, '../miniprogram/pages/profile/developer-note/index.json'),
  'utf8',
));
assert.strictEqual(developerJson.navigationBarTitleText, '作者寄语', '作者寄语页面导航标题错误');
assert(developerWxml.includes('<view class="note-kicker">作者寄语</view>'), '作者寄语页面内部标题错误');
assert((developerWxml.match(/class="note-paragraph"/g) || []).length >= 8, '作者寄语必须使用多段短文完整表达产品理念');
assert(developerWxml.includes('<view class="note-tagline">打开即用，用完即走。</view>'), '作者寄语必须突出轻量工具定位');
assert(developerWxml.includes('这也是源于我自己的真实需求'), '作者寄语开头必须明确产品源于作者自身需求');
assert(developerWxml.includes('真正麻烦的，往往不是“有没有”，而是“在哪里”'), '作者寄语必须说明问题重点是卫生间位置而非仅有无记录');
assert(developerWxml.includes('在站内还是站外，闸内还是闸外，需不需要去地面'), '作者寄语必须覆盖站内外、闸内外与地面位置判断');
assert(developerWxml.includes('是在车头、车尾，还是换乘通道里'), '作者寄语必须覆盖站台方向与换乘通道位置');
assert(developerWxml.includes('地图导航、短视频、种草社区这类 App 功能很全'), '作者寄语必须交代独立 App 的使用成本');
assert(developerWxml.includes('但用起来也很“重”'), '作者寄语必须说明独立 App 的流程负担');
assert(developerWxml.includes('绝大多数人每天都会打开的高频软件'), '作者寄语必须说明微信的小程序承载优势');
assert(developerWxml.includes('交互也不够直接、快速、高效'), '作者寄语必须如实说明现有同类工具的体验不足');
assert(!developerWxml.includes('高德地图'), '作者寄语不得点名具体地图产品');
assert(!developerWxml.includes('Metro 大都会'), '作者寄语不得点名具体交通出行产品');
assert(developerWxml.includes('我会每个站都亲自走一遍'), '作者寄语必须保留上海逐站亲自核查承诺');
assert(developerWxml.includes('请当地靠谱的人按同样的标准实地核实'), '作者寄语必须保留其他城市协作核查说明');
assert(developerWxml.includes('尽快核实更新'), '作者寄语必须明确反馈后的处理承诺');
assert(!developerWxml.includes('note-card'), '作者寄语不得继续使用引用卡片结构');
assert(!developerWxss.includes('.note-card'), '作者寄语不得残留引用卡片或左侧竖线样式');
assert(/\.note-paragraph\s*\{[^}]*font-size:\s*29rpx[^}]*line-height:\s*1\.8/.test(developerWxss), '作者寄语必须使用放大后的移动端正文字号和行距');
assert(developerWxml.includes('bindtap="onBack"'), '作者寄语页必须提供明确的返回操作');
assert(developerWxml.includes('aria-label="返回我的"'), '作者寄语返回操作必须提供读屏名称');

pageDefinition = null;
const developerPagePath = path.resolve(__dirname, '../miniprogram/pages/profile/developer-note/index.js');
delete require.cache[developerPagePath];
require(developerPagePath);
assert(pageDefinition, '作者寄语 Page 配置未加载');
const developerPage = createPage();
pageStackDepth = 2;
developerPage.onBack();
assert.deepStrictEqual(navigateBackCalls.slice(-1)[0], { delta: 1 }, '作者寄语存在上一页时必须正常返回');
pageStackDepth = 1;
developerPage.onBack();
assert.strictEqual(switchTabCalls.slice(-1)[0].url, '/pages/profile/index', '作者寄语单独打开时必须回到“我的”');

console.log('个人中心验收通过：最近记录、数据同步归位与正式版版本展示符合要求。');
