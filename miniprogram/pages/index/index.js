const prototype = require('../../data/prototype');
const { createStationFeedback } = require('../../utils/feedback');
const {
  addRecentRecord,
  savePreferences,
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
    return {
      ...option,
      id: option.id || option.lineId,
      name: option.name || option.label || option.title || option.id || option.lineId,
    };
  });
}

Page({
  data: {
    cityName: '上海',
    lineId: '',
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
    drawerStation: null,
    drawerRestrooms: [],
  },

  onLoad() {
    const initialState = prototype.getInitialHomeState();

    this._state = {
      lineId: initialState.lineId,
      direction: initialState.direction || 'forward',
      originStationId: initialState.originStationId,
      routeId: initialState.routeId,
    };
    this._systemOriginStationId = initialState.systemOriginStationId || initialState.originStationId;
    this._feedback = createStationFeedback({
      soundEnabled: initialState.soundEnabled,
      vibrationEnabled: initialState.vibrationEnabled,
    });
    this._lastFeedbackIndex = null;

    this.setData({
      lineOptions: normalizeLineOptions(prototype.getLineOptions()),
      isManualAnchor: initialState.originMode === 'manual',
      soundEnabled: initialState.soundEnabled !== false,
      vibrationEnabled: initialState.vibrationEnabled !== false,
    });
    this._refreshHomeView();
  },

  onShow() {
    if (!this._state) return;

    const initialState = prototype.getInitialHomeState();
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
    if (this._feedback) {
      this._feedback.updatePreferences({
        soundEnabled: initialState.soundEnabled,
        vibrationEnabled: initialState.vibrationEnabled,
      });
    }
    this._refreshHomeView(this._visibleStationId());
  },

  onUnload() {
    if (this._feedback) this._feedback.destroy();
  },

  _buildHomeView() {
    return prototype.buildHomeView({ ...this._state });
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
    this._state.originStationId = homeView.originStationId || this._state.originStationId;

    this.setData({
      lineId: this._state.lineId,
      lineName: getLineName(homeView.line, this._state.lineId),
      lineColor: getLineColor(homeView.line),
      directionLabel: homeView.directionLabel || '',
      originStationId: this._state.originStationId,
      originStationName: homeView.originStationName || '',
      currentIndex,
      stations: this._decorateStations(rawStations, currentIndex, getLineColor(homeView.line)),
    });
    this._lastFeedbackIndex = currentIndex;
  },

  _decorateStations(stations, currentIndex, lineColor) {
    return stations.map((station, index) => {
      const restrooms = station.restrooms || [];
      return {
        ...station,
        restrooms,
        primaryRestroom: restrooms[0] || null,
        restroomCount: restrooms.length,
        isActive: index === currentIndex,
        isOrigin: station.id === this._state.originStationId,
        isSystemOrigin: !this.data.isManualAnchor && station.id === this._systemOriginStationId,
        dotStyle: `border-color: ${lineColor}; background-color: ${!this.data.isManualAnchor && station.id === this._systemOriginStationId ? lineColor : '#f6f7f8'};`,
      };
    });
  },

  _visibleStationId() {
    const station = this._rawStations && this._rawStations[this.data.currentIndex];
    return station && station.id;
  },

  _saveCurrentPreferences(patch) {
    savePreferences({
      lineId: this._state.lineId,
      direction: this._state.direction,
      originStationId: this._state.originStationId,
      routeId: this._state.routeId,
      originMode: this.data.isManualAnchor ? 'manual' : 'smart',
      ...(patch || {}),
    });
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

    this._state.lineId = option.id;
    this._state.direction = option.directions[0].id;
    this._state.routeId = option.defaultRouteId;
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

    this._state.lineId = lineId;
    this._state.direction = (option.directions && option.directions[0] && option.directions[0].id) || 'forward';
    this._state.routeId = option.defaultRouteId;
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
    if (!this._systemOriginStationId) {
      wx.showToast({ title: '暂时无法恢复智能定位', icon: 'none' });
      return;
    }

    const visibleStationId = this._visibleStationId();
    this._state.originStationId = this._systemOriginStationId;
    this.setData({ isManualAnchor: false });
    this._refreshHomeView(visibleStationId || this._systemOriginStationId);
    this._saveCurrentPreferences({ originMode: 'smart' });
  },

  onSwitchDirection() {
    const visibleStationId = this._visibleStationId();
    const lineOption = this.data.lineOptions.find((item) => item.id === this._state.lineId) || {};
    const directions = lineOption.directions || [];
    const directionIndex = directions.findIndex((item) => item.id === this._state.direction);
    const nextDirection = directions.length > 1
      ? directions[(directionIndex + 1) % directions.length]
      : null;

    if (!nextDirection) {
      return;
    }

    this._state.direction = nextDirection.id;
    this._refreshHomeView(visibleStationId);
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

  onCorrectRestroom() {
    const station = this.data.drawerStation;
    wx.showModal({
      title: '反馈数据问题',
      content: station
        ? `已带入${this.data.lineName}、${station.name}和当前厕所信息。纠错提交将在云开发阶段接入。`
        : '纠错提交将在云开发阶段接入。',
      showCancel: false,
    });
  },

  onStopPropagation() {},
});
