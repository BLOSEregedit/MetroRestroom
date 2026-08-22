#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  getShareAppMessage,
  getShareTimeline,
  resolveShareEntry,
} = require('../miniprogram/utils/share');

const friendShare = getShareAppMessage();
assert.deepStrictEqual(friendShare, {
  title: '先收藏吃灰，真急时一路畅通～',
  path: '/pages/index/index',
  imageUrl: '/images/share/share-friend.png',
});
assert.deepStrictEqual(getShareTimeline(), {
  title: '查个地铁卫生间，何必翻那么多页',
  query: '',
  imageUrl: '/images/share/share-timeline.png',
});
assert(!friendShare.path.includes('?'), '好友分享必须直接打开普通首页，不携带入口参数');
assert.strictEqual(getShareTimeline().query, '', '朋友圈分享不得携带入口参数');
assert(!/[?&](?:lineId|stationId|origin|latitude|longitude|location|preference)=/.test(
  `${friendShare.path}&${getShareTimeline().query}`,
), '分享参数不得携带线路、站点、起点、坐标或偏好');

assert.deepStrictEqual(resolveShareEntry({ scene: 1007 }), {
  scene: 1007,
  isTimelineSinglePage: false,
});
assert.deepStrictEqual(resolveShareEntry({ scene: 1154 }), {
  scene: 1154,
  isTimelineSinglePage: true,
});
assert.deepStrictEqual(resolveShareEntry({ scene: 1155 }), {
  scene: 1155,
  isTimelineSinglePage: false,
});
assert.deepStrictEqual(resolveShareEntry({ scene: 1001 }), {
  scene: 1001,
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

assert.deepStrictEqual(
  pngSize(path.resolve(__dirname, '../miniprogram/images/share/share-friend.png')),
  { width: 1000, height: 800 },
  '好友分享图必须是 5:4',
);
assert.deepStrictEqual(
  pngSize(path.resolve(__dirname, '../miniprogram/images/share/share-timeline.png')),
  { width: 1000, height: 1000 },
  '朋友圈分享图必须是 1:1',
);

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
assert.deepStrictEqual(pageDefinition.onShareTimeline(), getShareTimeline());

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

console.log('分享功能验证通过：好友／朋友圈直接打开、单页模式兼容和分享图尺寸正确');
