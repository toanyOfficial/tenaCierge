module.exports = function uniqBy(array = [], iteratee) {
  const fn = typeof iteratee === 'function' ? iteratee : (item) => item?.[iteratee];
  const seen = new Map();
  const result = [];
  array.forEach((item, index) => {
    const key = fn ? fn(item, index, array) : item;
    if (!seen.has(key)) {
      seen.set(key, true);
      result.push(item);
    }
  });
  return result;
};
