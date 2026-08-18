const restroomData = require('../../../data/generated/restrooms');
const stationLocationData = require('../../../data/station-locations');

Page({
  data: {
    version: '开发版',
    dataVersion: `厕所 ${restroomData.stats.sourceRowCount} 条 · 坐标 ${stationLocationData.stations.length} 站`,
    cloudStatus: '本地数据可离线使用',
    osmLicenseUrl: 'https://www.openstreetmap.org/copyright',
  },
  onShow() {
    const status = getApp().globalData.dataVersionStatus;
    let cloudStatus = '本地数据可离线使用';
    if (status && status.available && status.updateAvailable) cloudStatus = '发现新的数据版本';
    if (status && status.available && !status.updateAvailable) cloudStatus = '当前已是最新数据';
    this.setData({ cloudStatus });
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
