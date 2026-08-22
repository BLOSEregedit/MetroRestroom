function getReleaseVersion() {
  if (typeof wx === 'undefined' || typeof wx.getAccountInfoSync !== 'function') return '';
  try {
    const accountInfo = wx.getAccountInfoSync();
    const miniProgram = accountInfo && accountInfo.miniProgram;
    return miniProgram && miniProgram.envVersion === 'release'
      ? String(miniProgram.version || '').trim()
      : '';
  } catch (error) {
    return '';
  }
}

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
