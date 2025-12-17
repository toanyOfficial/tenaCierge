function get(object, path, defaultValue) {
  if (object == null) return defaultValue;
  const segments = Array.isArray(path)
    ? path
    : String(path)
        .replace(/\[(\w+)\]/g, '.$1')
        .replace(/^\./, '')
        .split('.');
  let result = object;
  for (const segment of segments) {
    if (result != null && Object.prototype.hasOwnProperty.call(result, segment)) {
      result = result[segment];
    } else {
      return defaultValue;
    }
  }
  return result === undefined ? defaultValue : result;
}

module.exports = get;
