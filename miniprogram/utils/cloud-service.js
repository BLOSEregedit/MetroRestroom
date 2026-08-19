const ENV_ID = 'metro-restroom-d4goyb1fq3f9df0b3';
const FUNCTION_NAME = 'metroRestroomApi';
const DEFAULT_TIMEOUT_MS = 10000;

function createError(code, message, details) {
  const error = new Error(message || code);
  error.code = code;
  error.retryAfterSeconds = Number(details && details.retryAfterSeconds) || 0;
  error.retryable = Boolean(details && details.retryable);
  error.isMetroRestroomError = true;
  return error;
}

function normalizeCallError(error) {
  if (error && error.isMetroRestroomError) return error;
  const message = String((error && error.errMsg) || (error && error.message) || '云端请求失败');
  return createError(
    'CLOUD_CALL_FAILED',
    message,
    { retryable: true },
  );
}

function initCloud() {
  if (typeof wx === 'undefined' || !wx.cloud || typeof wx.cloud.init !== 'function') {
    return false;
  }

  wx.cloud.init({ env: ENV_ID, traceUser: true });
  return true;
}

function withTimeout(promise, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(createError(
      'TIMEOUT',
      '云端响应超时',
      { retryable: true },
    )), timeoutMs);
    promise.then((value) => {
      clearTimeout(timer);
      resolve(value);
    }, (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function callApi(action, payload, timeoutMs) {
  if (typeof wx === 'undefined' || !wx.cloud || typeof wx.cloud.callFunction !== 'function') {
    return Promise.reject(createError('CLOUD_UNAVAILABLE', '当前环境不支持云开发'));
  }

  let request;
  try {
    request = wx.cloud.callFunction({
      name: FUNCTION_NAME,
      data: { action, payload: payload || {} },
    });
  } catch (error) {
    return Promise.reject(normalizeCallError(error));
  }

  return withTimeout(request, timeoutMs || DEFAULT_TIMEOUT_MS).then((response) => {
    const result = response && response.result;
    if (!result || result.success !== true) {
      throw createError(
        (result && result.code) || 'CLOUD_ERROR',
        (result && result.message) || '云端请求失败',
        {
          retryAfterSeconds: result && result.retryAfterSeconds,
          retryable: Boolean(result && result.retryable)
            || Boolean(result && ['CLOUD_ERROR', 'INTERNAL_ERROR', 'SERVICE_UNAVAILABLE']
              .includes(result.code)),
        },
      );
    }
    return result.data || {};
  }).catch((error) => Promise.reject(normalizeCallError(error)));
}

function checkDataVersion(localVersion) {
  return callApi('getDataVersion', { localVersion }, 5000);
}

function submitCorrection(report) {
  return callApi('submitCorrection', report, DEFAULT_TIMEOUT_MS);
}

function syncRestroomStatus(request) {
  return callApi('syncRestroomStatus', request, DEFAULT_TIMEOUT_MS);
}

module.exports = {
  ENV_ID,
  FUNCTION_NAME,
  initCloud,
  callApi,
  checkDataVersion,
  submitCorrection,
  syncRestroomStatus,
};
