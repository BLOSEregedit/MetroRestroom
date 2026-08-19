#!/usr/bin/env node

const assert = require('assert');
const path = require('path');

const root = path.resolve(__dirname, '..');
const storage = require(path.join(root, 'miniprogram/utils/storage'));
const cloudService = require(path.join(root, 'miniprogram/utils/cloud-service'));
const {
  AUTO_RETRY_BACKOFF_MS,
  DEFAULT_TTL_SECONDS,
  MANUAL_COOLDOWN_MS,
  MANUAL_FAILURE_BLOCK_MS,
  DataSyncManager,
  formatDateTime,
} = require(path.join(root, 'miniprogram/utils/data-sync'));

const CITY_ID = 'shanghai';
const BUNDLE_SCHEMA = 1;
const TTL_MS = DEFAULT_TTL_SECONDS * 1000;
const TEST_LINES = [
  'sync-a',
  'sync-b',
  'sync-fail',
  'sync-manual',
  'sync-single',
  'sync-invalid',
  'sync-duplicate',
  'sync-extra',
  'sync-ttl',
];

function cleanup() {
  TEST_LINES.forEach((lineId) => storage.clearLineSyncState(CITY_ID, lineId));
  storage.clearCitySyncState(CITY_ID);
}

function retryableError(code) {
  const error = new Error(code);
  error.code = code;
  error.retryable = true;
  return error;
}

async function validateCloudServiceContract() {
  let request;
  global.wx = {
    cloud: {
      callFunction(options) {
        request = options;
        return Promise.resolve({
          result: {
            success: true,
            data: {
              schemaVersion: BUNDLE_SCHEMA,
              cityId: CITY_ID,
              checkedAtMs: 1000,
              ttlSeconds: DEFAULT_TTL_SECONDS,
              changedLines: [],
              unchangedLineIds: ['sync-a'],
            },
          },
        });
      },
    },
  };
  await cloudService.syncRestroomStatus({
    schemaVersion: BUNDLE_SCHEMA,
    cityId: CITY_ID,
    lines: [{ lineId: 'sync-a', version: 'v1' }],
  });
  assert.strictEqual(request.name, 'metroRestroomApi');
  assert.strictEqual(request.data.action, 'syncRestroomStatus');
  assert.strictEqual(request.data.payload.schemaVersion, BUNDLE_SCHEMA);
  assert.strictEqual(request.data.payload.cityId, CITY_ID);
  delete global.wx;
}

function validateAtomicBatchStorage() {
  const disk = Object.create(null);
  let writeCount = 0;
  let failWrites = false;
  global.wx = {
    getStorageSync(key) { return disk[key]; },
    setStorageSync(key, value) {
      writeCount += 1;
      if (failWrites) throw new Error('mock storage full');
      disk[key] = value;
    },
    removeStorageSync(key) { delete disk[key]; },
  };
  const batch = ['sync-a', 'sync-b'].map((lineId, index) => ({
    cityId: CITY_ID,
    lineId,
    version: `atomic-v${index + 1}`,
    lastAlignedAt: 900000,
    ttlSeconds: DEFAULT_TTL_SECONDS,
    bundleSchema: BUNDLE_SCHEMA,
    overrides: [],
  }));
  storage.saveLineSyncStates(CITY_ID, batch);
  assert.strictEqual(writeCount, 1, '完整线路批次必须只执行一次 setStorageSync');
  assert.strictEqual(storage.getLineSyncState(CITY_ID, 'sync-a').version, 'atomic-v1');
  assert.strictEqual(storage.getLineSyncState(CITY_ID, 'sync-b').version, 'atomic-v2');

  failWrites = true;
  assert.throws(() => storage.saveLineSyncStates(CITY_ID, batch.map((state) => Object.assign(
    {},
    state,
    { version: 'must-not-commit' },
  ))), /写入失败/);
  assert.strictEqual(
    storage.getLineSyncState(CITY_ID, 'sync-a').version,
    'atomic-v1',
    '批量写失败时不能提交部分线路',
  );
  failWrites = false;
  storage.clearLineSyncState(CITY_ID, 'sync-a');
  storage.clearLineSyncState(CITY_ID, 'sync-b');
  delete global.wx;
}

