const assert = require('assert');
const {
  haversineMeters,
  rankNearbyStations,
} = require('../miniprogram/utils/location');
const {
  requestCurrentPosition,
  openLocationSettings,
} = require('../miniprogram/utils/location-service');
const restroomData = require('../miniprogram/data/generated/restrooms');
const { canGenerateSameNameTransfer } = require('../miniprogram/data/topology');
const catalog = require('../miniprogram/data/catalog');

function wxMock(handlers) {
  return Object.keys(handlers).reduce((api, name) => {
    api[name] = (options) => handlers[name](options);
    return api;
  }, {});
}

async function validate() {
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
  ).status, 'ambiguous');
  assert.strictEqual(rankNearbyStations(
    { latitude: 30.8, longitude: 121.1 },
    locations,
  ).status, 'unmatched');

  const allowedApi = wxMock({
    getPrivacySetting: ({ success }) => success({ needAuthorization: false }),
    getSetting: ({ success }) => success({ authSetting: { 'scope.userLocation': true } }),
    getLocation: ({ success }) => success({ latitude: 31.23, longitude: 121.47, accuracy: 20 }),
  });
  assert.strictEqual((await requestCurrentPosition(allowedApi)).ok, true);

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
  console.log('定位逻辑验收通过：距离、歧义、站外、授权、拒绝、超时和设置恢复。');
}

validate().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
