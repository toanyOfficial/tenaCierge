"use client";

import React, { useEffect, useMemo, useRef } from 'react';
import dynamic from 'next/dynamic';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  LabelList,
  Legend,
  Line,
  Rectangle as RechartsRectangle,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Rectangle
} from 'recharts';

import styles from './stats-dashboard.module.css';
import PR010NaNProbe from './PR010NaNProbe.client';
import type { MonthlyAveragePoint } from './server/fetchMonthlyAverages';
import type { MonthlyOverviewPoint } from './server/fetchMonthlyOverview';
import type { WeekdaySeriesMeta, WeekdayStatsPoint } from './server/fetchWeekdayStats';
import type { ProfileSummary } from '@/src/utils/profile';

const PR001ClientOnlyChart = dynamic(() => import('./PR001ClientOnlyChart'), { ssr: false });

function formatValue(value: number) {
  return Number.isInteger(value) ? `${value}` : value.toFixed(1);
}

function hexChannel(value: number) {
  return Math.min(255, Math.max(0, Math.round(value)));
}

function shadeHexColor(hex: string, ratio: number) {
  const normalized = hex.startsWith('#') ? hex.slice(1) : hex;
  const bigint = parseInt(normalized, 16);
  const r = bigint >> 16;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;

  const shift = (channel: number) => hexChannel(channel + (255 - channel) * ratio);
  const newR = shadeDirection(r, ratio, shift);
  const newG = shadeDirection(g, ratio, shift);
  const newB = shadeDirection(b, ratio, shift);
  return `#${newR.toString(16).padStart(2, '0')}${newG
    .toString(16)
    .padStart(2, '0')}${newB.toString(16).padStart(2, '0')}`;
}

function shadeDirection(channel: number, ratio: number, lighten: (channel: number) => number) {
  if (ratio === 0) return hexChannel(channel);
  if (ratio > 0) return hexChannel(lighten(channel));
  return hexChannel(channel * (1 + ratio));
}

type Props = {
  profile: ProfileSummary;
  monthlyAverages: MonthlyAveragePoint[];
  monthlyOverview: MonthlyOverviewPoint[];
  weekdayStats: { points: WeekdayStatsPoint[]; buildings: WeekdaySeriesMeta[] };
};

class ChartErrorBoundary extends React.Component<
  { children: React.ReactNode; section: string },
  { hasError: boolean }
> {
  constructor(props: { children: React.ReactNode; section: string }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    console.log('[client-150 -> recharts-error-boundary]', {
      section: this.props.section,
      message: error?.message,
      name: error?.name,
      stackPresent: Boolean(error?.stack)
    });
  }

  render() {
    if (this.state.hasError) {
      return <div>{`Chart render error (section=${this.props.section})`}</div>;
    }

    return this.props.children;
  }
}

