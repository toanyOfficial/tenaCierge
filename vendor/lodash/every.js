module.exports = function every(collection, predicate) {
  if (!collection) return false;
  const fn = typeof predicate === 'function' ? predicate : (item) => item && item[predicate];
  if (Array.isArray(collection)) {
    return collection.every((item, index) => fn(item, index, collection));
  }
  return Object.values(collection).every((item, index) => fn(item, index, collection));
};
