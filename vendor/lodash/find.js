module.exports = function find(collection, predicate) {
  if (!collection) return undefined;
  const fn = typeof predicate === 'function' ? predicate : (item) => item && item[predicate];
  if (Array.isArray(collection)) {
    return collection.find((item, index) => fn(item, index, collection));
  }
  return Object.values(collection).find((item, index) => fn(item, index, collection));
};
