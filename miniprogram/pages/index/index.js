const catalog = require('../../data/catalog');
const stationLocationData = require('../../data/station-locations');
const { createStationFeedback } = require('../../utils/feedback');
const { rankNearbyStations } = require('../../utils/location');
const {
  requestCurrentPosition,
  openLocationSettings,
} = require('../../utils/location-service');
const {
  addRecentRecord,
  savePreferences,
  saveLastLocationStation,
} = require('../../utils/storage');
const {
  formatDateTime,
  getLineOverrides,
  getSyncStatus,
  subscribeSyncState,
  syncLines,
} = require('../../utils/data-sync');

const SYNC_CITY_ID = 'shanghai';
const SYNC_BUNDLE_SCHEMA = 1;
const OPERATIONAL_STATUS_REFRESH_MS = 60 * 1000;
const GESTURE_DECISION_PX = 12;
const TRANSFER_SWIPE_PX = 48;
const HORIZONTAL_GESTURE_RATIO = 1.2;
const RESTROOM_STATUS_LABELS = Object.freeze({
  maintenance: '维护中',
  closed: '暂不可用',
  unknown: '状态待确认',
});
const READABLE_TEXT_NEUTRAL = Object.freeze([31, 36, 41]);
const MIN_LINE_TEXT_CONTRAST = 4.5;

function getLineName(line, lineId) {
  if (typeof line === 'string') return line;
  return (line && (line.name || line.label || line.title)) || lineId || '线路';
}

function getLineColor(line) {
  return (line && line.color) || '#1677ff';
}

