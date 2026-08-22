const DEFAULT_CITY_ID = 'shanghai';

const CITIES = Object.freeze({
  shanghai: Object.freeze({
    id: 'shanghai',
    name: '上海',
    landmarkHome: Object.freeze({
      lineId: '2',
      routeId: 'l2-main',
      direction: 'to-pudong-airport',
      originStationId: 'l2-renmin-square',
    }),
    landmarkStationId: 'l2-s019',
  }),
});

function isSupportedCityId(cityId) {
  const normalized = String(cityId || '').trim().toLowerCase();
  return Boolean(CITIES[normalized]);
}

function normalizeCityId(cityId) {
  const normalized = String(cityId || '').trim().toLowerCase();
  return isSupportedCityId(normalized) ? normalized : DEFAULT_CITY_ID;
}

function getCity(cityId) {
  return CITIES[normalizeCityId(cityId)];
}

module.exports = {
  CITIES,
  DEFAULT_CITY_ID,
  getCity,
  isSupportedCityId,
  normalizeCityId,
};
