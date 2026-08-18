const assert = require('assert');
const path = require('path');

const root = path.resolve(__dirname, '..');
const validator = require(path.join(root, 'cloudfunctions/metroRestroomApi/validator'));
const correctionOptions = require(path.join(root, 'miniprogram/data/correction-options'));
const storage = require(path.join(root, 'miniprogram/utils/storage'));

function createDatabaseMock() {
  const stores = {
    data_versions: new Map(),
    correction_reports: new Map(),
    correction_rate_limits: new Map(),
  };

  function reference(collectionName, id) {
    const store = stores[collectionName];
    return {
      async get() { return { data: store.get(id) || null }; },
      async set(options) {
        store.set(id, Object.assign({ _id: id }, options.data));
        return { _id: id };
      },
    };
  }

  return {
    stores,
    collection(name) {
      return { doc(id) { return reference(name, id); } };
    },
    serverDate() { return { $date: 'server' }; },
    async runTransaction(callback) { return callback(this); },
  };
}

async function validateCloudFunction() {
  const db = createDatabaseMock();
  const sdkPath = require.resolve('wx-server-sdk', {
    paths: [path.join(root, 'cloudfunctions/metroRestroomApi')],
  });
  const cloudMock = {
    DYNAMIC_CURRENT_ENV: 'dynamic',
    init() {},
    database() { return db; },
    getWXContext() { return { OPENID: 'private-openid-for-tests' }; },
  };
  require.cache[sdkPath] = { id: sdkPath, filename: sdkPath, loaded: true, exports: cloudMock };
  const apiPath = path.join(root, 'cloudfunctions/metroRestroomApi/index');
  delete require.cache[require.resolve(apiPath)];
  const api = require(apiPath);

  const payload = {
    requestId: 'correction-1',
    lineId: '2',
    stationId: 'l2-s001',
    stationName: '浦东国际机场',
    restroomId: 'l2-s001-restroom',
    sourceSheet: '2号线',
    sourceRow: 2,
    issueType: 'location',
    description: '应为 3 号口外',
    contact: '',
    clientVersion: '开发版',
    dataVersion: 'local-data-sha256',
  };
  const first = await api.main({ action: 'submitCorrection', payload });
  assert.strictEqual(first.success, true);
  assert.strictEqual(first.data.duplicate, false);
  assert.strictEqual(JSON.stringify(first).includes('private-openid-for-tests'), false);
  assert.strictEqual(db.stores.correction_reports.size, 1);
  assert.strictEqual(db.stores.correction_rate_limits.size, 1);
  const storedReport = Array.from(db.stores.correction_reports.values())[0];
  assert.ok(storedReport.userKey);
  assert.strictEqual(storedReport.openid, undefined);
  assert.strictEqual(storedReport.status, 'pending');

  const duplicate = await api.main({ action: 'submitCorrection', payload });
  assert.strictEqual(duplicate.success, true);
  assert.strictEqual(duplicate.data.duplicate, true);
  assert.strictEqual(Array.from(db.stores.correction_rate_limits.values())[0].count, 1);

  const conflict = await api.main({
    action: 'submitCorrection',
    payload: Object.assign({}, payload, { description: '同一请求改成另一份内容' }),
  });
  assert.strictEqual(conflict.success, false);
  assert.strictEqual(conflict.code, 'IDEMPOTENCY_CONFLICT');

  const limited = await api.main({
    action: 'submitCorrection',
    payload: Object.assign({}, payload, { requestId: 'correction-2' }),
  });
  assert.strictEqual(limited.success, false);
  assert.strictEqual(limited.code, 'RATE_LIMITED');

  const unknown = await api.main({ action: 'templateDangerousAction' });
  assert.strictEqual(unknown.success, false);
  assert.strictEqual(unknown.code, 'INVALID_ACTION');
  const version = await api.main({ action: 'getDataVersion', payload: { localVersion: 'local' } });
  assert.deepStrictEqual(version.data, { available: false, localVersion: 'local' });
}

async function validateClientService() {
  let initOptions = null;
  global.wx = {
    cloud: {
      init(options) { initOptions = options; },
      callFunction() {
        return Promise.resolve({
          result: { success: true, data: { available: false, localVersion: 'local' } },
        });
      },
    },
  };
  const servicePath = path.join(root, 'miniprogram/utils/cloud-service');
  delete require.cache[require.resolve(servicePath)];
  const service = require(servicePath);
  assert.strictEqual(service.initCloud(), true);
  assert.strictEqual(initOptions.env, 'metro-restroom-d4goyb1fq3f9df0b3');
  assert.strictEqual(initOptions.traceUser, true);
  const status = await service.checkDataVersion('local');
  assert.deepStrictEqual(status, { available: false, localVersion: 'local' });

  global.wx.cloud.callFunction = () => Promise.resolve({
    result: { success: false, code: 'RATE_LIMITED', message: '稍后再试' },
  });
  await assert.rejects(service.submitCorrection({}), (error) => error.code === 'RATE_LIMITED');
}

async function main() {
  const lines = correctionOptions.getCorrectionOptions();
  assert.strictEqual(lines.length, 19);
  assert.strictEqual(lines.reduce((count, line) => count + line.stations.length, 0), 518);
  assert.strictEqual(
    correctionOptions.findCorrectionContext('2', 'l2-s001').stationName,
    '浦东国际机场',
  );
  assert.strictEqual(correctionOptions.findCorrectionContext('2', 'missing'), null);

  const normalized = validator.normalizeCorrection({
    requestId: ' correction-1 ',
    lineId: '2',
    stationId: 'l2-s001',
    stationName: '浦东国际机场',
    restroomId: 'l2-s001-restroom',
    sourceSheet: '2号线',
    sourceRow: 2,
    issueType: 'location',
    description: '  应为 3 号口外  ',
    contact: '',
    clientVersion: '开发版',
    dataVersion: 'sha256',
  });
  assert.strictEqual(normalized.requestId, 'correction-1');
  assert.strictEqual(normalized.description, '应为 3 号口外');
  assert.throws(() => validator.normalizeCorrection(Object.assign({}, normalized, {
    issueType: 'unknown',
  })), /issueType/);

  storage.saveCorrectionDraft({ context: { lineId: '2' }, description: '草稿' });
  assert.strictEqual(storage.getCorrectionDraft().description, '草稿');
  storage.clearCorrectionDraft();
  assert.strictEqual(storage.getCorrectionDraft(), null);

  await validateClientService();
  await validateCloudFunction();
  console.log('云开发验收通过：19 条线路、518 个纠错上下文、匿名幂等、限流、错误降级和本地草稿。');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
