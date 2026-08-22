const { getReleaseVersion } = require('../../../utils/version');

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
    version: '',
  },
  onLoad() {
    this.setData({ version: getReleaseVersion() });
  },
  onOpenDataSources() {
    wx.navigateTo({ url: '/pages/profile/data-sources/index' });
  },
  onBack() {
    returnToProfile();
  },
});
