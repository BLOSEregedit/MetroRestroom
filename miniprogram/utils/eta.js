const ETA_DEFAULTS = Object.freeze({
  segmentSeconds: 180,
  headwaySeconds: 360,
  transferWalkSeconds: 180,
  sameLineChangeWalkSeconds: 150,
  reverseWalkSeconds: 0,
  restroomWalkSeconds: Object.freeze({
    "闸内": 150,
    "闸外": 240,
    "车站外": 360,
  }),
});

function normalizeCount(value) {
  const count = Number(value);
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
}

function normalizeSeconds(value, fallback) {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : fallback;
}

function roundEtaMinutes(rawMinutes) {
  const minutes = Math.max(Number(rawMinutes) || 0, 0);
  const step = minutes < 10 ? 1 : (minutes <= 30 ? 2 : 5);
  return Math.max(step, Math.round(minutes / step) * step);
}

function formatEtaLabel(minutes) {
  return `约 ${roundEtaMinutes(minutes)} 分钟`;
}

function addBreakdown(breakdown, key, label, count, seconds) {
  const totalSeconds = normalizeSeconds(seconds, 0);
  if (!count || totalSeconds <= 0) return;

  const minutes = totalSeconds / 60;
  breakdown.push({
    key,
    label,
    count,
    seconds: totalSeconds,
    minutes,
    // 保留旧字段，避免既有详情和调试代码读取失败；V2 中二者为同一个中心估计。
    minMinutes: minutes,
    maxMinutes: minutes,
  });
}

function explicitOrLegacySeconds(input, explicitKey, count, perItemSeconds) {
  if (input[explicitKey] !== undefined && input[explicitKey] !== null) {
    return normalizeSeconds(input[explicitKey], 0);
  }
  return count * perItemSeconds;
}

function estimateEta(options) {
  const input = options || {};
  const segmentCount = normalizeCount(input.segmentCount);
  const transferCount = normalizeCount(input.transferCount);
  const sameLineChangeCount = normalizeCount(input.sameLineChangeCount);
  const access = ETA_DEFAULTS.restroomWalkSeconds[input.access]
    ? input.access
    : "闸内";
  const rideSeconds = explicitOrLegacySeconds(
    input,
    "rideSeconds",
    segmentCount,
    ETA_DEFAULTS.segmentSeconds,
  );
  const hasJourney = rideSeconds > 0 || transferCount > 0 || sameLineChangeCount > 0;
  const initialWaitSeconds = input.initialWaitSeconds !== undefined
    ? normalizeSeconds(input.initialWaitSeconds, 0)
    : (hasJourney ? ETA_DEFAULTS.headwaySeconds / 2 : 0);
  const reverseWalkSeconds = input.reverseWalkSeconds !== undefined
    ? normalizeSeconds(input.reverseWalkSeconds, 0)
    : (input.isReverse && rideSeconds > 0 ? ETA_DEFAULTS.reverseWalkSeconds : 0);
  const transferWalkSeconds = explicitOrLegacySeconds(
    input,
    "transferWalkSeconds",
    transferCount,
    ETA_DEFAULTS.transferWalkSeconds,
  );
  const transferWaitSeconds = explicitOrLegacySeconds(
    input,
    "transferWaitSeconds",
    transferCount,
    ETA_DEFAULTS.headwaySeconds / 2,
  );
  const sameLineChangeWalkSeconds = explicitOrLegacySeconds(
    input,
    "sameLineChangeWalkSeconds",
    sameLineChangeCount,
    ETA_DEFAULTS.sameLineChangeWalkSeconds,
  );
  const sameLineChangeWaitSeconds = explicitOrLegacySeconds(
    input,
    "sameLineChangeWaitSeconds",
    sameLineChangeCount,
    ETA_DEFAULTS.headwaySeconds / 2,
  );
  const restroomWalkSeconds = input.restroomWalkSeconds !== undefined
    ? normalizeSeconds(input.restroomWalkSeconds, ETA_DEFAULTS.restroomWalkSeconds[access])
    : ETA_DEFAULTS.restroomWalkSeconds[access];
  const breakdown = [];

  addBreakdown(breakdown, "initialWait", "首次平均候车", hasJourney ? 1 : 0, initialWaitSeconds);
  addBreakdown(breakdown, "reverseWalk", "在起点换向步行", input.isReverse ? 1 : 0, reverseWalkSeconds);
  addBreakdown(breakdown, "train", "乘车", segmentCount || (rideSeconds > 0 ? 1 : 0), rideSeconds);
  addBreakdown(breakdown, "transferWalk", "跨线换乘步行", transferCount, transferWalkSeconds);
  addBreakdown(breakdown, "transferWait", "跨线换乘候车", transferCount, transferWaitSeconds);
  addBreakdown(
    breakdown,
    "sameLineChangeWalk",
    "同线换车步行",
    sameLineChangeCount,
    sameLineChangeWalkSeconds,
  );
  addBreakdown(
    breakdown,
    "sameLineChangeWait",
    "同线换车候车",
    sameLineChangeCount,
    sameLineChangeWaitSeconds,
  );
  addBreakdown(
    breakdown,
    "restroomWalk",
    `前往${access}卫生间`,
    1,
    restroomWalkSeconds,
  );

  const totalSeconds = breakdown.reduce((total, item) => total + item.seconds, 0);
  const rawMinutes = totalSeconds / 60;
  const minutes = roundEtaMinutes(rawMinutes);

  return {
    totalSeconds,
    rawMinutes,
    minutes,
    minMinutes: minutes,
    maxMinutes: minutes,
    label: `约 ${minutes} 分钟`,
    breakdown,
  };
}

module.exports = {
  ETA_CONSTANTS: ETA_DEFAULTS,
  ETA_DEFAULTS,
  estimateEta,
  formatEtaLabel,
  roundEtaMinutes,
};
