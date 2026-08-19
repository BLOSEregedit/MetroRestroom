const crypto = require('crypto');
const cloud = require('wx-server-sdk');
const { normalizeCorrection, stableStringify } = require('./validator');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database({ throwOnNotFound: false });

const COLLECTIONS = Object.freeze({
  versions: 'data_versions',
  reports: 'correction_reports',
  rateLimits: 'correction_rate_limits',
});
const MAX_DAILY_REPORTS = 5;
const MIN_INTERVAL_MS = 30000;
const SYNC_SCHEMA_VERSION = 1;
const SYNC_CITY_ID = 'shanghai';
const SYNC_MANIFEST_ID = 'sync_manifest_shanghai';
const DEFAULT_SYNC_TTL_SECONDS = 12 * 60 * 60;
const MAX_SYNC_LINES = 20;
const MAX_LINE_OVERRIDES = 128;
const KNOWN_LINE_IDS = new Set([
  '1', '2', '3', '4', '5', '6', '7', '8', '9',
  '10', '11', '12', '13', '14', '15', '16', '17', '18', 'pujiang',
]);
const RESTROOM_STATUSES = new Set(['maintenance', 'closed', 'unknown']);
const SAFE_ID_PATTERN = /^[a-zA-Z0-9:_-]+$/;
const SAFE_VERSION_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

