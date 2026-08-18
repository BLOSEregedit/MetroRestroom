const {
  clearRecentRecords,
  getPreferences,
  getRecentRecords,
  savePreferences,
} = require("../../utils/storage");

function formatRecentRecords(records) {
  return records.map((record) => Object.assign({}, record, {
    lineName: record.lineName || `${record.lineId}号线`,
    stationName: record.stationName || record.stationId,
    action: record.action || "浏览",
  }));
}

Page({
  data: { soundEnabled: true, vibrationEnabled: true, recentRecords: [] },
  onShow() {
    const preferences = getPreferences();
    this.setData({
      soundEnabled: preferences.soundEnabled !== false,
      vibrationEnabled: preferences.vibrationEnabled !== false,
      recentRecords: formatRecentRecords(getRecentRecords()),
    });
  },
  onSoundChange(e) {
    const enabled = e.detail.value;
    savePreferences({ soundEnabled: enabled });
    this.setData({ soundEnabled: enabled });
  },
  onVibrationChange(e) {
    const enabled = e.detail.value;
    savePreferences({ vibrationEnabled: enabled });
    this.setData({ vibrationEnabled: enabled });
  },
  onOpenRecent(e) {
    const record = this.data.recentRecords[e.currentTarget.dataset.index];
    if (!record) return;

    savePreferences({
      lineId: record.lineId,
      routeId: record.routeId,
      direction: record.direction,
      originStationId: record.stationId,
      originMode: "manual",
    });
    wx.switchTab({ url: "/pages/index/index" });
  },
  onClearRecent() {
    clearRecentRecords();
    this.setData({ recentRecords: [] });
  },
  onOpenCorrection() {
    const app = getApp();
    app.globalData.pendingCorrectionContext = null;
    wx.navigateTo({ url: "/pages/correction/index" });
  },
  openAbout() { wx.navigateTo({ url: "/pages/profile/about/index" }); }
});
