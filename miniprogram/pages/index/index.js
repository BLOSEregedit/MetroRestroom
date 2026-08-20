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
const {
  clamp,
  clampWheelVelocity,
  getCardMotion,
  getDetentIndex,
} = require('../../utils/wheel-physics');

const workletApi = typeof wx !== 'undefined' && wx.worklet ? wx.worklet : null;
const runOnJS = workletApi && workletApi.runOnJS;
const scrollViewContext = workletApi && workletApi.scrollViewContext;

const SYNC_CITY_ID = 'shanghai';
const SYNC_BUNDLE_SCHEMA = 1;
const OPERATIONAL_STATUS_REFRESH_MS = 60 * 1000;
const TRANSFER_SWIPE_PX = 48;
const HORIZONTAL_GESTURE_RATIO = 1.2;
const WHEEL_VISIBLE_SLOTS = 5;
const WHEEL_BOTTOM_SPACER_SLOTS = 3;
const WHEEL_CANDIDATE_ENTER_DISTANCE = .55;
const WHEEL_CANDIDATE_EXIT_DISTANCE = .45;
const WHEEL_TOUCH_DEAD_DISTANCE = .1;
const WHEEL_DIRECTION_SPEED = 1;
const WHEEL_FLING_SPEED = 4;
const WHEEL_SNAP_MIN_DURATION_MS = 140;
const WHEEL_SNAP_MAX_DURATION_MS = 220;
const WHEEL_SNAP_ERROR_DISTANCE = .01;
const WHEEL_PHASE_IDLE = 0;
const WHEEL_PHASE_DRAGGING = 1;
const WHEEL_PHASE_DECELERATING = 2;
const WHEEL_PHASE_SNAPPING = 3;
const WHEEL_PHASE_RESETTING = 4;
const WHEEL_PHASE_REBASING = 5;
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
    navigationBarHeight: 64,
    statusBarHeight: 20,
    wheelSlotHeight: 64,
    wheelTopSpacerHeight: 64,
    wheelBottomSpacerHeight: 192,
    wheelScrollTop: 0,
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
    const navigationMetrics = this._getNavigationMetrics();

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
    this._initializeWheelWorklet();
    this._wheelFeedbackSequence = 0;
    this._wheelSettledSession = -1;
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
      navigationBarHeight: navigationMetrics.navigationBarHeight,
      statusBarHeight: navigationMetrics.statusBarHeight,
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
    if (this._feedback) this._feedback.reset();
  },

  onResize() {
    this._scheduleStationWheelLayout();
  },

  onUnload() {
    this._locationRequestToken += 1;
    if (this._syncTimer) clearTimeout(this._syncTimer);
    if (this._stationLayoutTimer) clearTimeout(this._stationLayoutTimer);
    if (this._wheelSnapTimer) clearTimeout(this._wheelSnapTimer);
    this._clearStationAnimatedStyles();
    this._stopOperationalStatusClock();
    if (this._unsubscribeSync) this._unsubscribeSync();
    if (this._feedback) this._feedback.destroy();
  },

  _getNavigationMetrics() {
    let statusBarHeight = 20;
    try {
      const windowInfo = wx.getWindowInfo
        ? wx.getWindowInfo()
        : (wx.getSystemInfoSync ? wx.getSystemInfoSync() : {});
      statusBarHeight = Number(windowInfo.statusBarHeight) || statusBarHeight;
      if (wx.getMenuButtonBoundingClientRect) {
        const menu = wx.getMenuButtonBoundingClientRect();
        const contentHeight = menu.height + (2 * Math.max(menu.top - statusBarHeight, 0));
        return {
          statusBarHeight,
          navigationBarHeight: statusBarHeight + Math.max(contentHeight, 44),
        };
      }
    } catch (error) {
      // 无法读取胶囊尺寸时使用微信导航栏的通用高度。
    }
    return { statusBarHeight, navigationBarHeight: statusBarHeight + 44 };
  },

  _initializeWheelWorklet() {
    if (!workletApi || typeof workletApi.shared !== 'function') return;
    this._wheelPosition = workletApi.shared(0);
    this._wheelSlotHeight = workletApi.shared(1);
    this._wheelMaxIndex = workletApi.shared(0);
    this._wheelDetentIndex = workletApi.shared(0);
    this._wheelSuppressDetents = workletApi.shared(1);
    this._wheelSnapping = workletApi.shared(0);
    this._wheelPhase = workletApi.shared(WHEEL_PHASE_RESETTING);
    this._wheelSettledIndex = workletApi.shared(0);
    this._wheelCandidateIndex = workletApi.shared(0);
    this._wheelGestureStartPosition = workletApi.shared(0);
    this._wheelLastPosition = workletApi.shared(0);
    this._wheelLastDirection = workletApi.shared(0);
    this._wheelReleaseVelocity = workletApi.shared(0);
    this._wheelSnapTarget = workletApi.shared(-1);
    this._wheelSnapAttempts = workletApi.shared(0);
    this._wheelSession = workletApi.shared(0);
    this._wheelSequence = workletApi.shared(0);
    this._wheelScrollRef = workletApi.shared();
    this._wheelHorizontalX = workletApi.shared(0);
    this._wheelHorizontalY = workletApi.shared(0);
  },

  _clearStationAnimatedStyles() {
    if (typeof this.clearAnimatedStyle !== 'function') return;
    const count = Number(this._boundStationStyleCount) || 0;
    for (let index = 0; index < count; index += 1) {
      try {
        this.clearAnimatedStyle(`#station-card-${index}`);
      } catch (error) {
        // 节点已被线路切换移除时无需额外处理。
      }
    }
    this._boundStationStyleCount = 0;
  },

  _bindStationAnimatedStyles(count) {
    if (!this._wheelPosition || typeof this.applyAnimatedStyle !== 'function') return;
    this._clearStationAnimatedStyles();
    const position = this._wheelPosition;
    const slotHeight = this._wheelSlotHeight;
    const stationCount = Math.max(0, Number(count) || 0);

    for (let index = 0; index < stationCount; index += 1) {
      const stationIndex = index;
      try {
        this.applyAnimatedStyle(`#station-card-${stationIndex}`, () => {
          'worklet';
          const motion = getCardMotion(stationIndex - position.value, slotHeight.value);
          return {
            transform: `translateY(${motion.translateY}px) scale3d(${motion.scaleX},${motion.scaleY},1)`,
            zIndex: 1 + Math.round(motion.focus * 10),
          };
        });
      } catch (error) {
        // 极短线路切换窗口中节点可能尚未挂载，下一次布局会重新绑定。
      }
    }
    this._boundStationStyleCount = stationCount;

    if (!this._wheelScrollRef || typeof this.createSelectorQuery !== 'function') return;
    this.createSelectorQuery().select('.station-wheel-scroll').ref((result) => {
      if (result && result.ref) this._wheelScrollRef.value = result.ref;
    }).exec();
  },

  _getWheelCandidateIndex(currentCandidate, position, maxIndex) {
    'worklet';
    const maximum = Math.max(0, Number(maxIndex) || 0);
    const candidate = clamp(Math.round(Number(currentCandidate) || 0), 0, maximum);
    const nextPosition = clamp(Number(position) || 0, 0, maximum);
    if (nextPosition >= candidate + WHEEL_CANDIDATE_ENTER_DISTANCE) {
      return clamp(
        Math.floor(nextPosition + WHEEL_CANDIDATE_EXIT_DISTANCE),
        candidate,
        maximum,
      );
    }
    if (nextPosition <= candidate - WHEEL_CANDIDATE_ENTER_DISTANCE) {
      return clamp(
        Math.ceil(nextPosition - WHEEL_CANDIDATE_EXIT_DISTANCE),
        0,
        candidate,
      );
    }
    return candidate;
  },

  _resolveWheelSnapTarget(position, candidateIndex, gestureStartPosition,
    releaseVelocity, lastDirection, maxIndex) {
    'worklet';
    const maximum = Math.max(0, Number(maxIndex) || 0);
    const nextPosition = clamp(Number(position) || 0, 0, maximum);
    const startPosition = clamp(Number(gestureStartPosition) || 0, 0, maximum);
    const velocity = Number(releaseVelocity) || 0;
    const velocityDirection = velocity > 0 ? 1 : (velocity < 0 ? -1 : 0);
    const direction = velocityDirection || (lastDirection > 0 ? 1 : (lastDirection < 0 ? -1 : 0));
    const startIndex = clamp(Math.round(startPosition), 0, maximum);
    let targetIndex = clamp(Math.round(Number(candidateIndex) || 0), 0, maximum);

    if (Math.abs(nextPosition - startPosition) < WHEEL_TOUCH_DEAD_DISTANCE
      && Math.abs(velocity) < WHEEL_DIRECTION_SPEED) {
      return startIndex;
    }

    const lowerIndex = Math.floor(nextPosition);
    const fraction = nextPosition - lowerIndex;
    if (fraction >= WHEEL_CANDIDATE_EXIT_DISTANCE
      && fraction <= WHEEL_CANDIDATE_ENTER_DISTANCE
      && Math.abs(velocity) >= WHEEL_DIRECTION_SPEED
      && direction) {
      targetIndex = direction > 0 ? Math.ceil(nextPosition) : lowerIndex;
    }

    if (Math.abs(velocity) >= WHEEL_FLING_SPEED && targetIndex === startIndex && direction) {
      targetIndex = startIndex + direction;
    }
    return clamp(targetIndex, 0, maximum);
  },

  _getWheelAnchorIndex(position, lastDirection, settledIndex, maxIndex) {
    'worklet';
    const maximum = Math.max(0, Number(maxIndex) || 0);
    const nextPosition = clamp(Number(position) || 0, 0, maximum);
    const lowerIndex = Math.floor(nextPosition);
    const fraction = nextPosition - lowerIndex;
    if (Math.abs(fraction - .5) < .0001) {
      if (lastDirection > 0) return clamp(lowerIndex + 1, 0, maximum);
      if (lastDirection < 0) return clamp(lowerIndex, 0, maximum);
      const settled = clamp(Math.round(Number(settledIndex) || 0), 0, maximum);
      if (settled === lowerIndex || settled === lowerIndex + 1) return settled;
    }
    return clamp(Math.round(nextPosition), 0, maximum);
  },

  _getWheelRebasePosition(oldPosition, oldAnchorIndex, newAnchorIndex, maxIndex) {
    'worklet';
    const maximum = Math.max(0, Number(maxIndex) || 0);
    const position = Number(oldPosition) || 0;
    const oldAnchor = Number(oldAnchorIndex) || 0;
    const newAnchor = Number(newAnchorIndex) || 0;
    return clamp(newAnchor + position - oldAnchor, 0, maximum);
  },

  _getWheelSnapDuration(position, targetIndex) {
    'worklet';
    const distance = Math.abs((Number(position) || 0) - (Number(targetIndex) || 0));
    return Math.round(clamp(
      WHEEL_SNAP_MIN_DURATION_MS + (distance * 80),
      WHEEL_SNAP_MIN_DURATION_MS,
      WHEEL_SNAP_MAX_DURATION_MS,
    ));
  },

  _resetWheelWorklet(currentIndex, maxIndex, slotHeight, options) {
    if (!this._wheelPosition) return;
    const settings = options || {};
    const position = clamp(
      Number.isFinite(Number(settings.position)) ? Number(settings.position) : currentIndex,
      0,
      maxIndex,
    );
    const phase = settings.phase === WHEEL_PHASE_REBASING
      ? WHEEL_PHASE_REBASING
      : WHEEL_PHASE_RESETTING;
    const nextSession = (Number(this._wheelSessionId) || 0) + 1;
    this._wheelSessionId = nextSession;
    this._wheelFeedbackSession = nextSession;
    this._wheelFeedbackSequence = 0;
    this._wheelSettledSession = -1;
    this._wheelPosition.value = position;
    this._wheelSlotHeight.value = slotHeight;
    this._wheelMaxIndex.value = maxIndex;
    this._wheelDetentIndex.value = clamp(Math.round(position), 0, maxIndex);
    this._wheelSuppressDetents.value = 1;
    this._wheelSnapping.value = 0;
    this._wheelPhase.value = phase;
    this._wheelSettledIndex.value = currentIndex;
    this._wheelCandidateIndex.value = this._getWheelCandidateIndex(currentIndex, position, maxIndex);
    this._wheelGestureStartPosition.value = position;
    this._wheelLastPosition.value = position;
    this._wheelLastDirection.value = 0;
    this._wheelReleaseVelocity.value = 0;
    this._wheelSnapTarget.value = -1;
    this._wheelSnapAttempts.value = 0;
    this._wheelSession.value = nextSession;
    this._wheelSequence.value = 0;
    if (this._feedback) this._feedback.reset();
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
    const maxIndex = Math.max(rawStations.length - 1, 0);
    const wheelRebase = options && options.wheelRebase;
    const canRebaseWheel = wheelRebase
      && preferredIndex >= 0
      && Number.isFinite(Number(wheelRebase.oldPosition))
      && Number.isFinite(Number(wheelRebase.oldAnchorIndex))
      && Number(this.data.wheelSlotHeight) > 0;
    const rebasedPosition = canRebaseWheel
      ? this._getWheelRebasePosition(
        Number(wheelRebase.oldPosition),
        Number(wheelRebase.oldAnchorIndex),
        currentIndex,
        maxIndex,
      )
      : currentIndex;

    this._homeView = homeView;
    this._rawStations = rawStations;
    this._state.routeId = homeView.line.routeId || this._state.routeId;
    this._state.direction = homeView.direction || this._state.direction;
    this._state.originStationId = homeView.originStationId || this._state.originStationId;
    const lineOption = this.data.lineOptions.find((item) => item.id === this._state.lineId) || {};
    const routeOptions = lineOption.routes || [];

    const lineColor = getLineColor(homeView.line);
    const patch = {
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
      stations: this._decorateStations(rawStations, currentIndex, lineColor),
    };
    if (canRebaseWheel) {
      const slotHeight = Number(this.data.wheelSlotHeight);
      patch.wheelScrollTop = rebasedPosition * slotHeight;
      this._resetWheelWorklet(currentIndex, maxIndex, slotHeight, {
        position: rebasedPosition,
        phase: WHEEL_PHASE_REBASING,
      });
    }
    this.setData(patch, () => {
      if (canRebaseWheel) {
        this._bindStationAnimatedStyles(rawStations.length);
        return;
      }
      this._scheduleStationWheelLayout();
    });
    this._updateSyncStatus();
    if (!(options && options.skipSync)) this._scheduleSyncForVisibleStation(0);
  },

  _scheduleStationWheelLayout() {
    if (!wx.createSelectorQuery && typeof this.createSelectorQuery !== 'function') return;
    if (this._stationLayoutTimer) clearTimeout(this._stationLayoutTimer);
    this._stationLayoutTimer = setTimeout(() => {
      this._stationLayoutTimer = null;
      const query = typeof this.createSelectorQuery === 'function'
        ? this.createSelectorQuery()
        : wx.createSelectorQuery();
      query.select('.station-wheel-scroll').boundingClientRect((rect) => {
        if (!rect || !rect.height) return;
        const slotHeight = rect.height / WHEEL_VISIBLE_SLOTS;
        const maxIndex = Math.max((this._rawStations || []).length - 1, 0);
        const currentIndex = clamp(this.data.currentIndex, 0, maxIndex);
        this._resetWheelWorklet(currentIndex, maxIndex, slotHeight, { position: currentIndex });
        this.setData({
          wheelSlotHeight: slotHeight,
          wheelTopSpacerHeight: slotHeight,
          wheelBottomSpacerHeight: slotHeight * WHEEL_BOTTOM_SPACER_SLOTS,
          wheelScrollTop: currentIndex * slotHeight,
        }, () => this._bindStationAnimatedStyles((this._rawStations || []).length));
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

  _getReadableLineColor(color) {
    return getReadableLineColor(color);
  },

  onWheelDragStart() {
    if (!this._wheelSuppressDetents) return;
    if (this._wheelPhase.value !== WHEEL_PHASE_DRAGGING) {
      const session = (Number(this._wheelSession.value) || 0) + 1;
      const position = this._wheelPosition.value;
      const maximum = this._wheelMaxIndex.value;
      const settledIndex = clamp(Math.round(this._wheelSettledIndex.value), 0, maximum);
      this._wheelSession.value = session;
      this._wheelSequence.value = 0;
      this._wheelPhase.value = WHEEL_PHASE_DRAGGING;
      this._wheelCandidateIndex.value = this._getWheelCandidateIndex(
        settledIndex,
        position,
        maximum,
      );
      this._wheelGestureStartPosition.value = position;
      this._wheelLastPosition.value = position;
      this._wheelLastDirection.value = 0;
      this._wheelReleaseVelocity.value = 0;
      this._wheelSnapTarget.value = -1;
      this._wheelSnapAttempts.value = 0;
      this.onWheelCycleStart(session);
    }
    this._wheelSuppressDetents.value = 0;
    this._wheelSnapping.value = 0;
  },

  _beginWheelCycleOnUI() {
    'worklet';
    if (this._wheelPhase.value === WHEEL_PHASE_DRAGGING) return;
    const session = this._wheelSession.value + 1;
    const position = this._wheelPosition.value;
    const maximum = this._wheelMaxIndex.value;
    const settledIndex = clamp(Math.round(this._wheelSettledIndex.value), 0, maximum);
    this._wheelSession.value = session;
    this._wheelSequence.value = 0;
    this._wheelPhase.value = WHEEL_PHASE_DRAGGING;
    this._wheelCandidateIndex.value = this._getWheelCandidateIndex(
      settledIndex,
      position,
      maximum,
    );
    this._wheelGestureStartPosition.value = position;
    this._wheelLastPosition.value = position;
    this._wheelLastDirection.value = 0;
    this._wheelReleaseVelocity.value = 0;
    this._wheelSnapTarget.value = -1;
    this._wheelSnapAttempts.value = 0;
    this._wheelSuppressDetents.value = 0;
    this._wheelSnapping.value = 0;
    runOnJS(this.onWheelCycleStart.bind(this))(session);
  },

  onWheelCycleStart(session) {
    const nextSession = Number(session) || 0;
    if (nextSession < Number(this._wheelFeedbackSession)) return;
    if (this._wheelSnapTimer) {
      clearTimeout(this._wheelSnapTimer);
      this._wheelSnapTimer = null;
    }
    this._wheelSessionId = Math.max(Number(this._wheelSessionId) || 0, nextSession);
    this._wheelFeedbackSession = nextSession;
    this._wheelFeedbackSequence = 0;
    this._wheelSettledSession = -1;
    if (this._feedback) this._feedback.reset();
  },

  _applyWheelPosition(position) {
    'worklet';
    const maximum = this._wheelMaxIndex.value;
    const nextPosition = clamp(position, 0, maximum);
    this._wheelPosition.value = nextPosition;
    if (this._wheelSuppressDetents.value) return;

    const currentDetent = this._wheelDetentIndex.value;
    const nextDetent = getDetentIndex(currentDetent, nextPosition, maximum);
    if (nextDetent === currentDetent) return;

    const count = Math.abs(nextDetent - currentDetent);
    const direction = nextDetent > currentDetent ? 1 : -1;
    const sequence = this._wheelSequence.value + 1;
    this._wheelDetentIndex.value = nextDetent;
    this._wheelSequence.value = sequence;
    runOnJS(this.onWheelDetents.bind(this))(
      this._wheelSession.value,
      sequence,
      count,
      direction,
      nextDetent,
    );
  },

  onWheelScrollStart(event) {
    'worklet';
    const isDrag = Boolean(event && event.detail && event.detail.isDrag);
    if (isDrag) {
      this._beginWheelCycleOnUI();
      return;
    }
    if (this._wheelPhase.value !== WHEEL_PHASE_SNAPPING
      && this._wheelPhase.value !== WHEEL_PHASE_RESETTING
      && this._wheelPhase.value !== WHEEL_PHASE_REBASING) {
      this._wheelPhase.value = WHEEL_PHASE_DECELERATING;
    }
  },

  onWheelScrollUpdate(event) {
    'worklet';
    const slotHeight = Math.max(1, this._wheelSlotHeight.value);
    const isDrag = Boolean(event && event.detail && event.detail.isDrag);
    if (isDrag && this._wheelPhase.value !== WHEEL_PHASE_DRAGGING) {
      this._beginWheelCycleOnUI();
    } else if (!isDrag && this._wheelPhase.value === WHEEL_PHASE_DRAGGING) {
      this._wheelPhase.value = WHEEL_PHASE_DECELERATING;
    }
    const previousPosition = this._wheelPosition.value;
    const nextPosition = clamp(event.detail.scrollTop / slotHeight, 0, this._wheelMaxIndex.value);
    const delta = nextPosition - previousPosition;
    if (Math.abs(delta) > .0001) this._wheelLastDirection.value = delta > 0 ? 1 : -1;
    this._wheelLastPosition.value = nextPosition;
    this._applyWheelPosition(nextPosition);
    this._wheelCandidateIndex.value = this._getWheelCandidateIndex(
      this._wheelCandidateIndex.value,
      nextPosition,
      this._wheelMaxIndex.value,
    );
  },

  adjustWheelDecelerationVelocity(velocity) {
    'worklet';
    const adjustedVelocity = clampWheelVelocity(velocity, this._wheelSlotHeight.value);
    const slotHeight = Math.max(1, this._wheelSlotHeight.value);
    this._wheelReleaseVelocity.value = adjustedVelocity / slotHeight;
    if (Math.abs(adjustedVelocity) > .01) {
      this._wheelLastDirection.value = adjustedVelocity > 0 ? 1 : -1;
    }
    if (this._wheelPhase.value === WHEEL_PHASE_DRAGGING) {
      this._wheelPhase.value = WHEEL_PHASE_DECELERATING;
    }
    return adjustedVelocity;
  },

  onWheelScrollEnd(event) {
    'worklet';
    const phase = this._wheelPhase.value;
    if (phase === WHEEL_PHASE_RESETTING || phase === WHEEL_PHASE_REBASING) {
      this._wheelPhase.value = WHEEL_PHASE_IDLE;
      this._wheelSnapping.value = 0;
      return;
    }

    const slotHeight = Math.max(1, this._wheelSlotHeight.value);
    const eventScrollTop = event && event.detail && event.detail.scrollTop;
    if (typeof eventScrollTop === 'number') {
      const eventPosition = clamp(eventScrollTop / slotHeight, 0, this._wheelMaxIndex.value);
      this._wheelLastPosition.value = eventPosition;
      this._applyWheelPosition(eventPosition);
      this._wheelCandidateIndex.value = this._getWheelCandidateIndex(
        this._wheelCandidateIndex.value,
        eventPosition,
        this._wheelMaxIndex.value,
      );
    }

    const position = this._wheelPosition.value;
    const targetIndex = phase === WHEEL_PHASE_SNAPPING
      ? clamp(Math.round(this._wheelSnapTarget.value), 0, this._wheelMaxIndex.value)
      : this._resolveWheelSnapTarget(
        position,
        this._wheelCandidateIndex.value,
        this._wheelGestureStartPosition.value,
        this._wheelReleaseVelocity.value,
        this._wheelLastDirection.value,
        this._wheelMaxIndex.value,
      );
    const session = this._wheelSession.value;
    const finish = this.onWheelSettled.bind(this);
    const distance = Math.abs(position - targetIndex);

    if (distance <= WHEEL_SNAP_ERROR_DISTANCE) {
      this._wheelSnapping.value = 0;
      this._applyWheelPosition(targetIndex);
      this._wheelPhase.value = WHEEL_PHASE_IDLE;
      this._wheelSettledIndex.value = targetIndex;
      this._wheelCandidateIndex.value = targetIndex;
      this._wheelGestureStartPosition.value = targetIndex;
      this._wheelSnapTarget.value = -1;
      this._wheelSnapAttempts.value = 0;
      runOnJS(finish)(targetIndex, session);
      return;
    }

    if (phase === WHEEL_PHASE_SNAPPING && this._wheelSnapAttempts.value >= 1) {
      this._applyWheelPosition(targetIndex);
      this._wheelPhase.value = WHEEL_PHASE_RESETTING;
      this._wheelSuppressDetents.value = 1;
      this._wheelSnapping.value = 0;
      runOnJS(this.onWheelSnapFallback.bind(this))(targetIndex, session);
      return;
    }

    const duration = this._getWheelSnapDuration(position, targetIndex);
    this._wheelSnapping.value = 1;
    this._wheelPhase.value = WHEEL_PHASE_SNAPPING;
    this._wheelSnapTarget.value = targetIndex;
    if (phase === WHEEL_PHASE_SNAPPING) this._wheelSnapAttempts.value += 1;
    if (scrollViewContext && this._wheelScrollRef.value) {
      scrollViewContext.scrollTo(this._wheelScrollRef.value, {
        top: targetIndex * slotHeight,
        duration,
        animated: true,
        easingFunction: 'ease-out',
      });
      runOnJS(this.onWheelSnapStarted.bind(this))(targetIndex, session, duration);
      return;
    }

    this._applyWheelPosition(targetIndex);
    runOnJS(this.onWheelSnapFallback.bind(this))(targetIndex, session);
  },

  onWheelSnapStarted(targetIndex, session, duration) {
    if (Number(session) !== Number(this._wheelFeedbackSession)) return;
    if (this._wheelSnapTimer) clearTimeout(this._wheelSnapTimer);
    this._wheelSnapTimer = setTimeout(() => {
      this._wheelSnapTimer = null;
      if (Number(session) !== Number(this._wheelFeedbackSession)) return;
      if (!this._wheelPhase || this._wheelPhase.value !== WHEEL_PHASE_SNAPPING) return;
      if (Math.round(this._wheelSnapTarget.value) !== Math.round(targetIndex)) return;
      this._wheelPosition.value = targetIndex;
      this._wheelLastPosition.value = targetIndex;
      this._wheelSettledIndex.value = targetIndex;
      this._wheelCandidateIndex.value = targetIndex;
      this._wheelGestureStartPosition.value = targetIndex;
      this._wheelDetentIndex.value = targetIndex;
      this._wheelPhase.value = WHEEL_PHASE_RESETTING;
      this._wheelSuppressDetents.value = 1;
      this._wheelSnapping.value = 0;
      this._wheelSnapTarget.value = -1;
      this._wheelSnapAttempts.value = 0;
      this.setData({ wheelScrollTop: targetIndex * this.data.wheelSlotHeight });
      this.onWheelSettled(targetIndex, session);
    }, Math.max(0, Number(duration) || 0) + 100);
  },

  onWheelSnapFallback(targetIndex, session) {
    if (Number(session) !== Number(this._wheelFeedbackSession)) return;
    if (this._wheelSnapTimer) {
      clearTimeout(this._wheelSnapTimer);
      this._wheelSnapTimer = null;
    }
    if (this._wheelPosition) {
      this._wheelPosition.value = targetIndex;
      this._wheelLastPosition.value = targetIndex;
      this._wheelSettledIndex.value = targetIndex;
      this._wheelCandidateIndex.value = targetIndex;
      this._wheelGestureStartPosition.value = targetIndex;
      this._wheelDetentIndex.value = targetIndex;
      this._wheelPhase.value = WHEEL_PHASE_RESETTING;
      this._wheelSuppressDetents.value = 1;
      this._wheelSnapping.value = 0;
      this._wheelSnapTarget.value = -1;
      this._wheelSnapAttempts.value = 0;
    }
    this.setData({
      wheelScrollTop: targetIndex * this.data.wheelSlotHeight,
    });
    this.onWheelSettled(targetIndex, session);
  },

  onWheelDetents(session, sequence, count) {
    if (Number(session) !== Number(this._wheelFeedbackSession)) return;
    if (Number(sequence) <= Number(this._wheelFeedbackSequence)) return;
    this._wheelFeedbackSequence = Number(sequence);
    if (this._feedback) this._feedback.playDetents(count);
  },

  onWheelSettled(rawIndex, session) {
    if (session !== undefined && Number(session) !== Number(this._wheelFeedbackSession)) return;
    if (session !== undefined && Number(session) === Number(this._wheelSettledSession)) return;
    if (this._wheelSnapTimer) {
      clearTimeout(this._wheelSnapTimer);
      this._wheelSnapTimer = null;
    }
    if (session !== undefined) this._wheelSettledSession = Number(session);
    const parsedIndex = Number(rawIndex);
    const currentIndex = Math.min(
      Math.max(Number.isFinite(parsedIndex) ? parsedIndex : this.data.currentIndex, 0),
      Math.max((this._rawStations || []).length - 1, 0),
    );
    const changed = currentIndex !== this.data.currentIndex;
    if (!changed) return;
    this.setData({
      currentIndex,
      stations: this._decorateStations(this._rawStations, currentIndex, this.data.lineColor),
    });
    this._updateSyncStatus();
    this._scheduleSyncForVisibleStation(320);
  },

  onStationAnimationFinish(payload) {
    const detail = payload && payload.detail ? payload.detail : (payload || {});
    const rawIndex = detail.currentIndex !== undefined ? detail.currentIndex : detail.current;
    this.onWheelSettled(rawIndex);
  },

  onWheelHorizontalGesture(event) {
    'worklet';
    if (event.state === 1) {
      this._wheelHorizontalX.value = 0;
      this._wheelHorizontalY.value = 0;
      return;
    }
    if (event.state === 2) {
      this._wheelHorizontalX.value += event.deltaX;
      this._wheelHorizontalY.value += event.deltaY;
      return;
    }
    if (event.state === 3) {
      const finish = this.onWheelHorizontalSwipe.bind(this);
      runOnJS(finish)(this._wheelHorizontalX.value, this._wheelHorizontalY.value);
    }
    this._wheelHorizontalX.value = 0;
    this._wheelHorizontalY.value = 0;
  },

  onWheelHorizontalSwipe(payload, rawDeltaY) {
    const deltaX = typeof payload === 'number'
      ? payload
      : (Number(payload && payload.deltaX) || 0);
    const deltaY = typeof payload === 'number'
      ? (Number(rawDeltaY) || 0)
      : (Number(payload && payload.deltaY) || 0);
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
    const maximum = Math.max((this._rawStations || []).length - 1, 0);
    const position = this._wheelPosition
      ? clamp(Number(this._wheelPosition.value) || 0, 0, maximum)
      : clamp(Number(this.data.currentIndex) || 0, 0, maximum);
    const lastDirection = this._wheelLastDirection
      ? Number(this._wheelLastDirection.value) || 0
      : 0;
    const anchorIndex = this._getWheelAnchorIndex(
      position,
      lastDirection,
      this.data.currentIndex,
      maximum,
    );
    const anchorStation = (this._rawStations || [])[anchorIndex];
    const visibleStationId = anchorStation ? anchorStation.id : this._visibleStationId();
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
    if (this._wheelSnapTimer) {
      clearTimeout(this._wheelSnapTimer);
      this._wheelSnapTimer = null;
    }
    if (this._wheelPhase) {
      const rebaseSession = (Number(this._wheelSession.value) || 0) + 1;
      this._wheelSession.value = rebaseSession;
      this._wheelSessionId = Math.max(Number(this._wheelSessionId) || 0, rebaseSession);
      this._wheelFeedbackSession = rebaseSession;
      this._wheelFeedbackSequence = 0;
      this._wheelSettledSession = -1;
      this._wheelPhase.value = WHEEL_PHASE_REBASING;
      this._wheelSuppressDetents.value = 1;
      this._wheelSnapping.value = 0;
      this._wheelSnapTarget.value = -1;
      this._wheelSnapAttempts.value = 0;
    }
    this._state.direction = nextDirection.id;
    this._directionMode = 'manual';
    this._refreshHomeView(visibleStationId, {
      wheelRebase: {
        oldPosition: position,
        oldAnchorIndex: anchorIndex,
      },
    });
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
