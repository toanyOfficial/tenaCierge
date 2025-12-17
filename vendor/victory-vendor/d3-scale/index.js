function createLinearScale(initialDomain = [0, 1], initialRange = [0, 1]) {
  let domain = [...initialDomain];
  let range = [...initialRange];
  let clamp = false;

  const scale = (value) => {
    const [d0, d1] = domain;
    const [r0, r1] = range;
    const ratio = d1 !== d0 ? (value - d0) / (d1 - d0) : 0;
    let mapped = r0 + ratio * (r1 - r0);
    if (clamp) {
      const min = Math.min(r0, r1);
      const max = Math.max(r0, r1);
      mapped = Math.min(Math.max(mapped, min), max);
    }
    return mapped;
  };

  scale.domain = (newDomain) => {
    if (!newDomain) return domain;
    domain = [...newDomain];
    return scale;
  };

  scale.range = (newRange) => {
    if (!newRange) return range;
    range = [...newRange];
    return scale;
  };

  scale.clamp = (shouldClamp) => {
    if (shouldClamp === undefined) return clamp;
    clamp = Boolean(shouldClamp);
    return scale;
  };

  scale.invert = (value) => {
    const [r0, r1] = range;
    const [d0, d1] = domain;
    const ratio = r1 !== r0 ? (value - r0) / (r1 - r0) : 0;
    return d0 + ratio * (d1 - d0);
  };

  scale.copy = () => createLinearScale(domain, range).clamp(clamp);

  scale.ticks = (count = 10) => {
    const [d0, d1] = domain;
    const step = (d1 - d0) / Math.max(count - 1, 1);
    return Array.from({ length: count }, (_, i) => d0 + step * i);
  };

  scale.nice = () => scale;

  return scale;
}

function createBandScale(initialDomain = [], initialRange = [0, 1], paddingInner = 0, paddingOuter = 0) {
  let domain = [...initialDomain];
  let range = [...initialRange];
  let inner = paddingInner;
  let outer = paddingOuter;

  const scale = (value) => {
    const index = domain.indexOf(value);
    if (index === -1 || domain.length === 0) return undefined;
    const step = (range[1] - range[0]) / Math.max(domain.length + outer * 2 - inner, 1);
    return range[0] + (outer + index) * step;
  };

  scale.domain = (newDomain) => {
    if (!newDomain) return domain;
    domain = [...newDomain];
    return scale;
  };

  scale.range = (newRange) => {
    if (!newRange) return range;
    range = [...newRange];
    return scale;
  };

  scale.paddingInner = (value) => {
    if (value === undefined) return inner;
    inner = value;
    return scale;
  };

  scale.paddingOuter = (value) => {
    if (value === undefined) return outer;
    outer = value;
    return scale;
  };

  scale.bandwidth = () => {
    const step = (range[1] - range[0]) / Math.max(domain.length + outer * 2 - inner, 1);
    return step * Math.max(1 - inner, 0);
  };

  scale.step = () => {
    return (range[1] - range[0]) / Math.max(domain.length + outer * 2 - inner, 1);
  };

  scale.copy = () => createBandScale(domain, range, inner, outer);

  return scale;
}

function createPointScale(initialDomain = [], initialRange = [0, 1]) {
  const band = createBandScale(initialDomain, initialRange, 1, 0);
  band.paddingInner(1);
  band.paddingOuter(1);
  const scale = (value) => {
    const position = band(value);
    if (position === undefined) return undefined;
    return position + band.step() / 2;
  };

  scale.domain = band.domain;
  scale.range = band.range;
  scale.step = band.step;
  scale.copy = () => createPointScale(band.domain(), band.range());

  return scale;
}

function createOrdinalScale(initialDomain = [], initialRange = []) {
  let domain = [...initialDomain];
  let range = [...initialRange];
  const scale = (value) => {
    let index = domain.indexOf(value);
    if (index === -1) {
      domain.push(value);
      index = domain.length - 1;
    }
    if (range.length === 0) return undefined;
    return range[index % range.length];
  };

  scale.domain = (newDomain) => {
    if (!newDomain) return domain;
    domain = [...newDomain];
    return scale;
  };

  scale.range = (newRange) => {
    if (!newRange) return range;
    range = [...newRange];
    return scale;
  };

  scale.copy = () => createOrdinalScale(domain, range);

  return scale;
}

module.exports = {
  scaleBand: createBandScale,
  scaleLinear: createLinearScale,
  scaleOrdinal: createOrdinalScale,
  scalePoint: createPointScale,
};
