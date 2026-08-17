const {
  clearRecentRecords,
  getPreferences,
  getRecentRecords,
  savePreferences,
} = require("../../utils/storage");

function formatRecentRecords(records) {
  return records.map((record) => ({
    ...record,
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
    wx.showModal({
      title: "反馈数据问题",
      content: "纠错表单将在云开发阶段接入；从首页厕所卡片进入时会自动带入线路和站点。",
      showCancel: false,
    });
  },
  openAbout() { wx.navigateTo({ url: "/pages/profile/about/index" }); }
});
