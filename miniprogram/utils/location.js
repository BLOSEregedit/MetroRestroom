const EARTH_RADIUS_METERS = 6371008.8;
const DEFAULT_NEARBY_DISTANCE_METERS = 1200;
const DEFAULT_AUTO_DISTANCE_METERS = 3000;
const DEFAULT_MAX_DISTANCE_METERS = 5000;
const LOW_ACCURACY_METERS = 200;
const DEFAULT_ENTRANCE_ACCURACY_METERS = 50;
const MIN_ENTRANCE_UNCERTAINTY_METERS = 25;
const MAX_ENTRANCE_ACCURACY_METERS = 150;

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
  const nearbyDistance = Number(settings.nearbyDistanceMeters)
    || DEFAULT_NEARBY_DISTANCE_METERS;
  const automaticDistance = Number(settings.automaticDistanceMeters)
    || DEFAULT_AUTO_DISTANCE_METERS;
  const maximumDistance = Number(settings.maximumDistanceMeters)
    || DEFAULT_MAX_DISTANCE_METERS;

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
  const accuracy = Math.max(Number(position.accuracy) || 0, 0);
  const upperDistance = nearest.distanceMeters + accuracy;
  const proximity = upperDistance <= nearbyDistance ? 'nearby' : 'nearest';
  const lowAccuracy = accuracy > LOW_ACCURACY_METERS || upperDistance > maximumDistance;

  if (nearest.distanceMeters > automaticDistance || upperDistance > automaticDistance) {
    return {
      status: 'selectionRequired',
      issue: lowAccuracy ? 'lowAccuracy' : '',
      proximity,
      lowAccuracy,
      candidates: nearby,
    };
  }

  return {
    status: 'success',
    issue: '',
    proximity,
    lowAccuracy,
    candidates: [nearest],
  };
}

function resolveNearestEntranceLine(position, physicalStationId, lineStationIds, entrances) {
  if (!isValidPosition(position) || !physicalStationId) {
    return { status: 'unresolved', issue: 'invalidPosition' };
  }
  const accuracy = Number(position.accuracy) || DEFAULT_ENTRANCE_ACCURACY_METERS;
  if (accuracy > MAX_ENTRANCE_ACCURACY_METERS) {
    return { status: 'unresolved', issue: 'lowAccuracy' };
  }

  const validLineStationIds = Array.isArray(lineStationIds) ? lineStationIds : [];
  const validEntrances = (entrances || []).filter((entrance) => (
    entrance
      && entrance.physicalStationId === physicalStationId
      && isValidPosition({ latitude: entrance.lat, longitude: entrance.lon })
  )).map((entrance) => Object.assign({}, entrance, {
    distanceMeters: Math.round(haversineMeters(position, {
      latitude: entrance.lat,
      longitude: entrance.lon,
    })),
  })).sort((left, right) => (
    left.distanceMeters - right.distanceMeters
      || String(left.osmNodeId || '').localeCompare(String(right.osmNodeId || ''))
  ));

  if (!validEntrances.length) return { status: 'unresolved', issue: 'noEntranceData' };

  const stationCoveredLineIds = validEntrances.reduce(
    (all, entrance) => all.concat(entrance.lineStationIds || []),
    [],
  ).filter((lineStationId, index, all) => (
    validLineStationIds.includes(lineStationId) && all.indexOf(lineStationId) === index
  ));
  if (validLineStationIds.some((lineStationId) => (
    !stationCoveredLineIds.includes(lineStationId)
  ))) {
    return {
      status: 'unresolved',
      issue: 'incompleteEntranceCoverage',
      lineStationIds: [],
    };
  }

  const uncertainty = Math.min(Math.max(
    accuracy,
    MIN_ENTRANCE_UNCERTAINTY_METERS,
  ), MAX_ENTRANCE_ACCURACY_METERS);
  const nearestDistance = validEntrances[0].distanceMeters;
  const plausibleEntrances = validEntrances.filter(
    (entrance) => entrance.distanceMeters <= nearestDistance + uncertainty,
  );
  const resolvedIds = plausibleEntrances.map((entrance) => (
    entrance.association === 'unique'
      && Array.isArray(entrance.lineStationIds)
      && entrance.lineStationIds.length === 1
      && validLineStationIds.includes(entrance.lineStationIds[0])
      ? entrance.lineStationIds[0]
      : ''
  ));
  const uniqueIds = resolvedIds.filter(
    (lineStationId, index, all) => lineStationId && all.indexOf(lineStationId) === index,
  );
  if (resolvedIds.some((lineStationId) => !lineStationId) || uniqueIds.length !== 1) {
    const hasUnknownAssociation = plausibleEntrances.some((entrance) => (
      entrance.association === 'unknown'
        || !Array.isArray(entrance.lineStationIds)
        || !entrance.lineStationIds.length
    ));
    const plausibleLineStationIds = hasUnknownAssociation ? [] : plausibleEntrances.reduce(
      (all, entrance) => all.concat(entrance.lineStationIds || []),
      [],
    ).filter((lineStationId, index, all) => (
      validLineStationIds.includes(lineStationId) && all.indexOf(lineStationId) === index
    ));
    return {
      status: 'unresolved',
      issue: 'ambiguousEntrance',
      lineStationIds: plausibleLineStationIds,
    };
  }

  return {
    status: 'unique',
    issue: '',
    lineStationId: uniqueIds[0],
    entranceRef: validEntrances[0].ref || '',
    distanceMeters: validEntrances[0].distanceMeters,
  };
}

module.exports = {
  DEFAULT_NEARBY_DISTANCE_METERS,
  DEFAULT_AUTO_DISTANCE_METERS,
  DEFAULT_MAX_DISTANCE_METERS,
  isValidPosition,
  haversineMeters,
  rankNearbyStations,
  resolveNearestEntranceLine,
};
