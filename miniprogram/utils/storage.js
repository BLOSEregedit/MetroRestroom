const STORAGE_KEYS = Object.freeze({
  preferences: "metroRestroom:preferences",
  recentRecords: "metroRestroom:recentRecords",
  lastLocationStation: "metroRestroom:lastLocationStation",
  stationLineChoices: "metroRestroom:stationLineChoices",
  correctionDraft: "metroRestroom:correctionDraft",
  lineSyncPrefix: "metroRestroom:lineSync",
  citySyncPrefix: "metroRestroom:citySync",
});

const DEFAULT_PREFERENCES = Object.freeze({
  soundEnabled: true,
  vibrationEnabled: true,
  lineId: "2",
  routeId: "l2-main",
  direction: "to-pudong-airport",
  originStationId: "l2-renmin-square",
  originMode: "smart",
  directionMode: "default",
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
  if (typeof wx !== "undefined" && typeof wx.setStorageSync === "function") {
    try {
      wx.setStorageSync(key, value);
    } catch (error) {
      return false;
    }
  }

  memoryStorage[key] = value;
  return true;
}

function removeStorage(key) {
  if (typeof wx !== "undefined" && typeof wx.removeStorageSync === "function") {
    try {
      wx.removeStorageSync(key);
    } catch (error) {
      return false;
    }
  }

  delete memoryStorage[key];
  return true;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cloneValue(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function normalizeStorageId(value, label) {
  const normalized = String(value || "").trim();
  if (!normalized || !/^[a-zA-Z0-9_-]+$/.test(normalized)) {
    throw new TypeError(`${label}格式不正确`);
  }
  return normalized;
}

function cityLineSyncStorageKey(cityId) {
  return `${STORAGE_KEYS.lineSyncPrefix}:${normalizeStorageId(cityId, "cityId")}`;
}

function legacyLineSyncStorageKey(cityId, lineId) {
  return `${cityLineSyncStorageKey(cityId)}:${normalizeStorageId(lineId, "lineId")}`;
}

function citySyncStorageKey(cityId) {
  return `${STORAGE_KEYS.citySyncPrefix}:${normalizeStorageId(cityId, "cityId")}`;
}

function normalizeTimestamp(value) {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : 0;
}

function overrideExpiresAt(override) {
  if (!isPlainObject(override)) return 0;
  const raw = override.expiresAtMs !== undefined
    ? override.expiresAtMs
    : override.expiresAt;
  if (raw === undefined || raw === null || raw === "") return 0;
  const numeric = Number(raw);
  if (Number.isFinite(numeric)) return numeric;
  const parsed = Date.parse(String(raw));
  return Number.isFinite(parsed) ? parsed : 0;
}

function overrideEffectiveFrom(override) {
  if (!isPlainObject(override)) return 0;
  const raw = override.effectiveFromMs;
  if (raw === undefined || raw === null || raw === "") return 0;
  const numeric = Number(raw);
  return Number.isFinite(numeric) ? numeric : 0;
}

function filterActiveOverrides(overrides, nowMs) {
  const now = normalizeTimestamp(nowMs) || Date.now();
  return (Array.isArray(overrides) ? overrides : []).filter((override) => {
    if (!isPlainObject(override)) return false;
    const effectiveFrom = overrideEffectiveFrom(override);
    const expiresAt = overrideExpiresAt(override);
    return (!effectiveFrom || effectiveFrom <= now) && (!expiresAt || expiresAt > now);
  }).map((override) => cloneValue(override));
}

function readCityLineSyncState(cityId) {
  const normalizedCityId = normalizeStorageId(cityId, "cityId");
  const stored = readStorage(cityLineSyncStorageKey(normalizedCityId));
  return {
    cityId: normalizedCityId,
    lines: isPlainObject(stored) && isPlainObject(stored.lines)
      ? cloneValue(stored.lines)
      : {},
  };
}

function normalizeLineSyncState(state, cityId, lineId) {
  if (!isPlainObject(state)) throw new TypeError("线路同步状态必须是对象");
  const normalizedCityId = normalizeStorageId(state.cityId || cityId, "cityId");
  const normalizedLineId = normalizeStorageId(state.lineId || lineId, "lineId");
  if (state.bundleSchema === undefined || state.bundleSchema === null || state.bundleSchema === "") {
    throw new TypeError("线路同步状态必须包含 bundleSchema");
  }
  if (state.overrides !== undefined && !Array.isArray(state.overrides)) {
    throw new TypeError("线路同步状态 overrides 必须是数组");
  }
  return {
    cityId: normalizedCityId,
    lineId: normalizedLineId,
    version: typeof state.version === "string" ? state.version : "",
    lastAlignedAt: normalizeTimestamp(state.lastAlignedAt),
    nextRetryAt: normalizeTimestamp(state.nextRetryAt),
    ttlSeconds: Number(state.ttlSeconds) > 0 ? Number(state.ttlSeconds) : 0,
    bundleSchema: cloneValue(state.bundleSchema),
    overrides: (state.overrides || []).filter(isPlainObject).map((override) => cloneValue(override)),
  };
}

function getLineSyncState(cityId, lineId, options) {
  const normalizedCityId = normalizeStorageId(cityId, "cityId");
  const normalizedLineId = normalizeStorageId(lineId, "lineId");
  const cityState = readCityLineSyncState(normalizedCityId);
  const stored = cityState.lines[normalizedLineId]
    || readStorage(legacyLineSyncStorageKey(normalizedCityId, normalizedLineId));
  if (!isPlainObject(stored)) return null;

  const expectedBundleSchema = options && options.bundleSchema;
  if (expectedBundleSchema !== undefined
    && String(stored.bundleSchema) !== String(expectedBundleSchema)) {
    return null;
  }

  return {
    cityId: String(stored.cityId || normalizedCityId),
    lineId: String(stored.lineId || normalizedLineId),
    version: typeof stored.version === "string" ? stored.version : "",
    lastAlignedAt: normalizeTimestamp(stored.lastAlignedAt),
    nextRetryAt: normalizeTimestamp(stored.nextRetryAt),
    ttlSeconds: Number(stored.ttlSeconds) > 0 ? Number(stored.ttlSeconds) : 0,
    bundleSchema: stored.bundleSchema,
    overrides: options && options.includeInactive
      ? cloneValue(Array.isArray(stored.overrides) ? stored.overrides : [])
      : filterActiveOverrides(stored.overrides, options && options.nowMs),
  };
}

function saveLineSyncStates(cityId, states) {
  const current = readCityLineSyncState(cityId);
  if (!Array.isArray(states) || !states.length) {
    throw new TypeError("批量线路同步状态不能为空");
  }
  const normalizedStates = states.map((state) => {
    const normalized = normalizeLineSyncState(state, current.cityId, state && state.lineId);
    if (normalized.cityId !== current.cityId) throw new TypeError("批量线路 cityId 必须一致");
    return normalized;
  });
  const nextLines = cloneValue(current.lines);
  normalizedStates.forEach((state) => { nextLines[state.lineId] = state; });
  const next = { cityId: current.cityId, lines: nextLines };
  if (!writeStorage(cityLineSyncStorageKey(current.cityId), next)) {
    throw new Error("批量线路同步状态写入失败");
  }
  return cloneValue(normalizedStates);
}

function saveLineSyncState(state) {
  return saveLineSyncStates(state && state.cityId, [state])[0];
}

function clearLineSyncState(cityId, lineId) {
  const current = readCityLineSyncState(cityId);
  const normalizedLineId = normalizeStorageId(lineId, "lineId");
  const nextLines = cloneValue(current.lines);
  delete nextLines[normalizedLineId];
  const citySaved = writeStorage(cityLineSyncStorageKey(current.cityId), {
    cityId: current.cityId,
    lines: nextLines,
  });
  if (!citySaved) return false;
  return removeStorage(legacyLineSyncStorageKey(current.cityId, normalizedLineId));
}

function getCitySyncState(cityId) {
  const normalizedCityId = normalizeStorageId(cityId, "cityId");
  const stored = readStorage(citySyncStorageKey(normalizedCityId));
  return {
    cityId: normalizedCityId,
    lastManualSuccessAt: isPlainObject(stored)
      ? normalizeTimestamp(stored.lastManualSuccessAt)
      : 0,
    manualBlockedUntil: isPlainObject(stored)
      ? normalizeTimestamp(stored.manualBlockedUntil)
      : 0,
  };
}

function saveCitySyncState(cityId, patch) {
  const current = getCitySyncState(cityId);
  const input = isPlainObject(patch) ? patch : {};
  const next = {
    cityId: current.cityId,
    lastManualSuccessAt: input.lastManualSuccessAt === undefined
      ? current.lastManualSuccessAt
      : normalizeTimestamp(input.lastManualSuccessAt),
    manualBlockedUntil: input.manualBlockedUntil === undefined
      ? current.manualBlockedUntil
      : normalizeTimestamp(input.manualBlockedUntil),
  };
  if (!writeStorage(citySyncStorageKey(current.cityId), next)) {
    throw new Error("城市同步状态写入失败");
  }
  return cloneValue(next);
}

function clearCitySyncState(cityId) {
  return removeStorage(citySyncStorageKey(cityId));
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

function getLastLocationStation() {
  const stored = readStorage(STORAGE_KEYS.lastLocationStation);
  return isPlainObject(stored) && stored.lineStationId
    ? Object.assign({}, stored)
    : null;
}

function saveLastLocationStation(station) {
  if (!isPlainObject(station) || !station.lineStationId) {
    throw new TypeError("最近定位站必须包含 lineStationId");
  }
  const next = {
    lineStationId: String(station.lineStationId),
    physicalStationId: String(station.physicalStationId || ""),
    locatedAt: Number(station.locatedAt) || Date.now(),
  };
  writeStorage(STORAGE_KEYS.lastLocationStation, next);
  return next;
}

function clearLastLocationStation() {
  removeStorage(STORAGE_KEYS.lastLocationStation);
  return null;
}

function getStationLineChoices() {
  const stored = readStorage(STORAGE_KEYS.stationLineChoices);
  return isPlainObject(stored) ? cloneValue(stored) : {};
}

function getStationLineChoice(physicalStationId) {
  const stationId = normalizeStorageId(physicalStationId, "physicalStationId");
  const choice = getStationLineChoices()[stationId];
  return isPlainObject(choice) && choice.lineStationId
    ? cloneValue(choice)
    : null;
}

function saveStationLineChoice(physicalStationId, choice) {
  const stationId = normalizeStorageId(physicalStationId, "physicalStationId");
  if (!isPlainObject(choice) || !choice.lineStationId) {
    throw new TypeError("换乘站线路偏好必须包含 lineStationId");
  }
  const choices = getStationLineChoices();
  choices[stationId] = {
    lineStationId: normalizeStorageId(choice.lineStationId, "lineStationId"),
    chosenAt: Number(choice.chosenAt) || Date.now(),
  };
  writeStorage(STORAGE_KEYS.stationLineChoices, choices);
  return cloneValue(choices[stationId]);
}

function clearStationLineChoices() {
  removeStorage(STORAGE_KEYS.stationLineChoices);
  return {};
}

function getCorrectionDraft() {
  const stored = readStorage(STORAGE_KEYS.correctionDraft);
  return isPlainObject(stored) ? Object.assign({}, stored) : null;
}

function saveCorrectionDraft(draft) {
  if (!isPlainObject(draft) || !isPlainObject(draft.context)) {
    throw new TypeError("纠错草稿必须包含 context");
  }
  const next = Object.assign({}, draft, { updatedAt: Date.now() });
  writeStorage(STORAGE_KEYS.correctionDraft, next);
  return next;
}

function clearCorrectionDraft() {
  removeStorage(STORAGE_KEYS.correctionDraft);
  return null;
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
  getLastLocationStation,
  saveLastLocationStation,
  clearLastLocationStation,
  getStationLineChoice,
  saveStationLineChoice,
  clearStationLineChoices,
  getCorrectionDraft,
  saveCorrectionDraft,
  clearCorrectionDraft,
  getLineSyncState,
  saveLineSyncState,
  saveLineSyncStates,
  clearLineSyncState,
  getCitySyncState,
  saveCitySyncState,
  clearCitySyncState,
  filterActiveOverrides,
};
