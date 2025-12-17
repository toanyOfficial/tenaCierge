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
import type { ProfileSummary } from '@/src/utils/profile';

type GraphCard = {
  title: string;
  description: string;
  bars: { label: string; value: number; baseline?: number }[];
  trend: number[];
};

const graphCards: GraphCard[] = [
  {
    title: '2번 그래프',
    description: '서비스 성과를 세그먼트별로 나누어 비교합니다. 모든 요소는 입력 없이 자동 정렬됩니다.',
    bars: [
      { label: 'North', value: 64, baseline: 50 },
      { label: 'East', value: 58, baseline: 52 },
      { label: 'West', value: 73, baseline: 60 },
      { label: 'South', value: 49, baseline: 44 }
    ],
    trend: [18, 34, 30, 46, 52, 60, 66]
  },
  {
    title: '3번 그래프',
    description: '운영 안정성을 가늠할 수 있는 누적형 그래프입니다. 스크롤 없이 정적인 상태를 유지합니다.',
    bars: [
      { label: 'Queue', value: 82, baseline: 70 },
      { label: 'Flow', value: 77, baseline: 65 },
      { label: 'Sync', value: 69, baseline: 60 },
      { label: 'Load', value: 58, baseline: 55 }
    ],
    trend: [30, 44, 40, 52, 60, 72, 80]
  },
  {
    title: '4번 그래프',
    description: '품질 검증 단계를 순차적으로 표현합니다. 모든 구성은 가로·세로 스크롤 없이 고정됩니다.',
    bars: [
      { label: 'Prep', value: 71, baseline: 58 },
      { label: 'Stage', value: 66, baseline: 55 },
      { label: 'QA', value: 84, baseline: 68 },
      { label: 'Release', value: 62, baseline: 57 }
    ],
    trend: [26, 42, 58, 54, 70, 78, 90]
  }
];

const yTickRatios = [0.25, 0.5, 0.75, 1];

function formatValue(value: number) {
  return Number.isInteger(value) ? `${value}` : value.toFixed(1);
}

type Props = { profile: ProfileSummary; monthlyAverages: MonthlyAveragePoint[] };

export default function StatsDashboard({ profile: _profile, monthlyAverages }: Props) {
  const leftMax = useMemo(() => {
    const peak = Math.max(
      ...monthlyAverages.map((row) => Math.max(row.subscriptionCount, row.perOrderCount)),
      0
    );
    if (peak === 0) return 1;
    return Math.ceil(peak * 1.1);
  }, [monthlyAverages]);

  const leftTicks = useMemo(
    () => yTickRatios.map((ratio) => Math.ceil(leftMax * ratio)),
    [leftMax]
  );

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

  const ChartLegend = useMemo(
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

  const monthlyChart = useMemo(
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
            domain={[0, leftMax]}
            ticks={leftTicks}
            allowDecimals={false}
          />
          <Legend verticalAlign="top" align="right" content={<ChartLegend />} />
          <Bar
            dataKey="subscriptionCount"
            yAxisId="left"
            fill="url(#totalBarGradient)"
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
            <linearGradient id="totalBarGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#22c55e" stopOpacity="0.9" />
              <stop offset="100%" stopColor="#16a34a" stopOpacity="0.9" />
            </linearGradient>
          </defs>
        </ComposedChart>
      </ResponsiveContainer>
    ),
    [BarValueLabel, ChartLegend, LineValueLabel, leftMax, leftTicks, monthlyAverages]
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
              <div className={styles.mixedChart}>{monthlyChart}</div>
            </div>
          </section>

          {graphCards.map((card) => (
            <section key={card.title} className={styles.graphCard} aria-label={card.title}>
              <div className={styles.graphHeading}>
                <p className={styles.graphTitle}>{card.title}</p>
                <p className={styles.graphDescription}>{card.description}</p>
              </div>

              <div className={styles.graphSurface} aria-hidden="true">
                <div className={styles.gridLines}>
                  {Array.from({ length: 5 }).map((_, index) => (
                    <span key={index} className={styles.gridLine} />
                  ))}
                </div>

                <div className={styles.trendLine}>
                  {card.trend.map((point, index) => (
                    <span
                      key={`${card.title}-trend-${index}`}
                      className={styles.trendDot}
                      style={{
                        left: `${(index / (card.trend.length - 1)) * 100}%`,
                        bottom: `${point}%`
                      }}
                    />
                  ))}
                </div>

                <div className={styles.barGroup}>
                  {card.bars.map((bar) => (
                    <div key={bar.label} className={styles.barColumn}>
                      <span className={styles.barLabel}>{bar.label}</span>
                      <div className={styles.barTrack}>
                        <div className={styles.barBaseline} style={{ height: `${bar.baseline ?? 0}%` }} />
                        <div className={styles.barValue} style={{ height: `${bar.value}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
