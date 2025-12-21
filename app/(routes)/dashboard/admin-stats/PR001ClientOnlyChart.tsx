'use client';

import React, { useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts';

export default function PR001ClientOnlyChart() {
  console.log('[client-001] PR-001 FixedDebugBarChart render (client-only)');
  console.log('[client-010] PR-002 PR001ClientOnlyChart render (ssr:false target)');

  const data = [
    { name: 'A', v: 10 },
    { name: 'B', v: 30 }
  ];

  useEffect(() => {
    console.log('[client-011] PR-002 post-mount counts (path/rect)', {
      barGroup: document.querySelectorAll('#pr-001-fixed-chart .recharts-bar-rectangle').length,
      barRect: document.querySelectorAll('#pr-001-fixed-chart .recharts-bar-rectangle rect').length,
      barPath: document.querySelectorAll(
        '#pr-001-fixed-chart .recharts-bar-rectangle path.recharts-rectangle'
      ).length,
      allPath: document.querySelectorAll('#pr-001-fixed-chart svg path').length,
      allRect: document.querySelectorAll('#pr-001-fixed-chart rect').length
    });
  }, []);

  return (
    <BarChart width={520} height={320} data={data}>
      <CartesianGrid vertical={false} />
      <XAxis dataKey="name" type="category" />
      <YAxis domain={[0, 40]} />
      <Bar
        dataKey="v"
        isAnimationActive={false}
        onMouseEnter={() => {
          console.log('[client-002] PR-001 Bar mouse enter');
          console.log('[client-012] PR-002 Bar mouse enter');
        }}
      />
    </BarChart>
  );
}
