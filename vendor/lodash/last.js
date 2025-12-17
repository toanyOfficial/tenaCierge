module.exports = function last(array) {
  if (!Array.isArray(array) || array.length === 0) return undefined;
  return array[array.length - 1];
};