async function validateStorageAndAutomaticSync() {
  let now = 1000000;
  let calls = 0;
  let batchWrites = 0;
  const events = [];
  const countedStorage = Object.assign({}, storage, {
    saveLineSyncStates(cityId, states) {
      batchWrites += 1;
      return storage.saveLineSyncStates(cityId, states);
    },
  });
  const manager = new DataSyncManager({
    storage: countedStorage,
    now: () => now,
    syncRestroomStatus(request) {
      calls += 1;
      if (calls === 1) {
        return Promise.resolve({
          schemaVersion: BUNDLE_SCHEMA,
          cityId: CITY_ID,
          checkedAtMs: now,
          ttlSeconds: DEFAULT_TTL_SECONDS,
          changedLines: request.lines.map((line) => ({
            lineId: line.lineId,
            version: 'cloud-v1',
            bundleSchema: BUNDLE_SCHEMA,
            overrides: [
              { restroomId: 'active', restroomStatus: 'maintenance', expiresAtMs: now + 120000 },
              { restroomId: 'expired', restroomStatus: 'closed', expiresAtMs: now - 1 },
              {
                restroomId: 'future',
                restroomStatus: 'unknown',
                effectiveFromMs: now + 300000,
                expiresAtMs: now + 800000,
              },
            ],
          })),
          unchangedLineIds: [],
        });
      }
      return Promise.resolve({
        schemaVersion: BUNDLE_SCHEMA,
        cityId: CITY_ID,
        checkedAtMs: now,
        ttlSeconds: DEFAULT_TTL_SECONDS,
        changedLines: [],
        unchangedLineIds: request.lines.map((line) => line.lineId),
      });
    },
  });
  manager.subscribe((event) => events.push(event.phase));

  const first = await manager.ensureLines(['sync-a', 'sync-b'], {
    cityId: CITY_ID,
    bundleSchema: BUNDLE_SCHEMA,
    bundledVersions: { 'sync-a': 'bundle-v1', 'sync-b': 'bundle-v1' },
  });
  assert.strictEqual(first.success, true);
  assert.deepStrictEqual(events, ['checking', 'success']);
  assert.strictEqual(calls, 1);
  assert.strictEqual(batchWrites, 1, '同步管理器必须整批一次写入所有线路');
  let state = storage.getLineSyncState(CITY_ID, 'sync-a', {
    bundleSchema: BUNDLE_SCHEMA,
    nowMs: now,
  });
  assert.strictEqual(state.version, 'cloud-v1');
  assert.strictEqual(state.lastAlignedAt, now);
  assert.strictEqual(state.ttlSeconds, DEFAULT_TTL_SECONDS, 'v1 缓存 TTL 必须固定为 12 小时');
  assert.deepStrictEqual(state.overrides.map((item) => item.restroomId), ['active']);
  assert.strictEqual(storage.getLineSyncState(CITY_ID, 'sync-a', { bundleSchema: 2 }), null);
  assert.strictEqual(manager.getStatus(['sync-a'], { nowMs: now }).tone, 'green');
  storage.saveLineSyncState({
    cityId: CITY_ID,
    lineId: 'sync-b',
    version: 'cloud-b1',
    lastAlignedAt: now - 500000,
    ttlSeconds: DEFAULT_TTL_SECONDS,
    bundleSchema: BUNDLE_SCHEMA,
    overrides: [],
  });
  const crossLineStatus = manager.getStatus(['sync-a', 'sync-b'], { nowMs: now });
  assert.strictEqual(crossLineStatus.tone, 'green');
  assert.strictEqual(crossLineStatus.lastAlignedAt, now, '跨线最近同步必须取最大 lastAlignedAt');
  storage.saveLineSyncState({
    cityId: CITY_ID,
    lineId: 'sync-b',
    version: 'cloud-b1',
    lastAlignedAt: now - TTL_MS - 1,
    ttlSeconds: DEFAULT_TTL_SECONDS,
    bundleSchema: BUNDLE_SCHEMA,
    overrides: [],
  });
  assert.notStrictEqual(
    manager.getStatus(['sync-a', 'sync-b'], { nowMs: now }).tone,
    'green',
    '任一相关线路过期时都不能显示绿色',
  );

  now += 599000;
  assert.deepStrictEqual(
    manager.getLineOverrides('sync-a', { nowMs: now }).map((item) => item.restroomId),
    ['future'],
    '尚未到生效时间的 override 必须先忽略，并在生效后可用',
  );
  const fresh = await manager.ensureLines(['sync-a'], { bundleSchema: BUNDLE_SCHEMA });
  assert.strictEqual(fresh.skipped, true);
  assert.strictEqual(calls, 1);

  now += 202000;
  assert.deepStrictEqual(
    manager.getLineOverrides('sync-a', { nowMs: now }),
    [],
    '过期 override 必须被忽略',
  );
  const stillFresh = await manager.ensureLines(['sync-a'], { bundleSchema: BUNDLE_SCHEMA });
  assert.strictEqual(stillFresh.skipped, true);
  assert.strictEqual(calls, 1);

  now += TTL_MS - 801000 - 1000;
  const boundaryFresh = await manager.ensureLines(['sync-a'], { bundleSchema: BUNDLE_SCHEMA });
  assert.strictEqual(boundaryFresh.skipped, true, '不足 12 小时时不得检查');
  assert.strictEqual(calls, 1);
  now += 2000;
  const refreshed = await manager.ensureLines(['sync-a'], { bundleSchema: BUNDLE_SCHEMA });
  assert.strictEqual(refreshed.success, true);
  assert.strictEqual(calls, 2);
  state = storage.getLineSyncState(CITY_ID, 'sync-a', {
    bundleSchema: BUNDLE_SCHEMA,
    nowMs: now,
  });
  assert.strictEqual(state.lastAlignedAt, now);
  assert.strictEqual(state.ttlSeconds, DEFAULT_TTL_SECONDS);
  assert.deepStrictEqual(state.overrides, [], '过期 override 在版本未变化时也必须被忽略');
}

