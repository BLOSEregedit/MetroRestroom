const { VERSION_SERIES } = require('../../../data/release-notes');

const INITIAL_VISIBLE_SERIES_COUNT = 6;

function returnToProfile() {
  const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
  if (pages.length > 1 && typeof wx.navigateBack === 'function') {
    wx.navigateBack({ delta: 1 });
    return;
  }
  wx.switchTab({ url: '/pages/profile/index' });
}

Page({
  data: {
    expandedSeries: '',
    hasMoreSeries: VERSION_SERIES.length > INITIAL_VISIBLE_SERIES_COUNT,
    visibleSeries: VERSION_SERIES.slice(0, INITIAL_VISIBLE_SERIES_COUNT),
  },
  onToggleSeries(e) {
    const series = e.currentTarget.dataset.series;
    const historyCount = Number(e.currentTarget.dataset.historyCount || 0);
    if (!series || !historyCount) return;
    this.setData({
      expandedSeries: this.data.expandedSeries === series ? '' : series,
    });
  },
  onShowMore() {
    this.setData({
      hasMoreSeries: false,
      visibleSeries: VERSION_SERIES,
    });
  },
  onBack() {
    returnToProfile();
  },
});
