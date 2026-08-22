const ENVIRONMENT_VERSIONS = Object.freeze({
  release: '1.2.3',
  trial: '1.2.4',
  develop: '1.2.5',
});

const RELEASE_NOTES = Object.freeze([
  {
    version: '1.2.5',
    date: '2026-08-23',
    summary: '优化智能定位体验与版本记录',
  },
  {
    version: '1.2.4',
    date: '2026-08-22',
    summary: '升级前台实时定位',
  },
  {
    version: '1.2.3',
    date: '2026-08-22',
    summary: '新增分享功能和系统基础能力',
  },
  {
    version: '1.2.2',
    date: '2026-08-22',
    summary: '新增行程预估与数据来源说明',
  },
  {
    version: '1.2.1',
    date: '2026-08-21',
    summary: '升级站点数据与范围判定',
  },
  {
    version: '1.2.0',
    date: '2026-08-21',
    summary: '支持智能定位与手动选站',
  },
  {
    version: '1.1.1',
    date: '2026-08-21',
    summary: '支持左右滑动切换换乘线路',
  },
  {
    version: '1.1.0',
    date: '2026-08-20',
    summary: '新增轮盘式站点浏览',
  },
  {
    version: '1.0.0',
    date: '2026-08-17',
    summary: '上海首发，支持地铁卫生间查询',
  },
]);

function buildVersionSeries(records) {
  const seriesList = [];
  const seriesByKey = Object.create(null);

  (records || []).forEach((record) => {
    const versionParts = String(record.version || '').split('.');
    const series = versionParts.slice(0, 2).join('.');
    if (!seriesByKey[series]) {
      const versionSeries = {
        series,
        latest: record,
        history: [],
      };
      seriesByKey[series] = versionSeries;
      seriesList.push(versionSeries);
      return;
    }
    seriesByKey[series].history.push(record);
  });

  return seriesList.map((versionSeries) => Object.freeze({
    series: versionSeries.series,
    latest: versionSeries.latest,
    history: Object.freeze(versionSeries.history),
  }));
}

const VERSION_SERIES = Object.freeze(buildVersionSeries(RELEASE_NOTES));

module.exports = {
  ENVIRONMENT_VERSIONS,
  RELEASE_NOTES,
  VERSION_SERIES,
  buildVersionSeries,
};
