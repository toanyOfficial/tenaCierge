module.exports = function throttle(func, wait = 0) {
  let lastCall = 0;
  let timeoutId;
  let lastArgs;

  const invoke = () => {
    lastCall = Date.now();
    timeoutId = undefined;
    func(...lastArgs);
  };

  const throttled = (...args) => {
    lastArgs = args;
    const now = Date.now();
    const remaining = wait - (now - lastCall);
    if (remaining <= 0 || remaining > wait) {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = undefined;
      }
      invoke();
    } else if (!timeoutId) {
      timeoutId = setTimeout(invoke, remaining);
    }
  };

  throttled.cancel = () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = undefined;
    }
  };

  return throttled;
};
