const restroomData = require('../../../data/generated/restrooms');
const stationLocationData = require('../../../data/station-locations');

Page({
  data: {
    version: '开发版',
    dataVersion: `厕所 ${restroomData.stats.sourceRowCount} 条 · 坐标 ${stationLocationData.stations.length} 站`,
    osmLicenseUrl: 'https://www.openstreetmap.org/copyright',
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
