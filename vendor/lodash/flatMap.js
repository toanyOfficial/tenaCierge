module.exports = function flatMap(collection, iteratee) {
  const fn = typeof iteratee === 'function' ? iteratee : (item) => item?.[iteratee];
  const source = Array.isArray(collection) ? collection : Object.values(collection || {});
  return source.flatMap((item, index) => {
    const result = fn(item, index, collection);
    if (Array.isArray(result)) return result;
    if (result === undefined || result === null) return [];
    return [result];
  });
};