async function validateAutomaticFailureBackoff() {
  let now = 2000000;
  let calls = 0;
  const manager = new DataSyncManager({
    storage,
    now: () => now,
    syncRestroomStatus() {
      calls += 1;
      return Promise.reject(retryableError('TIMEOUT'));
    },
  });
  const failed = await manager.ensureLines(['sync-fail'], {
    bundleSchema: BUNDLE_SCHEMA,
    bundledVersions: { 'sync-fail': 'bundle-v1' },
  });
  assert.strictEqual(failed.success, false);
  assert.strictEqual(calls, 1, '后台自动检查不能短时间连续重试');
  const state = storage.getLineSyncState(CITY_ID, 'sync-fail', {
    bundleSchema: BUNDLE_SCHEMA,
    nowMs: now,
  });
  assert.strictEqual(state.lastAlignedAt, 0, '检查失败不得修改最近同步时间');
  assert.strictEqual(state.nextRetryAt, now + AUTO_RETRY_BACKOFF_MS);

  const backedOff = await manager.ensureLines(['sync-fail'], { bundleSchema: BUNDLE_SCHEMA });
  assert.strictEqual(backedOff.skipped, true);
  assert.strictEqual(calls, 1);
  now += AUTO_RETRY_BACKOFF_MS + 1;
  await manager.ensureLines(['sync-fail'], { bundleSchema: BUNDLE_SCHEMA });
  assert.strictEqual(calls, 2);
}

