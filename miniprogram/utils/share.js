const { normalizeCityId } = require('../data/cities');

const SHARE_APP_MESSAGE = Object.freeze({
  title: '先收藏吃灰，真急时一路畅通～',
  imageUrl: '/images/share/share-friend.png',
});

const SHARE_TIMELINE = Object.freeze({
  title: '查个地铁卫生间，何必翻那么多页',
  imageUrl: '/images/share/share-timeline.png',
});

const TIMELINE_SINGLE_PAGE_SCENE = 1154;
const TIMELINE_FULL_APP_SCENE = 1155;

function resolveShareEntry(enterOptions, pageOptions) {
  const enter = enterOptions || {};
  const enterQuery = enter.query || {};
  const pageQuery = pageOptions || {};
  const scene = Number(enter.scene) || 0;
  const rawCityId = pageQuery.cityId || enterQuery.cityId || '';
  const cityId = normalizeCityId(rawCityId);
  const hasSharedCity = Boolean(String(rawCityId || '').trim());
  return {
    scene,
    cityId,
    hasSharedCity,
    isShareEntry: hasSharedCity
      || scene === TIMELINE_SINGLE_PAGE_SCENE
      || scene === TIMELINE_FULL_APP_SCENE,
    isTimelineSinglePage: scene === TIMELINE_SINGLE_PAGE_SCENE,
  };
}

function getShareAppMessage(cityId) {
  const normalizedCityId = normalizeCityId(cityId);
  return Object.assign({}, SHARE_APP_MESSAGE, {
    path: `/pages/index/index?cityId=${encodeURIComponent(normalizedCityId)}`,
  });
}

function getShareTimeline(cityId) {
  const normalizedCityId = normalizeCityId(cityId);
  return Object.assign({}, SHARE_TIMELINE, {
    query: `cityId=${encodeURIComponent(normalizedCityId)}`,
  });
}

module.exports = {
  TIMELINE_FULL_APP_SCENE,
  TIMELINE_SINGLE_PAGE_SCENE,
  getShareAppMessage,
  getShareTimeline,
  resolveShareEntry,
};
