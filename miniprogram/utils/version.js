function getMiniProgramInfo(api) {
  const target = api || (typeof wx !== 'undefined' ? wx : null);
  if (!target || typeof target.getAccountInfoSync !== 'function') return null;

  try {
    const accountInfo = target.getAccountInfoSync();
    return (accountInfo && accountInfo.miniProgram) || null;
  } catch (error) {
    return null;
  }
}

function formatVersion(value) {
  const normalized = String(value || '').trim().replace(/^v/i, '');
  return /^\d+\.\d+\.\d+$/.test(normalized) ? normalized : '';
}

function getReleaseVersion(api) {
  const miniProgram = getMiniProgramInfo(api);
  return miniProgram && miniProgram.envVersion === 'release'
    ? formatVersion(miniProgram.version)
    : '';
}

function getCurrentVersion(environmentVersions, api) {
  const miniProgram = getMiniProgramInfo(api);
  if (!miniProgram) return '';

  const runtimeVersion = formatVersion(miniProgram.version);
  if (runtimeVersion) return runtimeVersion;

  const versions = environmentVersions || {};
  return formatVersion(versions[miniProgram.envVersion]);
}

module.exports = {
  formatVersion,
  getCurrentVersion,
  getReleaseVersion,
};
