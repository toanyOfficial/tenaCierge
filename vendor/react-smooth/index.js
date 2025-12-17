const React = require('react');

function Animate({
  isActive = true,
  children,
  onAnimationStart,
  onAnimationEnd,
}) {
  React.useEffect(() => {
    if (!isActive) return undefined;
    if (typeof onAnimationStart === 'function') {
      onAnimationStart();
    }
    if (typeof onAnimationEnd === 'function') {
      onAnimationEnd();
    }
    return undefined;
  }, [isActive, onAnimationStart, onAnimationEnd]);

  if (typeof children === 'function') {
    return children({});
  }
  return React.createElement(React.Fragment, null, children);
}

module.exports = Animate;
module.exports.default = Animate;
