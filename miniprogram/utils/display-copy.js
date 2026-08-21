function normalizeFacilityTerms(value) {
  return String(value || '').replace(/厕所/g, '卫生间');
}

module.exports = {
  normalizeFacilityTerms,
};
