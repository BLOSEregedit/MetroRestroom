const cloudService = require('./cloud-service');
const storage = require('./storage');

const DEFAULT_CITY_ID = 'shanghai';
const DEFAULT_BUNDLE_SCHEMA = 1;
const DEFAULT_TTL_SECONDS = 12 * 60 * 60;
const MANUAL_COOLDOWN_MS = 5 * 60 * 1000;
const MANUAL_FAILURE_BLOCK_MS = 10 * 1000;
const AUTO_RETRY_BACKOFF_MS = 15 * 60 * 1000;
const MANUAL_RETRY_DELAYS_MS = Object.freeze([2000, 5000]);
const MAX_LINE_OVERRIDES = 128;
const RESTROOM_STATUSES = new Set(['maintenance', 'closed', 'unknown']);
const SAFE_ID_PATTERN = /^[a-zA-Z0-9:_-]+$/;
const SAFE_LINE_ID_PATTERN = /^[a-zA-Z0-9_-]{1,20}$/;
const SAFE_VERSION_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

function normalizeLineIds(lineIds) {
  const seen = Object.create(null);
  return (Array.isArray(lineIds) ? lineIds : [lineIds]).map((lineId) => (
    String(lineId || '').trim()
  )).filter((lineId) => {
    if (!lineId || seen[lineId]) return false;
    seen[lineId] = true;
    return true;
  }).sort((left, right) => left.localeCompare(right, 'zh-CN', { numeric: true }));
}

function pad(value) {
  return String(value).padStart(2, '0');
}

function formatDateTime(timestamp) {
  const value = Number(timestamp);
  if (!Number.isFinite(value) || value <= 0) return '';
  const date = new Date(value + (8 * 60 * 60 * 1000));
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

function createSyncError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  error.retryable = false;
  return error;
}

function normalizeOptionalTimestamp(value, lineId) {
  if (value === undefined || value === null) return undefined;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw createSyncError('INVALID_SYNC_RESPONSE', `线路 ${lineId} 的状态时间不正确`);
  }
  return value;
}

function normalizeStatusOverride(value, lineId) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw createSyncError('INVALID_SYNC_RESPONSE', `线路 ${lineId} 的状态覆盖格式不正确`);
  }
  const restroomId = typeof value.restroomId === 'string' ? value.restroomId.trim() : '';
  if (!restroomId || restroomId.length > 80 || !SAFE_ID_PATTERN.test(restroomId)) {
    throw createSyncError('INVALID_SYNC_RESPONSE', `线路 ${lineId} 的卫生间 ID 不正确`);
  }
  if (!RESTROOM_STATUSES.has(value.restroomStatus)) {
    throw createSyncError('INVALID_SYNC_RESPONSE', `线路 ${lineId} 的卫生间状态不正确`);
  }

  const normalized = { restroomId, restroomStatus: value.restroomStatus };
  if (value.reason !== undefined && value.reason !== null) {
    if (typeof value.reason !== 'string') {
      throw createSyncError('INVALID_SYNC_RESPONSE', `线路 ${lineId} 的状态原因不正确`);
    }
    const reason = value.reason.trim();
    if (reason.length > 120) {
      throw createSyncError('INVALID_SYNC_RESPONSE', `线路 ${lineId} 的状态原因过长`);
    }
    if (reason) normalized.reason = reason;
  }

  const effectiveFromMs = normalizeOptionalTimestamp(value.effectiveFromMs, lineId);
  const expiresAtMs = normalizeOptionalTimestamp(value.expiresAtMs, lineId);
  if (effectiveFromMs !== undefined) normalized.effectiveFromMs = effectiveFromMs;
  if (expiresAtMs !== undefined) normalized.expiresAtMs = expiresAtMs;
  if (effectiveFromMs !== undefined && expiresAtMs !== undefined && expiresAtMs <= effectiveFromMs) {
    throw createSyncError('INVALID_SYNC_RESPONSE', `线路 ${lineId} 的状态时间范围不正确`);
  }
  return normalized;
}

function isRetryableError(error) {
  if (error && typeof error.retryable === 'boolean') return error.retryable;
  return Boolean(error && [
    'TIMEOUT',
    'CLOUD_CALL_FAILED',
    'CLOUD_ERROR',
    'INTERNAL_ERROR',
    'SERVICE_UNAVAILABLE',
  ].includes(error.code));
}

