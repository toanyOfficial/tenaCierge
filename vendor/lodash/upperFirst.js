module.exports = function upperFirst(string = '') {
  const str = String(string);
  if (str.length === 0) return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
};
