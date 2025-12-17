module.exports = function some(collection, predicate) {
  if (!collection) return false;
  const fn = typeof predicate === 'function' ? predicate : (value) => value && value[predicate];
  if (Array.isArray(collection)) {
    return collection.some((item, index) => fn(item, index, collection));
  }
  return Object.values(collection).some((item, index) => fn(item, index, collection));
};
