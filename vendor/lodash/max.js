function max(array) {
  if (!Array.isArray(array) || array.length === 0) return undefined;
  let result = array[0];
  for (let i = 1; i < array.length; i += 1) {
    if (array[i] > result) {
      result = array[i];
    }
  }
  return result;
}

module.exports = max;
