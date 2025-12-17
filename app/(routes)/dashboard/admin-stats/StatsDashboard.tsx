"use client";

import React, { useMemo } from 'react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  LabelList,
  Legend,
  Line,
  ResponsiveContainer,
  XAxis,
  YAxis
} from 'recharts';

import styles from './stats-dashboard.module.css';
import type { MonthlyAveragePoint } from './server/fetchMonthlyAverages';
import type { MonthlyOverviewPoint } from './server/fetchMonthlyOverview';
import type { WeekdayStatsPoint } from './server/fetchWeekdayStats';
import type { ProfileSummary } from '@/src/utils/profile';

function formatValue(value: number) {
  return Number.isInteger(value) ? `${value}` : value.toFixed(1);
}

type Props = {
  profile: ProfileSummary;
  monthlyAverages: MonthlyAveragePoint[];
  monthlyOverview: MonthlyOverviewPoint[];
  weekdayStats: WeekdayStatsPoint[];
};

export default function StatsDashboard({
  profile: _profile,
  monthlyAverages,
  monthlyOverview,
  weekdayStats
}: Props) {
  const planMax = useMemo(() => {
    const peak = Math.max(
      ...monthlyAverages.map((row) => Math.max(row.subscriptionCount, row.perOrderCount)),
      0
    );
    if (peak === 0) return 1;
    return Math.ceil(peak * 1.1);
  }, [monthlyAverages]);

  const planTicks = useMemo(() => {
    const ratios = [0.25, 0.5, 0.75, 1];
    return ratios.map((ratio) => Math.ceil(planMax * ratio));
  }, [planMax]);

  const overviewLeftMax = 31;

  const overviewRightMax = useMemo(() => {
    const peak = Math.max(...monthlyOverview.map((row) => row.totalCount), 0);
    if (peak === 0) return 100;
    return Math.max(400, Math.ceil(peak * 1.15));
  }, [monthlyOverview]);

  const overviewLeftTicks = useMemo(() => [0, 8, 16, 24, 31], []);

  const overviewRightTicks = useMemo(() => {
    const ratios = [0.25, 0.5, 0.75, 1];
    return ratios.map((ratio) => Math.ceil(overviewRightMax * ratio));
  }, [overviewRightMax]);

  const weekdayLeftMax = useMemo(() => {
    const peak = Math.max(...weekdayStats.map((row) => row.buildingAverage), 0);
    if (peak === 0) return 1;
    return Math.max(14, Math.ceil(peak * 1.2));
  }, [weekdayStats]);

  const weekdayRightMax = useMemo(() => {
    const peak = Math.max(...weekdayStats.map((row) => row.totalCount), 0);
    if (peak === 0) return 4;
    return Math.max(30, Math.ceil(peak * 1.15));
  }, [weekdayStats]);

  const weekdayLeftTicks = useMemo(() => {
    const ratios = [0.25, 0.5, 0.75, 1];
    return ratios.map((ratio) => Math.ceil(weekdayLeftMax * ratio));
  }, [weekdayLeftMax]);

  const weekdayRightTicks = useMemo(() => {
    const ratios = [0.25, 0.5, 0.75, 1];
    return ratios.map((ratio) => Math.ceil(weekdayRightMax * ratio));
  }, [weekdayRightMax]);

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
          <div className={styles.chartLegend} aria-label="범례">
            <span className={styles.legendItem}>
              <span className={styles.legendBarSwatchAlt} />요일별 총 건수
            </span>
            <span className={styles.legendItem}>
              <span className={styles.legendLineSwatchAlt} />건물별 요일별 평균 건수
            </span>
          </div>
        );
      },
    []
  );

  const planChart = useMemo(
    () => (
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={monthlyAverages} margin={{ top: 18, right: 18, bottom: 24, left: 18 }}>
          <CartesianGrid strokeDasharray="4 4" stroke="rgba(148, 163, 184, 0.2)" vertical={false} />
          <XAxis
            dataKey="label"
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
            domain={[0, planMax]}
            ticks={planTicks}
            allowDecimals={false}
          />
          <Legend verticalAlign="top" align="right" content={<PlanLegend />} />
          <Bar
            dataKey="subscriptionCount"
            yAxisId="left"
            fill="url(#planBarGradient)"
            barSize={18}
            radius={[6, 6, 0, 0]}
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
    [BarValueLabel, LineValueLabel, PlanLegend, monthlyAverages, planMax, planTicks]
  );

  const monthlyTotalsChart = useMemo(
    () => (
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={monthlyOverview} margin={{ top: 18, right: 18, bottom: 24, left: 18 }}>
          <CartesianGrid strokeDasharray="4 4" stroke="rgba(148, 163, 184, 0.2)" vertical={false} />
          <XAxis
            dataKey="label"
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
            domain={[0, overviewLeftMax]}
            ticks={overviewLeftTicks}
            allowDecimals={false}
          />
          <YAxis
            yAxisId="right"
            orientation="right"
            tickLine={false}
            axisLine={{ stroke: 'rgba(148, 163, 184, 0.4)' }}
            tick={{ fill: '#cbd5e1', fontWeight: 700, fontSize: 12 }}
            domain={[0, overviewRightMax]}
            ticks={overviewRightTicks}
            allowDecimals={false}
          />
          <Legend verticalAlign="top" align="right" content={<MonthlyLegend />} />
          <Bar
            dataKey="totalCount"
            yAxisId="right"
            fill="url(#totalCountGradient)"
            barSize={18}
            radius={[6, 6, 0, 0]}
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
    [BarValueLabel, LineValueLabel, MonthlyLegend, monthlyOverview, overviewLeftMax, overviewLeftTicks, overviewRightMax, overviewRightTicks]
  );

  const weekdayChart = useMemo(
    () => (
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={weekdayStats} margin={{ top: 18, right: 18, bottom: 24, left: 18 }}>
          <CartesianGrid strokeDasharray="4 4" stroke="rgba(148, 163, 184, 0.2)" vertical={false} />
          <XAxis
            dataKey="label"
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
            domain={[0, weekdayLeftMax]}
            ticks={weekdayLeftTicks}
            allowDecimals={false}
          />
          <YAxis
            yAxisId="right"
            orientation="right"
            tickLine={false}
            axisLine={{ stroke: 'rgba(148, 163, 184, 0.4)' }}
            tick={{ fill: '#cbd5e1', fontWeight: 700, fontSize: 12 }}
            domain={[0, weekdayRightMax]}
            ticks={weekdayRightTicks}
            allowDecimals={false}
          />
          <Legend verticalAlign="top" align="right" content={<WeekdayLegend />} />
          <Bar
            dataKey="totalCount"
            yAxisId="right"
            fill="url(#weekdayTotalGradient)"
            barSize={20}
            radius={[6, 6, 0, 0]}
          >
            <LabelList dataKey="totalCount" position="top" content={<BarValueLabel />} />
          </Bar>
          <Line
            dataKey="buildingAverage"
            yAxisId="left"
            type="monotone"
            stroke="#38bdf8"
            strokeWidth={1}
            dot={{ stroke: '#38bdf8', fill: '#38bdf8', r: 3 }}
            activeDot={false}
            connectNulls
          >
            <LabelList dataKey="buildingAverage" position="top" content={<LineValueLabel />} />
          </Line>
          <defs>
            <linearGradient id="weekdayTotalGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#34d399" stopOpacity="0.95" />
              <stop offset="100%" stopColor="#10b981" stopOpacity="0.95" />
            </linearGradient>
          </defs>
        </ComposedChart>
      </ResponsiveContainer>
    ),
    [BarValueLabel, LineValueLabel, WeekdayLegend, weekdayLeftMax, weekdayLeftTicks, weekdayRightMax, weekdayRightTicks, weekdayStats]
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
          <section className={styles.graphCard} aria-label="요금제별 통계">
            <div className={styles.graphHeading}>
              <p className={styles.graphTitle}>요금제별 통계</p>
            </div>
            <div className={styles.graphSurface} aria-hidden="true">
              <div className={styles.mixedChart}>{planChart}</div>
            </div>
          </section>

          <section className={styles.graphCard} aria-label="월별 통계값">
            <div className={styles.graphHeading}>
              <p className={styles.graphTitle}>월별 통계값</p>
            </div>
            <div className={styles.graphSurface} aria-hidden="true">
              <div className={styles.mixedChart}>{monthlyTotalsChart}</div>
            </div>
          </section>

          <section className={styles.graphCard} aria-label="요일별 통계값">
            <div className={styles.graphHeading}>
              <p className={styles.graphTitle}>요일별 통계값</p>
            </div>
            <div className={styles.graphSurface} aria-hidden="true">
              <div className={styles.mixedChart}>{weekdayChart}</div>
            </div>
          </section>

          <section className={styles.graphCard} aria-label="숙박일수별 통계값">
            <div className={styles.graphHeading}>
              <p className={styles.graphTitle}>숙박일수별 통계값</p>
            </div>
            <div className={styles.graphSurface} aria-hidden="true">
              <div className={styles.placeholderMessage}>준비중입니다.</div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
