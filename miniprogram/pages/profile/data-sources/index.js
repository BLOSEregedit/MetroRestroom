function returnToAbout() {
  const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
  if (pages.length > 1 && typeof wx.navigateBack === 'function') {
    wx.navigateBack({ delta: 1 });
    return;
  }
  wx.navigateTo({ url: '/pages/profile/about/index' });
}

Page({
  onOpenShanghai() {
    wx.navigateTo({ url: '/pages/profile/data-sources/shanghai/index' });
  },
  onBack() {
    returnToAbout();
  },
});
