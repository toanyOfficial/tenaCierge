module.exports = function mapValues(object, iteratee) {
  if (object == null) return {};
  const result = {};
  const fn = typeof iteratee === 'function' ? iteratee : (value) => value;
  Object.keys(object).forEach((key) => {
    result[key] = fn(object[key], key, object);
  });
  return result;
};
