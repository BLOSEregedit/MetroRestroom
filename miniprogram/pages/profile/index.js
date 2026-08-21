const {
  clearRecentRecords,
  getPreferences,
  getRecentRecords,
  savePreferences,
} = require("../../utils/storage");
const {
  formatDateTime,
  getSyncStatus,
  subscribeSyncState,
  syncLines,
} = require('../../utils/data-sync');
const stationLocationData = require("../../data/station-locations");
const { normalizeFacilityTerms } = require('../../utils/display-copy');

const COLLAPSED_RECENT_COUNT = 5;
const SYNC_CITY_ID = 'shanghai';
const SYNC_BUNDLE_SCHEMA = 1;

function formatCompactSyncTime(timestamp, nowMs) {
  const formatted = formatDateTime(timestamp);
  if (!formatted) return '';
  const current = formatDateTime(nowMs || Date.now());
  return current && current.slice(0, 4) === formatted.slice(0, 4)
    ? formatted.slice(5)
    : formatted;
}

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
    action: normalizeFacilityTerms(record.action || "浏览"),
  }));
}

Page({
  data: {
    soundEnabled: true,
    vibrationEnabled: true,
    recentRecords: [],
    recentTotal: 0,
    recentExpanded: false,
    syncTone: 'blue',
    syncMessage: '本地数据 · 尚未同步',
  },
  onShow() {
    const preferences = getPreferences();
    this._allRecentRecords = formatRecentRecords(dedupeRecentRecords(getRecentRecords()));
    this.setData({
      soundEnabled: preferences.soundEnabled !== false,
      vibrationEnabled: preferences.vibrationEnabled !== false,
      recentTotal: this._allRecentRecords.length,
      recentExpanded: false,
      recentRecords: this._allRecentRecords.slice(0, COLLAPSED_RECENT_COUNT),
    });
    if (!this._unsubscribeSync) {
      this._unsubscribeSync = subscribeSyncState((event) => {
        if (event.cityId === SYNC_CITY_ID) this._updateSyncStatus();
      });
    }
    this._updateSyncStatus();
    const app = getApp();
    if (app.globalData.cloudReady) {
      syncLines(this._syncLineIds(), {
        mode: 'auto',
        cityId: SYNC_CITY_ID,
        bundleSchema: SYNC_BUNDLE_SCHEMA,
      }).then(() => this._updateSyncStatus());
    }
  },
  onUnload() {
    if (this._unsubscribeSync) this._unsubscribeSync();
    this._unsubscribeSync = null;
  },
  _syncLineIds() {
    const lineIds = getApp().globalData.activeSyncLineIds;
    return Array.isArray(lineIds) && lineIds.length ? lineIds : ['2'];
  },
  _updateSyncStatus() {
    const status = getSyncStatus(this._syncLineIds(), {
      cityId: SYNC_CITY_ID,
      bundleSchema: SYNC_BUNDLE_SCHEMA,
    });
    const presentation = this._buildSyncPresentation(status);
    this.setData({
      syncTone: presentation.tone,
      syncMessage: presentation.message,
    });
  },
  _buildSyncPresentation(status, nowMs) {
    const input = status || {};
    const isFresh = input.tone === 'green'
      || (input.phase === 'checking' && this.data.syncTone === 'green');
    const timeLabel = formatCompactSyncTime(input.lastAlignedAt, nowMs);
    return {
      tone: isFresh ? 'green' : 'blue',
      message: isFresh
        ? `已同步${timeLabel ? ` · ${timeLabel}` : ''}`
        : `本地数据${timeLabel ? ` · 上次 ${timeLabel}` : ' · 尚未同步'}`,
    };
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
  openAbout() { wx.navigateTo({ url: "/pages/profile/about/index" }); },
  openDeveloperNote() { wx.navigateTo({ url: "/pages/profile/developer-note/index" }); }
});
