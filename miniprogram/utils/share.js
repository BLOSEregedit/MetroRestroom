const SHARE_APP_MESSAGE = Object.freeze({
  title: '先收藏吃灰，真急时一路畅通～',
  path: '/pages/index/index',
  imageUrl: '/images/share/share-friend.png',
});

const SHARE_TIMELINE = Object.freeze({
  title: '查个地铁卫生间，何必翻那么多页',
  query: '',
  imageUrl: '/images/share/share-timeline.png',
});

const TIMELINE_SINGLE_PAGE_SCENE = 1154;
const TIMELINE_FULL_APP_SCENE = 1155;

function resolveShareEntry(enterOptions) {
  const enter = enterOptions || {};
  const scene = Number(enter.scene) || 0;
  return {
    scene,
    isTimelineSinglePage: scene === TIMELINE_SINGLE_PAGE_SCENE,
  };
}

function getShareAppMessage() {
  return Object.assign({}, SHARE_APP_MESSAGE);
}

function getShareTimeline() {
  return Object.assign({}, SHARE_TIMELINE);
}

module.exports = {
  TIMELINE_FULL_APP_SCENE,
  TIMELINE_SINGLE_PAGE_SCENE,
  getShareAppMessage,
  getShareTimeline,
  resolveShareEntry,
};
