/**
 * 上海地铁物理站坐标。
 *
 * 本文件将在固定的 OpenStreetMap 快照完成 411/411 个物理站匹配后，
 * 由 scripts/build_station_locations.js 确定性生成。厕所业务数据不会写入本文件。
 */
module.exports = {
  schemaVersion: 1,
  dataReady: false,
  source: {
    name: 'OpenStreetMap',
    coordinateSystem: 'WGS84',
    license: 'ODbL-1.0',
    url: 'https://www.openstreetmap.org/copyright',
    snapshotSha256: '',
    snapshotDate: '',
  },
  stations: [],
};
