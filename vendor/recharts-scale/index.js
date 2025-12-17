function generateTicks(domain, count = 6) {
  const [start, end] = domain;
  const step = (end - start) / Math.max(count - 1, 1);
  return Array.from({ length: count }, (_, i) => start + step * i);
}

function getNiceTickValues(domain, count = 6) {
  return generateTicks(domain, count);
}

function getTickValuesFixedDomain(domain, count = 6) {
  return generateTicks(domain, count).filter((value) => value >= domain[0] && value <= domain[1]);
}

module.exports = {
  getNiceTickValues,
  getTickValuesFixedDomain,
};