function intersects(left, right) {
  const lookup = new Set(left);
  return right.some((item) => lookup.has(item));
}

function isSubset(subset, superset) {
  const lookup = new Set(superset);
  return subset.every((item) => lookup.has(item));
}

class DataSyncManager {
  constructor(options) {
    const input = options || {};
    this._storage = input.storage || storage;
    this._syncRestroomStatus = input.syncRestroomStatus || cloudService.syncRestroomStatus;
    this._now = typeof input.now === 'function' ? input.now : Date.now;
    this._sleep = typeof input.sleep === 'function'
      ? input.sleep
      : (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs));
    this._listeners = new Set();
    this._failures = Object.create(null);
    this._inFlight = null;
    this._lastEvent = null;
    this._lastStorageError = null;
    this._lastSubscriberError = null;
  }

  subscribe(listener) {
    if (typeof listener !== 'function') throw new TypeError('同步状态订阅者必须是函数');
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  getLastEvent() {
    return this._lastEvent ? Object.assign({}, this._lastEvent) : null;
  }

  getLineOverrides(lineId, options) {
    const input = options || {};
    const cityId = input.cityId || DEFAULT_CITY_ID;
    const bundleSchema = input.bundleSchema === undefined
      ? DEFAULT_BUNDLE_SCHEMA
      : input.bundleSchema;
    const state = this._storage.getLineSyncState(cityId, lineId, {
      bundleSchema,
      nowMs: input.nowMs || this._now(),
    });
    return state ? state.overrides : [];
  }

  getStatus(lineIds, options) {
    const input = options || {};
    const cityId = input.cityId || DEFAULT_CITY_ID;
    const bundleSchema = input.bundleSchema === undefined
      ? DEFAULT_BUNDLE_SCHEMA
      : input.bundleSchema;
    const normalizedLineIds = normalizeLineIds(lineIds);
    const now = input.nowMs || this._now();
    const states = normalizedLineIds.map((lineId) => this._storage.getLineSyncState(
      cityId,
      lineId,
      { bundleSchema, nowMs: now },
    ));
    const lastAlignedAt = states.reduce(
      (latest, state) => Math.max(latest, Number(state && state.lastAlignedAt) || 0),
      0,
    );
    const isChecking = Boolean(this._inFlight
      && this._inFlight.cityId === cityId
      && intersects(normalizedLineIds, this._inFlight.lineIds));
    const hasFailure = normalizedLineIds.some((lineId, index) => {
      const state = states[index];
      return Boolean(this._failures[`${cityId}:${lineId}`])
        || Boolean(state && state.nextRetryAt > now && !this._isFresh(state, now));
    });
    const allFresh = normalizedLineIds.length > 0
      && states.every((state) => this._isFresh(state, now));

    if (isChecking) {
      return {
        phase: 'checking',
        tone: 'orange',
        message: '正在检查最新数据',
        lastAlignedAt,
      };
    }
    if (hasFailure) {
      return {
        phase: 'failed',
        tone: 'gray',
        message: lastAlignedAt
          ? `检查失败 · 最近同步 ${formatDateTime(lastAlignedAt)}`
          : '检查失败 · 尚未完成首次同步',
        lastAlignedAt,
      };
    }
    if (allFresh) {
      return {
        phase: 'success',
        tone: 'green',
        message: `数据正常 · 最近同步 ${formatDateTime(lastAlignedAt)}`,
        lastAlignedAt,
      };
    }
    return {
      phase: 'idle',
      tone: 'gray',
      message: lastAlignedAt
        ? `最近同步 ${formatDateTime(lastAlignedAt)}`
        : '尚未完成首次同步',
      lastAlignedAt,
    };
  }

  ensureLines(lineIds, options) {
    const input = options || {};
    const cityId = input.cityId || DEFAULT_CITY_ID;
    const bundleSchema = input.bundleSchema === undefined
      ? DEFAULT_BUNDLE_SCHEMA
      : input.bundleSchema;
    const mode = input.mode === 'manual' ? 'manual' : 'auto';
    const normalizedLineIds = normalizeLineIds(lineIds);
    const now = this._now();

    if (!normalizedLineIds.length) {
      return Promise.resolve({ success: true, skipped: true, reason: 'no-lines', lineIds: [] });
    }

    if (this._inFlight) {
      if (this._inFlight.cityId === cityId
        && isSubset(normalizedLineIds, this._inFlight.lineIds)) {
        return this._inFlight.promise;
      }
      return this._inFlight.promise.then(() => this.ensureLines(normalizedLineIds, input));
    }

    if (mode === 'manual') {
      const cityState = this._storage.getCitySyncState(cityId);
      const cooldownUntil = cityState.lastManualSuccessAt + MANUAL_COOLDOWN_MS;
      if (cityState.lastManualSuccessAt && now < cooldownUntil) {
        return Promise.resolve({
          success: true,
          skipped: true,
          reason: 'manual-cooldown',
          retryAt: cooldownUntil,
          lineIds: normalizedLineIds,
        });
      }
      if (now < cityState.manualBlockedUntil) {
        return Promise.resolve({
          success: false,
          skipped: true,
          reason: 'manual-failure-block',
          retryAt: cityState.manualBlockedUntil,
          lineIds: normalizedLineIds,
        });
      }
    }

    const targetLineIds = mode === 'manual'
      ? normalizedLineIds
      : normalizedLineIds.filter((lineId) => {
        const state = this._storage.getLineSyncState(cityId, lineId, {
          bundleSchema,
          nowMs: now,
        });
        return !this._isFresh(state, now) && !(state && state.nextRetryAt > now);
      });
    if (!targetLineIds.length) {
      return Promise.resolve({
        success: true,
        skipped: true,
        reason: mode === 'manual' ? 'manual-cooldown' : 'fresh-or-backoff',
        lineIds: normalizedLineIds,
      });
    }

    const flight = { cityId, lineIds: targetLineIds, mode, promise: null };
    const task = Promise.resolve().then(() => this._executeSync(targetLineIds, {
      cityId,
      bundleSchema,
      bundledVersions: input.bundledVersions || {},
      mode,
    }));
    flight.promise = task.then((result) => {
      if (this._inFlight === flight) this._inFlight = null;
      return result;
    }, (error) => {
      if (this._inFlight === flight) this._inFlight = null;
      throw error;
    });
    this._inFlight = flight;
    return flight.promise;
  }

  _isFresh(state, now) {
    if (!state || !state.lastAlignedAt) return false;
    return now - state.lastAlignedAt < DEFAULT_TTL_SECONDS * 1000;
  }

  _emit(event) {
    this._lastEvent = Object.assign({}, event);
    this._listeners.forEach((listener) => {
      try {
        listener(Object.assign({}, event));
      } catch (error) {
        this._lastSubscriberError = error;
      }
    });
  }

  _requestLines(lineIds, options) {
    return lineIds.map((lineId) => {
      const state = this._storage.getLineSyncState(options.cityId, lineId, {
        bundleSchema: options.bundleSchema,
        nowMs: this._now(),
      });
      return {
        lineId,
        version: (state && state.version) || String(options.bundledVersions[lineId] || ''),
      };
    });
  }

  async _executeSync(lineIds, options) {
    const requestLines = this._requestLines(lineIds, options);
    const request = {
      schemaVersion: options.bundleSchema,
      cityId: options.cityId,
      lines: requestLines,
    };
    this._emit({
      phase: 'checking',
      cityId: options.cityId,
      lineIds: lineIds.slice(),
      mode: options.mode,
    });

    try {
      const response = await this._callWithRetries(request, options.mode);
      const normalized = this._normalizeResponse(response, requestLines, options.bundleSchema);
      const changedByLine = normalized.changedLines.reduce((result, line) => {
        result[line.lineId] = line;
        return result;
      }, Object.create(null));

      const nextStates = lineIds.map((lineId) => {
        const existing = this._storage.getLineSyncState(options.cityId, lineId, {
          bundleSchema: options.bundleSchema,
          nowMs: normalized.checkedAtMs,
          includeInactive: true,
        });
        const requested = requestLines.find((line) => line.lineId === lineId);
        const changed = changedByLine[lineId];
        const version = changed
          ? changed.version
          : String((existing && existing.version)
            || (requested && requested.version)
            || '');
        const overrides = changed
          ? changed.overrides
          : ((existing && existing.overrides) || []);
        return {
          cityId: options.cityId,
          lineId,
          version,
          lastAlignedAt: normalized.checkedAtMs,
          nextRetryAt: 0,
          ttlSeconds: normalized.ttlSeconds,
          bundleSchema: options.bundleSchema,
          overrides,
        };
      });
      this._storage.saveLineSyncStates(options.cityId, nextStates);
      lineIds.forEach((lineId) => { delete this._failures[`${options.cityId}:${lineId}`]; });

      if (options.mode === 'manual') {
        this._storage.saveCitySyncState(options.cityId, {
          lastManualSuccessAt: normalized.checkedAtMs,
          manualBlockedUntil: 0,
        });
      }
      this._inFlight = null;
      this._emit({
        phase: 'success',
        cityId: options.cityId,
        lineIds: lineIds.slice(),
        mode: options.mode,
        checkedAtMs: normalized.checkedAtMs,
      });
      return {
        success: true,
        skipped: false,
        lineIds: lineIds.slice(),
        changedLineIds: normalized.changedLines.map((line) => line.lineId),
        unchangedLineIds: normalized.unchangedLineIds.slice(),
        checkedAtMs: normalized.checkedAtMs,
        ttlSeconds: normalized.ttlSeconds,
      };
    } catch (error) {
      this._recordFailure(lineIds, options, error);
      return {
        success: false,
        skipped: false,
        lineIds: lineIds.slice(),
        code: error.code || 'SYNC_FAILED',
        message: error.message || '检查更新失败',
      };
    }
  }

  async _callWithRetries(request, mode) {
    const maxAttempts = mode === 'manual' ? 3 : 1;
    let lastError;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        return await this._syncRestroomStatus(request);
      } catch (error) {
        lastError = error;
        if (!isRetryableError(error) || attempt >= maxAttempts - 1) throw error;
        await this._sleep(MANUAL_RETRY_DELAYS_MS[attempt]);
      }
    }
    throw lastError || createSyncError('SYNC_FAILED', '检查更新失败');
  }

  _normalizeResponse(response, requestLines, bundleSchema) {
    const result = response || {};
    const checkedAtMs = result.checkedAtMs;
    if (result.schemaVersion !== bundleSchema
      || result.cityId !== DEFAULT_CITY_ID
      || !Number.isSafeInteger(checkedAtMs)
      || checkedAtMs <= 0) {
      throw createSyncError('INVALID_SYNC_RESPONSE', '云端未返回有效的检查时间');
    }
    if (result.ttlSeconds !== DEFAULT_TTL_SECONDS) {
      throw createSyncError('INVALID_SYNC_RESPONSE', '云端 TTL 与 v1 协议不一致');
    }
    if (!Array.isArray(result.changedLines) || !Array.isArray(result.unchangedLineIds)) {
      throw createSyncError('INVALID_SYNC_RESPONSE', '云端线路结果格式不正确');
    }
    const requestedLineIds = requestLines.map((line) => line.lineId);
    const requestedLookup = new Set(requestedLineIds);
    const rawChangedLines = result.changedLines;
    const changedLookup = new Set();
    const changedLines = rawChangedLines.map((line) => {
      if (!line
        || typeof line.lineId !== 'string'
        || !SAFE_LINE_ID_PATTERN.test(line.lineId)
        || !requestedLookup.has(line.lineId)
        || changedLookup.has(line.lineId)) {
        throw createSyncError('INVALID_SYNC_RESPONSE', '云端返回了无效的变化线路');
      }
      const lineId = line.lineId;
      const responseBundleSchema = line.bundleSchema === undefined
        ? bundleSchema
        : line.bundleSchema;
      if (responseBundleSchema !== bundleSchema
        || typeof line.version !== 'string'
        || !SAFE_VERSION_PATTERN.test(line.version)
        || !Array.isArray(line.overrides)
        || line.overrides.length > MAX_LINE_OVERRIDES) {
        throw createSyncError('INVALID_SYNC_RESPONSE', `线路 ${lineId} 的快照格式不正确`);
      }
      const seenRestroomIds = new Set();
      const overrides = line.overrides.map((override) => {
        const normalized = normalizeStatusOverride(override, lineId);
        if (seenRestroomIds.has(normalized.restroomId)) {
          throw createSyncError('INVALID_SYNC_RESPONSE', `线路 ${lineId} 的卫生间状态重复`);
        }
        seenRestroomIds.add(normalized.restroomId);
        return normalized;
      });
      changedLookup.add(lineId);
      return {
        lineId,
        version: line.version,
        overrides,
      };
    });
    const unchangedLookup = new Set();
    const unchangedLineIds = result.unchangedLineIds.map((lineId) => {
      if (typeof lineId !== 'string' || !SAFE_LINE_ID_PATTERN.test(lineId)) {
        throw createSyncError('INVALID_SYNC_RESPONSE', '云端返回了无效的未变化线路');
      }
      return lineId;
    });
    unchangedLineIds.forEach((lineId) => {
      if (!requestedLookup.has(lineId) || changedLookup.has(lineId) || unchangedLookup.has(lineId)) {
        throw createSyncError('INVALID_SYNC_RESPONSE', '云端返回了无效的未变化线路');
      }
      unchangedLookup.add(lineId);
    });
    if (requestedLineIds.some((lineId) => !changedLookup.has(lineId) && !unchangedLookup.has(lineId))) {
      throw createSyncError('INVALID_SYNC_RESPONSE', '云端没有返回全部线路的检查结果');
    }

    return {
      checkedAtMs,
      ttlSeconds: DEFAULT_TTL_SECONDS,
      changedLines,
      unchangedLineIds,
    };
  }

  _recordFailure(lineIds, options, error) {
    const now = this._now();
    lineIds.forEach((lineId) => {
      this._failures[`${options.cityId}:${lineId}`] = {
        failedAt: now,
        code: error.code || 'SYNC_FAILED',
      };
    });
    if (options.mode === 'auto') {
      try {
        const nextStates = lineIds.map((lineId) => {
          const existing = this._storage.getLineSyncState(options.cityId, lineId, {
            bundleSchema: options.bundleSchema,
            nowMs: now,
            includeInactive: true,
          });
          return {
            cityId: options.cityId,
            lineId,
            version: (existing && existing.version)
              || String(options.bundledVersions[lineId] || ''),
            lastAlignedAt: (existing && existing.lastAlignedAt) || 0,
            nextRetryAt: now + AUTO_RETRY_BACKOFF_MS,
            ttlSeconds: DEFAULT_TTL_SECONDS,
            bundleSchema: options.bundleSchema,
            overrides: (existing && existing.overrides) || [],
          };
        });
        this._storage.saveLineSyncStates(options.cityId, nextStates);
      } catch (storageError) {
        this._lastStorageError = storageError;
      }
    }
    if (options.mode === 'manual') {
      try {
        this._storage.saveCitySyncState(options.cityId, {
          manualBlockedUntil: now + MANUAL_FAILURE_BLOCK_MS,
        });
      } catch (storageError) {
        this._lastStorageError = storageError;
      }
    }
    this._inFlight = null;
    this._emit({
      phase: 'failed',
      cityId: options.cityId,
      lineIds: lineIds.slice(),
      mode: options.mode,
      failedAt: now,
      code: error.code || 'SYNC_FAILED',
    });
  }
}

const defaultManager = new DataSyncManager();

module.exports = {
  DEFAULT_CITY_ID,
  DEFAULT_BUNDLE_SCHEMA,
  DEFAULT_TTL_SECONDS,
  MANUAL_COOLDOWN_MS,
  MANUAL_FAILURE_BLOCK_MS,
  AUTO_RETRY_BACKOFF_MS,
  MANUAL_RETRY_DELAYS_MS,
  DataSyncManager,
  formatDateTime,
  isRetryableError,
  syncLines: defaultManager.ensureLines.bind(defaultManager),
  subscribeSyncState: defaultManager.subscribe.bind(defaultManager),
  getSyncStatus: defaultManager.getStatus.bind(defaultManager),
  getLineOverrides: defaultManager.getLineOverrides.bind(defaultManager),
};
