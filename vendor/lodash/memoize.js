module.exports = function memoize(func) {
  const cache = new Map();
  const memoized = (...args) => {
    const key = JSON.stringify(args);
    if (cache.has(key)) {
      return cache.get(key);
    }
    const result = func(...args);
    cache.set(key, result);
    return result;
  };
  memoized.cache = cache;
  return memoized;
};
