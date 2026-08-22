const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  DEFAULT_AUTO_DISTANCE_METERS,
  DEFAULT_MAX_DISTANCE_METERS,
  DEFAULT_NEARBY_DISTANCE_METERS,
  haversineMeters,
  rankNearbyStations,
  resolveNearestEntranceLine,
} = require('../miniprogram/utils/location');
const {
  requestAuthorizedCurrentPosition,
  requestCurrentPosition,
  startForegroundLocation,
  openLocationSettings,
} = require('../miniprogram/utils/location-service');
const restroomData = require('../miniprogram/data/generated/restrooms');
const stationLocationData = require('../miniprogram/data/station-locations');
const stationEntranceData = require('../miniprogram/data/station-entrances');
const {
  LINES,
  canGenerateSameNameTransfer,
  normalizeStationName,
} = require('../miniprogram/data/topology');
const catalog = require('../miniprogram/data/catalog');

function wxMock(handlers) {
  return Object.keys(handlers).reduce((api, name) => {
    api[name] = (options) => handlers[name](options);
    return api;
  }, {});
}

async function validate() {
  const appConfig = JSON.parse(fs.readFileSync(
    path.resolve(__dirname, '../miniprogram/app.json'),
    'utf8',
  ));
  assert.deepStrictEqual(
    appConfig.requiredPrivateInfos,
    ['getLocation', 'startLocationUpdate', 'onLocationChange'],
    '必须声明单次定位和前台持续定位所需接口',
  );
  assert(!appConfig.requiredPrivateInfos.includes('startLocationUpdateBackground'),
    '本小程序不得声明后台持续定位');

  const activeRecords = restroomData.lines.reduce(
    (records, line) => records.concat(line.records || []),
    [],
  ).filter((record) => record.status === 'active');
  const parent = activeRecords.map((record, index) => index);
  function find(index) {
    if (parent[index] !== index) parent[index] = find(parent[index]);
    return parent[index];
  }
  function union(left, right) {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parent[rightRoot] = leftRoot;
  }
  for (let left = 0; left < activeRecords.length; left += 1) {
    for (let right = left + 1; right < activeRecords.length; right += 1) {
      if (canGenerateSameNameTransfer(
        activeRecords[left].lineId,
        activeRecords[left].stationName,
        activeRecords[right].lineId,
        activeRecords[right].stationName,
      )) union(left, right);
    }
  }
  assert.strictEqual(activeRecords.length, 518);
  assert.strictEqual(new Set(activeRecords.map((record, index) => find(index))).size, 411);
  assert.strictEqual(stationLocationData.dataReady, true);
  assert.strictEqual(stationLocationData.stations.length, 411);
  const locationByLineStationId = Object.create(null);
  stationLocationData.stations.forEach((station) => {
    assert(Number.isFinite(station.latitude));
    assert(Number.isFinite(station.longitude));
    assert.strictEqual(station.coordinateSystem, 'WGS84');
    station.lineStationIds.forEach((lineStationId) => {
      assert(!locationByLineStationId[lineStationId], `坐标重复覆盖 ${lineStationId}`);
      locationByLineStationId[lineStationId] = station;
    });
  });
  assert.strictEqual(Object.keys(locationByLineStationId).length, 518);

  const routeEdgeDistances = [];
  restroomData.lines.forEach((line) => {
    const records = (line.records || []).filter((record) => record.status === 'active');
    LINES[line.lineId].routes.forEach((route) => {
      const routeRecords = route.stationNames.map((stationName) => records.find((record) => (
        normalizeStationName(record.stationName, record.lineId)
          === normalizeStationName(stationName, record.lineId)
      ))).filter(Boolean);
      routeRecords.forEach((record, index) => {
        if (!index) return;
        routeEdgeDistances.push(haversineMeters(
          locationByLineStationId[routeRecords[index - 1].lineStationId],
          locationByLineStationId[record.lineStationId],
        ));
      });
    });
  });
  assert.strictEqual(routeEdgeDistances.length, 561);
  assert(Math.min.apply(null, routeEdgeDistances) >= 500);
  assert(Math.max.apply(null, routeEdgeDistances) <= 10000);
  assert.strictEqual(catalog.getLocationCandidateOptions({
    physicalStationId: 'physical-people-square',
    lineStationIds: ['l1-s016', 'l2-s019', 'l8-s015'],
    distanceMeters: 20,
  }).length, 3);
  assert.deepStrictEqual(catalog.getLocationCandidateOptions({
    lineStationIds: ['missing-line-station'],
  }), []);

  const peoplesSquare = { latitude: 31.232687, longitude: 121.475108 };
  assert(haversineMeters(peoplesSquare, peoplesSquare) < 0.01);
  assert.strictEqual(DEFAULT_NEARBY_DISTANCE_METERS, 1200);
  assert.strictEqual(DEFAULT_AUTO_DISTANCE_METERS, 3000);
  assert.strictEqual(DEFAULT_MAX_DISTANCE_METERS, 5000);

  const locations = [
    {
      physicalStationId: 'people-square',
      latitude: 31.232687,
      longitude: 121.475108,
      lineStationIds: ['l1-s001'],
    },
    {
      physicalStationId: 'east-nanjing-road',
      latitude: 31.238101,
      longitude: 121.484628,
      lineStationIds: ['l2-s001'],
    },
  ];
  assert.strictEqual(rankNearbyStations(peoplesSquare, locations).status, 'success');
  assert.strictEqual(rankNearbyStations(
    peoplesSquare,
    [Object.assign({}, locations[0], { lineStationIds: ['l1-s001', 'l2-s001'] })],
  ).status, 'success');
  assert.strictEqual(rankNearbyStations(
    peoplesSquare,
    locations,
  ).candidates.length, 1, '3 公里内必须直接返回距离第一名');
  assert.strictEqual(rankNearbyStations(
    { latitude: 30.8, longitude: 121.1 },
    locations,
  ).status, 'unmatched');

  function stationAtDistance(distanceMeters) {
    return {
      physicalStationId: `distance-${distanceMeters}`,
      latitude: peoplesSquare.latitude + distanceMeters / 6371008.8 * 180 / Math.PI,
      longitude: peoplesSquare.longitude,
      lineStationIds: ['l1-s001'],
    };
  }
  const matchAt = (distanceMeters, accuracy) => rankNearbyStations(
    Object.assign({}, peoplesSquare, { accuracy: accuracy || 0 }),
    [stationAtDistance(distanceMeters)],
  );
  assert.strictEqual(matchAt(1200).proximity, 'nearby', '1200 米仍属于附近站');
  assert.strictEqual(matchAt(1201).proximity, 'nearest', '1201 米起必须改称最近站');
  assert.strictEqual(matchAt(3000).status, 'success', '3000 米仍可自动匹配最近站');
  assert.strictEqual(matchAt(3001).status, 'selectionRequired', '3001 米起必须进入附近站选择');
  assert.strictEqual(matchAt(5000).status, 'selectionRequired', '5000 米仍应提供附近站选择');
  assert.strictEqual(matchAt(5001).status, 'unmatched', '超过 5000 米不得自动提出站点');
  assert.strictEqual(matchAt(1100, 300).proximity, 'nearest', '精度范围跨过 1200 米时不得标为附近站');
  assert.strictEqual(matchAt(2900, 300).status, 'selectionRequired', '精度范围跨过 3000 米时不得静默提交');
  assert.strictEqual(matchAt(4900, 300).lowAccuracy, true, '精度范围跨过 5000 米时必须标记定位较粗略');

  const sortedSelection = rankNearbyStations(peoplesSquare, [
    stationAtDistance(4900),
    stationAtDistance(3100),
    stationAtDistance(5200),
    stationAtDistance(4500),
  ]);
  assert.strictEqual(sortedSelection.status, 'selectionRequired');
  assert.deepStrictEqual(
    sortedSelection.candidates.map((station) => station.physicalStationId),
    ['distance-3100', 'distance-4500', 'distance-4900'],
    '附近站选择必须只包含 5 公里内物理站，并按距离由近到远排列',
  );

  const entranceAt = (distanceMeters, lineStationIds, association) => ({
    physicalStationId: 'physical-transfer',
    lat: peoplesSquare.latitude + distanceMeters / 6371008.8 * 180 / Math.PI,
    lon: peoplesSquare.longitude,
    lineStationIds,
    association,
  });
  const entranceOptions = ['l1-s001', 'l2-s001'];
  const stableEntrance = resolveNearestEntranceLine(
    Object.assign({}, peoplesSquare, { accuracy: 20 }),
    'physical-transfer',
    entranceOptions,
    [
      entranceAt(10, ['l1-s001'], 'unique'),
      entranceAt(100, ['l2-s001'], 'unique'),
    ],
  );
  assert.strictEqual(stableEntrance.status, 'unique');
  assert.strictEqual(stableEntrance.lineStationId, 'l1-s001');
  assert.strictEqual(resolveNearestEntranceLine(
    Object.assign({}, peoplesSquare, { accuracy: 100 }),
    'physical-transfer',
    entranceOptions,
    [
      entranceAt(10, ['l1-s001'], 'unique'),
      entranceAt(100, ['l2-s001'], 'unique'),
    ],
  ).status, 'unresolved', '精度范围覆盖不同线路入口时不得自动选线');
  assert.strictEqual(resolveNearestEntranceLine(
    Object.assign({}, peoplesSquare, { accuracy: 20 }),
    'physical-transfer',
    entranceOptions,
    [entranceAt(10, entranceOptions, 'multiple')],
  ).status, 'unresolved', '共享入口不得按数组首项选线');
  assert.strictEqual(resolveNearestEntranceLine(
    Object.assign({}, peoplesSquare, { accuracy: 20 }),
    'physical-transfer',
    entranceOptions,
    [entranceAt(10, ['l1-s001'], 'unique')],
  ).issue, 'incompleteEntranceCoverage', '入口未覆盖换乘站全部线路时不得作为强选线证据');
  const lujiazui = stationLocationData.stations.find(
    (station) => station.canonicalName === '陆家嘴',
  );
  const lujiazuiEntrance = stationEntranceData.entrances.find(
    (entrance) => entrance.physicalStationId === lujiazui.physicalStationId,
  );
  assert(lujiazui && lujiazuiEntrance && lujiazui.lineStationIds.length === 2);
  assert.strictEqual(resolveNearestEntranceLine(
    {
      latitude: lujiazuiEntrance.lat,
      longitude: lujiazuiEntrance.lon,
      accuracy: 20,
    },
    lujiazui.physicalStationId,
    lujiazui.lineStationIds,
    stationEntranceData.entrances,
  ).issue, 'incompleteEntranceCoverage', '陆家嘴入口缺少 14 号线关系时不得自动偏向 2 号线');
  assert.strictEqual(resolveNearestEntranceLine(
    Object.assign({}, peoplesSquare, { accuracy: 200 }),
    'physical-transfer',
    entranceOptions,
    [entranceAt(10, ['l1-s001'], 'unique')],
  ).issue, 'lowAccuracy', '定位精度超过入口判断上限时必须降级');

  const loopView = catalog.buildHomeView({ lineId: '4', direction: 'inner' });
  const loopStation = loopView.stations.find((station) => station.name === '世纪大道');
  const loopContext = catalog.getStationContext(loopStation.id, {
    lineId: '4', routeId: 'l4-loop', direction: 'inner', directionMode: 'manual',
  });
  assert.strictEqual(loopContext.direction, 'inner', '同线定位必须保留合法的环线圈向');
  assert.strictEqual(loopContext.directionMode, 'manual');

  const branchView = catalog.buildHomeView({
    lineId: '10', routeId: 'l10-hangzhong-road', direction: 'to-hangzhong-road',
  });
  const commonBranchStation = branchView.stations.find((station) => station.name === '龙溪路');
  const exclusiveBranchStation = branchView.stations.find((station) => station.name === '紫藤路');
  assert.strictEqual(catalog.getStationContext(commonBranchStation.id, {
    lineId: '10', routeId: 'l10-hangzhong-road', direction: 'to-hangzhong-road',
  }).routeId, 'l10-hangzhong-road', '支线公共区段必须保留当前有效路径');
  const exclusiveBranchContext = catalog.getStationContext(exclusiveBranchStation.id, {
    lineId: '10', routeId: 'l10-hongqiao-railway-station', direction: 'to-hongqiao-railway-station',
  });
  assert.strictEqual(exclusiveBranchContext.routeId, 'l10-hangzhong-road', '独占支线站必须切到包含该站的路径');
  assert.strictEqual(exclusiveBranchContext.direction, 'to-hangzhong-road');

  const allowedApi = wxMock({
    getPrivacySetting: ({ success }) => success({ needAuthorization: false }),
    getSetting: ({ success }) => success({ authSetting: { 'scope.userLocation': true } }),
    getLocation: ({ success }) => success({ latitude: 31.23, longitude: 121.47, accuracy: 20 }),
  });
  assert.strictEqual((await requestCurrentPosition(allowedApi)).ok, true);

  let locationListener = null;
  let locationErrorListener = null;
  let startLocationOptions = null;
  let receivedPosition = null;
  let receivedLocationError = null;
  let stopLocationCalls = 0;
  let offLocationCalls = 0;
  let offLocationErrorCalls = 0;
  const foregroundApi = {
    getSetting: ({ success }) => success({
      authSetting: { 'scope.userLocation': true },
    }),
    onLocationChange(listener) { locationListener = listener; },
    offLocationChange(listener) {
      assert.strictEqual(listener, locationListener);
      offLocationCalls += 1;
    },
    onLocationChangeError(listener) { locationErrorListener = listener; },
    offLocationChangeError(listener) {
      assert.strictEqual(listener, locationErrorListener);
      offLocationErrorCalls += 1;
    },
    startLocationUpdate(options) {
      startLocationOptions = options;
      options.success({});
    },
    stopLocationUpdate({ success }) {
      stopLocationCalls += 1;
      success({});
    },
  };
  const foregroundLocation = await startForegroundLocation(
    foregroundApi,
    (position) => { receivedPosition = position; },
    (error) => { receivedLocationError = error; },
  );
  assert.strictEqual(foregroundLocation.ok, true);
  assert.strictEqual(startLocationOptions.type, 'wgs84', '持续定位必须与本地 WGS84 站点坐标一致');
  locationListener({
    latitude: 31.23,
    longitude: 121.47,
    horizontalAccuracy: 18,
  });
  assert.deepStrictEqual(receivedPosition, {
    latitude: 31.23,
    longitude: 121.47,
    accuracy: 18,
  });
  locationErrorListener({ errCode: 2 });
  assert.deepStrictEqual(receivedLocationError, { errCode: 2 });
  assert.strictEqual(await foregroundLocation.stop(), true);
  assert.strictEqual(await foregroundLocation.stop(), true, '重复停止持续定位必须安全幂等');
  assert.strictEqual(stopLocationCalls, 1, '退出前台必须停止持续定位');
  assert.strictEqual(offLocationCalls, 1, '退出前台必须移除位置变化监听');
  assert.strictEqual(offLocationErrorCalls, 1, '退出前台必须移除持续定位错误监听');

  let unavailableSettingCalls = 0;
  const unavailableForeground = await startForegroundLocation({
    getSetting() { unavailableSettingCalls += 1; },
  });
  assert.strictEqual(unavailableForeground.status, 'unavailable');
  assert.strictEqual(unavailableSettingCalls, 0, '接口不存在时必须直接降级，不得额外触发授权');

  let unauthorizedStartCalls = 0;
  const unauthorizedForeground = await startForegroundLocation({
    getSetting: ({ success }) => success({ authSetting: {} }),
    onLocationChange() {},
    startLocationUpdate() { unauthorizedStartCalls += 1; },
  });
  assert.strictEqual(unauthorizedForeground.status, 'notAuthorized');
  assert.strictEqual(unauthorizedStartCalls, 0, '未授权时不得启动持续定位');

  let failedOffCalls = 0;
  const failedForeground = await startForegroundLocation({
    getSetting: ({ success }) => success({
      authSetting: { 'scope.userLocation': true },
    }),
    onLocationChange() {},
    offLocationChange() { failedOffCalls += 1; },
    startLocationUpdate: ({ fail }) => fail({
      errMsg: 'startLocationUpdate:fail api not authorized',
    }),
  });
  assert.strictEqual(failedForeground.ok, false);
  assert.strictEqual(failedForeground.status, 'failed');
  assert.strictEqual(failedOffCalls, 1, '持续定位启动失败必须清理已注册监听');

  let silentAuthorizeCalls = 0;
  let silentLocationCalls = 0;
  const silentlyAllowedApi = wxMock({
    getSetting: ({ success }) => success({ authSetting: { 'scope.userLocation': true } }),
    authorize: ({ success }) => {
      silentAuthorizeCalls += 1;
      success({});
    },
    getLocation: ({ success }) => {
      silentLocationCalls += 1;
      success({ latitude: 31.23, longitude: 121.47, accuracy: 20 });
    },
  });
  assert.strictEqual((await requestAuthorizedCurrentPosition(silentlyAllowedApi)).ok, true);
  assert.strictEqual(silentAuthorizeCalls, 0, '分享进入的静默定位不得重复触发授权');
  assert.strictEqual(silentLocationCalls, 1);

  const silentlyUnapprovedApi = wxMock({
    getSetting: ({ success }) => success({ authSetting: {} }),
    authorize: () => { silentAuthorizeCalls += 1; },
    getLocation: () => { silentLocationCalls += 1; },
  });
  assert.strictEqual(
    (await requestAuthorizedCurrentPosition(silentlyUnapprovedApi)).status,
    'notAuthorized',
  );
  assert.strictEqual(silentAuthorizeCalls, 0, '未授权用户打开分享时不得弹出定位授权');
  assert.strictEqual(silentLocationCalls, 1, '未授权用户不得调用 GPS');

  const deniedApi = wxMock({
    getPrivacySetting: ({ success }) => success({ needAuthorization: false }),
    getSetting: ({ success }) => success({ authSetting: { 'scope.userLocation': false } }),
  });
  assert.strictEqual((await requestCurrentPosition(deniedApi)).status, 'denied');

  const newlyAllowedApi = wxMock({
    getPrivacySetting: ({ success }) => success({ needAuthorization: false }),
    getSetting: ({ success }) => success({ authSetting: {} }),
    authorize: ({ success }) => success({}),
    getLocation: ({ success }) => success({ latitude: 31.23, longitude: 121.47 }),
  });
  assert.strictEqual((await requestCurrentPosition(newlyAllowedApi)).ok, true);

  const failedApi = wxMock({
    getPrivacySetting: ({ success }) => success({ needAuthorization: false }),
    getSetting: ({ success }) => success({ authSetting: { 'scope.userLocation': true } }),
    getLocation: ({ fail }) => fail({ errMsg: 'getLocation:fail timeout' }),
  });
  assert.strictEqual((await requestCurrentPosition(failedApi)).issue, 'timeout');

  const settingApi = wxMock({
    openSetting: ({ success }) => success({ authSetting: { 'scope.userLocation': true } }),
  });
  assert.strictEqual(await openLocationSettings(settingApi), true);
  console.log('定位逻辑验收通过：411 个物理站、561 条路线边、距离分层、前台持续定位启停与降级、入口选线、静默授权复用、拒绝、超时和设置恢复。');
}

validate().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
