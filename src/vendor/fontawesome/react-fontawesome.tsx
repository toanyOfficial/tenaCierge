import type { IconDefinition } from './fontawesome-svg-core';
import type { CSSProperties } from 'react';

const sizeMap: Record<string, string> = {
  xs: '0.75em',
  sm: '0.875em',
  lg: '1.333em',
  '1x': '1em',
  '2x': '2em',
  '3x': '3em'
};

type Props = {
  icon: IconDefinition;
  size?: keyof typeof sizeMap | '1x' | '2x' | '3x';
  className?: string;
};

export function FontAwesomeIcon({ icon, size = '1x', className }: Props) {
  const dimension = sizeMap[size] ?? sizeMap['1x'];
  const style: CSSProperties = {
    width: dimension,
    height: dimension,
    display: 'inline-block'
  };

  return (
    <svg
      aria-hidden
      focusable="false"
      role="img"
      viewBox={icon.viewBox}
      style={style}
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path fill="currentColor" d={icon.svgPathData} />
    </svg>
  );
}

export default FontAwesomeIcon;
