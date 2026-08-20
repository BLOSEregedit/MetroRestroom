const {
  clearRecentRecords,
  getPreferences,
  getRecentRecords,
  savePreferences,
} = require("../../utils/storage");
const stationLocationData = require("../../data/station-locations");

const COLLAPSED_RECENT_COUNT = 5;

const physicalStationByLineStationId = Object.create(null);
(stationLocationData.stations || []).forEach((station) => {
  (station.lineStationIds || []).forEach((lineStationId) => {
    physicalStationByLineStationId[lineStationId] = station.physicalStationId;
  });
});

function recentDedupeKey(record) {
  return physicalStationByLineStationId[record.stationId]
    || `line:${record.lineId}:${record.stationId}`;
}

function dedupeRecentRecords(records) {
  const seen = Object.create(null);
  return records.filter((record) => {
    const key = recentDedupeKey(record);
    if (seen[key]) return false;
    seen[key] = true;
    return true;
  });
}

function formatRecentRecords(records) {
  return records.map((record) => Object.assign({}, record, {
    lineName: record.lineName || `${record.lineId}号线`,
    stationName: record.stationName || record.stationId,
    action: record.action || "浏览",
  }));
}

Page({
  data: {
    soundEnabled: true,
    vibrationEnabled: true,
    recentRecords: [],
    recentTotal: 0,
    recentExpanded: false,
  },
  onShow() {
    const tabBar = this.getTabBar && this.getTabBar();
    if (tabBar) tabBar.setData({ selected: 1 });
    const preferences = getPreferences();
    this._allRecentRecords = formatRecentRecords(dedupeRecentRecords(getRecentRecords()));
    this.setData({
      soundEnabled: preferences.soundEnabled !== false,
      vibrationEnabled: preferences.vibrationEnabled !== false,
      recentTotal: this._allRecentRecords.length,
      recentExpanded: false,
      recentRecords: this._allRecentRecords.slice(0, COLLAPSED_RECENT_COUNT),
    });
  },
  onToggleRecent() {
    const expanded = !this.data.recentExpanded;
    this.setData({
      recentExpanded: expanded,
      recentRecords: expanded
        ? this._allRecentRecords
        : this._allRecentRecords.slice(0, COLLAPSED_RECENT_COUNT),
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
    this._allRecentRecords = [];
    this.setData({
      recentRecords: [],
      recentTotal: 0,
      recentExpanded: false,
    });
  },
  onOpenCorrection() {
    const app = getApp();
    app.globalData.pendingCorrectionContext = null;
    wx.navigateTo({ url: "/pages/correction/index" });
  },
  openAbout() { wx.navigateTo({ url: "/pages/profile/about/index" }); }
});
