function invariant(condition, message = 'Invariant violation') {
  if (!condition) {
    throw new Error(message);
  }
}

module.exports = invariant;
module.exports.default = invariant;
