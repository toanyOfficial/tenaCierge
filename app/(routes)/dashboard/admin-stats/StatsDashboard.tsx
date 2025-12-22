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

const SUBSCRIPTION_Y_AXIS_DOMAIN: [number, number | 'auto'] = [0, 'auto'];
const MONTHLY_LEFT_Y_AXIS_DOMAIN: [number, number | 'auto'] = [0, 'auto'];
const MONTHLY_RIGHT_Y_AXIS_DOMAIN: [number, number | 'auto'] = [0, 'auto'];
const DEBUG_BAR_SHAPE_LIMIT = 10;

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
  const minimalChartRef = useRef<HTMLDivElement | null>(null);
  const minimalBarShapeLog = useRef<Set<string>>(new Set());
  const barShapeLogCounters = useRef<Record<string, number>>({});
  const barShapeOnceLogGuard = useRef<Set<string>>(new Set());
  const barShapeCallCounters = useRef<Record<string, number>>({});

  const debugBarShapes = useMemo(() => {
    const createShape = (logId: string, onceLogId?: string, callLogId?: string) =>
      function DebugBarShape(props: any) {
        const { x, y, width, height, value, index, dataKey, fill, background } = props ?? {};
        const current = barShapeLogCounters.current[logId] ?? 0;

        if (current < DEBUG_BAR_SHAPE_LIMIT) {
          barShapeLogCounters.current[logId] = current + 1;
          console.log(`[${logId}] debug bar shape props`, {
            x,
            y,
            width,
            height,
            value,
            index,
            dataKey,
            fill,
            background
          });
        }

        if (callLogId) {
          const callCount = barShapeCallCounters.current[callLogId] ?? 0;
          barShapeCallCounters.current[callLogId] = callCount + 1;
          if (callCount === 0) {
            console.log(`[${callLogId} -> ${callLogId === 'client-120' ? 'subscription' : 'monthly'}-shape-called]`, {
              callCount: callCount + 1,
              dataKey,
              value,
              x,
              y,
              width,
              height,
              isYFinite: Number.isFinite(y),
              isHeightFinite: Number.isFinite(height),
              isValueFinite: Number.isFinite(value),
              yAxisId: props?.yAxisId,
              xAxisId: props?.xAxisId,
              stackId: props?.stackId
            });
          }
        }

        if (onceLogId && !barShapeOnceLogGuard.current.has(onceLogId)) {
          barShapeOnceLogGuard.current.add(onceLogId);
          console.log(`[${onceLogId} -> shape-props snapshot]`, {
            index,
            value,
            valueType: typeof value,
            y,
            height,
            isYFinite: Number.isFinite(y),
            isHeightFinite: Number.isFinite(height),
            fill,
            stackId: props?.stackId,
            yAxisId: props?.yAxisId
          });
        }

        return <RechartsRectangle {...props} />;
      };

    return {
      subscription: createShape('client-080', 'client-110', 'client-120'),
      monthly: createShape('client-081', 'client-111', 'client-121'),
      weekday: createShape('client-082')
    };
  }, []);

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

  useEffect(() => {
    console.log('[client-001 -> minimal-fixed-barchart-mounted -> 고정형 BarChart 렌더 준비]', {
      dataLength: minimalBarData.length
    });

    const rect = minimalChartRef.current?.getBoundingClientRect();
    console.log('[client-002 -> minimal-fixed-barchart-domrect -> 컨테이너 크기 스냅샷]', {
      width: rect?.width ?? null,
      height: rect?.height ?? null,
      x: rect?.x ?? null,
      y: rect?.y ?? null
    });

    console.log('[client-004 -> minimal-fixed-barchart-data -> 고정 데이터 스냅샷]', {
      rows: minimalBarData,
      dataLength: minimalBarData.length
    });

    const logRects = () => {
      const rectNodes = minimalChartRef.current?.querySelectorAll('rect');
      console.log('[client-005 -> minimal-fixed-barchart-rect-elements -> SVG rect 존재 여부]', {
        rectCount: rectNodes?.length ?? 0,
        rectClassList: rectNodes ? Array.from(rectNodes).map((node) => node.getAttribute('class')) : []
      });
    };

    logRects();
    const timeoutId = setTimeout(logRects, 300);

    return () => {
      clearTimeout(timeoutId);
    };
  }, []);

  const MinimalBarShape = useMemo(
    () =>
      function MinimalBarShape(props: any) {
        const { index, x, y, width, height, value } = props;
        const key = `${index}-${x}-${y}-${width}-${height}-${value}`;
        if (!minimalBarShapeLog.current.has(key)) {
          minimalBarShapeLog.current.add(key);
          console.log('[client-003 -> minimal-fixed-barchart-shape -> Bar shape props 스냅샷]', {
            index,
            x,
            y,
            width,
            height,
            value
          });
        }

        return <Rectangle {...props} />;
      },
    []
  );

  useEffect(() => {
    console.log(
      '[요금제별 평균] chart data',
      normalizedMonthlyAverages.map((row) => ({
        label: row.label,
        subscriptionCount: row.subscriptionCount,
        subscriptionType: typeof row.subscriptionCount,
        perOrderCount: row.perOrderCount,
        perOrderType: typeof row.perOrderCount
      }))
    );

    console.log(
      '[월별 통계값] chart data',
      normalizedMonthlyOverview.map((row) => ({
        label: row.label,
        totalCount: row.totalCount,
        totalCountType: typeof row.totalCount,
        roomAverage: row.roomAverage,
        roomAverageType: typeof row.roomAverage
      }))
    );

    console.log(
      '[요일별 통계] meta',
      normalizedWeekdayBuildings.map((meta) => ({
        key: meta.key,
        label: meta.label,
        averageCount: meta.averageCount,
        averageType: typeof meta.averageCount,
        sectorCode: meta.sectorCode
      }))
    );

    console.log('[요일별 통계] points', normalizedWeekdayPoints);
  }, [
    normalizedMonthlyAverages,
    normalizedMonthlyOverview,
    normalizedWeekdayBuildings,
    normalizedWeekdayPoints
  ]);

  useEffect(() => {
    const timer = setTimeout(() => {
      const targets = [
        {
          id: 'chart-subscription',
          countId: 'client-020',
          bboxId: 'client-021',
          dataShapeId: 'client-030',
          dataKeySanityId: 'client-031',
          tickId: 'client-034',
          presenceId: 'client-036',
          data: normalizedMonthlyAverages,
          xAxisKey: 'label',
          barKeys: ['subscriptionCount']
        },
        {
          id: 'chart-monthly',
          countId: 'client-022',
          bboxId: 'client-023',
          dataShapeId: 'client-032',
          dataKeySanityId: 'client-033',
          tickId: 'client-035',
          presenceId: 'client-037',
          data: normalizedMonthlyOverview,
          xAxisKey: 'label',
          barKeys: ['totalCount']
        },
        { id: 'chart-weekday', countId: 'client-024', bboxId: 'client-025' }
      ];

      targets.forEach(({ id, countId, bboxId, data, barKeys, dataShapeId, dataKeySanityId, xAxisKey, tickId, presenceId }) => {
        const root = document.getElementById(id);
        const barPaths = root?.querySelectorAll<SVGPathElement>(
          '.recharts-layer.recharts-bar-rectangle path.recharts-rectangle'
        );
        const clipPaths = root?.querySelectorAll('svg defs clipPath');
        const svgs = root?.querySelectorAll('svg');

        console.log(`[${countId} -> ${id} -> bar counts]`, {
          barPathCount: barPaths?.length ?? 0,
          clipPathCount: clipPaths?.length ?? 0,
          svgCount: svgs?.length ?? 0
        });

        const bboxes = Array.from(barPaths ?? [])
          .slice(0, 5)
          .map((node, index) => {
            try {
              const bbox = node.getBBox();
              return {
                index,
                width: bbox.width,
                height: bbox.height,
                x: bbox.x,
                y: bbox.y
              };
            } catch (error) {
              return { index, error: String(error) };
            }
          });

        console.log(`[${bboxId} -> ${id} -> bar bbox sample]`, bboxes);
        console.log(`[client-026 -> ${id} -> clipPath count]`, {
          clipPathCount: clipPaths?.length ?? 0
        });

        if (data && barKeys && dataShapeId && dataKeySanityId) {
          const firstRow = data[0];
          const keys = firstRow ? Object.keys(firstRow) : null;
          console.log(`[${dataShapeId} -> ${id}-data-shape]`, {
            dataLength: data.length,
            keys,
            xAxisKey,
            barDataKeys: barKeys
          });

          const sanity = barKeys.map((key) => {
            const value = firstRow ? (firstRow as Record<string, unknown>)[key] : undefined;
            return {
              key,
              value,
              type: typeof value,
              isFinite: typeof value === 'number' ? Number.isFinite(value) : Number.isFinite(Number(value))
            };
          });
          console.log(`[${dataKeySanityId} -> ${id}-datakey-sanity]`, sanity);
        }

        if (tickId) {
          const ticks = root?.querySelectorAll('.recharts-cartesian-axis-tick');
          const tickTexts = Array.from(
            root?.querySelectorAll<SVGTextElement>('.recharts-cartesian-axis-tick text') ?? []
          )
            .slice(0, 5)
            .map((node) => node.textContent ?? '');
          console.log(`[${tickId} -> ${id}-xaxis-ticks]`, {
            tickCount: ticks?.length ?? 0,
            tickTexts
          });
        }

        if (presenceId) {
          const barLayer = root?.querySelector('.recharts-layer.recharts-bar');
          const barRectangles = root?.querySelector('.recharts-layer.recharts-bar-rectangles');
          console.log(`[${presenceId} -> ${id}-dom-presence]`, {
            hasBarLayer: Boolean(barLayer),
            hasBarRectangles: Boolean(barRectangles),
            barLayerCount: barLayer ? 1 : 0,
            barRectanglesCount: barRectangles ? 1 : 0
          });
        }
      });

      const subscriptionRoot = document.getElementById('chart-subscription');
      const subscriptionBarPaths = subscriptionRoot?.querySelectorAll<SVGPathElement>(
        '.recharts-layer.recharts-bar-rectangle path.recharts-rectangle'
      );
      console.log('[client-040 -> chart-subscription-domain-guard -> domain + barPathCount]', {
        domainApplied: SUBSCRIPTION_Y_AXIS_DOMAIN,
        barPathCount: subscriptionBarPaths?.length ?? 0
      });
      const subscriptionYAxisTicks = Array.from(
        subscriptionRoot?.querySelectorAll<SVGTextElement>('.recharts-yAxis .recharts-cartesian-axis-tick text') ?? []
      )
        .slice(0, 5)
        .map((node) => node.textContent ?? '');
      console.log('[client-042 -> chart-subscription-yaxis-ticks]', {
        tickCount:
          subscriptionRoot?.querySelectorAll('.recharts-yAxis .recharts-cartesian-axis-tick').length ?? 0,
        tickTexts: subscriptionYAxisTicks
      });

      const monthlyRoot = document.getElementById('chart-monthly');
      const monthlyBarPaths = monthlyRoot?.querySelectorAll<SVGPathElement>(
        '.recharts-layer.recharts-bar-rectangle path.recharts-rectangle'
      );
      console.log('[client-041 -> chart-monthly-domain-guard -> domain + barPathCount]', {
        domainApplied: { left: MONTHLY_LEFT_Y_AXIS_DOMAIN, right: MONTHLY_RIGHT_Y_AXIS_DOMAIN },
        barPathCount: monthlyBarPaths?.length ?? 0
      });
      const monthlyYAxisTicks = Array.from(
        monthlyRoot?.querySelectorAll<SVGTextElement>('.recharts-yAxis .recharts-cartesian-axis-tick text') ?? []
      )
        .slice(0, 5)
        .map((node) => node.textContent ?? '');
      console.log('[client-043 -> chart-monthly-yaxis-ticks]', {
        tickCount: monthlyRoot?.querySelectorAll('.recharts-yAxis .recharts-cartesian-axis-tick').length ?? 0,
        tickTexts: monthlyYAxisTicks
      });

      const measureClipState = (root: HTMLElement | null) => {
        const barPaths = root?.querySelectorAll<SVGPathElement>(
          '.recharts-layer.recharts-bar-rectangle path.recharts-rectangle'
        );
        const clipPaths = root?.querySelectorAll('svg clipPath');
        const allPaths = root?.querySelectorAll('svg path');
        const allRects = root?.querySelectorAll('svg rect');
        return {
          barPathCount: barPaths?.length ?? 0,
          clipPathCount: clipPaths?.length ?? 0,
          allPathCount: allPaths?.length ?? 0,
          allRectCount: allRects?.length ?? 0
        };
      };

      const logClipDebug = (
        id: string,
        debugId: string,
        snapshotId: string,
        bboxId?: string
      ) => {
        const root = document.getElementById(id);
        const before = measureClipState(root);

        console.log(`[${debugId} -> ${id}-clip-debug -> overflow-visible]`, {
          overflowApplied: true,
          before,
          after: before
        });

        console.log(`[${snapshotId} -> ${id}-svg-snapshot]`, before);

        if ((before.barPathCount ?? 0) > 0 && bboxId) {
          const barPaths = root?.querySelectorAll<SVGPathElement>(
            '.recharts-layer.recharts-bar-rectangle path.recharts-rectangle'
          );
          const bboxSample = Array.from(barPaths ?? [])
            .slice(0, 5)
            .map((node, index) => {
              try {
                const bbox = node.getBBox();
                return { index, width: bbox.width, height: bbox.height, x: bbox.x, y: bbox.y };
              } catch (error) {
                return { index, error: String(error) };
              }
            });

          console.log(`[${bboxId} -> ${id}-bar-bbox]`, bboxSample);
        }
      };

      logClipDebug('chart-subscription', 'client-060', 'client-062', 'client-064');
      logClipDebug('chart-monthly', 'client-061', 'client-063', 'client-065');

      const collectTickGaps = (root: HTMLElement | null) => {
        const ticks = Array.from(
          root?.querySelectorAll<SVGTextElement>(
            '.recharts-cartesian-axis.recharts-xAxis .recharts-cartesian-axis-tick text'
          ) ?? []
        );
        const positions = ticks
          .map((node) => node.getBoundingClientRect().x)
          .filter((x) => Number.isFinite(x));
        const gaps = positions
          .sort((a, b) => a - b)
          .slice(1)
          .map((x, index) => x - positions[index]);
        const xGapAvg = gaps.length ? gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length : null;
        return { tickCount: ticks.length, xGapAvg, tickTexts: ticks.slice(0, 5).map((t) => t.textContent ?? '') };
      };

      const logBarWidthDebug = (id: string, debugId: string) => {
        const root = document.getElementById(id);
        const barPaths = root?.querySelectorAll<SVGPathElement>(
          '.recharts-layer.recharts-bar-rectangle path.recharts-rectangle'
        );
        const firstBBox = barPaths?.[0]
          ? (() => {
              try {
                const bbox = barPaths[0].getBBox();
                return { width: bbox.width, height: bbox.height, x: bbox.x, y: bbox.y };
              } catch (error) {
                return { error: String(error) };
              }
            })()
          : null;
        const tickInfo = collectTickGaps(root);
        console.log(`[${debugId} -> ${id}-bar-width-debug]`, {
          barPathCount: barPaths?.length ?? 0,
          firstBBox,
          tickCount: tickInfo.tickCount,
          xGapAvg: tickInfo.xGapAvg,
          tickTexts: tickInfo.tickTexts
        });
      };

      const logSvgBasics = (id: string, debugId: string) => {
        const root = document.getElementById(id);
        const svg = root?.querySelector('svg');
        const viewBox = svg?.getAttribute('viewBox');
        console.log(`[${debugId} -> ${id}-svg-basic]`, {
          viewBox,
          width: svg?.getAttribute('width'),
          height: svg?.getAttribute('height'),
          gridCount: root?.querySelectorAll('.recharts-cartesian-grid').length ?? 0,
          xAxisCount: root?.querySelectorAll('.recharts-xAxis').length ?? 0,
          yAxisCount: root?.querySelectorAll('.recharts-yAxis').length ?? 0
        });
      };

      const logBarSizeResult = (id: string, debugId: string, barSizeApplied: number) => {
        const root = document.getElementById(id);
        const barPaths = root?.querySelectorAll<SVGPathElement>(
          '.recharts-layer.recharts-bar-rectangle path.recharts-rectangle'
        );
        console.log(`[${debugId} -> ${id}-barSize-result]`, {
          barSizeApplied,
          barPathCount: barPaths?.length ?? 0
        });
      };

      const logBarPathAfterAxisFix = (id: string, logId: string) => {
        const root = document.getElementById(id);
        const barPaths = root?.querySelectorAll<SVGPathElement>(
          '.recharts-layer.recharts-bar-rectangle path.recharts-rectangle'
        );
        console.log(`[${logId} -> ${id}-barPathCount-after-axis-fix]`, {
          barPathCount: barPaths?.length ?? 0
        });
      };

      logBarWidthDebug('chart-subscription', 'client-070');
      logBarWidthDebug('chart-monthly', 'client-071');
      logSvgBasics('chart-subscription', 'client-072');
      logSvgBasics('chart-monthly', 'client-073');
      logBarSizeResult('chart-subscription', 'client-074', 20);
      logBarSizeResult('chart-monthly', 'client-075', 20);
      logBarPathAfterAxisFix('chart-subscription', 'client-130');
      logBarPathAfterAxisFix('chart-monthly', 'client-131');

      const logDomAfter = (id: string, logId: string) => {
        const root = document.getElementById(id);
        const barRectangleLayers = root?.querySelectorAll('.recharts-layer.recharts-bar-rectangle').length ?? 0;
        const barPathCount =
          root?.querySelectorAll<SVGPathElement>(
            '.recharts-layer.recharts-bar-rectangle path.recharts-rectangle'
          ).length ?? 0;
        const clipPathCount = root?.querySelectorAll('svg clipPath').length ?? 0;
        console.log(`[${logId} -> ${id}-dom-after-800ms]`, {
          barRectangleLayers,
          barPathCount,
          clipPathCount
        });
      };

      logDomAfter('chart-subscription', 'client-122');
      logDomAfter('chart-monthly', 'client-123');
    }, 800);

    return () => clearTimeout(timer);
  }, [
    normalizedMonthlyAverages,
    normalizedMonthlyOverview,
    normalizedWeekdayBuildings,
    normalizedWeekdayPoints
  ]);

  useEffect(() => {
    const timer = setTimeout(() => {
      const targets = [
        { id: 'chart-subscription', logId: 'client-112' },
        { id: 'chart-monthly', logId: 'client-113' }
      ];

      targets.forEach(({ id, logId }) => {
        const barPaths = document.querySelectorAll<SVGPathElement>(
          `#${id} .recharts-layer.recharts-bar-rectangle path.recharts-rectangle`
        );
        console.log(`[${logId} -> ${id}-barPathCount-solid-fill]`, {
          barPathCount: barPaths.length
        });
      });
    }, 800);

    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    console.log('[client-124 -> subscription-yaxis-config]', {
      yAxisId: 'left',
      domain: SUBSCRIPTION_Y_AXIS_DOMAIN,
      allowDataOverflow: false,
      scale: 'auto'
    });

    console.log('[client-125 -> monthly-yaxis-config]', {
      left: {
        yAxisId: 'left',
        domain: MONTHLY_LEFT_Y_AXIS_DOMAIN,
        allowDataOverflow: false,
        scale: 'auto'
      },
      right: {
        yAxisId: 'right',
        domain: MONTHLY_RIGHT_Y_AXIS_DOMAIN,
        allowDataOverflow: false,
        scale: 'auto'
      }
    });
  }, []);

  const planMax = useMemo(() => {
    const peak = Math.max(
      ...normalizedMonthlyAverages.map((row) => Math.max(row.subscriptionCount, row.perOrderCount)),
      0
    );
    if (peak === 0) return 1;
    return Math.ceil(peak * 1.1);
  }, [normalizedMonthlyAverages]);

  const planTicks = useMemo(() => {
    const ratios = [0.25, 0.5, 0.75, 1];
    return ratios.map((ratio) => Math.ceil(planMax * ratio));
  }, [planMax]);

  const overviewLeftMax = 31;

  const overviewRightMax = useMemo(() => {
    const peak = Math.max(...normalizedMonthlyOverview.map((row) => row.totalCount), 0);
    if (peak === 0) return 100;
    return Math.max(400, Math.ceil(peak * 1.15));
  }, [normalizedMonthlyOverview]);

  const overviewLeftTicks = useMemo(() => [0, 8, 16, 24, 31], []);

  const overviewRightTicks = useMemo(() => {
    const ratios = [0.25, 0.5, 0.75, 1];
    return ratios.map((ratio) => Math.ceil(overviewRightMax * ratio));
  }, [overviewRightMax]);

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
          data={normalizedMonthlyAverages}
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
            yAxisId="left"
            orientation="left"
            tickLine={false}
            axisLine={{ stroke: 'rgba(148, 163, 184, 0.4)' }}
            tick={{ fill: '#cbd5e1', fontWeight: 700, fontSize: 12 }}
            domain={SUBSCRIPTION_Y_AXIS_DOMAIN}
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
            xAxisId="x"
            yAxisId="left"
            shape={debugBarShapes.subscription}
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
      normalizedMonthlyAverages,
      planMax,
      planTicks
    ]
  );

  const monthlyTotalsChart = useMemo(
    () => (
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart
          data={normalizedMonthlyOverview}
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
            yAxisId="left"
            orientation="left"
            tickLine={false}
            axisLine={{ stroke: 'rgba(148, 163, 184, 0.4)' }}
            tick={{ fill: '#cbd5e1', fontWeight: 700, fontSize: 12 }}
            domain={MONTHLY_LEFT_Y_AXIS_DOMAIN}
            ticks={overviewLeftTicks}
            allowDecimals={false}
          />
          <YAxis
            yAxisId="right"
            orientation="right"
            tickLine={false}
            axisLine={{ stroke: 'rgba(148, 163, 184, 0.4)' }}
            tick={{ fill: '#cbd5e1', fontWeight: 700, fontSize: 12 }}
            domain={MONTHLY_RIGHT_Y_AXIS_DOMAIN}
            ticks={overviewRightTicks}
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
            xAxisId="x"
            yAxisId="right"
            shape={debugBarShapes.monthly}
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
      normalizedMonthlyOverview,
      overviewLeftMax,
      overviewLeftTicks,
      overviewRightMax,
      overviewRightTicks
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
          <section
            id="chart-subscription"
            className={styles.graphCard}
            aria-label="요금제별 통계"
          >
            <div className={styles.graphHeading}>
              <p className={styles.graphTitle}>요금제별 통계</p>
            </div>
            <div className={styles.graphSurface} aria-hidden="true">
              <div className={styles.mixedChart}>{planChart}</div>
            </div>
          </section>

          <section id="chart-monthly" className={styles.graphCard} aria-label="월별 통계">
            <div className={styles.graphHeading}>
              <p className={styles.graphTitle}>월별 통계</p>
            </div>
            <div className={styles.graphSurface} aria-hidden="true">
              <div className={styles.mixedChart}>{monthlyTotalsChart}</div>
            </div>
          </section>

          <section id="chart-weekday" className={styles.graphCard} aria-label="요일별 통계">
            <div className={styles.graphHeading}>
              <p className={styles.graphTitle}>요일별 통계</p>
            </div>
            <div className={styles.graphSurface} aria-hidden="true">
              <div className={styles.mixedChart}>{weekdayChart}</div>
            </div>
          </section>

          {/* ===========================
              PR-001: Fixed BarChart Debug
              =========================== */}
          <section className={styles.graphCard} style={{ border: '2px dashed red' }}>
            <h3 style={{ color: 'red' }}>고정형 BarChart 진단 (PR-001)</h3>

            <div
              id="pr-001-fixed-chart"
              ref={minimalChartRef}
              style={{
                width: 520,
                height: 320,
                background: '#fff',
                marginTop: 12
              }}
            >
              {(() => {
                console.log('[client-003] PR-001 debug card mounted');
                return <PR001ClientOnlyChart />;
              })()}
            </div>
          </section>

          <section className={styles.graphCard} style={{ border: '2px dashed #f97316' }}>
            <h3 style={{ color: '#f97316' }}>PR-010 NaN Probe (subscription/monthly)</h3>
            <div style={{ marginTop: 12 }}>
              <PR010NaNProbe
                subscriptionData={normalizedMonthlyAverages}
                monthlyData={normalizedMonthlyOverview}
              />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
