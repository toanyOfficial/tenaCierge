module.exports = function range(start = 0, end, step = 1) {
  let actualStart = start;
  let actualEnd = end;

  if (actualEnd === undefined) {
    actualEnd = actualStart;
    actualStart = 0;
  }

  if (step === 0) return [];

  const length = Math.max(Math.ceil((actualEnd - actualStart) / step), 0);
  return Array.from({ length }, (_, index) => actualStart + index * step);
};
