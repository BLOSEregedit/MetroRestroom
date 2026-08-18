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

function getLineName(line, lineId) {
  if (typeof line === 'string') return line;
  return (line && (line.name || line.label || line.title)) || lineId || '线路';
}

function getLineColor(line) {
  return (line && line.color) || '#1677ff';
}

function normalizeLineOptions(options) {
  return (options || []).map((option) => {
    if (typeof option === 'string') return { id: option, name: option };
    return Object.assign({}, option, {
      id: option.id || option.lineId,
      name: option.name || option.label || option.title || option.id || option.lineId,
    });
  });
}

Page({
  data: {
    cityName: '上海',
    lineId: '',
    routeId: '',
    lineName: '',
    lineColor: '#1677ff',
    directionLabel: '',
    originStationId: '',
    originStationName: '',
    stations: [],
    currentIndex: 0,
    isManualAnchor: false,
    soundEnabled: true,
    vibrationEnabled: true,
    showLinePicker: false,
    showStationPicker: false,
    showRestroomDrawer: false,
    lineOptions: [],
    routeOptions: [],
    showRouteSelector: false,
    drawerStation: null,
    drawerRestrooms: [],
    locationDataReady: false,
    locationStatus: 'notRequested',
    locationLabel: '尚未开启定位',
    locationActionLabel: '开启智能定位',
    showLocationAction: true,
    showLocationCandidates: false,
    locationCandidates: [],
    locationIssue: '',
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
  },

  onUnload() {
    this._locationRequestToken += 1;
    if (this._feedback) this._feedback.destroy();
  },

  _setLocationStatus(status, issue) {
    const states = {
      unavailable: {
        label: '手动查询', action: '定位数据准备中', showAction: false,
      },
      notRequested: {
        label: '尚未开启定位', action: '开启智能定位', showAction: true,
      },
      cached: {
        label: '上次位置', action: '重新定位', showAction: true,
      },
      locating: {
        label: '正在定位…', action: '', showAction: false,
      },
      success: {
        label: '智能定位', action: '重新定位', showAction: true,
      },
      ambiguous: {
        label: '位置需要确认', action: '查看候选', showAction: true,
      },
      unmatched: {
        label: '附近未匹配到地铁站', action: '重新定位', showAction: true,
      },
      denied: {
        label: '未开启定位', action: '去开启定位', showAction: true,
      },
      failed: {
        label: '定位失败，仍可手动查询', action: '重新定位', showAction: true,
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

  _refreshHomeView(preferredStationId) {
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

    this.setData({
      lineId: this._state.lineId,
      lineName: getLineName(homeView.line, this._state.lineId),
      lineColor: getLineColor(homeView.line),
      directionLabel: homeView.directionLabel || '',
      originStationId: this._state.originStationId,
      originStationName: homeView.originStationName || '',
      routeId: this._state.routeId,
      routeOptions,
      showRouteSelector: lineOption.type === 'branched' && routeOptions.length > 1,
      currentIndex,
      stations: this._decorateStations(rawStations, currentIndex, getLineColor(homeView.line)),
    });
    this._lastFeedbackIndex = currentIndex;
  },

  _decorateStations(stations, currentIndex, lineColor) {
    return stations.map((station, index) => {
      const restrooms = station.restrooms || [];
      return Object.assign({}, station, {
        restrooms,
        primaryRestroom: restrooms[0] || null,
        restroomCount: restrooms.length,
        isActive: index === currentIndex,
        isOrigin: station.id === this._state.originStationId,
        isSystemOrigin: !this.data.isManualAnchor && station.id === this._systemOriginStationId,
        dotStyle: `border-color: ${lineColor}; background-color: ${!this.data.isManualAnchor && station.id === this._systemOriginStationId ? lineColor : '#f6f7f8'};`,
      });
    });
  },

  _visibleStationId() {
    const station = this._rawStations && this._rawStations[this.data.currentIndex];
    return station && station.id;
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

  onStationChange(event) {
    const currentIndex = event.detail.current;
    this.setData({
      currentIndex,
      stations: this._decorateStations(this._rawStations, currentIndex, this.data.lineColor),
    });
    this._playStationFeedback(currentIndex);
  },

  onWheelTouchStart(event) {
    const touch = event.touches && event.touches[0];
    this._wheelTouchStart = touch
      ? { x: touch.clientX, y: touch.clientY }
      : null;
  },

  onWheelTouchEnd(event) {
    const touch = event.changedTouches && event.changedTouches[0];
    const start = this._wheelTouchStart;
    this._wheelTouchStart = null;
    if (!touch || !start) return;

    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;
    if (Math.abs(deltaX) < 48 || Math.abs(deltaX) <= Math.abs(deltaY) * 1.2) return;

    const station = this._rawStations && this._rawStations[this.data.currentIndex];
    const transfers = station && station.transfers || [];
    if (!transfers.length) return;

    const transferIndex = deltaX < 0 ? 0 : transfers.length - 1;
    this._switchToTransfer(transfers[transferIndex]);
  },

  _switchToTransfer(transfer) {
    const option = this.data.lineOptions.find((item) => item.id === transfer.lineId);
    if (!option) return;

    this._cancelPendingLocation();
    this._state.lineId = option.id;
    this._state.direction = option.defaultDirection
      || (option.directions[0] && option.directions[0].id)
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
    const originStationId = event.currentTarget.dataset.stationId;
    const visibleStationId = this._visibleStationId();
    this._cancelPendingLocation();
    this._state.originStationId = originStationId;
    this.setData({ isManualAnchor: true });
    this._refreshHomeView(visibleStationId || originStationId);
    this._saveCurrentPreferences({ originMode: 'manual' });
    this._addRecentRecord(
      (this._rawStations || []).find((station) => station.id === originStationId),
      '设置起点',
    );
    wx.showToast({ title: `已从 ${this.data.originStationName} 开始计算`, icon: 'none' });
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
    const station = (this._rawStations || []).find((item) => item.id === stationId);
    if (!station || !(station.restrooms || []).length) return;

    this.setData({
      showRestroomDrawer: true,
      drawerStation: station,
      drawerRestrooms: station.restrooms,
    });
    this._addRecentRecord(station, '查看厕所');
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

    const app = getApp();
    app.globalData.pendingCorrectionContext = {
      lineId: restroom.lineId || this._state.lineId,
      stationId: String(restroom.id || '').replace(/-restroom$/, ''),
      restroomId: restroom.id,
    };
    this.setData({ showRestroomDrawer: false });
    wx.navigateTo({ url: '/pages/correction/index' });
  },

  onStopPropagation() {},
});
