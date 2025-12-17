function toValue(mixed) {
  if (!mixed) return '';
  if (typeof mixed === 'string' || typeof mixed === 'number') return mixed;
  if (Array.isArray(mixed)) return mixed.map(toValue).filter(Boolean).join(' ');
  if (typeof mixed === 'object') {
    return Object.keys(mixed)
      .filter((key) => mixed[key])
      .join(' ');
  }
  return '';
}

function clsx(...inputs) {
  return inputs.map(toValue).filter(Boolean).join(' ');
}

module.exports = clsx;
module.exports.default = clsx;
