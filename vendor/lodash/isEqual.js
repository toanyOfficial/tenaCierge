function isObjectLike(value) {
  return value !== null && typeof value === 'object';
}

function isEqual(a, b) {
  if (a === b) return true;
  if (Number.isNaN(a) && Number.isNaN(b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (!isEqual(a[i], b[i])) return false;
    }
    return true;
  }
  if (isObjectLike(a) && isObjectLike(b)) {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    for (const key of keysA) {
      if (!Object.prototype.hasOwnProperty.call(b, key) || !isEqual(a[key], b[key])) {
        return false;
      }
    }
    return true;
  }
  return false;
}

module.exports = isEqual;
