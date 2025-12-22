'use client';

import React, { useEffect, useMemo, useRef } from 'react';
import { Bar, CartesianGrid, ComposedChart, XAxis, YAxis } from 'recharts';

type ProbeProps = {
  subscriptionData: Array<Record<string, unknown>>;
  monthlyData: Array<Record<string, unknown>>;
};

type DebugShapeProps = any;

function createDebugShape(logId: string, guard: React.MutableRefObject<Set<string>>) {
  return function DebugBarShape(props: DebugShapeProps) {
    const { x, y, width, height, value, index, dataKey, fill, background } = props ?? {};
    const shouldLogValue = value === 1;
    const guardKey = shouldLogValue ? `${logId}-value-${index}` : `${logId}-first-${index}`;

    if (!guard.current.has(guardKey)) {
      guard.current.add(guardKey);
      console.log(`[${logId} -> bar-shape-props]`, {
        value,
        index,
        dataKey,
        y,
        height,
        x,
        width,
        isYFinite: Number.isFinite(y),
        isHeightFinite: Number.isFinite(height),
        fill,
        background
      });
    }

    return (
      <rect
        x={Number.isFinite(x) ? x : 0}
        y={Number.isFinite(y) ? y : 0}
        width={Number.isFinite(width) ? width : 0}
        height={Number.isFinite(height) ? height : 0}
        fill={fill ?? '#94a3b8'}
      />
    );
  };
}

export default function PR010NaNProbe({ subscriptionData, monthlyData }: ProbeProps) {
  const logGuard = useRef<Set<string>>(new Set());

  const subscriptionProbeData = useMemo(
    () =>
      (subscriptionData ?? []).map((row, index) => ({
        ...(row ?? {}),
        label: (row as Record<string, unknown>)?.label ?? `row-${index}`,
        subscriptionCount: index === 0 ? 1 : (row as Record<string, unknown>)?.subscriptionCount
      })),
    [subscriptionData]
  );

  const monthlyProbeData = useMemo(
    () =>
      (monthlyData ?? []).map((row, index) => ({
        ...(row ?? {}),
        label: (row as Record<string, unknown>)?.label ?? `row-${index}`,
        totalCount: index === 0 ? 1 : (row as Record<string, unknown>)?.totalCount
      })),
    [monthlyData]
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      const ids = [
        { id: 'chart-subscription', label: 'subscription' },
        { id: 'chart-monthly', label: 'monthly' }
      ];

      ids.forEach(({ id, label }) => {
        const barPaths = document.querySelectorAll<SVGPathElement>(
          `#${id} .recharts-layer.recharts-bar-rectangle path.recharts-rectangle`
        );
        console.log(`[client-092 -> ${label}-barPathCount-after-probe]`, {
          barPathCount: barPaths.length
        });
      });
    }, 800);

    return () => clearTimeout(timer);
  }, []);

  const shapes = useMemo(
    () => ({
      subscription: createDebugShape('client-090', logGuard),
      monthly: createDebugShape('client-091', logGuard)
    }),
    []
  );

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ width: 520, height: 240, background: '#0f172a', padding: 12, borderRadius: 8 }}>
        <p style={{ color: '#f97316', fontWeight: 700, marginBottom: 8 }}>PR-010 subscription probe</p>
        <ComposedChart width={480} height={180} data={subscriptionProbeData} style={{ overflow: 'visible' }}>
          <CartesianGrid strokeDasharray="4 4" stroke="rgba(148, 163, 184, 0.4)" vertical={false} />
          <XAxis dataKey="label" type="category" tickLine={false} axisLine={false} />
          <YAxis tickLine={false} axisLine={false} domain={[0, 'auto']} />
          <Bar
            dataKey="subscriptionCount"
            isAnimationActive={false}
            shape={shapes.subscription}
            fill="#22c55e"
            barSize={20}
            minPointSize={1}
          />
        </ComposedChart>
      </div>

      <div style={{ width: 520, height: 240, background: '#0f172a', padding: 12, borderRadius: 8 }}>
        <p style={{ color: '#f97316', fontWeight: 700, marginBottom: 8 }}>PR-010 monthly probe</p>
        <ComposedChart width={480} height={180} data={monthlyProbeData} style={{ overflow: 'visible' }}>
          <CartesianGrid strokeDasharray="4 4" stroke="rgba(148, 163, 184, 0.4)" vertical={false} />
          <XAxis dataKey="label" type="category" tickLine={false} axisLine={false} />
          <YAxis tickLine={false} axisLine={false} domain={[0, 'auto']} />
          <Bar
            dataKey="totalCount"
            isAnimationActive={false}
            shape={shapes.monthly}
            fill="#6366f1"
            barSize={20}
            minPointSize={1}
          />
        </ComposedChart>
      </div>
    </div>
  );
}
