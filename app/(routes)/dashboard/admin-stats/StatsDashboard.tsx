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
  Tooltip,
  XAxis,
  YAxis,
  Rectangle
} from 'recharts';
import packageJson from '../../../../package.json';
const pkgMeta = packageJson as {
  version?: string;
  commit?: string;
  buildTime?: string;
  dependencies?: Record<string, string>;
};

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

function buildSubscriptionChartData(rows: MonthlyAveragePoint[]) {
  let fixed = 0;
  const data = rows.map((row) => {
    const subscriptionCount = toNumber(row.subscriptionCount, 0);
    if (!Number.isFinite(row.subscriptionCount)) fixed += 1;
    return {
      label: row.label,
      subscriptionCount,
      perOrderCount: toNumber(row.perOrderCount, 0)
    };
  });

  const allZero = data.every((row) => row.subscriptionCount === 0);
  const domain: [number, number | 'auto'] = allZero ? [0, 1] : [0, 'auto'];
  const planMax = Math.max(...data.map((row) => Math.max(row.subscriptionCount, row.perOrderCount)), 0);
  const effectiveMax = planMax === 0 ? 1 : Math.ceil(planMax * 1.1);
  const ticks = [0.25, 0.5, 0.75, 1].map((ratio) => Math.ceil(effectiveMax * ratio));

  return { data, fixed, total: data.length, allZero, domain, ticks } as const;
}

function buildMonthlyChartData(rows: MonthlyOverviewPoint[]) {
  let totalFixed = 0;
  let roomFixed = 0;
  const data = rows.map((row) => {
    const totalCount = toNumber(row.totalCount, 0);
    const roomAverage = toNumber(row.roomAverage, 0);

    if (!Number.isFinite(row.totalCount)) totalFixed += 1;
    if (!Number.isFinite(row.roomAverage)) roomFixed += 1;

    return { label: row.label, totalCount, roomAverage };
  });

  const allZero = data.every((row) => row.totalCount === 0);
  const domain: [number, number | 'auto'] = allZero ? [0, 1] : [0, 'auto'];
  const monthlyMax = Math.max(...data.map((row) => Math.max(row.totalCount, row.roomAverage)), 0);
  const effectiveMax = monthlyMax === 0 ? 1 : Math.max(1, Math.ceil(monthlyMax * 1.15));
  const ticks = [0.25, 0.5, 0.75, 1].map((ratio) => Math.ceil(effectiveMax * ratio));

  return { data, totalFixed, roomFixed, total: data.length, allZero, domain, ticks } as const;
}

type ValueType = 'null' | 'array' | 'number' | 'string' | 'boolean' | 'object' | 'undefined';

function resolveValueType(value: unknown): ValueType {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value as ValueType;
}

function simpleHash(value: string) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return `h${Math.abs(hash)}`;
}

function buildDataFingerprint(rows: Array<Record<string, unknown>>) {
  const length = rows.length;
  const keys = Array.from(
    new Set(
      rows.flatMap((row) => (row ? Object.keys(row).slice(0, 32) : []))
    )
  ).sort();

  const keyTypes: Record<string, string> = {};
  let hasNaN = false;
  let hasInfinity = false;
  let hasNullRow = false;

  rows.forEach((row) => {
    if (row === null) {
      hasNullRow = true;
      return;
    }

    Object.entries(row).forEach(([key, value]) => {
      const valueType = resolveValueType(value);
      keyTypes[key] = keyTypes[key] ?? valueType;

      if (typeof value === 'number') {
        if (Number.isNaN(value)) hasNaN = true;
        if (!Number.isFinite(value)) hasInfinity = true;
      }
    });
  });

  const sample0 = rows[0] ?? null;
  const hash = length > 0 ? simpleHash(JSON.stringify(rows.slice(0, 64))) : null;

  return { length, keys, keyTypes, hasNaN, hasInfinity, hasNullRow, sample0, hash } as const;
}

type ChartMode = 'unsafeCharts' | 'minChart';

