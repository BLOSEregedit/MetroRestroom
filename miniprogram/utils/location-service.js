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

function normalizePosition(result) {
  const latitude = Number(result && result.latitude);
  const longitude = Number(result && result.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return {
    latitude,
    longitude,
    accuracy: Number(result.accuracy || result.horizontalAccuracy) || 0,
  };
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
    .then((result) => {
      const position = normalizePosition(result);
      if (!position) throw { errMsg: 'getLocation:fail invalid position' };
      return { ok: true, position };
    })
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
    .then((result) => {
      const position = normalizePosition(result);
      if (!position) throw { errMsg: 'getLocation:fail invalid position' };
      return { ok: true, position };
    })
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

function startForegroundLocation(api, onPosition, onError) {
  if (!api
    || typeof api.startLocationUpdate !== 'function'
    || typeof api.onLocationChange !== 'function') {
    return Promise.resolve({ ok: false, status: 'unavailable', issue: 'apiUnavailable' });
  }

  return callWx(api, 'getSetting')
    .then((setting) => {
      const authorization = setting.authSetting && setting.authSetting['scope.userLocation'];
      if (authorization !== true) {
        return Promise.reject({
          errMsg: 'startLocationUpdate:fail not authorized',
          notAuthorized: true,
        });
      }

      const locationListener = (result) => {
        const position = normalizePosition(result);
        if (position && typeof onPosition === 'function') onPosition(position);
      };
      const errorListener = (error) => {
        if (typeof onError === 'function') onError(error || {});
      };
      const detachListeners = () => {
        try {
          if (typeof api.offLocationChange === 'function') api.offLocationChange(locationListener);
        } catch (error) {
          // 监听清理失败不应阻塞单次定位降级。
        }
        try {
          if (typeof api.offLocationChangeError === 'function') {
            api.offLocationChangeError(errorListener);
          }
        } catch (error) {
          // 监听清理失败不应阻塞单次定位降级。
        }
      };
      try {
        api.onLocationChange(locationListener);
        if (typeof api.onLocationChangeError === 'function') {
          api.onLocationChangeError(errorListener);
        }
      } catch (error) {
        detachListeners();
        return Promise.reject(error);
      }

      return callWx(api, 'startLocationUpdate', { type: 'wgs84' })
        .then(() => {
          let stopped = false;
          return {
            ok: true,
            stop() {
              if (stopped) return Promise.resolve(true);
              stopped = true;
              detachListeners();
              if (typeof api.stopLocationUpdate !== 'function') return Promise.resolve(false);
              return callWx(api, 'stopLocationUpdate').then(() => true).catch(() => false);
            },
          };
        })
        .catch((error) => {
          detachListeners();
          return {
            ok: false,
            status: 'failed',
            issue: locationIssue(error),
            message: errorMessage(error),
          };
        });
    })
    .catch((error) => ({
      ok: false,
      status: error.notAuthorized ? 'notAuthorized' : 'failed',
      issue: error.notAuthorized ? 'notAuthorized' : locationIssue(error),
      message: errorMessage(error),
    }));
}

module.exports = {
  requestCurrentPosition,
  requestAuthorizedCurrentPosition,
  startForegroundLocation,
  openLocationSettings,
  locationIssue,
};
