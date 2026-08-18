const ISSUE_TYPES = new Set([
  'location',
  'access',
  'description',
  'unavailable',
  'other',
]);

function validationError(message) {
  const error = new Error(message);
  error.code = 'INVALID_ARGUMENT';
  return error;
}

function cleanString(value, maxLength, field, required) {
  const result = typeof value === 'string' ? value.trim() : '';
  if (required && !result) throw validationError(`${field}不能为空`);
  if (result.length > maxLength) throw validationError(`${field}过长`);
  return result;
}

function cleanId(value, field) {
  const result = cleanString(value, 80, field, true);
  if (!/^[a-zA-Z0-9:_-]+$/.test(result)) throw validationError(`${field}格式错误`);
  return result;
}

function normalizeCorrection(payload) {
  const input = payload && typeof payload === 'object' ? payload : {};
  const requestId = cleanId(input.requestId, 'requestId');
  const issueType = cleanString(input.issueType, 32, 'issueType', true);
  if (!ISSUE_TYPES.has(issueType)) throw validationError('issueType不支持');
  const description = cleanString(input.description, 300, 'description', true);
  if (description.length < 5) throw validationError('description至少需要5个字');
  const sourceRow = Number(input.sourceRow);
  if (!Number.isInteger(sourceRow) || sourceRow < 1 || sourceRow > 10000) {
    throw validationError('sourceRow格式错误');
  }

  return {
    requestId,
    lineId: cleanId(input.lineId, 'lineId'),
    stationId: cleanId(input.stationId, 'stationId'),
    stationName: cleanString(input.stationName, 80, 'stationName', true),
    restroomId: cleanId(input.restroomId, 'restroomId'),
    sourceSheet: cleanString(input.sourceSheet, 40, 'sourceSheet', true),
    sourceRow,
    issueType,
    description,
    contact: cleanString(input.contact, 100, 'contact', false),
    clientVersion: cleanString(input.clientVersion, 40, 'clientVersion', true),
    dataVersion: cleanString(input.dataVersion, 128, 'dataVersion', true),
  };
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${stableStringify(value[key])}`
    )).join(',')}}`;
  }
  return JSON.stringify(value);
}

module.exports = {
  ISSUE_TYPES,
  normalizeCorrection,
  stableStringify,
};