function parseHexColor(color) {
  const match = String(color || '').trim().match(/^#([0-9a-f]{6})$/i);
  if (!match) return null;
  return [0, 2, 4].map((offset) => parseInt(match[1].slice(offset, offset + 2), 16));
}

function colorLuminance(rgb) {
  const channels = rgb.map((value) => {
    const channel = value / 255;
    return channel <= .04045
      ? channel / 12.92
      : ((channel + .055) / 1.055) ** 2.4;
  });
  return (.2126 * channels[0]) + (.7152 * channels[1]) + (.0722 * channels[2]);
}

function contrastOnWhite(rgb) {
  return 1.05 / (colorLuminance(rgb) + .05);
}

function rgbToHex(rgb) {
  return `#${rgb.map((value) => value.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

function getReadableLineColor(color) {
  const source = parseHexColor(color);
  if (!source) return '#59626C';
  if (contrastOnWhite(source) >= MIN_LINE_TEXT_CONTRAST) return rgbToHex(source);

  let low = 0;
  let high = 1;
  let readable = READABLE_TEXT_NEUTRAL.slice();
  for (let index = 0; index < 16; index += 1) {
    const ratio = (low + high) / 2;
    const mixed = source.map((value, channel) => Math.round(
      value + ((READABLE_TEXT_NEUTRAL[channel] - value) * ratio),
    ));
    if (contrastOnWhite(mixed) >= MIN_LINE_TEXT_CONTRAST) {
      readable = mixed;
      high = ratio;
    } else {
      low = ratio;
    }
  }
  return rgbToHex(readable);
}

function normalizeLineOptions(options) {
  return (options || []).map((option) => {
    if (typeof option === 'string') return { id: option, name: option };
    return Object.assign({}, option, {
      id: option.id || option.lineId,
      name: option.name || option.label || option.title || option.id || option.lineId,
      textColor: getReadableLineColor(option.color),
    });
  });
}

function formatHomeSyncTime(timestamp, nowMs) {
  const formatted = formatDateTime(timestamp);
  if (!formatted) return '';
  const current = formatDateTime(nowMs || Date.now());
  return current && current.slice(0, 4) === formatted.slice(0, 4)
    ? formatted.slice(5)
    : formatted;
}

Page({
  data: {
    cityName: '上海',
    lineId: '',
    routeId: '',
    lineName: '',
    lineColor: '#1677ff',
    lineTextColor: '#59626C',
    directionLabel: '',
    originStationId: '',
    originStationName: '',
    stations: [],
    currentIndex: 0,
    motionCommitVersion: 0,
    stationPreviousMargin: '120rpx',
    isManualAnchor: false,
    soundEnabled: true,
    vibrationEnabled: true,
    showLinePicker: false,
    showCityPicker: false,
    showStationPicker: false,
    showRestroomDrawer: false,
    lineOptions: [],
    routeOptions: [],
    showRouteSelector: false,
    drawerStation: null,
    drawerRestrooms: [],
    drawerGroups: [],
    locationDataReady: false,
    locationStatus: 'notRequested',
    locationLabel: '未定位',
    locationActionLabel: '开启定位',
    showLocationAction: true,
    showLocationCandidates: false,
    locationCandidates: [],
    locationIssue: '',
    syncPhase: 'idle',
    syncTone: 'blue',
    syncMessage: '本地数据 · 尚未同步',
    syncActionLabel: '更新',
  },

  onLoad() {
    const initialState = catalog.getInitialHomeState();

    this._state = {
      lineId: initialState.lineId,
      direction: initialState.direction || 'forward',
      originStationId: initialState.originStationId,
      routeId: initialState.routeId,
    };
    this._systemOriginStationId = initialState.systemOriginStationId || initialState.originStationId;
    this._directionMode = initialState.directionMode || 'default';
    this._locationRequestToken = 0;
    this._hasConfirmedLocation = Boolean(initialState.lastLocationStation);
    this._feedback = createStationFeedback({
      soundEnabled: initialState.soundEnabled,
      vibrationEnabled: initialState.vibrationEnabled,
    });
    this._lastFeedbackIndex = null;
    this._unsubscribeSync = subscribeSyncState((event) => {
      if (!this._state || event.cityId !== SYNC_CITY_ID) return;
      this._updateSyncStatus();
      if (event.phase === 'success') {
        const currentLineIds = this._currentSyncLineIds();
        if ((event.lineIds || []).some((lineId) => currentLineIds.includes(lineId))) {
          this._refreshHomeView(this._visibleStationId(), { skipSync: true });
        }
      }
    });

    this.setData({
      lineOptions: normalizeLineOptions(catalog.getLineOptions()),
      isManualAnchor: initialState.originMode === 'manual',
      soundEnabled: initialState.soundEnabled !== false,
      vibrationEnabled: initialState.vibrationEnabled !== false,
      locationDataReady: stationLocationData.dataReady === true,
    });
    if (stationLocationData.dataReady !== true) {
      this._setLocationStatus('unavailable');
    } else if (initialState.lastLocationStation) {
      this._setLocationStatus('cached');
    }
    this._refreshHomeView();
  },

  onShow() {
    if (!this._state) return;

    const initialState = catalog.getInitialHomeState();
    this._state = {
      lineId: initialState.lineId,
      direction: initialState.direction,
      originStationId: initialState.originStationId,
      routeId: initialState.routeId,
    };
    this.setData({
      isManualAnchor: initialState.originMode === 'manual',
      soundEnabled: initialState.soundEnabled !== false,
      vibrationEnabled: initialState.vibrationEnabled !== false,
    });
    this._systemOriginStationId = initialState.systemOriginStationId || this._systemOriginStationId;
    this._directionMode = initialState.directionMode || this._directionMode;
    if (this._feedback) {
      this._feedback.updatePreferences({
        soundEnabled: initialState.soundEnabled,
        vibrationEnabled: initialState.vibrationEnabled,
      });
    }
    this._refreshHomeView(this._visibleStationId());
    this._startOperationalStatusClock();
  },

  onHide() {
    this._stopOperationalStatusClock();
  },

  onResize() {
    this._scheduleStationWheelLayout();
  },

  onUnload() {
    this._locationRequestToken += 1;
    if (this._syncTimer) clearTimeout(this._syncTimer);
    if (this._stationLayoutTimer) clearTimeout(this._stationLayoutTimer);
    this._stopOperationalStatusClock();
    if (this._unsubscribeSync) this._unsubscribeSync();
    if (this._feedback) this._feedback.destroy();
  },

  _setLocationStatus(status, issue) {
    const states = {
      unavailable: {
        label: '手动查询', action: '定位数据准备中', showAction: false,
      },
      notRequested: {
        label: '未定位', action: '开启定位', showAction: true,
      },
      cached: {
        label: '上次位置', action: '重新定位', showAction: true,
      },
      locating: {
        label: '正在定位…', action: '', showAction: false,
      },
      success: {
        label: '智能定位', action: '', showAction: false,
      },
      ambiguous: {
        label: '位置待确认', action: '查看候选', showAction: true,
      },
      unmatched: {
        label: '未匹配站点', action: '重新定位', showAction: true,
      },
      denied: {
        label: '未开启定位', action: '去开启', showAction: true,
      },
      failed: {
        label: '定位失败', action: '重新定位', showAction: true,
      },
    };
    const state = states[status] || states.failed;
    this.setData({
      locationStatus: status,
      locationLabel: state.label,
      locationActionLabel: state.action,
      showLocationAction: state.showAction,
      locationIssue: issue || '',
    });
  },

  _cancelPendingLocation() {
    if (this.data.locationStatus !== 'locating') return;
    this._locationRequestToken += 1;
    this._setLocationStatus(this._hasConfirmedLocation ? 'cached' : 'notRequested');
  },

  _buildHomeView() {
    return catalog.buildHomeView(Object.assign({}, this._state));
  },

  _getDirectionOptions(lineOption, routeId) {
    const option = lineOption || {};
    const route = (option.routes || []).find((item) => item.id === routeId);
    return (route && route.directions && route.directions.length)
      ? route.directions
      : (option.directions || []);
  },

  _refreshHomeView(preferredStationId, options) {
    const homeView = this._buildHomeView();
    const rawStations = homeView.stations || [];
    const preferredIndex = rawStations.findIndex((station) => station.id === preferredStationId);
    const currentIndex = preferredIndex >= 0
      ? preferredIndex
      : Math.min(Math.max(homeView.currentIndex || 0, 0), Math.max(rawStations.length - 1, 0));

    this._homeView = homeView;
    this._rawStations = rawStations;
    this._state.routeId = homeView.line.routeId || this._state.routeId;
    this._state.direction = homeView.direction || this._state.direction;
    this._state.originStationId = homeView.originStationId || this._state.originStationId;
    const lineOption = this.data.lineOptions.find((item) => item.id === this._state.lineId) || {};
    const routeOptions = lineOption.routes || [];

    const lineColor = getLineColor(homeView.line);
    this.setData({
      lineId: this._state.lineId,
      lineName: getLineName(homeView.line, this._state.lineId),
      lineColor,
      lineTextColor: getReadableLineColor(lineColor),
      directionLabel: homeView.directionLabel || '',
      originStationId: this._state.originStationId,
      originStationName: homeView.originStationName || '',
      routeId: this._state.routeId,
      routeOptions,
      showRouteSelector: lineOption.type === 'branched' && routeOptions.length > 1,
      currentIndex,
      motionCommitVersion: (this.data.motionCommitVersion || 0) + 1,
      stations: this._decorateStations(rawStations, currentIndex, lineColor),
    });
    this._lastFeedbackIndex = currentIndex;
    this._scheduleStationWheelLayout();
    this._updateSyncStatus();
    if (!(options && options.skipSync)) this._scheduleSyncForVisibleStation(0);
  },

  _scheduleStationWheelLayout() {
    if (!wx.createSelectorQuery) return;
    if (this._stationLayoutTimer) clearTimeout(this._stationLayoutTimer);
    this._stationLayoutTimer = setTimeout(() => {
      this._stationLayoutTimer = null;
      wx.createSelectorQuery().select('.station-swiper').boundingClientRect((rect) => {
        if (!rect || !rect.height) return;
        const stationPreviousMargin = `${Math.round(rect.height / 5)}px`;
        if (stationPreviousMargin !== this.data.stationPreviousMargin) {
          this.setData({ stationPreviousMargin });
        }
      }).exec();
    }, 0);
  },

  _decorateStations(stations, currentIndex, lineColor) {
    const overrideMaps = Object.create(null);
    const getOverride = (restroom) => {
      const lineId = restroom.lineId;
      if (!overrideMaps[lineId]) {
        overrideMaps[lineId] = getLineOverrides(lineId, {
          cityId: SYNC_CITY_ID,
          bundleSchema: SYNC_BUNDLE_SCHEMA,
        }).reduce((result, override) => {
          result[override.restroomId] = override;
          return result;
        }, Object.create(null));
      }
      return overrideMaps[lineId][restroom.id] || null;
    };
    return stations.map((station, index) => {
      const restrooms = (station.restrooms || []).map((restroom) => {
        const override = getOverride(restroom);
        const restroomStatus = override && override.restroomStatus;
        return Object.assign({}, restroom, {
          restroomStatus: restroomStatus || '',
          statusLabel: RESTROOM_STATUS_LABELS[restroomStatus] || '',
          statusReason: (override && override.reason) || '',
          hasOperationalIssue: Boolean(restroomStatus),
        });
      });
      const primaryRestroom = restrooms.find((restroom) => !restroom.hasOperationalIssue)
        || restrooms[0]
        || null;
      return Object.assign({}, station, {
        restrooms,
        primaryRestroom,
        restroomCount: restrooms.length,
        isActive: index === currentIndex,
        isBeforeFocus: index === currentIndex - 1,
        isAfterFocus: index === currentIndex + 1,
        showReverse: index === currentIndex && Boolean(station.isReverse),
        isOrigin: station.id === this._state.originStationId,
        isSystemOrigin: !this.data.isManualAnchor && station.id === this._systemOriginStationId,
        dotStyle: `border-color: ${lineColor};`,
      });
    });
  },

  _startOperationalStatusClock() {
    this._stopOperationalStatusClock();
    this._operationalStatusTimer = setInterval(() => {
      if (!this._rawStations) return;
      const stations = this._decorateStations(
        this._rawStations,
        this.data.currentIndex,
        this.data.lineColor,
      );
      const patch = { stations };
      if (this.data.showRestroomDrawer && this.data.drawerStation) {
        const drawerStation = stations.find(
          (station) => station.id === this.data.drawerStation.id,
        );
        if (drawerStation) {
          const drawerGroups = this._buildDrawerGroups(drawerStation.restrooms);
          patch.drawerStation = drawerStation;
          patch.drawerGroups = drawerGroups;
          patch.drawerRestrooms = drawerGroups.reduce(
            (result, group) => result.concat(group.restrooms),
            [],
          );
        }
      }
      this.setData(patch);
    }, OPERATIONAL_STATUS_REFRESH_MS);
  },

  _stopOperationalStatusClock() {
    if (!this._operationalStatusTimer) return;
    clearInterval(this._operationalStatusTimer);
    this._operationalStatusTimer = null;
  },

  _visibleStationId() {
    const station = this._rawStations && this._rawStations[this.data.currentIndex];
    return station && station.id;
  },

  _currentSyncLineIds() {
    const station = this._rawStations && this._rawStations[this.data.currentIndex];
    const lineIds = (station && station.syncLineIds && station.syncLineIds.length)
      ? station.syncLineIds.slice()
      : [this._state.lineId];
    const unique = lineIds.filter((lineId, index, all) => lineId && all.indexOf(lineId) === index);
    const app = getApp();
    app.globalData.activeSyncLineIds = unique.slice();
    return unique;
  },

  _updateSyncStatus() {
    if (!this._state || !this._rawStations) return;
    const status = getSyncStatus(this._currentSyncLineIds(), {
      cityId: SYNC_CITY_ID,
      bundleSchema: SYNC_BUNDLE_SCHEMA,
    });
    const presentation = this._buildHomeSyncPresentation(status);
    this.setData({
      syncPhase: status.phase,
      syncTone: presentation.tone,
      syncMessage: presentation.message,
      syncActionLabel: presentation.actionLabel,
    });
  },

  _buildHomeSyncPresentation(status, nowMs) {
    const input = status || {};
    const isChecking = input.phase === 'checking';
    const isFresh = input.tone === 'green'
      || (isChecking && this.data.syncTone === 'green');
    const timeLabel = formatHomeSyncTime(input.lastAlignedAt, nowMs);
    return {
      tone: isFresh ? 'green' : 'blue',
      message: isFresh
        ? `已同步${timeLabel ? ` · ${timeLabel}` : ''}`
        : `本地数据${timeLabel ? ` · 上次 ${timeLabel}` : ' · 尚未同步'}`,
      actionLabel: isChecking ? '更新中' : (input.phase === 'failed' ? '重试' : '更新'),
    };
  },

  _scheduleSyncForVisibleStation(delayMs) {
    if (this._syncTimer) clearTimeout(this._syncTimer);
    this._syncTimer = setTimeout(() => {
      this._syncTimer = null;
      const app = getApp();
      if (!app.globalData.cloudReady) return;
      const lineIds = this._currentSyncLineIds();
      syncLines(lineIds, {
        mode: 'auto',
        cityId: SYNC_CITY_ID,
        bundleSchema: SYNC_BUNDLE_SCHEMA,
      }).then(() => this._updateSyncStatus());
    }, Math.max(0, Number(delayMs) || 0));
  },

  onRefreshSync() {
    if (this.data.syncPhase === 'checking') return;
    const app = getApp();
    if (!app.globalData.cloudReady) {
      wx.showToast({ title: '当前无法连接云端', icon: 'none' });
      return;
    }
    syncLines(this._currentSyncLineIds(), {
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

  _saveCurrentPreferences(patch) {
    savePreferences(Object.assign({
      lineId: this._state.lineId,
      direction: this._state.direction,
      originStationId: this._state.originStationId,
      routeId: this._state.routeId,
      originMode: this.data.isManualAnchor ? 'manual' : 'smart',
      directionMode: this._directionMode || 'default',
    }, patch || {}));
  },

  _addRecentRecord(station, action) {
    if (!station) return;

    addRecentRecord({
      lineId: this._state.lineId,
      lineName: this.data.lineName,
      stationId: station.id,
      stationName: station.name,
      direction: this._state.direction,
      routeId: this._state.routeId,
      action,
    });
  },

  _playStationFeedback(index) {
    if (index === this._lastFeedbackIndex) return;
    this._lastFeedbackIndex = index;
    if (this._feedback) this._feedback.play();
  },

  _getReadableLineColor(color) {
    return getReadableLineColor(color);
  },

  onStationAnimationFinish(payload) {
    const detail = payload && payload.detail ? payload.detail : (payload || {});
    const rawIndex = detail.currentIndex !== undefined ? detail.currentIndex : detail.current;
    const parsedIndex = Number(rawIndex);
    const currentIndex = Math.min(
      Math.max(Number.isFinite(parsedIndex) ? parsedIndex : this.data.currentIndex, 0),
      Math.max((this._rawStations || []).length - 1, 0),
    );
    const changed = currentIndex !== this.data.currentIndex;
    const patch = {
      motionCommitVersion: (this.data.motionCommitVersion || 0) + 1,
    };
    if (changed) {
      patch.currentIndex = currentIndex;
      patch.stations = this._decorateStations(this._rawStations, currentIndex, this.data.lineColor);
    }
    this.setData(patch);
    if (!changed) return;
    this._playStationFeedback(currentIndex);
    this._updateSyncStatus();
    this._scheduleSyncForVisibleStation(320);
  },

  onWheelHorizontalSwipe(payload) {
    const deltaX = Number(payload && payload.deltaX) || 0;
    const deltaY = Number(payload && payload.deltaY) || 0;
    if (Math.abs(deltaX) < TRANSFER_SWIPE_PX
      || Math.abs(deltaX) <= Math.abs(deltaY) * HORIZONTAL_GESTURE_RATIO) return;

    const station = (this._rawStations || []).find(
      (item) => item.id === ((payload && payload.stationId) || this._visibleStationId()),
    );
    const transfers = station && station.transfers || [];
    if (!transfers.length) return;

    const transfer = this._getAdjacentTransfer(transfers, deltaX < 0 ? 1 : -1);
    if (transfer) this._switchToTransfer(transfer);
  },

  onWheelTouchStart(event) {
    const touch = event.touches && event.touches[0];
    this._wheelTouchGesture = touch
      ? {
        startX: touch.clientX,
        startY: touch.clientY,
        lastX: touch.clientX,
        lastY: touch.clientY,
        axis: 'pending',
        sourceStationId: this._visibleStationId(),
      }
      : null;
  },

  onWheelTouchMove(event) {
    const touch = event.touches && event.touches[0];
    const gesture = this._wheelTouchGesture;
    if (!touch || !gesture) return;
    gesture.lastX = touch.clientX;
    gesture.lastY = touch.clientY;
    if (gesture.axis !== 'pending') return;
    const deltaX = touch.clientX - gesture.startX;
    const deltaY = touch.clientY - gesture.startY;
    if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) < GESTURE_DECISION_PX) return;
    if (Math.abs(deltaX) > Math.abs(deltaY) * HORIZONTAL_GESTURE_RATIO) {
      gesture.axis = 'horizontal';
    } else if (Math.abs(deltaY) > Math.abs(deltaX) * HORIZONTAL_GESTURE_RATIO) {
      gesture.axis = 'vertical';
    }
  },

  onWheelTouchEnd(event) {
    this._finishWheelTouch(event);
  },

  onWheelTouchCancel(event) {
    this._finishWheelTouch(event);
  },

  _finishWheelTouch(event) {
    const gesture = this._wheelTouchGesture;
    const touch = event && event.changedTouches && event.changedTouches[0];
    this._wheelTouchGesture = null;
    if (!gesture) return;
    const endX = touch ? touch.clientX : gesture.lastX;
    const endY = touch ? touch.clientY : gesture.lastY;
    this.onWheelHorizontalSwipe({
      deltaX: endX - gesture.startX,
      deltaY: endY - gesture.startY,
      stationId: gesture.sourceStationId,
    });
  },

  _getAdjacentTransfer(transfers, step) {
    const currentLineId = this._state && this._state.lineId;
    const transferList = (transfers || []).filter(
      (transfer, index, all) => transfer && transfer.lineId
        && transfer.lineId !== currentLineId
        && all.findIndex((item) => item.lineId === transfer.lineId) === index,
    );
    if (!currentLineId || !transferList.length) return null;

    const lineIds = [currentLineId].concat(transferList.map((transfer) => transfer.lineId))
      .sort((left, right) => String(left).localeCompare(String(right), 'zh-CN', { numeric: true }));
    const currentIndex = lineIds.indexOf(currentLineId);
    const offset = step < 0 ? -1 : 1;
    const targetLineId = lineIds[(currentIndex + offset + lineIds.length) % lineIds.length];
    return transferList.find((transfer) => transfer.lineId === targetLineId) || null;
  },

  onSelectTransferLine(event) {
    const dataset = (event.currentTarget && event.currentTarget.dataset) || {};
    const station = (this._rawStations || []).find((item) => item.id === this._visibleStationId());
    if (!station) return;
    const targetStationId = dataset.transferStationId || dataset.stationId;
    const transfer = (station.transfers || []).find((item) => (
      item.lineId === dataset.lineId
      && (!targetStationId || item.stationId === targetStationId)
    ));
    if (transfer) this._switchToTransfer(transfer);
  },

  _switchToTransfer(transfer) {
    const option = this.data.lineOptions.find((item) => item.id === transfer.lineId);
    if (!option) return;

    this._cancelPendingLocation();
    this._state.lineId = option.id;
    this._state.direction = option.defaultDirection
      || (option.directions && option.directions[0] && option.directions[0].id)
      || 'forward';
    this._state.routeId = option.type === 'branched' ? '' : option.defaultRouteId;
    this._refreshHomeView(transfer.stationId);
    this._saveCurrentPreferences();
    this._addRecentRecord(this._rawStations[this.data.currentIndex], '换乘浏览');
    wx.showToast({ title: `已切换至${option.name}`, icon: 'none' });
  },

  onOpenLinePicker() {
    this.setData({ showLinePicker: true });
  },

  onCloseLinePicker() {
    this.setData({ showLinePicker: false });
  },

  onSelectLine(event) {
    const lineId = event.currentTarget.dataset.lineId;
    const option = this.data.lineOptions.find((item) => item.id === lineId) || {};
    const visibleStationId = this._visibleStationId();

    this._cancelPendingLocation();
    this._state.lineId = lineId;
    this._state.direction = option.defaultDirection
      || (option.directions && option.directions[0] && option.directions[0].id)
      || 'forward';
    this._state.routeId = option.type === 'branched' ? '' : option.defaultRouteId;
    this.setData({ showLinePicker: false });
    this._refreshHomeView(visibleStationId);
    this._saveCurrentPreferences();
    this._addRecentRecord(this._rawStations[this.data.currentIndex], '切换线路');
  },

  onOpenCityPicker() {
    this.setData({ showCityPicker: true });
  },

  onCloseCityPicker() {
    this.setData({ showCityPicker: false });
  },

  onSelectCity() {
    this.setData({ showCityPicker: false });
  },

  onOpenStationPicker() {
    this.setData({ showStationPicker: true });
  },

  onCloseStationPicker() {
    this.setData({ showStationPicker: false });
  },

  onSelectOriginStation(event) {
    const originStationId = event.currentTarget.dataset.stationId;
    this._cancelPendingLocation();
    this._state.originStationId = originStationId;
    this.setData({ isManualAnchor: true, showStationPicker: false });
    this._refreshHomeView(originStationId);
    this._saveCurrentPreferences({ originMode: 'manual' });
    this._addRecentRecord(this._rawStations[this.data.currentIndex], '设置起点');
    wx.showToast({ title: `已从 ${this.data.originStationName} 开始计算`, icon: 'none' });
  },

  onSetManualAnchor(event) {
    const dataset = (event.currentTarget && event.currentTarget.dataset) || {};
    const originStationId = dataset.stationId;
    const originStation = (this._rawStations || []).find(
      (station) => station.id === originStationId,
    );
    if (!originStation) return;

    const visibleStationId = this._visibleStationId();
    this._cancelPendingLocation();
    this._state.originStationId = originStationId;
    this.setData({ isManualAnchor: true });
    this._refreshHomeView(visibleStationId || originStationId);
    this._saveCurrentPreferences({ originMode: 'manual' });
    this._addRecentRecord(originStation, '设置起点');
    wx.showToast({ title: `已从 ${originStation.name} 开始计算`, icon: 'none' });
  },

  onRestoreSmartLocation() {
    this.onRequestLocation();
  },

  onLocationAction() {
    if (this.data.locationStatus === 'ambiguous' && this.data.locationCandidates.length) {
      this.setData({ showLocationCandidates: true });
      return;
    }
    if (this.data.locationStatus === 'denied'
      && this.data.locationIssue === 'permissionDenied') {
      openLocationSettings(wx).then((enabled) => {
        if (!enabled) {
          wx.showToast({ title: '可继续手动查询', icon: 'none' });
          return;
        }
        this.onRequestLocation();
      });
      return;
    }
    this.onRequestLocation();
  },

  onRequestLocation() {
    if (stationLocationData.dataReady !== true || !(stationLocationData.stations || []).length) {
      wx.showToast({ title: '站点定位数据准备中', icon: 'none' });
      return;
    }

    const requestToken = this._locationRequestToken + 1;
    this._locationRequestToken = requestToken;
    this._setLocationStatus('locating');
    requestCurrentPosition(wx).then((result) => {
      if (requestToken !== this._locationRequestToken) return;

      if (!result.ok) {
        this._setLocationStatus(result.status, result.issue);
        return;
      }

      const match = rankNearbyStations(result.position, stationLocationData.stations);
      if (match.status === 'unmatched') {
        this._setLocationStatus('unmatched');
        return;
      }
      if (match.status !== 'success' && match.status !== 'ambiguous') {
        this._setLocationStatus('failed');
        return;
      }

      const candidates = match.candidates.reduce((all, candidate) => (
        all.concat(catalog.getLocationCandidateOptions(candidate))
      ), []).map((candidate) => Object.assign({}, candidate, {
        distanceLabel: candidate.distanceMeters < 1000
          ? `约 ${candidate.distanceMeters} 米`
          : `约 ${(candidate.distanceMeters / 1000).toFixed(1)} 公里`,
      }));

      if (candidates.length !== 1) {
        this.setData({
          locationCandidates: candidates,
          showLocationCandidates: true,
        });
        this._setLocationStatus('ambiguous');
        return;
      }

      this._applyLocationCandidate(candidates[0]);
    }).catch(() => {
      if (requestToken === this._locationRequestToken) this._setLocationStatus('failed');
    });
  },

  _applyLocationCandidate(candidate) {
    if (!candidate || !candidate.lineStationId) return;

    this._systemOriginStationId = candidate.lineStationId;
    this._hasConfirmedLocation = true;
    this._directionMode = 'default';
    this._state.lineId = candidate.lineId;
    this._state.routeId = candidate.routeId;
    this._state.direction = candidate.direction;
    this._state.originStationId = candidate.lineStationId;
    saveLastLocationStation({
      lineStationId: candidate.lineStationId,
      physicalStationId: candidate.physicalStationId,
    });
    this.setData({
      isManualAnchor: false,
      showLocationCandidates: false,
      locationCandidates: [],
    });
    this._refreshHomeView(candidate.lineStationId);
    this._saveCurrentPreferences({ originMode: 'smart', directionMode: 'default' });
    this._setLocationStatus('success');
    wx.showToast({ title: `已定位到${candidate.stationName}`, icon: 'none' });
  },

  onSelectLocationCandidate(event) {
    const lineStationId = event.currentTarget.dataset.stationId;
    const candidate = this.data.locationCandidates.find(
      (item) => item.lineStationId === lineStationId,
    );
    this._applyLocationCandidate(candidate);
  },

  onCloseLocationCandidates() {
    this.setData({ showLocationCandidates: false });
  },

  onChooseManualLocation() {
    this.setData({
      showLocationCandidates: false,
      showStationPicker: true,
    });
  },

  onSwitchDirection() {
    const visibleStationId = this._visibleStationId();
    const lineOption = this.data.lineOptions.find((item) => item.id === this._state.lineId) || {};
    const directions = this._getDirectionOptions(lineOption, this._state.routeId);
    const directionIndex = directions.findIndex((item) => item.id === this._state.direction);
    const nextDirection = directions.length > 1
      ? directions[(directionIndex + 1) % directions.length]
      : null;

    if (!nextDirection) {
      return;
    }

    this._cancelPendingLocation();
    this._state.direction = nextDirection.id;
    this._directionMode = 'manual';
    this._refreshHomeView(visibleStationId);
    this._saveCurrentPreferences({ directionMode: 'manual' });
  },

  onSelectRoute(event) {
    const routeId = event.currentTarget.dataset.routeId;
    if (!routeId || routeId === this._state.routeId) return;

    this._cancelPendingLocation();
    const visibleStationId = this._visibleStationId();
    const visibleStation = (this._rawStations || []).find((item) => item.id === visibleStationId);
    const lineOption = this.data.lineOptions.find((item) => item.id === this._state.lineId) || {};
    const routeOption = (lineOption.routes || []).find((item) => item.id === routeId) || {};
    const keepVisibleStation = visibleStation
      && (routeOption.stationNames || []).includes(visibleStation.name);
    const directions = this._getDirectionOptions(lineOption, routeId);
    if (!directions.some((item) => item.id === this._state.direction)) {
      this._state.direction = (directions[0] && directions[0].id) || this._state.direction;
    }
    this._state.routeId = routeId;
    this._refreshHomeView(keepVisibleStation ? visibleStationId : null);
    if (!keepVisibleStation && routeOption.splitStationName) {
      const splitStation = (this._rawStations || []).find(
        (station) => station.name === routeOption.splitStationName,
      );
      if (splitStation) this._refreshHomeView(splitStation.id);
      wx.showToast({ title: `已回到${routeOption.splitStationName}`, icon: 'none' });
    }
    this._saveCurrentPreferences();
  },

  onOpenRestroomDrawer(event) {
    const stationId = event.currentTarget.dataset.stationId;
    const station = (this.data.stations || []).find((item) => item.id === stationId);
    if (!station || !(station.restrooms || []).length) return;
    const drawerGroups = this._buildDrawerGroups(station.restrooms);

    this.setData({
      showRestroomDrawer: true,
      drawerStation: station,
      drawerGroups,
      drawerRestrooms: drawerGroups.reduce(
        (result, group) => result.concat(group.restrooms),
        [],
      ),
    });
    this._addRecentRecord(station, '查看厕所');
  },

  _buildDrawerGroups(restrooms) {
    const lineOptions = this.data.lineOptions || [];
    const groupsByLine = Object.create(null);
    (restrooms || []).forEach((restroom) => {
      const lineId = String(restroom.lineId || '');
      if (!lineId) return;
      const lineOption = lineOptions.find((item) => item.id === lineId) || {};
      if (!groupsByLine[lineId]) {
        const lineColor = lineOption.color || '#1677ff';
        groupsByLine[lineId] = {
          lineId,
          lineName: lineOption.name || restroom.lineName || `${lineId}号线`,
          lineColor,
          lineTextColor: lineOption.textColor || getReadableLineColor(lineColor),
          isCurrent: lineId === this._state.lineId,
          restrooms: [],
        };
      }
      groupsByLine[lineId].restrooms.push(Object.assign({}, restroom, {
        lineId,
        lineName: restroom.lineName || groupsByLine[lineId].lineName,
      }));
    });
    return Object.keys(groupsByLine).map((lineId) => groupsByLine[lineId]).sort((left, right) => {
      if (left.isCurrent !== right.isCurrent) return left.isCurrent ? -1 : 1;
      return left.lineId.localeCompare(right.lineId, 'zh-CN', { numeric: true });
    });
  },

  onCloseRestroomDrawer() {
    this.setData({ showRestroomDrawer: false });
  },

  onCorrectRestroom(event) {
    const dataset = (event.currentTarget && event.currentTarget.dataset) || {};
    const stationId = dataset.stationId || (this.data.drawerStation && this.data.drawerStation.id);
    const station = (this._rawStations || []).find((item) => item.id === stationId)
      || this.data.drawerStation;
    if (!station) return;
    const restroom = (station.restrooms || []).find((item) => item.id === dataset.restroomId)
      || station.primaryRestroom
      || (station.restrooms || [])[0];
    if (!restroom) return;
    if (!restroom.lineId) return;

    const app = getApp();
    app.globalData.pendingCorrectionContext = {
      lineId: String(restroom.lineId),
      stationId: String(restroom.stationId || ''),
      restroomId: restroom.id,
    };
    this.setData({ showRestroomDrawer: false });
    wx.navigateTo({ url: '/pages/correction/index' });
  },

  onStopPropagation() {},
});
