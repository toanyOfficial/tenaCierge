function createCurve(name) {
  const curveFn = (...args) => ({ name, args });
  curveFn.toString = () => name;
  return curveFn;
}

function line() {
  let xAccessor = (d) => d[0];
  let yAccessor = (d) => d[1];
  let defined = () => true;
  let curve = createCurve('curveLinear');

  const generator = (data = []) => {
    const points = [];
    data.forEach((d, i) => {
      if (defined(d, i, data)) {
        points.push([xAccessor(d, i), yAccessor(d, i)]);
      }
    });
    if (points.length === 0) return '';
    return points
      .map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${x},${y}`)
      .join('');
  };

  generator.x = (fn) => {
    if (fn === undefined) return xAccessor;
    xAccessor = fn;
    return generator;
  };

  generator.y = (fn) => {
    if (fn === undefined) return yAccessor;
    yAccessor = fn;
    return generator;
  };

  generator.defined = (fn) => {
    if (fn === undefined) return defined;
    defined = fn;
    return generator;
  };

  generator.curve = (fn) => {
    if (fn === undefined) return curve;
    curve = fn;
    return generator;
  };

  return generator;
}

function area() {
  let xAccessor = (d) => d[0];
  let y0Accessor = () => 0;
  let y1Accessor = (d) => d[1];
  let defined = () => true;
  let curve = createCurve('curveLinear');

  const generator = (data = []) => {
    const top = [];
    const bottom = [];
    data.forEach((d, i) => {
      if (defined(d, i, data)) {
        top.push([xAccessor(d, i), y1Accessor(d, i)]);
        bottom.unshift([xAccessor(d, i), y0Accessor(d, i)]);
      }
    });
    if (top.length === 0) return '';
    const pathSegments = [...top, ...bottom].map(([x, y], idx) => `${idx === 0 ? 'M' : 'L'}${x},${y}`);
    return `${pathSegments.join('')}Z`;
  };

  generator.x = (fn) => {
    if (fn === undefined) return xAccessor;
    xAccessor = fn;
    return generator;
  };

  generator.y0 = (fn) => {
    if (fn === undefined) return y0Accessor;
    y0Accessor = fn;
    return generator;
  };

  generator.y1 = (fn) => {
    if (fn === undefined) return y1Accessor;
    y1Accessor = fn;
    return generator;
  };

  generator.defined = (fn) => {
    if (fn === undefined) return defined;
    defined = fn;
    return generator;
  };

  generator.curve = (fn) => {
    if (fn === undefined) return curve;
    curve = fn;
    return generator;
  };

  return generator;
}

function stack() {
  let keys = [];
  let valueAccessor = (d, key) => d[key];
  let order = null;
  let offset = null;

  const stackGen = (data = []) => {
    return keys.map((key) => {
      let acc = 0;
      return data.map((datum) => {
        const value = Number(valueAccessor(datum, key, data)) || 0;
        const tuple = [acc, acc + value];
        acc += value;
        return Object.assign(tuple, { data: datum, key });
      });
    });
  };

  stackGen.keys = (newKeys) => {
    if (!newKeys) return keys;
    keys = newKeys;
    return stackGen;
  };

  stackGen.value = (fn) => {
    if (fn === undefined) return valueAccessor;
    valueAccessor = fn;
    return stackGen;
  };

  stackGen.order = (fn) => {
    if (fn === undefined) return order;
    order = fn;
    return stackGen;
  };

  stackGen.offset = (fn) => {
    if (fn === undefined) return offset;
    offset = fn;
    return stackGen;
  };

  return stackGen;
}

const stackOffsetNone = (series) => series;
const stackOffsetExpand = (series) => series;
const stackOffsetSilhouette = (series) => series;
const stackOffsetWiggle = (series) => series;
const stackOrderNone = (series) => series;

const curveBasis = createCurve('curveBasis');
const curveBasisClosed = createCurve('curveBasisClosed');
const curveBasisOpen = createCurve('curveBasisOpen');
const curveLinear = createCurve('curveLinear');
const curveMonotoneX = createCurve('curveMonotoneX');
const curveMonotoneY = createCurve('curveMonotoneY');
const curveNatural = createCurve('curveNatural');
const curveStep = createCurve('curveStep');
const curveStepAfter = createCurve('curveStepAfter');
const curveStepBefore = createCurve('curveStepBefore');
const curveCatmullRom = createCurve('curveCatmullRom');

module.exports = {
  area,
  curveBasis,
  curveBasisClosed,
  curveBasisOpen,
  curveCatmullRom,
  curveLinear,
  curveMonotoneX,
  curveMonotoneY,
  curveNatural,
  curveStep,
  curveStepAfter,
  curveStepBefore,
  line,
  stack,
  stackOffsetExpand,
  stackOffsetNone,
  stackOffsetSilhouette,
  stackOffsetWiggle,
  stackOrderNone,
};
