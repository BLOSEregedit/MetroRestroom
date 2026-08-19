const {
  formatDateTime,
  getSyncStatus,
  subscribeSyncState,
  syncLines,
} = require('../../../utils/data-sync');

const SYNC_CITY_ID = 'shanghai';
const SYNC_BUNDLE_SCHEMA = 1;

Page({
  data: {
    version: '开发版',
    syncPhase: 'idle',
    syncTone: 'gray',
    cloudStatus: '尚未完成首次同步',
    osmLicenseUrl: 'https://www.openstreetmap.org/copyright',
  },
  onShow() {
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
    this.setData({
      syncPhase: status.phase,
      syncTone: status.tone,
      cloudStatus: status.message,
    });
  },
  onRefreshSync() {
    if (this.data.syncPhase === 'checking') return;
    const app = getApp();
    if (!app.globalData.cloudReady) {
      wx.showToast({ title: '当前无法连接云端', icon: 'none' });
      return;
    }
    syncLines(this._syncLineIds(), {
      mode: 'manual',
      cityId: SYNC_CITY_ID,
      bundleSchema: SYNC_BUNDLE_SCHEMA,
    }).then((result) => {
      this._updateSyncStatus();
      if (result.success && !result.skipped) {
        wx.showToast({ title: '检查完成', icon: 'none' });
        return;
      }
      if (result.retryAt) {
        wx.showToast({ title: `下次可检查 ${formatDateTime(result.retryAt)}`, icon: 'none' });
        return;
      }
      if (!result.success) wx.showToast({ title: '检查失败，请稍后重试', icon: 'none' });
    });
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
