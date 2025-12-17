module.exports = function sortBy(collection, iteratee) {
  const values = Array.isArray(collection) ? [...collection] : Object.values(collection || {});
  const getter = typeof iteratee === 'function' ? iteratee : (item) => item?.[iteratee];
  return values.sort((a, b) => {
    const va = getter(a);
    const vb = getter(b);
    if (va === vb) return 0;
    if (va === undefined) return 1;
    if (vb === undefined) return -1;
    return va > vb ? 1 : -1;
  });
};
