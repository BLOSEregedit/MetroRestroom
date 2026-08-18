const ENV_ID = 'metro-restroom-d4goyb1fq3f9df0b3';
const FUNCTION_NAME = 'metroRestroomApi';
const DEFAULT_TIMEOUT_MS = 10000;

function createError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
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
    const timer = setTimeout(() => reject(createError('TIMEOUT', '云端响应超时')), timeoutMs);
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

  return withTimeout(wx.cloud.callFunction({
    name: FUNCTION_NAME,
    data: { action, payload: payload || {} },
  }), timeoutMs || DEFAULT_TIMEOUT_MS).then((response) => {
    const result = response && response.result;
    if (!result || result.success !== true) {
      throw createError(
        (result && result.code) || 'CLOUD_ERROR',
        (result && result.message) || '云端请求失败',
      );
    }
    return result.data || {};
  });
}

function checkDataVersion(localVersion) {
  return callApi('getDataVersion', { localVersion }, 5000);
}

function submitCorrection(report) {
  return callApi('submitCorrection', report, DEFAULT_TIMEOUT_MS);
}

module.exports = {
  ENV_ID,
  FUNCTION_NAME,
  initCloud,
  callApi,
  checkDataVersion,
  submitCorrection,
};
