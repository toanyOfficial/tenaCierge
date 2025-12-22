"use client";

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  LabelList,
  Legend,
  ResponsiveContainer,
  XAxis,
  YAxis
} from 'recharts';

import styles from './stats-dashboard.module.css';
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

export default function StatsDashboard({
  profile: _profile,
  monthlyAverages,
  monthlyOverview,
  weekdayStats
}: Props) {
  const searchParams = useSearchParams();
  const unsafeCharts = searchParams?.get('unsafeCharts') === '1' || searchParams?.get('unsafeCharts') === 'true';
  const chartFilterRaw = searchParams?.get('chart');
  const allowedChartFilters = new Set(['subscription', 'monthly', 'weekday', 'pr001', 'pr010', 'all', 'none']);
  const chartFilter = chartFilterRaw && allowedChartFilters.has(chartFilterRaw) ? chartFilterRaw : null;

  const enabledSections = useMemo(() => {
    const allSections = ['subscription', 'monthly', 'weekday', 'pr001'];
    if (!unsafeCharts) return [];
    if (!chartFilter || chartFilter === 'all') return allSections;
    if (chartFilter === 'none') return [];
    return allSections.includes(chartFilter) ? [chartFilter] : [];
  }, [chartFilter, unsafeCharts]);

  const subscriptionEnabled = enabledSections.includes('subscription');
  const monthlyEnabled = enabledSections.includes('monthly');
  const weekdayEnabled = enabledSections.includes('weekday');
  const pr001Enabled = enabledSections.includes('pr001');
  const subscriptionContainerRef = useRef<HTMLDivElement | null>(null);
  const monthlyContainerRef = useRef<HTMLDivElement | null>(null);
  const containerRefLogged = useRef({ subscription: false, monthly: false });
  const [containerRects, setContainerRects] = useState({
    subscription: { w: null as number | null, h: null as number | null },
    monthly: { w: null as number | null, h: null as number | null }
  });
  const subscriptionRect = containerRects.subscription;
  const monthlyRect = containerRects.monthly;
  const subscriptionHasSize =
    subscriptionRect.w !== null && subscriptionRect.w > 0 && subscriptionRect.h !== null && subscriptionRect.h > 0;
  const monthlyHasSize = monthlyRect.w !== null && monthlyRect.w > 0 && monthlyRect.h !== null && monthlyRect.h > 0;

  useEffect(() => {
    console.log('[client-180 -> admin-stats-fingerprint]', {
      commit: process.env.NEXT_PUBLIC_GIT_SHA ?? 'unknown',
      buildTime: process.env.NEXT_PUBLIC_BUILD_TIME ?? 'unknown',
      fileMarker: 'StatsDashboard.PR017-HOTFIX.v3',
      unsafeCharts,
      chart: chartFilter ?? 'none'
    });
  }, [chartFilter, unsafeCharts]);

  useEffect(() => {
    console.log('[client-190 -> charts-toggle-state]', {
      unsafeCharts,
      chart: chartFilter ?? 'none'
    });
    console.log('[client-191 -> charts-enabled-sections]', { enabledSections });
  }, [chartFilter, enabledSections, unsafeCharts]);

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
    const subscriptionReason = !unsafeCharts
      ? 'hard-disabled'
      : subscriptionEnabled
      ? 'unsafe-enabled'
      : 'filtered-out';
    const monthlyReason = !unsafeCharts
      ? 'hard-disabled'
      : monthlyEnabled
      ? 'unsafe-enabled'
      : 'filtered-out';

    console.log('[client-181 -> subscription-render-path]', {
      rendered: subscriptionEnabled,
      reason: subscriptionReason
    });
    console.log('[client-182 -> monthly-render-path]', {
      rendered: monthlyEnabled,
      reason: monthlyReason
    });
  }, [monthlyEnabled, subscriptionEnabled, unsafeCharts]);

  useEffect(() => {
    if (!subscriptionEnabled && !monthlyEnabled) return;

    const payload = {
      sub0: subscriptionEnabled ? subscriptionGuard.data?.[0] ?? null : null,
      mon0: monthlyEnabled ? monthlyGuard.data?.[0] ?? null : null,
      subHasLabel: subscriptionEnabled
        ? subscriptionGuard.data?.[0]
          ? 'label' in subscriptionGuard.data[0]
          : null
        : null,
      monHasLabel: monthlyEnabled ? (monthlyGuard.data?.[0] ? 'label' in monthlyGuard.data[0] : null) : null,
      subCountType: subscriptionEnabled
        ? subscriptionGuard.data?.[0]
          ? typeof subscriptionGuard.data[0].subscriptionCount
          : null
        : null,
      monCountType: monthlyEnabled ? (monthlyGuard.data?.[0] ? typeof monthlyGuard.data[0].totalCount : null) : null,
      subKeys: subscriptionEnabled
        ? subscriptionGuard.data?.[0]
          ? Object.keys(subscriptionGuard.data[0]).slice(0, 20)
          : []
        : [],
      monKeys: monthlyEnabled ? (monthlyGuard.data?.[0] ? Object.keys(monthlyGuard.data[0]).slice(0, 20) : []) : []
    };

    console.log('[client-200 -> chart-data-sample]', payload);
  }, [monthlyEnabled, monthlyGuard.data, subscriptionEnabled, subscriptionGuard.data]);

  useEffect(() => {
    if (!unsafeCharts) return;

    const timer = setTimeout(() => {
      const processSection = (
        section: 'subscription' | 'monthly',
        ref: React.RefObject<HTMLDivElement | null>
      ) => {
        if (containerRefLogged.current[section]) return;

        const node = ref.current;
        console.log('[client-202 -> chart-container-ref-state]', {
          section,
          hasRef: Boolean(node),
          nodeName: node?.nodeName ?? null,
          isConnected: node ? node.isConnected : null
        });

        const rect = node?.getBoundingClientRect?.();
        console.log('[client-203 -> chart-container-rect-raw]', { section, rect: rect ?? null });

        const style = node
          ? getComputedStyle(node)
          : null;
        console.log('[client-204 -> chart-container-style-sample]', {
          section,
          style:
            style !== null
              ? {
                  width: style.width,
                  height: style.height,
                  minHeight: style.minHeight,
                  display: style.display,
                  position: style.position
                }
              : null
        });

        console.log('[client-201 -> chart-container-rect]', {
          section,
          w: rect?.width ?? null,
          h: rect?.height ?? null
        });

        setContainerRects((prev) => {
          const next = {
            ...prev,
            [section]: {
              w: rect?.width ?? null,
              h: rect?.height ?? null
            }
          };
          if (
            prev[section].w === next[section].w &&
            prev[section].h === next[section].h
          ) {
            return prev;
          }
          return next;
        });

        containerRefLogged.current[section] = true;
      };

      if (subscriptionEnabled) {
        processSection('subscription', subscriptionContainerRef);
      }

      if (monthlyEnabled) {
        processSection('monthly', monthlyContainerRef);
      }
    }, 200);

    return () => clearTimeout(timer);
  }, [monthlyEnabled, subscriptionEnabled, unsafeCharts]);

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

  // shape 디버그 변수가 누락되어 빌드가 깨지는 것을 방지하기 위한 안전한 기본 shape
  const weekdayBarShape: React.ComponentProps<typeof Bar>['shape'] = undefined;

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
        <BarChart data={subscriptionGuard.data} margin={{ top: 54, right: 18, bottom: 24, left: 18 }}>
          <CartesianGrid strokeDasharray="4 4" stroke="rgba(148, 163, 184, 0.2)" vertical={false} />
          <XAxis
            dataKey="label"
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
          >
            <LabelList dataKey="subscriptionCount" position="top" content={<BarValueLabel />} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    ),
    [BarValueLabel, PlanLegend, legendTopLeft, subscriptionDomain, subscriptionGuard.data, planTicks]
  );

  const monthlyTotalsChart = useMemo(
    () => (
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={monthlyGuard.data} margin={{ top: 54, right: 18, bottom: 24, left: 18 }}>
          <CartesianGrid strokeDasharray="4 4" stroke="rgba(148, 163, 184, 0.2)" vertical={false} />
          <XAxis
            dataKey="label"
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
          <Bar dataKey="totalCount" fill="#6366f1" barSize={20} radius={[6, 6, 0, 0]} minPointSize={1}>
            <LabelList dataKey="totalCount" position="top" content={<BarValueLabel />} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    ),
    [BarValueLabel, MonthlyLegend, legendTopLeft, monthlyDomain, monthlyGuard.data, monthlyTicks]
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      console.log('[client-170 -> chart-type-simplified]', {
        subscriptionChart: 'BarChart',
        monthlyChart: 'BarChart',
        sub_domain: subscriptionDomain,
        mon_domain: monthlyDomain
      });
    }, 200);

    return () => clearTimeout(timer);
  }, [monthlyDomain, subscriptionDomain]);

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
                shape={weekdayBarShape}
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
              <div className={styles.mixedChart} ref={subscriptionContainerRef} style={{ minHeight: 320 }}>
                {subscriptionEnabled ? (
                  subscriptionHasSize ? (
                    planChart
                  ) : (
                    <p className={styles.chartDisabledText}>
                      Chart container not ready (size unavailable). enable unsafeCharts=1&chart=subscription and retry.
                    </p>
                  )
                ) : (
                  <p className={styles.chartDisabledText}>
                    Chart temporarily disabled (invariant hotfix). add ?unsafeCharts=1&chart=subscription to render.
                  </p>
                )}
              </div>
            </div>
          </section>
        </ChartErrorBoundary>

        <ChartErrorBoundary section="monthly">
            <section id="chart-monthly" className={styles.graphCard} aria-label="월별 통계">
          <div className={styles.graphHeading}>
            <p className={styles.graphTitle}>월별 통계</p>
          </div>
            <div className={styles.graphSurface} aria-hidden="true">
              <div className={styles.mixedChart} ref={monthlyContainerRef} style={{ minHeight: 320 }}>
                {monthlyEnabled ? (
                  monthlyHasSize ? (
                    monthlyTotalsChart
                  ) : (
                    <p className={styles.chartDisabledText}>
                      Chart container not ready (size unavailable). enable unsafeCharts=1&chart=monthly and retry.
                    </p>
                  )
                ) : (
                  <p className={styles.chartDisabledText}>
                    Chart temporarily disabled (invariant hotfix). add ?unsafeCharts=1&chart=monthly to render.
                  </p>
                )}
              </div>
            </div>
          </section>
        </ChartErrorBoundary>

          <ChartErrorBoundary section="weekday">
            <section id="chart-weekday" className={styles.graphCard} aria-label="요일별 통계">
              <div className={styles.graphHeading}>
                <p className={styles.graphTitle}>요일별 통계</p>
              </div>
              <div className={styles.graphSurface} aria-hidden="true">
                <div className={styles.mixedChart}>
                  {weekdayEnabled ? (
                    weekdayChart
                  ) : (
                    <p className={styles.chartDisabledText}>
                      Chart disabled by filter. remove chart parameter or set chart=weekday.
                    </p>
                  )}
                </div>
              </div>
            </section>
          </ChartErrorBoundary>

          <ChartErrorBoundary section="pr-001-fixed-debug">
            <section id="pr-001-fixed-chart" className={styles.graphCard} aria-label="고정형 BarChart 진단 (PR-001)">
              <div className={styles.graphHeading}>
                <p className={styles.graphTitle}>고정형 BarChart 진단 (PR-001)</p>
              </div>
              <div className={styles.graphSurface} aria-hidden="true">
                {pr001Enabled ? (
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
                ) : (
                  <p className={styles.chartDisabledText}>
                    Chart disabled by filter. set chart=pr001 to render this card.
                  </p>
                )}
              </div>
            </section>
          </ChartErrorBoundary>
        </div>
      </div>
    </div>
  );
}
