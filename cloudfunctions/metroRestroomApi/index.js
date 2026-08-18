const crypto = require('crypto');
const cloud = require('wx-server-sdk');
const { normalizeCorrection, stableStringify } = require('./validator');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const COLLECTIONS = Object.freeze({
  versions: 'data_versions',
  reports: 'correction_reports',
  rateLimits: 'correction_rate_limits',
});
const MAX_DAILY_REPORTS = 5;
const MIN_INTERVAL_MS = 30000;

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