function digest(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function dayBucket(timestamp) {
  return new Date(timestamp + (8 * 60 * 60 * 1000)).toISOString().slice(0, 10);
}

function success(data) {
  return { success: true, data: data || {} };
}

function failure(code, message, retryAfterSeconds) {
  return {
    success: false,
    code,
    message,
    retryAfterSeconds: Number(retryAfterSeconds) || 0,
  };
}

function businessError(code, retryAfterSeconds) {
  throw new Error(`METRO_BUSINESS:${code}:${Number(retryAfterSeconds) || 0}`);
}

function parseBusinessError(error) {
  const match = String((error && error.message) || error || '')
    .match(/METRO_BUSINESS:([A-Z_]+):(\d+)/);
  return match ? { code: match[1], retryAfterSeconds: Number(match[2]) || 0 } : null;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function syncRequestError(message) {
  const error = new Error(message);
  error.code = 'INVALID_ARGUMENT';
  return error;
}

function syncDataError() {
  const error = new Error('云端数据暂未就绪');
  error.code = 'DATA_NOT_READY';
  return error;
}

function normalizeSyncRequest(payload) {
  if (!isPlainObject(payload)) throw syncRequestError('payload格式错误');
  if (payload.schemaVersion !== SYNC_SCHEMA_VERSION) {
    throw syncRequestError('schemaVersion不支持');
  }
  if (payload.cityId !== SYNC_CITY_ID) throw syncRequestError('cityId不支持');
  if (!Array.isArray(payload.lines) || payload.lines.length < 1) {
    throw syncRequestError('lines不能为空');
  }
  if (payload.lines.length > MAX_SYNC_LINES) throw syncRequestError('lines数量过多');

  const seen = new Set();
  const lines = payload.lines.map((item) => {
    if (!isPlainObject(item)) throw syncRequestError('lines格式错误');
    const lineId = typeof item.lineId === 'string' ? item.lineId.trim() : '';
    if (typeof item.version !== 'string') throw syncRequestError('version格式错误');
    const version = item.version.trim();
    if (!KNOWN_LINE_IDS.has(lineId)) throw syncRequestError('lineId不支持');
    if (seen.has(lineId)) throw syncRequestError('lineId不能重复');
    if (version && !SAFE_VERSION_PATTERN.test(version)) {
      throw syncRequestError('version格式错误');
    }
    seen.add(lineId);
    return { lineId, version };
  });

  return { cityId: SYNC_CITY_ID, lines };
}

function normalizeSyncTtl(value) {
  if (value === undefined || value === null) return DEFAULT_SYNC_TTL_SECONDS;
  if (value !== DEFAULT_SYNC_TTL_SECONDS) throw syncDataError();
  return DEFAULT_SYNC_TTL_SECONDS;
}

function normalizeOptionalTimestamp(value) {
  if (value === undefined || value === null) return undefined;
  if (!Number.isSafeInteger(value) || value <= 0) throw syncDataError();
  return value;
}

function normalizeStatusOverride(value) {
  if (!isPlainObject(value)) throw syncDataError();
  const restroomId = typeof value.restroomId === 'string' ? value.restroomId.trim() : '';
  if (!restroomId || restroomId.length > 80 || !SAFE_ID_PATTERN.test(restroomId)) {
    throw syncDataError();
  }
  if (!RESTROOM_STATUSES.has(value.restroomStatus)) throw syncDataError();

  const result = {
    restroomId,
    restroomStatus: value.restroomStatus,
  };
  if (value.reason !== undefined && value.reason !== null) {
    if (typeof value.reason !== 'string') throw syncDataError();
    const reason = value.reason.trim();
    if (reason.length > 120) throw syncDataError();
    if (reason) result.reason = reason;
  }

  const effectiveFromMs = normalizeOptionalTimestamp(value.effectiveFromMs);
  const expiresAtMs = normalizeOptionalTimestamp(value.expiresAtMs);
  if (effectiveFromMs !== undefined) result.effectiveFromMs = effectiveFromMs;
  if (expiresAtMs !== undefined) result.expiresAtMs = expiresAtMs;
  if (effectiveFromMs !== undefined && expiresAtMs !== undefined && expiresAtMs <= effectiveFromMs) {
    throw syncDataError();
  }
  return result;
}

function normalizeLineSnapshot(snapshot, lineId, version) {
  if (!isPlainObject(snapshot)
    || snapshot.schemaVersion !== SYNC_SCHEMA_VERSION
    || snapshot.cityId !== SYNC_CITY_ID
    || snapshot.lineId !== lineId
    || snapshot.version !== version
    || !Array.isArray(snapshot.overrides)
    || snapshot.overrides.length > MAX_LINE_OVERRIDES) {
    throw syncDataError();
  }

  const seen = new Set();
  const overrides = snapshot.overrides.map((item) => {
    const normalized = normalizeStatusOverride(item);
    if (seen.has(normalized.restroomId)) throw syncDataError();
    seen.add(normalized.restroomId);
    return normalized;
  });
  return { lineId, version, overrides };
}

function getManifestLineVersion(manifest, lineId) {
  if (!isPlainObject(manifest)
    || manifest.schemaVersion !== SYNC_SCHEMA_VERSION
    || manifest.cityId !== SYNC_CITY_ID
    || !isPlainObject(manifest.lineVersions)) {
    throw syncDataError();
  }
  const version = manifest.lineVersions[lineId];
  if (typeof version !== 'string' || !SAFE_VERSION_PATTERN.test(version)) {
    throw syncDataError();
  }
  return version;
}

function lineSnapshotId(lineId, version) {
  return `sync_line_${SYNC_CITY_ID}_${lineId}_${version}`;
}

async function syncRestroomStatus(event) {
  let request;
  try {
    request = normalizeSyncRequest(event && event.payload);
  } catch (error) {
    return failure('INVALID_ARGUMENT', error.message || '同步参数错误');
  }

  try {
    const manifestResult = await db.collection(COLLECTIONS.versions).doc(SYNC_MANIFEST_ID).get();
    const manifest = manifestResult && manifestResult.data;
    const ttlSeconds = normalizeSyncTtl(manifest && manifest.ttlSeconds);
    const comparisons = request.lines.map((line) => ({
      lineId: line.lineId,
      localVersion: line.version,
      version: getManifestLineVersion(manifest, line.lineId),
    }));
    const unchangedLineIds = comparisons
      .filter((line) => line.localVersion === line.version)
      .map((line) => line.lineId);
    const changed = comparisons.filter((line) => line.localVersion !== line.version);
    const changedLines = await Promise.all(changed.map(async (line) => {
      const snapshotResult = await db.collection(COLLECTIONS.versions)
        .doc(lineSnapshotId(line.lineId, line.version))
        .get();
      return normalizeLineSnapshot(snapshotResult && snapshotResult.data, line.lineId, line.version);
    }));

    return success({
      schemaVersion: SYNC_SCHEMA_VERSION,
      cityId: SYNC_CITY_ID,
      checkedAtMs: Date.now(),
      ttlSeconds,
      unchangedLineIds,
      changedLines,
    });
  } catch (error) {
    if (error && error.code === 'DATA_NOT_READY') {
      return failure('DATA_NOT_READY', '云端数据暂未就绪', 900);
    }
    return failure('INTERNAL_ERROR', '暂时无法检查更新');
  }
}

async function getDataVersion(event) {
  const localVersion = event && event.payload && typeof event.payload.localVersion === 'string'
    ? event.payload.localVersion.slice(0, 128)
    : '';
  try {
    const response = await db.collection(COLLECTIONS.versions).doc('restroom-data').get();
    const version = response && response.data;
    if (!version || !version.latestVersion) {
      return success({ available: false, localVersion });
    }
    return success({
      available: true,
      localVersion,
      latestVersion: version.latestVersion,
      updateAvailable: Boolean(localVersion && version.latestVersion !== localVersion),
      releaseNote: version.releaseNote || '',
      updatedAt: version.updatedAt || null,
    });
  } catch (error) {
    return success({ available: false, localVersion });
  }
}

async function submitCorrection(event) {
  const wxContext = cloud.getWXContext();
  if (!wxContext || !wxContext.OPENID) {
    return failure('UNAUTHENTICATED', '无法识别匿名用户');
  }

  let report;
  try {
    report = normalizeCorrection(event && event.payload);
  } catch (error) {
    return failure(error.code || 'INVALID_ARGUMENT', error.message || '提交内容不完整');
  }

  const now = Date.now();
  const userKey = digest(`metro-restroom:user:v1:${wxContext.OPENID}`);
  const reportId = digest(`metro-restroom:report:v1:${wxContext.OPENID}:${report.requestId}`);
  const payloadHash = digest(stableStringify(report));
  const bucket = dayBucket(now);
  const limitId = digest(`metro-restroom:limit:v1:${userKey}:${bucket}`);

  try {
    const transactionResult = await db.runTransaction(async (transaction) => {
      const reportRef = transaction.collection(COLLECTIONS.reports).doc(reportId);
      const existingResult = await reportRef.get();
      const existing = existingResult && existingResult.data;
      if (existing) {
        if (existing.payloadHash !== payloadHash) businessError('IDEMPOTENCY_CONFLICT');
        return { reportId, duplicate: true };
      }

      const limitRef = transaction.collection(COLLECTIONS.rateLimits).doc(limitId);
      const limitResult = await limitRef.get();
      const limit = (limitResult && limitResult.data) || {};
      const count = Number(limit.count) || 0;
      const lastAcceptedAtMs = Number(limit.lastAcceptedAtMs) || 0;
      if (count >= MAX_DAILY_REPORTS) businessError('RATE_LIMITED', 86400);
      if (lastAcceptedAtMs && now - lastAcceptedAtMs < MIN_INTERVAL_MS) {
        businessError('RATE_LIMITED', Math.ceil((MIN_INTERVAL_MS - (now - lastAcceptedAtMs)) / 1000));
      }

      await limitRef.set({
        data: {
          userKey,
          bucket,
          count: count + 1,
          lastAcceptedAtMs: now,
          updatedAt: db.serverDate(),
        },
      });
      await reportRef.set({
        data: Object.assign({}, report, {
          userKey,
          payloadHash,
          status: 'pending',
          createdAt: db.serverDate(),
          createdAtMs: now,
          updatedAt: db.serverDate(),
        }),
      });
      return { reportId, duplicate: false };
    });
    return success(transactionResult);
  } catch (error) {
    const business = parseBusinessError(error);
    if (business) {
      return failure(
        business.code,
        business.code === 'RATE_LIMITED' ? '提交太频繁，请稍后再试' : '同一请求包含了不同内容',
        business.retryAfterSeconds,
      );
    }
    return failure('INTERNAL_ERROR', '暂时无法提交，请稍后重试');
  }
}

exports.main = async (event) => {
  switch (event && event.action) {
    case 'getDataVersion':
      return getDataVersion(event);
    case 'syncRestroomStatus':
      return syncRestroomStatus(event);
    case 'submitCorrection':
      return submitCorrection(event);
    default:
      return failure('INVALID_ACTION', '不支持的操作');
  }
};

exports._test = {
  dayBucket,
  digest,
  parseBusinessError,
};
