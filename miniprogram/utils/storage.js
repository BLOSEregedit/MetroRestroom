const STORAGE_KEYS = Object.freeze({
  preferences: "metroRestroom:preferences",
  recentRecords: "metroRestroom:recentRecords",
});

const DEFAULT_PREFERENCES = Object.freeze({
  soundEnabled: true,
  vibrationEnabled: true,
  lineId: "2",
  routeId: "l2-main",
  direction: "to-pudong-airport",
  originStationId: "l2-renmin-square",
  originMode: "smart",
});

const memoryStorage = Object.create(null);

function readStorage(key) {
  if (typeof wx !== "undefined" && typeof wx.getStorageSync === "function") {
    try {
      return wx.getStorageSync(key);
    } catch (error) {
      return memoryStorage[key];
    }
  }

  return memoryStorage[key];
}

function writeStorage(key, value) {
  memoryStorage[key] = value;

  if (typeof wx !== "undefined" && typeof wx.setStorageSync === "function") {
    try {
      wx.setStorageSync(key, value);
    } catch (error) {
      return false;
    }
  }

  return true;
}

function removeStorage(key) {
  delete memoryStorage[key];

  if (typeof wx !== "undefined" && typeof wx.removeStorageSync === "function") {
    try {
      wx.removeStorageSync(key);
    } catch (error) {
      return false;
    }
  }

  return true;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getPreferences() {
  const stored = readStorage(STORAGE_KEYS.preferences);
  return Object.assign(
    {},
    DEFAULT_PREFERENCES,
    isPlainObject(stored) ? stored : {},
  );
}

function savePreferences(patch) {
  const next = Object.assign(
    {},
    getPreferences(),
    isPlainObject(patch) ? patch : {},
  );
  writeStorage(STORAGE_KEYS.preferences, next);
  return next;
}

function resetPreferences() {
  removeStorage(STORAGE_KEYS.preferences);
  return Object.assign({}, DEFAULT_PREFERENCES);
}

function getRecentRecords() {
  const stored = readStorage(STORAGE_KEYS.recentRecords);
  return Array.isArray(stored) ? stored.slice(0, 20) : [];
}

function addRecentRecord(record) {
  if (!isPlainObject(record) || !record.lineId || !record.stationId) {
    throw new TypeError("最近记录必须包含 lineId 和 stationId");
  }

  const nextRecord = Object.assign({}, record, {
    lineId: String(record.lineId),
    stationId: String(record.stationId),
    visitedAt: Number(record.visitedAt) || Date.now(),
  });
  const dedupeKey = `${nextRecord.lineId}:${nextRecord.stationId}`;
  const records = getRecentRecords().filter(
    (item) => `${item.lineId}:${item.stationId}` !== dedupeKey,
  );
  const next = [nextRecord].concat(records).slice(0, 20);

  writeStorage(STORAGE_KEYS.recentRecords, next);
  return next;
}

function clearRecentRecords() {
  removeStorage(STORAGE_KEYS.recentRecords);
  return [];
}

module.exports = {
  STORAGE_KEYS,
  DEFAULT_PREFERENCES,
  getPreferences,
  savePreferences,
  resetPreferences,
  getRecentRecords,
  addRecentRecord,
  clearRecentRecords,
};
