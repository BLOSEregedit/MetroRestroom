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

Page({
  data: {
    version: '',
    osmLicenseUrl: 'https://www.openstreetmap.org/copyright',
  },
  onLoad() {
    this.setData({ version: getReleaseVersion() });
  },
  onCopyOsmLicense() {
    wx.setClipboardData({
      data: this.data.osmLicenseUrl,
      success() {
        wx.showToast({ title: '许可链接已复制', icon: 'none' });
      },
    });
  },
});
