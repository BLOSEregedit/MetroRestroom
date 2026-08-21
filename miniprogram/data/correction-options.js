const restroomData = require('./generated/restrooms');
const { normalizeFacilityTerms } = require('../utils/display-copy');

const lineOptions = restroomData.lines.map((line) => ({
  id: String(line.lineId),
  name: line.lineName,
  stations: (line.records || []).filter((record) => record.status === 'active').map((record) => ({
    id: record.lineStationId,
    name: record.stationName,
    restroomId: `${record.lineStationId}-restroom`,
    location: normalizeFacilityTerms(record.locationRaw),
    access: record.accessRaw || '',
    sourceSheet: record.sourceSheet,
    sourceRow: record.sourceRow,
  })),
}));

function getCorrectionOptions() {
  return lineOptions.map((line) => ({
    id: line.id,
    name: line.name,
    stations: line.stations.map((station) => Object.assign({}, station)),
  }));
}

function findCorrectionContext(lineId, stationId, restroomId) {
  const line = lineOptions.find((item) => item.id === String(lineId || ''));
  if (!line) return null;
  const station = line.stations.find((item) => item.id === stationId)
    || line.stations.find((item) => item.restroomId === restroomId);
  if (!station) return null;

  return {
    cityName: '上海',
    lineId: line.id,
    lineName: line.name,
    stationId: station.id,
    stationName: station.name,
    restroomId: station.restroomId,
    location: station.location,
    access: station.access,
    sourceSheet: station.sourceSheet,
    sourceRow: station.sourceRow,
  };
}

module.exports = {
  getCorrectionOptions,
  findCorrectionContext,
};