type ChartIdentityLogInput = {
  mode: ChartMode;
  section: 'subscription' | 'monthly';
  chartImpl: 'SubscriptionChartImpl@v1' | 'MonthlyChartImpl@v1';
  flags: {
    hasResponsiveContainer: boolean;
    hasXAxis: boolean;
    hasYAxis: boolean;
    hasTooltip: boolean;
    hasLegend: boolean;
    hasLabelList: boolean;
    hasCartesianGrid: boolean;
    animation: boolean | 'default';
    stackIdUsed: boolean;
    barSize: number | null;
  };
  data: Array<Record<string, unknown>>;
};

type BarChartFeatureFlags = {
  hasResponsiveContainer: boolean;
  hasBarChart: boolean;
  hasXAxis: boolean;
  hasYAxis: boolean;
  hasTooltip: boolean;
  hasLegend: boolean;
  hasLabelList: boolean;
  hasCartesianGrid: boolean;
  useData: boolean;
  hasBar: boolean;
  animation: boolean | 'default';
  stackIdUsed: boolean;
  barSize: number | null;
  radius: [number, number, number, number] | null;
};

function resolveBarChartFeatureFlags(mode: ChartMode, step: number): BarChartFeatureFlags {
  if (mode === 'unsafeCharts') {
    return {
      hasResponsiveContainer: true,
      hasBarChart: true,
      hasXAxis: true,
      hasYAxis: true,
      hasTooltip: true,
      hasLegend: true,
      hasLabelList: true,
      hasCartesianGrid: true,
      useData: true,
      hasBar: true,
      animation: 'default',
      stackIdUsed: false,
      barSize: 20,
      radius: [6, 6, 0, 0]
    };
  }

  const normalizedStep = Math.max(0, step);

  return {
    hasResponsiveContainer: normalizedStep >= 1,
    hasBarChart: normalizedStep >= 2,
    useData: normalizedStep >= 3,
    hasXAxis: normalizedStep >= 4,
    hasYAxis: normalizedStep >= 5,
    hasBar: normalizedStep >= 6,
    hasTooltip: normalizedStep >= 7,
    hasLegend: normalizedStep >= 8,
    hasLabelList: normalizedStep >= 9,
    hasCartesianGrid: normalizedStep >= 10,
    animation: normalizedStep >= 11 ? 'default' : false,
    stackIdUsed: normalizedStep >= 12,
    barSize: normalizedStep >= 13 ? 20 : null,
    radius: normalizedStep >= 14 ? [6, 6, 0, 0] : null
  };
}

function useChartIdentityLogger(input: ChartIdentityLogInput) {
  const { mode, section, chartImpl, flags, data } = input;
  const dataFingerprint = useMemo(() => buildDataFingerprint(data), [data]);

  const payload = useMemo(
    () => ({
      mode,
      section,
      chartImpl,
      flags,
      dataFingerprint
    }),
    [chartImpl, dataFingerprint, flags, mode, section]
  );

  useEffect(() => {
    console.log('[client-211 -> chart-impl-identity]', payload);
  }, [payload]);
}

function logBarChartSignature({
  mode,
  section,
  step,
  children,
  data,
  xAxisKey,
  barDataKey,
  stackId,
  barSize,
  domain,
  animation
}: {
  mode: ChartMode;
  section: 'subscription' | 'monthly';
  step: number;
  children: React.ReactElement[];
  data: Array<Record<string, unknown>>;
  xAxisKey: string;
  barDataKey: string;
  stackId: string | undefined;
  barSize: number | null;
  domain: [number, number | 'auto'];
  animation: boolean | 'default';
}) {
  const childArr = React.Children.toArray(children);
  const childSignature = childArr.map((child) => {
    const valid = React.isValidElement(child);
    if (!valid) {
      return { valid, type: typeof child, displayName: null };
    }
    const type = child.type as { displayName?: string; name?: string } | string;
    if (typeof type === 'string') {
      return { valid, type, displayName: type };
    }
    const displayName = type.displayName || type.name || 'anonymous';
    return { valid, type: displayName, displayName };
  });

  const sample = data[0] ?? null;
  const sampleTypes: Record<string, string> = {};
  if (sample && typeof sample === 'object') {
    Object.entries(sample).forEach(([key, value]) => {
      sampleTypes[key] = resolveValueType(value as unknown);
    });
  }

  const domainSafe = domain.map((value) =>
    typeof value === 'number' ? (Number.isFinite(value) ? value : 'non-finite') : value
  );

  console.log('[client-212 -> chart-child-signature]', {
    mode,
    section,
    step,
    childSignature,
    childCount: childArr.length,
    dataLength: data.length,
    sampleKeys: sample ? Object.keys(sample) : [],
    sampleTypes,
    xAxisKey,
    barDataKey,
    stackId,
    barSize,
    domain: domainSafe,
    animation
  });
}

