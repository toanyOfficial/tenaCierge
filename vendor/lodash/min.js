module.exports = function min(collection) {
  if (!collection || collection.length === 0) return undefined;
  return collection.reduce((lowest, value) => (value < lowest ? value : lowest), collection[0]);
};
