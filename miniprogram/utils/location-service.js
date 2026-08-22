function callWx(api, name, options) {
  return new Promise((resolve, reject) => {
    if (!api || typeof api[name] !== 'function') {
      reject({ errMsg: `${name}:fail api unavailable` });
      return;
    }
    api[name](Object.assign({}, options, { success: resolve, fail: reject }));
  });
}

function errorMessage(error) {
  return String(error && error.errMsg || error && error.message || error || '');
}

function locationIssue(error) {
  const message = errorMessage(error).toLowerCase();
  if (message.indexOf('privacy') >= 0) return 'privacyDenied';
  if (message.indexOf('auth deny') >= 0
    || message.indexOf('authorize:fail') >= 0
    || message.indexOf('permission') >= 0) return 'permissionDenied';
  if (message.indexOf('timeout') >= 0) return 'timeout';
  return 'systemError';
}

function ensurePrivacy(api) {
  if (!api || typeof api.getPrivacySetting !== 'function') return Promise.resolve();
  return callWx(api, 'getPrivacySetting').then((setting) => {
    if (!setting.needAuthorization || typeof api.requirePrivacyAuthorize !== 'function') return null;
    return callWx(api, 'requirePrivacyAuthorize');
  });
}

function ensureLocationPermission(api) {
  return callWx(api, 'getSetting').then((setting) => {
    const authorization = setting.authSetting && setting.authSetting['scope.userLocation'];
    if (authorization === false) {
      return Promise.reject({ errMsg: 'authorize:fail permission denied', permissionDenied: true });
    }
    if (authorization !== true) {
      return callWx(api, 'authorize', { scope: 'scope.userLocation' });
    }
    return null;
  });
}

function requestCurrentPosition(api) {
  return ensurePrivacy(api)
    .then(() => ensureLocationPermission(api))
    .then(() => callWx(api, 'getLocation', {
      type: 'wgs84',
      isHighAccuracy: true,
      highAccuracyExpireTime: 4000,
    }))
    .then((result) => ({
      ok: true,
      position: {
        latitude: Number(result.latitude),
        longitude: Number(result.longitude),
        accuracy: Number(result.accuracy) || 0,
      },
    }))
    .catch((error) => {
      const issue = error.permissionDenied ? 'permissionDenied' : locationIssue(error);
      return {
        ok: false,
        status: issue === 'permissionDenied' || issue === 'privacyDenied' ? 'denied' : 'failed',
        issue,
        message: errorMessage(error),
      };
    });
}

function requestAuthorizedCurrentPosition(api) {
  return callWx(api, 'getSetting')
    .then((setting) => {
      const authorization = setting.authSetting && setting.authSetting['scope.userLocation'];
      if (authorization !== true) {
        return Promise.reject({ errMsg: 'getLocation:fail not authorized', notAuthorized: true });
      }
      return callWx(api, 'getLocation', {
        type: 'wgs84',
        isHighAccuracy: true,
        highAccuracyExpireTime: 4000,
      });
    })
    .then((result) => ({
      ok: true,
      position: {
        latitude: Number(result.latitude),
        longitude: Number(result.longitude),
        accuracy: Number(result.accuracy) || 0,
      },
    }))
    .catch((error) => {
      if (error.notAuthorized) {
        return {
          ok: false,
          status: 'notAuthorized',
          issue: 'notAuthorized',
          message: errorMessage(error),
        };
      }
      const issue = locationIssue(error);
      return {
        ok: false,
        status: issue === 'permissionDenied' || issue === 'privacyDenied' ? 'denied' : 'failed',
        issue,
        message: errorMessage(error),
      };
    });
}

function openLocationSettings(api) {
  return callWx(api, 'openSetting')
    .then((result) => Boolean(result.authSetting && result.authSetting['scope.userLocation']))
    .catch(() => false);
}

module.exports = {
  requestCurrentPosition,
  requestAuthorizedCurrentPosition,
  openLocationSettings,
  locationIssue,
};