function toNumber(value: unknown, fallback = 0) {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const minimalBarData = [
  { label: 'Alpha', value: 12 },
  { label: 'Beta', value: 24 }
];

export default function StatsDashboard({
  profile: _profile,
  monthlyAverages,
  monthlyOverview,
  weekdayStats
}: Props) {

  const normalizedMonthlyAverages = useMemo(
    () =>
      monthlyAverages.map((row) => ({
        ...row,
        subscriptionCount: toNumber(row.subscriptionCount),
        perOrderCount: toNumber(row.perOrderCount)
      })),
    [monthlyAverages]
  );

  const normalizedMonthlyOverview = useMemo(
    () =>
      monthlyOverview.map((row) => ({
        ...row,
        totalCount: toNumber(row.totalCount),
        roomAverage: toNumber(row.roomAverage)
      })),
    [monthlyOverview]
  );

  const normalizedWeekdayBuildings = useMemo(
    () =>
      [...weekdayStats.buildings]
        .map((meta) => ({
          ...meta,
          averageCount: toNumber(meta.averageCount)
        }))
        .sort((a, b) => {
          const diff = (b.averageCount ?? 0) - (a.averageCount ?? 0);
          if (diff !== 0) return diff;
          return a.key.localeCompare(b.key);
        }),
    [weekdayStats.buildings]
  );

  
  const normalizedWeekdayPoints = useMemo(
    () =>
      weekdayStats.points.map((point) => {
        const next: WeekdayStatsPoint = {
          label: point.label,
          totalCount: toNumber(point.totalCount)
        };

        Object.entries(point).forEach(([key, value]) => {
          if (key === 'label' || key === 'totalCount') return;
          next[key] = toNumber(value);
        });

      return next;
    }),
    [weekdayStats.points]
  );

  const subscriptionGuard = useMemo(() => {
    let fixed = 0;
    const data = normalizedMonthlyAverages.map((row) => {
      const value = toNumber(row.subscriptionCount, 0);
      if (!Number.isFinite(row.subscriptionCount)) fixed += 1;
      return { ...row, subscriptionCount: value };
    });
    const allZero = data.every((row) => row.subscriptionCount === 0);
    return { data, fixed, total: data.length, allZero };
  }, [normalizedMonthlyAverages]);

  const monthlyGuard = useMemo(() => {
    let totalFixed = 0;
    let roomFixed = 0;
    const data = normalizedMonthlyOverview.map((row) => {
      const totalCount = toNumber(row.totalCount, 0);
      const roomAverage = toNumber(row.roomAverage, 0);
      if (!Number.isFinite(row.totalCount)) totalFixed += 1;
      if (!Number.isFinite(row.roomAverage)) roomFixed += 1;
      return { ...row, totalCount, roomAverage };
    });
    const allZero = data.every((row) => row.totalCount === 0);
    return { data, totalFixed, roomFixed, total: data.length, allZero };
  }, [normalizedMonthlyOverview]);

  const subscriptionDomain: [number, number | 'auto'] = subscriptionGuard.allZero ? [0, 1] : [0, 'auto'];
  const monthlyDomain: [number, number | 'auto'] = monthlyGuard.allZero ? [0, 1] : [0, 'auto'];

  useEffect(() => {
    console.log('[client-160 -> chart-finite-guard-summary]', {
      sub_total: subscriptionGuard.total,
      sub_fixed: subscriptionGuard.fixed,
      mon_total: monthlyGuard.total,
      mon_fixed: monthlyGuard.totalFixed + monthlyGuard.roomFixed,
      sub_allZero: subscriptionGuard.allZero,
      mon_allZero: monthlyGuard.allZero,
      sub_domain: subscriptionDomain,
      mon_domain: monthlyDomain
    });
  }, [monthlyDomain, monthlyGuard, subscriptionDomain, subscriptionGuard]);

  const planMax = useMemo(() => {
    const peak = Math.max(
      ...subscriptionGuard.data.map((row) => Math.max(row.subscriptionCount, row.perOrderCount)),
      0
    );
    if (peak === 0) return 1;
    return Math.ceil(peak * 1.1);
  }, [subscriptionGuard.data]);

  const planTicks = useMemo(() => {
    const ratios = [0.25, 0.5, 0.75, 1];
    return ratios.map((ratio) => Math.ceil(planMax * ratio));
  }, [planMax]);

  const monthlyMax = useMemo(() => {
    const peak = Math.max(
      ...monthlyGuard.data.map((row) => Math.max(row.totalCount, row.roomAverage)),
      0
    );
    if (peak === 0) return 1;
    return Math.max(1, Math.ceil(peak * 1.15));
  }, [monthlyGuard.data]);

  const monthlyTicks = useMemo(() => {
    const ratios = [0.25, 0.5, 0.75, 1];
    return ratios.map((ratio) => Math.ceil(monthlyMax * ratio));
  }, [monthlyMax]);

  const weekdayColorMap = useMemo(() => {
    const sectorBaseColors: Record<string, string> = {
      '1': '#38bdf8',
      '2': '#f59e0b',
      '3': '#22c55e'
    };

    const groupedBySector = normalizedWeekdayBuildings.reduce((acc, meta) => {
      const sectorKey = meta.sectorCode ?? '__unknown__';
      const group = acc.get(sectorKey) ?? [];
      group.push(meta);
      acc.set(sectorKey, group);
      return acc;
    }, new Map<string, WeekdaySeriesMeta[]>());

    const buildingColors = new Map<string, string>();
    const brightRatio = 0.32;
    const darkRatio = -0.32;

    groupedBySector.forEach((buildings, sectorKey) => {
      const base = sectorBaseColors[sectorKey] ?? '#38bdf8';
      const sortedByVolume = [...buildings].sort(
        (a, b) => (b.averageCount ?? 0) - (a.averageCount ?? 0)
      );

      sortedByVolume.forEach((meta, index) => {
        const ratio =
          sortedByVolume.length === 1
            ? 0
            : brightRatio - ((brightRatio - darkRatio) * index) / (sortedByVolume.length - 1);
        buildingColors.set(meta.key, shadeHexColor(base, ratio));
      });
    });

    return buildingColors;
  }, [normalizedWeekdayBuildings]);

  const weekdayMax = useMemo(() => {
    const peak = Math.max(...normalizedWeekdayPoints.map((row) => toNumber(row.totalCount)), 0);
    if (peak === 0) return 4;
    return Math.max(14, Math.ceil(peak * 1.2));
  }, [normalizedWeekdayPoints]);

  const weekdayTicks = useMemo(() => {
    const ratios = [0.25, 0.5, 0.75, 1];
    return ratios.map((ratio) => Math.ceil(weekdayMax * ratio));
  }, [weekdayMax]);

  const BarValueLabel = useMemo(
    () =>
      function BarLabel({ x, y, width, value }: any) {
        if (!value) return null;
        const midX = (x ?? 0) + (width ?? 0) / 2;
        const labelY = (y ?? 0) - 8;
        return (
          <text x={midX} y={labelY} textAnchor="middle" className={styles.barLabelText}>
            {formatValue(value)}
          </text>
        );
      },
    []
  );

  const makeBuildingLabel = useMemo(
    () =>
      (side: 'left' | 'right') =>
        function BuildingLabel({ x, y, width, height, value }: any) {
          if (value === undefined || value === null) return null;
          if (value < 1) return null;

          const centerY = (y ?? 0) + (height ?? 0) / 2;
          const offset = 8;
          const labelX =
            side === 'left'
              ? (x ?? 0) - offset
              : (x ?? 0) + (width ?? 0) + offset;
          const anchor = side === 'left' ? 'end' : 'start';

          return (
            <text
              x={labelX}
              y={centerY}
              dominantBaseline="middle"
              textAnchor={anchor}
              className={styles.buildingLabelText}
            >
              {formatValue(value)}
            </text>
          );
        },
    []
  );

  const LineValueLabel = useMemo(
    () =>
      function LineLabel({ x, y, value }: any) {
        if (!value) return null;
        const labelY = (y ?? 0) - 6;
        return (
          <text x={x} y={labelY} textAnchor="middle" className={styles.lineLabelText}>
            {formatValue(value)}
          </text>
        );
      },
    []
  );

  const PlanLegend = useMemo(
    () =>
      function LegendContent() {
        return (
          <div className={styles.chartLegend} aria-label="범례">
            <span className={styles.legendItem}>
              <span className={styles.legendBarSwatch} />정액제
            </span>
            <span className={styles.legendItem}>
              <span className={styles.legendLineSwatch} />건별제
            </span>
          </div>
        );
      },
    []
  );

  const MonthlyLegend = useMemo(
    () =>
      function LegendContent() {
        return (
          <div className={styles.chartLegend} aria-label="범례">
            <span className={styles.legendItem}>
              <span className={styles.legendBarSwatchAlt} />총 건수
            </span>
            <span className={styles.legendItem}>
              <span className={styles.legendLineSwatchAlt} />호실 평균 건수
            </span>
          </div>
        );
      },
    []
  );

  const WeekdayLegend = useMemo(
    () =>
      function LegendContent() {
        return (
          <div className={`${styles.chartLegend} ${styles.weekdayLegend}`} aria-label="범례">
            {normalizedWeekdayBuildings.map((meta, index) => {
              const color = weekdayColorMap.get(meta.key) ?? '#38bdf8';
              return (
                <span key={meta.key} className={styles.legendItem}>
                  <span className={styles.legendBarSwatchDynamic} style={{ backgroundColor: color }} />
                  {meta.label}
                </span>
              );
            })}
          </div>
      );
    },
    [weekdayColorMap, normalizedWeekdayBuildings]
  );

  const legendTopLeft = useMemo(() => ({ top: 6, left: 12 }), []);

  const planChart = useMemo(
    () => (
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart
          data={subscriptionGuard.data}
          margin={{ top: 54, right: 18, bottom: 24, left: 18 }}
          style={{ overflow: 'visible' }}
        >
          <CartesianGrid strokeDasharray="4 4" stroke="rgba(148, 163, 184, 0.2)" vertical={false} />
          <XAxis
            dataKey="label"
            xAxisId="x"
            tickLine={false}
            axisLine={{ stroke: 'rgba(148, 163, 184, 0.4)' }}
            tick={{ fill: '#cbd5e1', fontWeight: 700, fontSize: 12 }}
          />
          <YAxis
            orientation="left"
            tickLine={false}
            axisLine={{ stroke: 'rgba(148, 163, 184, 0.4)' }}
            tick={{ fill: '#cbd5e1', fontWeight: 700, fontSize: 12 }}
            domain={subscriptionDomain}
            ticks={planTicks}
            allowDecimals={false}
          />
          <Legend
            verticalAlign="top"
            align="left"
            wrapperStyle={legendTopLeft}
            content={<PlanLegend />}
          />
          <Bar
            dataKey="subscriptionCount"
            fill="#22c55e"
            barSize={20}
            radius={[6, 6, 0, 0]}
            minPointSize={1}
            yAxisId="left"
          >
            <LabelList dataKey="subscriptionCount" position="top" content={<BarValueLabel />} />
          </Bar>
          <Line
            dataKey="perOrderCount"
            yAxisId="left"
            type="monotone"
            stroke="#38bdf8"
            strokeWidth={1}
            dot={false}
            activeDot={false}
            connectNulls
          >
            <LabelList dataKey="perOrderCount" position="top" content={<LineValueLabel />} />
          </Line>
          <defs>
            <linearGradient id="planBarGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#22c55e" stopOpacity="0.9" />
              <stop offset="100%" stopColor="#16a34a" stopOpacity="0.9" />
            </linearGradient>
          </defs>
        </ComposedChart>
      </ResponsiveContainer>
    ),
    [
      BarValueLabel,
      LineValueLabel,
      PlanLegend,
      legendTopLeft,
      subscriptionDomain,
      subscriptionGuard.data,
      planMax,
      planTicks
    ]
  );

  const monthlyTotalsChart = useMemo(
    () => (
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart
          data={monthlyGuard.data}
          margin={{ top: 54, right: 18, bottom: 24, left: 18 }}
          style={{ overflow: 'visible' }}
        >
          <CartesianGrid strokeDasharray="4 4" stroke="rgba(148, 163, 184, 0.2)" vertical={false} />
          <XAxis
            dataKey="label"
            xAxisId="x"
            tickLine={false}
            axisLine={{ stroke: 'rgba(148, 163, 184, 0.4)' }}
            tick={{ fill: '#cbd5e1', fontWeight: 700, fontSize: 12 }}
          />
          <YAxis
            orientation="left"
            tickLine={false}
            axisLine={{ stroke: 'rgba(148, 163, 184, 0.4)' }}
            tick={{ fill: '#cbd5e1', fontWeight: 700, fontSize: 12 }}
            domain={monthlyDomain}
            ticks={monthlyTicks}
            allowDecimals={false}
          />
          <Legend
            verticalAlign="top"
            align="left"
            wrapperStyle={legendTopLeft}
            content={<MonthlyLegend />}
          />
          <Bar
            dataKey="totalCount"
            fill="#6366f1"
            barSize={20}
            radius={[6, 6, 0, 0]}
            minPointSize={1}
            yAxisId="left"
          >
            <LabelList dataKey="totalCount" position="top" content={<BarValueLabel />} />
          </Bar>
          <Line
            dataKey="roomAverage"
            yAxisId="left"
            type="monotone"
            stroke="#7dd3fc"
            strokeWidth={1}
            dot={{ stroke: '#0ea5e9', fill: '#0ea5e9', r: 3 }}
            activeDot={false}
            connectNulls
          >
            <LabelList dataKey="roomAverage" position="top" content={<LineValueLabel />} />
          </Line>
          <defs>
            <linearGradient id="totalCountGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#818cf8" stopOpacity="0.95" />
              <stop offset="100%" stopColor="#6366f1" stopOpacity="0.95" />
            </linearGradient>
          </defs>
        </ComposedChart>
      </ResponsiveContainer>
    ),
    [
      BarValueLabel,
      LineValueLabel,
      MonthlyLegend,
      legendTopLeft,
      monthlyDomain,
      monthlyGuard.data,
      monthlyMax,
      monthlyTicks
    ]
  );

  const weekdayChart = useMemo(
    () => (
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart
          data={normalizedWeekdayPoints}
          margin={{ top: 60, right: 40, bottom: 24, left: 40 }}
        >
          <CartesianGrid strokeDasharray="4 4" stroke="rgba(148, 163, 184, 0.2)" vertical={false} />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={{ stroke: 'rgba(148, 163, 184, 0.4)' }}
            tick={{ fill: '#cbd5e1', fontWeight: 700, fontSize: 12 }}
          />
          <YAxis
            tickLine={false}
            axisLine={{ stroke: 'rgba(148, 163, 184, 0.4)' }}
            tick={{ fill: '#cbd5e1', fontWeight: 700, fontSize: 12 }}
            domain={[0, weekdayMax]}
            ticks={weekdayTicks}
            allowDecimals={false}
          />
          <Legend
            verticalAlign="top"
            align="left"
            wrapperStyle={legendTopLeft}
            content={<WeekdayLegend />}
          />
          {normalizedWeekdayBuildings.map((meta, index) => {
            const color = weekdayColorMap.get(meta.key) ?? '#38bdf8';
            const isTopStack = index === normalizedWeekdayBuildings.length - 1;
            const labelSide = index % 2 === 0 ? 'right' : 'left';
            const BuildingLabel = makeBuildingLabel(labelSide);
            return (
              <Bar
                key={meta.key}
                dataKey={meta.key}
                stackId="weekday"
                fill={color}
                barSize={20}
                radius={isTopStack ? [6, 6, 0, 0] : [0, 0, 0, 0]}
                isAnimationActive={false}
                shape={index === 0 ? debugBarShapes.weekday : undefined}
              >
                <LabelList dataKey={meta.key} content={<BuildingLabel />} />
                {isTopStack ? (
                  <LabelList dataKey="totalCount" position="top" content={<BarValueLabel />} />
                ) : null}
              </Bar>
            );
          })}
        </ComposedChart>
      </ResponsiveContainer>
    ),
    [
      BarValueLabel,
      WeekdayLegend,
      legendTopLeft,
      makeBuildingLabel,
      weekdayColorMap,
      weekdayMax,
      normalizedWeekdayBuildings,
      normalizedWeekdayPoints,
      weekdayTicks
    ]
  );

  return (
    <div className={styles.shell}>
      <div className={styles.canvas}>
        <header className={styles.header}>
          <div>
            <p className={styles.pageLabel}>대시보드-통계표</p>
            <p className={styles.pageSubtitle}>1920 x 1080 전용 풀 스크린 캔버스에서 네 개의 그래프만을 선명하게 배치했습니다.</p>
          </div>
          <div className={styles.badges}>
            <span className={styles.roleBadge}>ADMIN</span>
            <span className={styles.deviceNote}>입력 · 스크롤 없음</span>
          </div>
        </header>

        <div className={styles.graphGrid}>
          <ChartErrorBoundary section="subscription">
            <section id="chart-subscription" className={styles.graphCard} aria-label="요금제별 통계">
              <div className={styles.graphHeading}>
                <p className={styles.graphTitle}>요금제별 통계</p>
              </div>
              <div className={styles.graphSurface} aria-hidden="true">
                <div className={styles.mixedChart}>{planChart}</div>
              </div>
            </section>
          </ChartErrorBoundary>

          <ChartErrorBoundary section="monthly">
            <section id="chart-monthly" className={styles.graphCard} aria-label="월별 통계">
              <div className={styles.graphHeading}>
                <p className={styles.graphTitle}>월별 통계</p>
              </div>
              <div className={styles.graphSurface} aria-hidden="true">
                <div className={styles.mixedChart}>{monthlyTotalsChart}</div>
              </div>
            </section>
          </ChartErrorBoundary>

          <ChartErrorBoundary section="weekday">
            <section id="chart-weekday" className={styles.graphCard} aria-label="요일별 통계">
              <div className={styles.graphHeading}>
                <p className={styles.graphTitle}>요일별 통계</p>
              </div>
              <div className={styles.graphSurface} aria-hidden="true">
                <div className={styles.mixedChart}>{weekdayChart}</div>
              </div>
            </section>
          </ChartErrorBoundary>

          <ChartErrorBoundary section="pr-001-fixed-debug">
            <section id="pr-001-fixed-chart" className={styles.graphCard} aria-label="고정형 BarChart 진단 (PR-001)">
              <div className={styles.graphHeading}>
                <p className={styles.graphTitle}>고정형 BarChart 진단 (PR-001)</p>
              </div>
              <div className={styles.graphSurface} aria-hidden="true">
                <div
                  style={{
                    width: 520,
                    height: 320,
                    background: '#fff',
                    margin: '12px auto'
                  }}
                >
                  {(() => {
                    console.log('[client-003] PR-001 debug card mounted');
                    return <PR001ClientOnlyChart />;
                  })()}
                </div>
              </div>
            </section>
          </ChartErrorBoundary>
        </div>
      </div>
    </div>
  );
}