async function validateResponseValidation() {
  let now = 2500000;

  async function run(lineId, changedLine, responsePatch) {
    storage.clearLineSyncState(CITY_ID, lineId);
    storage.clearCitySyncState(CITY_ID);
    now += MANUAL_FAILURE_BLOCK_MS + 1;
    const manager = new DataSyncManager({
      storage,
      now: () => now,
      syncRestroomStatus() {
        return Promise.resolve(Object.assign({
          schemaVersion: BUNDLE_SCHEMA,
          cityId: CITY_ID,
          checkedAtMs: now,
          ttlSeconds: DEFAULT_TTL_SECONDS,
          changedLines: [changedLine],
          unchangedLineIds: [],
        }, responsePatch || {}));
      },
    });
    return manager.ensureLines([lineId], { mode: 'manual', bundleSchema: BUNDLE_SCHEMA });
  }

  let result = await run('sync-invalid', {
    lineId: 'sync-invalid',
    version: 'invalid-v1',
    overrides: [{ restroomId: 'restroom-1', restroomStatus: 'available' }],
  });
  assert.strictEqual(result.code, 'INVALID_SYNC_RESPONSE');
  assert.strictEqual(storage.getLineSyncState(CITY_ID, 'sync-invalid'), null);

  result = await run('sync-invalid', {
    lineId: 'sync-invalid',
    version: '',
    overrides: [],
  });
  assert.strictEqual(result.code, 'INVALID_SYNC_RESPONSE', '空版本不得写入');
  result = await run('sync-invalid', {
    lineId: 'sync-invalid',
    version: 'unsafe/version',
    overrides: [],
  });
  assert.strictEqual(result.code, 'INVALID_SYNC_RESPONSE', '非法版本不得写入');
  result = await run('sync-invalid', {
    lineId: '',
    version: 'invalid-v1',
    overrides: [],
  });
  assert.strictEqual(result.code, 'INVALID_SYNC_RESPONSE', '空 lineId 不得写入');

  result = await run('sync-duplicate', {
    lineId: 'sync-duplicate',
    version: 'duplicate-v1',
    overrides: [
      { restroomId: 'restroom-1', restroomStatus: 'maintenance' },
      { restroomId: 'restroom-1', restroomStatus: 'closed' },
    ],
  });
  assert.strictEqual(result.code, 'INVALID_SYNC_RESPONSE');
  assert.strictEqual(storage.getLineSyncState(CITY_ID, 'sync-duplicate'), null);

  const extraEffectiveFromMs = now - 1000;
  const extraExpiresAtMs = now + 1000;
  result = await run('sync-extra', {
    lineId: 'sync-extra',
    version: 'extra-v1',
    ignoredLineField: 'must-not-store',
    overrides: [{
      restroomId: 'restroom-1',
      restroomStatus: 'maintenance',
      reason: ' 临时维修 ',
      effectiveFromMs: extraEffectiveFromMs,
      expiresAtMs: extraExpiresAtMs,
      ignoredOverrideField: 'must-not-store',
    }],
  });
  assert.strictEqual(result.success, true);
  const extraState = storage.getLineSyncState(CITY_ID, 'sync-extra', {
    bundleSchema: BUNDLE_SCHEMA,
    nowMs: now,
    includeInactive: true,
  });
  assert.strictEqual(extraState.ttlSeconds, DEFAULT_TTL_SECONDS, 'v1 缓存 TTL 必须固定为 12 小时');
  assert.deepStrictEqual(extraState.overrides, [{
    restroomId: 'restroom-1',
    restroomStatus: 'maintenance',
    reason: '临时维修',
    effectiveFromMs: extraEffectiveFromMs,
    expiresAtMs: extraExpiresAtMs,
  }], '额外字段不得写入缓存');

  result = await run('sync-ttl', {
    lineId: 'sync-ttl',
    version: 'ttl-v1',
    overrides: [],
  }, { ttlSeconds: 3600 });
  assert.strictEqual(result.code, 'INVALID_SYNC_RESPONSE', 'v1 非 12 小时 TTL 必须拒绝');
  assert.strictEqual(storage.getLineSyncState(CITY_ID, 'sync-ttl'), null);

  result = await run('sync-ttl', {
    lineId: 'sync-ttl',
    version: 'ttl-v1',
    overrides: [],
  }, { ttlSeconds: undefined });
  assert.strictEqual(result.code, 'INVALID_SYNC_RESPONSE', 'v1 响应缺失 TTL 必须拒绝');
  assert.strictEqual(storage.getLineSyncState(CITY_ID, 'sync-ttl'), null);
}

async function validateManualRetryAndCooldown() {
  let now = 3000000;
  let attempts = 0;
  const sleeps = [];
  const manager = new DataSyncManager({
    storage,
    now: () => now,
    sleep(delayMs) {
      sleeps.push(delayMs);
      return Promise.resolve();
    },
    syncRestroomStatus(request) {
      attempts += 1;
      if (attempts < 3) return Promise.reject(retryableError('CLOUD_CALL_FAILED'));
      return Promise.resolve({
        schemaVersion: BUNDLE_SCHEMA,
        cityId: CITY_ID,
        checkedAtMs: now,
        ttlSeconds: DEFAULT_TTL_SECONDS,
        changedLines: request.lines.map((line) => ({
          lineId: line.lineId,
          version: 'manual-v1',
          bundleSchema: BUNDLE_SCHEMA,
          overrides: [],
        })),
        unchangedLineIds: [],
      });
    },
  });
  const result = await manager.ensureLines(['sync-manual'], {
    mode: 'manual',
    bundleSchema: BUNDLE_SCHEMA,
  });
  assert.strictEqual(result.success, true);
  assert.strictEqual(attempts, 3);
  assert.deepStrictEqual(sleeps, [2000, 5000]);
  assert.strictEqual(storage.getCitySyncState(CITY_ID).lastManualSuccessAt, now);

  const cooledDown = await manager.ensureLines(['sync-manual'], {
    mode: 'manual',
    bundleSchema: BUNDLE_SCHEMA,
  });
  assert.strictEqual(cooledDown.reason, 'manual-cooldown');
  assert.strictEqual(cooledDown.retryAt, now + MANUAL_COOLDOWN_MS);
  assert.strictEqual(attempts, 3);
}

