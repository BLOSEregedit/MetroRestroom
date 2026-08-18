const EARTH_RADIUS_METERS = 6371008.8;
const DEFAULT_MAX_DISTANCE_METERS = 1200;
const DEFAULT_AMBIGUITY_GAP_METERS = 180;

function toRadians(value) {
  return Number(value) * Math.PI / 180;
}

function isCoordinate(value, min, max) {
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max;
}

function isValidPosition(position) {
  return Boolean(position)
    && isCoordinate(position.latitude, -90, 90)
    && isCoordinate(position.longitude, -180, 180);
}

function haversineMeters(left, right) {
  if (!isValidPosition(left) || !isValidPosition(right)) return Infinity;

  const leftLatitude = toRadians(left.latitude);
  const rightLatitude = toRadians(right.latitude);
  const latitudeDelta = rightLatitude - leftLatitude;
  const longitudeDelta = toRadians(right.longitude) - toRadians(left.longitude);
  const latitudeSin = Math.sin(latitudeDelta / 2);
  const longitudeSin = Math.sin(longitudeDelta / 2);
  const rawA = latitudeSin * latitudeSin
    + Math.cos(leftLatitude) * Math.cos(rightLatitude) * longitudeSin * longitudeSin;
  const a = Math.min(Math.max(rawA, 0), 1);
  return 2 * EARTH_RADIUS_METERS * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function rankNearbyStations(position, stationLocations, options) {
  const settings = options || {};
  const maximumDistance = Number(settings.maximumDistanceMeters)
    || DEFAULT_MAX_DISTANCE_METERS;
  const ambiguityGap = Number(settings.ambiguityGapMeters)
    || DEFAULT_AMBIGUITY_GAP_METERS;

  if (!isValidPosition(position)) {
    return { status: 'failed', issue: 'invalidPosition', candidates: [] };
  }

  const nearby = (stationLocations || []).filter(isValidPosition).map((station) => (
    Object.assign({}, station, {
      distanceMeters: Math.round(haversineMeters(position, station)),
    })
  )).filter((station) => station.distanceMeters <= maximumDistance)
    .sort((left, right) => {
      if (left.distanceMeters !== right.distanceMeters) {
        return left.distanceMeters - right.distanceMeters;
      }
      return String(left.physicalStationId).localeCompare(String(right.physicalStationId));
    });

  if (!nearby.length) {
    return { status: 'unmatched', issue: 'noNearbyStation', candidates: [] };
  }

  const nearest = nearby[0];
  const comparable = nearby.filter((station) => (
    station.distanceMeters - nearest.distanceMeters <= ambiguityGap
  ));
  const lineStationCount = (nearest.lineStationIds || []).length;

  if (comparable.length > 1 || lineStationCount > 1) {
    return { status: 'ambiguous', issue: '', candidates: comparable };
  }

  return { status: 'success', issue: '', candidates: [nearest] };
}

module.exports = {
  DEFAULT_MAX_DISTANCE_METERS,
  DEFAULT_AMBIGUITY_GAP_METERS,
  isValidPosition,
  haversineMeters,
  rankNearbyStations,
};
