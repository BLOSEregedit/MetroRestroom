const ETA_CONSTANTS = Object.freeze({
  trainPerSegment: Object.freeze({ min: 2, max: 4 }),
  reverseAtOrigin: Object.freeze({ min: 4, max: 6 }),
  transferWalk: Object.freeze({ min: 2, max: 4 }),
  transferWait: Object.freeze({ min: 2, max: 4 }),
  sameLineChangeWalk: Object.freeze({ min: 2, max: 3 }),
  sameLineChangeWait: Object.freeze({ min: 2, max: 4 }),
  restroomWalk: Object.freeze({
    "闸内": Object.freeze({ min: 2, max: 3 }),
    "闸外": Object.freeze({ min: 3, max: 5 }),
    "车站外": Object.freeze({ min: 5, max: 7 }),
  }),
});

function normalizeCount(value) {
  const count = Number(value);
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
}

function formatEtaLabel(minMinutes, maxMinutes) {
  if (minMinutes === maxMinutes) {
    return `约 ${minMinutes} 分钟`;
  }

  return `约 ${minMinutes}-${maxMinutes} 分钟`;
}

function addBreakdown(breakdown, key, label, count, range) {
  if (!count) {
    return;
  }

  breakdown.push({
    key,
    label,
    count,
    minMinutes: range.min * count,
    maxMinutes: range.max * count,
  });
}

function estimateEta(options) {
  const input = options || {};
  const segmentCount = normalizeCount(input.segmentCount);
  const transferCount = normalizeCount(input.transferCount);
  const sameLineChangeCount = normalizeCount(input.sameLineChangeCount);
  const access = ETA_CONSTANTS.restroomWalk[input.access]
    ? input.access
    : "闸内";
  const breakdown = [];

  addBreakdown(
    breakdown,
    "train",
    "乘车",
    segmentCount,
    ETA_CONSTANTS.trainPerSegment,
  );

  if (input.isReverse && segmentCount > 0) {
    addBreakdown(
      breakdown,
      "reverse",
      "在计算起点掉头",
      1,
      ETA_CONSTANTS.reverseAtOrigin,
    );
  }

  addBreakdown(
    breakdown,
    "transferWalk",
    "跨线换乘步行",
    transferCount,
    ETA_CONSTANTS.transferWalk,
  );
  addBreakdown(
    breakdown,
    "transferWait",
    "跨线换乘候车",
    transferCount,
    ETA_CONSTANTS.transferWait,
  );
  addBreakdown(
    breakdown,
    "sameLineChangeWalk",
    "同线换车步行",
    sameLineChangeCount,
    ETA_CONSTANTS.sameLineChangeWalk,
  );
  addBreakdown(
    breakdown,
    "sameLineChangeWait",
    "同线换车候车",
    sameLineChangeCount,
    ETA_CONSTANTS.sameLineChangeWait,
  );
  addBreakdown(
    breakdown,
    "restroomWalk",
    `前往${access}厕所`,
    1,
    ETA_CONSTANTS.restroomWalk[access],
  );

  const total = breakdown.reduce(
    (result, item) => ({
      min: result.min + item.minMinutes,
      max: result.max + item.maxMinutes,
    }),
    { min: 0, max: 0 },
  );

  return {
    minMinutes: total.min,
    maxMinutes: total.max,
    label: formatEtaLabel(total.min, total.max),
    breakdown,
  };
}

module.exports = {
  ETA_CONSTANTS,
  estimateEta,
  formatEtaLabel,
};