type Props = {
  profile: ProfileSummary;
  monthlyAverages: MonthlyAveragePoint[];
  monthlyOverview: MonthlyOverviewPoint[];
  weekdayStats: { points: WeekdayStatsPoint[]; buildings: WeekdaySeriesMeta[] };
};

class ChartErrorBoundary extends React.Component<
  {
    children: React.ReactNode;
    section: string;
    chartSummary?: Record<string, unknown>;
    dataSummary?: Record<string, unknown>;
  },
  { hasError: boolean }
> {
  constructor(props: {
    children: React.ReactNode;
    section: string;
    chartSummary?: Record<string, unknown>;
    dataSummary?: Record<string, unknown>;
  }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.log('[client-150 -> recharts-error-boundary]', {
      section: this.props.section,
      message: error?.message,
      name: error?.name,
      stackPresent: Boolean(error?.stack),
      componentStack: info?.componentStack ?? null,
      chartSummary: this.props.chartSummary ?? null,
      dataSummary: this.props.dataSummary ?? null
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

function summarizeData(rows: Array<Record<string, unknown>>) {
  const length = rows.length;
  const first = rows[0] ?? null;
  const keys = first ? Object.keys(first) : [];
  const keyTypes: Record<string, Record<string, number>> = {};
  let hasNaN = false;
  let hasNullRow = false;

  rows.forEach((row) => {
    if (!row) {
      hasNullRow = true;
      return;
    }
    Object.entries(row).forEach(([key, value]) => {
      const typeKey = Number.isNaN(value) ? 'NaN' : typeof value;
      if (Number.isNaN(value)) hasNaN = true;
      keyTypes[key] = keyTypes[key] ?? {};
      keyTypes[key][typeKey] = (keyTypes[key][typeKey] ?? 0) + 1;
    });
  });

  return { length, keys, keyTypes, hasNaN, hasNullRow };
}

function summarizeChartProps(props: {
  hasBarChart?: boolean;
  hasXAxis?: boolean;
  hasYAxis?: boolean;
  hasBar?: boolean;
  hasTooltip?: boolean;
  hasLegend?: boolean;
  hasLabelList?: boolean;
  [key: string]: unknown;
}) {
  return props;
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
  const minChartEnabled = searchParams?.get('minChart') === '1';
  const minChartSectionRaw = searchParams?.get('section') ?? searchParams?.get('chart');
  const minChartStepRaw = searchParams?.get('step');
  const minChartStep = Number.isFinite(Number(minChartStepRaw)) ? Number(minChartStepRaw) : 0;
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
  const runtimeVersions = useMemo(
    () => ({
      react: pkgMeta.dependencies?.react ?? 'missing',
      recharts: pkgMeta.dependencies?.recharts ?? 'missing',
      next: pkgMeta.dependencies?.next ?? 'missing'
    }),
    []
  );

  useEffect(() => {
    const commit =
      process.env.NEXT_PUBLIC_GIT_SHA ??
      process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ??
      process.env.NEXT_PUBLIC_GITHUB_SHA ??
      process.env.VERCEL_GIT_COMMIT_SHA ??
      process.env.GITHUB_SHA ??
      pkgMeta?.commit ??
      pkgMeta?.version ??
      'env:missing';
    const buildTime = process.env.NEXT_PUBLIC_BUILD_TIME ?? pkgMeta?.buildTime ?? new Date().toISOString();

    console.log('[client-180 -> admin-stats-fingerprint]', {
      commit,
      buildTime,
      fileMarker: 'StatsDashboard.PR017-HOTFIX.v3.min-step',
      unsafeCharts,
      chart: chartFilter ?? 'none',
      versions: runtimeVersions
    });
  }, [chartFilter, runtimeVersions, unsafeCharts]);

  useEffect(() => {
    console.log('[client-190 -> charts-toggle-state]', {
      unsafeCharts,
      chart: chartFilter ?? 'none'
    });
    console.log('[client-191 -> charts-enabled-sections]', { enabledSections });
  }, [chartFilter, enabledSections, unsafeCharts]);

  useEffect(() => {
    console.log('[client-205 -> runtime-package-versions]', runtimeVersions);
  }, [runtimeVersions]);

  const subscriptionGuard = useMemo(() => buildSubscriptionChartData(monthlyAverages), [monthlyAverages]);

  const monthlyGuard = useMemo(() => buildMonthlyChartData(monthlyOverview), [monthlyOverview]);

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

  const subscriptionDataSummary = useMemo(() => summarizeData(subscriptionGuard.data), [subscriptionGuard.data]);
  const monthlyDataSummary = useMemo(() => summarizeData(monthlyGuard.data), [monthlyGuard.data]);
  const subscriptionChartSummary = useMemo(
    () =>
      summarizeChartProps({
        hasBarChart: true,
        hasXAxis: true,
        hasYAxis: true,
        hasBar: true,
        hasTooltip: true,
        hasLegend: true,
        hasLabelList: true,
        domain: subscriptionGuard.domain,
        barDataKey: 'subscriptionCount',
        barSize: 20,
        minPointSize: 1
      }),
    [subscriptionGuard.domain]
  );
  const monthlyChartSummary = useMemo(
    () =>
      summarizeChartProps({
        hasBarChart: true,
        hasXAxis: true,
        hasYAxis: true,
        hasBar: true,
        hasTooltip: true,
        hasLegend: true,
        hasLabelList: true,
        domain: monthlyGuard.domain,
        barDataKey: 'totalCount',
        barSize: 20,
        minPointSize: 1
      }),
    [monthlyGuard.domain]
  );
  const minChartFeatures = useMemo(() => {
    const features = ['base'];
    if (minChartStep >= 1) features.push('grid');
    if (minChartStep >= 2) features.push('tooltip');
    if (minChartStep >= 3) features.push('legend');
    if (minChartStep >= 4) features.push('labelList');
    return features;
  }, [minChartStep]);
  const minChartFeatureFlags = useMemo(() => resolveBarChartFeatureFlags('minChart', minChartStep), [minChartStep]);

  const minChartSection = useMemo(() => {
    const allowed = new Set(['subscription', 'monthly']);
    if (minChartSectionRaw && allowed.has(minChartSectionRaw)) {
      return minChartSectionRaw as 'subscription' | 'monthly';
    }
    return 'subscription';
  }, [minChartSectionRaw]);

  const minSubscriptionEnabled = minChartEnabled && minChartSection === 'subscription';
  const minMonthlyEnabled = minChartEnabled && minChartSection === 'monthly';
  const minimalChartSummary = useMemo(
    () =>
      summarizeChartProps({
        hasBarChart: true,
        hasXAxis: true,
        hasYAxis: true,
        hasBar: true,
        hasTooltip: minChartFeatureFlags.showTooltip,
        hasLegend: minChartFeatureFlags.showLegend,
        hasLabelList: minChartFeatureFlags.showLabelList,
        hasCartesianGrid: minChartFeatureFlags.showGrid,
        animation: minChartFeatureFlags.animation
      }),
    [minChartFeatureFlags]
  );
  useEffect(() => {
    if (!minChartEnabled) return;
    console.log('[client-210 -> min-chart-step]', {
      step: minChartStep,
      features: minChartFeatures,
      section: minChartSection
    });
  }, [minChartEnabled, minChartFeatures, minChartSection, minChartStep]);

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
      sub_domain: subscriptionGuard.domain,
      mon_domain: monthlyGuard.domain
    });
  }, [monthlyGuard, subscriptionGuard]);

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

  function SubscriptionChartImpl({
    mode,
    step,
    legendContent,
    labelContent,
    data,
    domain,
    ticks,
    legendStyle
  }: {
    mode: ChartMode;
    step: number;
    legendContent: React.ReactElement;
    labelContent: React.ReactElement;
    data: typeof subscriptionGuard.data;
    domain: [number, number | 'auto'];
    ticks: number[];
    legendStyle: Record<string, unknown>;
  }) {
    const featureFlags = useMemo(() => resolveBarChartFeatureFlags(mode, step), [mode, step]);
    const willRenderBarChart = featureFlags.hasBarChart && featureFlags.hasResponsiveContainer;

    useEffect(() => {
      if (mode !== 'minChart') return;
      console.log('[minchart-render-truth]', {
        section: 'subscription',
        willCreateBarChart: willRenderBarChart,
        didCreateBarChart: false,
        step
      });
    }, [mode, step, willRenderBarChart]);

    const parts: React.ReactElement[] = [];

    if (featureFlags.hasCartesianGrid) {
      parts.push(
        <CartesianGrid
          key="grid"
          strokeDasharray="4 4"
          stroke="rgba(148, 163, 184, 0.2)"
          vertical={false}
        />
      );
    }

    if (featureFlags.hasXAxis) {
      parts.push(
        <XAxis
          key="x-axis"
          dataKey="label"
          xAxisId="x"
          tickLine={false}
          axisLine={{ stroke: 'rgba(148, 163, 184, 0.4)' }}
          tick={{ fill: '#cbd5e1', fontWeight: 700, fontSize: 12 }}
        />
      );
    }

    if (featureFlags.hasYAxis) {
      parts.push(
        <YAxis
          key="y-axis"
          orientation="left"
          tickLine={false}
          axisLine={{ stroke: 'rgba(148, 163, 184, 0.4)' }}
          tick={{ fill: '#cbd5e1', fontWeight: 700, fontSize: 12 }}
          domain={domain}
          ticks={ticks}
          allowDecimals={false}
        />
      );
    }

    if (featureFlags.hasLegend) {
      parts.push(
        <Legend
          key="legend"
          verticalAlign="top"
          align="left"
          wrapperStyle={legendStyle}
          content={legendContent}
        />
      );
    }

    if (featureFlags.hasBar) {
      const barChildren: React.ReactElement[] = [];
      if (featureFlags.hasLabelList) {
        barChildren.push(
          <LabelList
            key="label-list"
            dataKey="subscriptionCount"
            position="top"
            content={labelContent}
          />
        );
      }

      parts.push(
        <Bar
          key="bar"
          dataKey="subscriptionCount"
          fill="#22c55e"
          barSize={featureFlags.barSize ?? undefined}
          radius={featureFlags.radius ?? undefined}
          minPointSize={1}
          stackId={featureFlags.stackIdUsed ? 'subscription' : undefined}
          isAnimationActive={featureFlags.animation === 'default' ? undefined : featureFlags.animation}
        >
          {barChildren}
        </Bar>
      );
    }

    if (featureFlags.hasTooltip) {
      parts.push(<Tooltip key="tooltip" />);
    }

    const dataForChart = featureFlags.useData ? data : [];

    const identityFlags = useMemo(
      () => ({
        hasResponsiveContainer: featureFlags.hasResponsiveContainer,
        hasXAxis: featureFlags.hasXAxis,
        hasYAxis: featureFlags.hasYAxis,
        hasTooltip: featureFlags.hasTooltip,
        hasLegend: featureFlags.hasLegend,
        hasLabelList: featureFlags.hasLabelList,
        hasCartesianGrid: featureFlags.hasCartesianGrid,
        animation: featureFlags.animation,
        stackIdUsed: featureFlags.stackIdUsed,
        barSize: featureFlags.barSize
      }),
      [featureFlags]
    );

    useChartIdentityLogger({
      mode,
      section: 'subscription',
      chartImpl: 'SubscriptionChartImpl@v1',
      flags: identityFlags,
      data: dataForChart
    });

    useEffect(() => {
      if (mode !== 'minChart') return;
      console.log('[minchart-render-truth]', {
        section: 'subscription',
        willCreateBarChart: willRenderBarChart,
        didCreateBarChart: willRenderBarChart,
        step
      });
    }, [mode, step, willRenderBarChart]);

    let chartBody: React.ReactNode;

    if (!featureFlags.hasBarChart) {
      chartBody = <div data-minchart="1" data-step={step} data-section="subscription" />;
    } else {
      if (willRenderBarChart) {
        logBarChartSignature({
          mode,
          section: 'subscription',
          step,
          children: parts,
          data: dataForChart,
          xAxisKey: 'label',
          barDataKey: 'subscriptionCount',
          stackId: featureFlags.stackIdUsed ? 'subscription' : undefined,
          barSize: featureFlags.barSize,
          domain,
          animation: featureFlags.animation
        });
      }

      chartBody = (
        <BarChart data={dataForChart} margin={{ top: 54, right: 18, bottom: 24, left: 18 }}>
          {parts}
        </BarChart>
      );
    }

    if (!featureFlags.hasResponsiveContainer) {
      return <div data-minchart="1" data-step={step} data-section="subscription" />;
    }

    return <ResponsiveContainer width="100%" height="100%">{chartBody}</ResponsiveContainer>;
  }

  function MonthlyChartImpl({
    mode,
    step,
    legendContent,
    labelContent,
    data,
    domain,
    ticks,
    legendStyle
  }: {
    mode: ChartMode;
    step: number;
    legendContent: React.ReactElement;
    labelContent: React.ReactElement;
    data: typeof monthlyGuard.data;
    domain: [number, number | 'auto'];
    ticks: number[];
    legendStyle: Record<string, unknown>;
  }) {
    const featureFlags = useMemo(() => resolveBarChartFeatureFlags(mode, step), [mode, step]);
    const willRenderBarChart = featureFlags.hasBarChart && featureFlags.hasResponsiveContainer;

    useEffect(() => {
      if (mode !== 'minChart') return;
      console.log('[minchart-render-truth]', {
        section: 'monthly',
        willCreateBarChart: willRenderBarChart,
        didCreateBarChart: false,
        step
      });
    }, [mode, step, willRenderBarChart]);

    const parts: React.ReactElement[] = [];

    if (featureFlags.hasCartesianGrid) {
      parts.push(
        <CartesianGrid
          key="grid"
          strokeDasharray="4 4"
          stroke="rgba(148, 163, 184, 0.2)"
          vertical={false}
        />
      );
    }

    if (featureFlags.hasXAxis) {
      parts.push(
        <XAxis
          key="x-axis"
          dataKey="label"
          xAxisId="x"
          tickLine={false}
          axisLine={{ stroke: 'rgba(148, 163, 184, 0.4)' }}
          tick={{ fill: '#cbd5e1', fontWeight: 700, fontSize: 12 }}
        />
      );
    }

    if (featureFlags.hasYAxis) {
      parts.push(
        <YAxis
          key="y-axis"
          orientation="left"
          tickLine={false}
          axisLine={{ stroke: 'rgba(148, 163, 184, 0.4)' }}
          tick={{ fill: '#cbd5e1', fontWeight: 700, fontSize: 12 }}
          domain={domain}
          ticks={ticks}
          allowDecimals={false}
        />
      );
    }

    if (featureFlags.hasLegend) {
      parts.push(
        <Legend
          key="legend"
          verticalAlign="top"
          align="left"
          wrapperStyle={legendStyle}
          content={legendContent}
        />
      );
    }

    if (featureFlags.hasBar) {
      const barChildren: React.ReactElement[] = [];
      if (featureFlags.hasLabelList) {
        barChildren.push(
          <LabelList key="label-list" dataKey="totalCount" position="top" content={labelContent} />
        );
      }

      parts.push(
        <Bar
          key="bar"
          dataKey="totalCount"
          fill="#6366f1"
          barSize={featureFlags.barSize ?? undefined}
          radius={featureFlags.radius ?? undefined}
          minPointSize={1}
          stackId={featureFlags.stackIdUsed ? 'monthly' : undefined}
          isAnimationActive={featureFlags.animation === 'default' ? undefined : featureFlags.animation}
        >
          {barChildren}
        </Bar>
      );
    }

    if (featureFlags.hasTooltip) {
      parts.push(<Tooltip key="tooltip" />);
    }

    const dataForChart = featureFlags.useData ? data : [];

    const identityFlags = useMemo(
      () => ({
        hasResponsiveContainer: featureFlags.hasResponsiveContainer,
        hasXAxis: featureFlags.hasXAxis,
        hasYAxis: featureFlags.hasYAxis,
        hasTooltip: featureFlags.hasTooltip,
        hasLegend: featureFlags.hasLegend,
        hasLabelList: featureFlags.hasLabelList,
        hasCartesianGrid: featureFlags.hasCartesianGrid,
        animation: featureFlags.animation,
        stackIdUsed: featureFlags.stackIdUsed,
        barSize: featureFlags.barSize
      }),
      [featureFlags]
    );

    useChartIdentityLogger({
      mode,
      section: 'monthly',
      chartImpl: 'MonthlyChartImpl@v1',
      flags: identityFlags,
      data: dataForChart
    });

    useEffect(() => {
      if (mode !== 'minChart') return;
      console.log('[minchart-render-truth]', {
        section: 'monthly',
        willCreateBarChart: willRenderBarChart,
        didCreateBarChart: willRenderBarChart,
        step
      });
    }, [mode, step, willRenderBarChart]);

    let chartBody: React.ReactNode;

    if (!featureFlags.hasBarChart) {
      chartBody = <div data-minchart="1" data-step={step} data-section="monthly" />;
    } else {
      if (willRenderBarChart) {
        logBarChartSignature({
          mode,
          section: 'monthly',
          step,
          children: parts,
          data: dataForChart,
          xAxisKey: 'label',
          barDataKey: 'totalCount',
          stackId: featureFlags.stackIdUsed ? 'monthly' : undefined,
          barSize: featureFlags.barSize,
          domain,
          animation: featureFlags.animation
        });
      }

      chartBody = (
        <BarChart data={dataForChart} margin={{ top: 54, right: 18, bottom: 24, left: 18 }}>
          {parts}
        </BarChart>
      );
    }

    if (!featureFlags.hasResponsiveContainer) {
      return <div data-minchart="1" data-step={step} data-section="monthly" />;
    }

    return <ResponsiveContainer width="100%" height="100%">{chartBody}</ResponsiveContainer>;
  }

  const subscriptionChart = useMemo(
    () => (
      <SubscriptionChartImpl
        mode="unsafeCharts"
        step={Number.POSITIVE_INFINITY}
        legendContent={<PlanLegend />}
        labelContent={<BarValueLabel />}
        data={subscriptionGuard.data}
        domain={subscriptionGuard.domain}
        ticks={subscriptionGuard.ticks}
        legendStyle={legendTopLeft}
      />
    ),
    [
      BarValueLabel,
      PlanLegend,
      SubscriptionChartImpl,
      legendTopLeft,
      subscriptionGuard.data,
      subscriptionGuard.domain,
      subscriptionGuard.ticks
    ]
  );

  const monthlyTotalsChart = useMemo(
    () => (
      <MonthlyChartImpl
        mode="unsafeCharts"
        step={Number.POSITIVE_INFINITY}
        legendContent={<MonthlyLegend />}
        labelContent={<BarValueLabel />}
        data={monthlyGuard.data}
        domain={monthlyGuard.domain}
        ticks={monthlyGuard.ticks}
        legendStyle={legendTopLeft}
      />
    ),
    [
      BarValueLabel,
      MonthlyChartImpl,
      MonthlyLegend,
      legendTopLeft,
      monthlyGuard.data,
      monthlyGuard.domain,
      monthlyGuard.ticks
    ]
  );

  const minimalSubscriptionChart = useMemo(
    () => (
      <SubscriptionChartImpl
        mode="minChart"
        step={minChartStep}
        legendContent={<PlanLegend />}
        labelContent={<BarValueLabel />}
        data={subscriptionGuard.data}
        domain={subscriptionGuard.domain}
        ticks={subscriptionGuard.ticks}
        legendStyle={legendTopLeft}
      />
    ),
    [
      BarValueLabel,
      PlanLegend,
      SubscriptionChartImpl,
      legendTopLeft,
      minChartStep,
      subscriptionGuard.data,
      subscriptionGuard.domain,
      subscriptionGuard.ticks
    ]
  );

  const minimalMonthlyChart = useMemo(
    () => (
      <MonthlyChartImpl
        mode="minChart"
        step={minChartStep}
        legendContent={<MonthlyLegend />}
        labelContent={<BarValueLabel />}
        data={monthlyGuard.data}
        domain={monthlyGuard.domain}
        ticks={monthlyGuard.ticks}
        legendStyle={legendTopLeft}
      />
    ),
    [
      BarValueLabel,
      MonthlyChartImpl,
      MonthlyLegend,
      legendTopLeft,
      minChartStep,
      monthlyGuard.data,
      monthlyGuard.domain,
      monthlyGuard.ticks
    ]
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      console.log('[client-170 -> chart-type-simplified]', {
        subscriptionChart: 'BarChart',
        monthlyChart: 'BarChart',
        sub_domain: subscriptionGuard.domain,
        mon_domain: monthlyGuard.domain
      });
    }, 200);

    return () => clearTimeout(timer);
  }, [monthlyGuard.domain, subscriptionGuard.domain]);

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
        weekdayTicks,
        weekdayBarShape
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
      <ChartErrorBoundary
        section="subscription"
        chartSummary={subscriptionChartSummary}
        dataSummary={subscriptionDataSummary}
      >
        <section id="chart-subscription" className={styles.graphCard} aria-label="요금제별 통계">
          <div className={styles.graphHeading}>
            <p className={styles.graphTitle}>요금제별 통계</p>
          </div>
                <div className={styles.graphSurface} aria-hidden="true">
                  <div className={styles.mixedChart} ref={subscriptionContainerRef} style={{ minHeight: 320 }}>
                    {subscriptionEnabled ? (
                      subscriptionHasSize ? (
                        subscriptionChart
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

        <ChartErrorBoundary
          section="monthly"
          chartSummary={monthlyChartSummary}
          dataSummary={monthlyDataSummary}
        >
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

          {minSubscriptionEnabled ? (
            <ChartErrorBoundary
              section="min-subscription"
              chartSummary={minimalChartSummary}
              dataSummary={subscriptionDataSummary}
            >
              <section className={styles.graphCard} aria-label="PR-018 minimal subscription chart">
                <div className={styles.graphHeading}>
                  <p className={styles.graphTitle}>PR-018 최소 재현 (Subscription)</p>
                  <p className={styles.graphSubtitle}>step={minChartStep}</p>
                </div>
                <div className={styles.graphSurface} aria-hidden="true">
                  <div className={styles.mixedChart} style={{ minHeight: 320 }}>
                    {minimalSubscriptionChart}
                  </div>
                </div>
              </section>
            </ChartErrorBoundary>
          ) : null}

          {minMonthlyEnabled ? (
            <ChartErrorBoundary
              section="min-monthly"
              chartSummary={minimalChartSummary}
              dataSummary={monthlyDataSummary}
            >
              <section className={styles.graphCard} aria-label="PR-018 minimal monthly chart">
                <div className={styles.graphHeading}>
                  <p className={styles.graphTitle}>PR-018 최소 재현 (Monthly)</p>
                  <p className={styles.graphSubtitle}>step={minChartStep}</p>
                </div>
                <div className={styles.graphSurface} aria-hidden="true">
                  <div className={styles.mixedChart} style={{ minHeight: 320 }}>
                    {minimalMonthlyChart}
                  </div>
                </div>
              </section>
            </ChartErrorBoundary>
          ) : null}
        </div>
      </div>
    </div>
  );
}