async function validateManualFailureBlock() {
  storage.clearCitySyncState(CITY_ID);
  let now = 4000000;
  let attempts = 0;
  const manager = new DataSyncManager({
    storage,
    now: () => now,
    sleep: () => Promise.resolve(),
    syncRestroomStatus(request) {
      attempts += 1;
      if (attempts <= 3) return Promise.reject(retryableError('TIMEOUT'));
      return Promise.resolve({
        schemaVersion: BUNDLE_SCHEMA,
        cityId: CITY_ID,
        checkedAtMs: now,
        ttlSeconds: DEFAULT_TTL_SECONDS,
        changedLines: request.lines.map((line) => ({
          lineId: line.lineId,
          version: 'manual-retry-v1',
          bundleSchema: BUNDLE_SCHEMA,
          overrides: [],
        })),
        unchangedLineIds: [],
      });
    },
  });
  const failed = await manager.ensureLines(['sync-manual'], {
    mode: 'manual',
    bundleSchema: BUNDLE_SCHEMA,
  });
  assert.strictEqual(failed.success, false);
  assert.strictEqual(attempts, 3);
  assert.strictEqual(storage.getCitySyncState(CITY_ID).lastManualSuccessAt, 0);
  assert.strictEqual(
    storage.getCitySyncState(CITY_ID).manualBlockedUntil,
    now + MANUAL_FAILURE_BLOCK_MS,
  );

  const blocked = await manager.ensureLines(['sync-manual'], {
    mode: 'manual',
    bundleSchema: BUNDLE_SCHEMA,
  });
  assert.strictEqual(blocked.reason, 'manual-failure-block');
  assert.strictEqual(attempts, 3);
  now += MANUAL_FAILURE_BLOCK_MS + 1;
  const retried = await manager.ensureLines(['sync-manual'], {
    mode: 'manual',
    bundleSchema: BUNDLE_SCHEMA,
  });
  assert.strictEqual(retried.success, true);
  assert.strictEqual(attempts, 4);
}

async function validateSingleFlight() {
  storage.clearCitySyncState(CITY_ID);
  let resolveRequest;
  let calls = 0;
  const events = [];
  const renderedPhases = [];
  const manager = new DataSyncManager({
    storage,
    now: () => 5000000,
    syncRestroomStatus(request) {
      calls += 1;
      return new Promise((resolve) => {
        resolveRequest = () => resolve({
          schemaVersion: BUNDLE_SCHEMA,
          cityId: CITY_ID,
          checkedAtMs: 5000000,
          ttlSeconds: DEFAULT_TTL_SECONDS,
          changedLines: request.lines.map((line) => ({
            lineId: line.lineId,
            version: 'single-v1',
            bundleSchema: BUNDLE_SCHEMA,
            overrides: [],
          })),
          unchangedLineIds: [],
        });
      });
    },
  });
  manager.subscribe((event) => {
    events.push(event.phase);
    renderedPhases.push(manager.getStatus(['sync-single']).phase);
  });
  const first = manager.ensureLines(['sync-single'], { bundleSchema: BUNDLE_SCHEMA });
  const second = manager.ensureLines(['sync-single'], { bundleSchema: BUNDLE_SCHEMA });
  await Promise.resolve();
  assert.strictEqual(calls, 1);
  assert.strictEqual(manager.getStatus(['sync-single']).phase, 'checking');
  resolveRequest();
  const results = await Promise.all([first, second]);
  assert.strictEqual(results[0].success, true);
  assert.strictEqual(results[1].success, true);
  assert.deepStrictEqual(events, ['checking', 'success']);
  assert.deepStrictEqual(renderedPhases, ['checking', 'success']);
}

async function main() {
  cleanup();
  try {
    assert.strictEqual(formatDateTime(0), '');
    assert.strictEqual(formatDateTime(Date.UTC(2026, 7, 18, 6, 30)), '2026-08-18 14:30');
    await validateCloudServiceContract();
    validateAtomicBatchStorage();
    await validateStorageAndAutomaticSync();
    await validateAutomaticFailureBackoff();
    await validateResponseValidation();
    await validateManualRetryAndCooldown();
    await validateManualFailureBlock();
    await validateSingleFlight();
    console.log('同步层验收通过：线路缓存、固定 12 小时 TTL、响应白名单、手动冷却、失败重试、退避、single-flight 与固定时间格式。');
  } finally {
    cleanup();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
