"use client";

import Script from 'next/script';
import React, { useEffect, useMemo, useState } from 'react';
import ReactDOM from 'react-dom';

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

type RechartsNamespace = {
  ResponsiveContainer: React.ComponentType<any>;
  ComposedChart: React.ComponentType<any>;
  Bar: React.ComponentType<any>;
  Line: React.ComponentType<any>;
  XAxis: React.ComponentType<any>;
  YAxis: React.ComponentType<any>;
  Legend: React.ComponentType<any>;
  Tooltip: React.ComponentType<any>;
  CartesianGrid: React.ComponentType<any>;
  LabelList: React.ComponentType<any>;
};

declare global {
  interface Window {
    Recharts?: RechartsNamespace;
  }
}

type Props = { profile: ProfileSummary; monthlyAverages: MonthlyAveragePoint[] };

const rechartsCdn =
  'https://unpkg.com/recharts@2.12.7/umd/Recharts.min.js';

export default function StatsDashboard({ monthlyAverages }: Props) {
  const [rechartsReady, setRechartsReady] = useState(false);
  const [rechartsError, setRechartsError] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      // Recharts UMD expects React/ReactDOM on window. Make them available before the CDN loads.
      (window as any).React = (window as any).React ?? React;
      (window as any).ReactDOM = (window as any).ReactDOM ?? ReactDOM;
    }
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined' && window.Recharts) {
      setRechartsReady(true);
    }
  }, []);

  const leftMax = useMemo(
    () => Math.max(100, ...monthlyAverages.map((row) => row.totalCount), 0),
    [monthlyAverages]
  );
  const rightMax = useMemo(
    () => Math.max(31, ...monthlyAverages.map((row) => row.averagePerRoom), 0),
    [monthlyAverages]
  );

  const leftTicks = useMemo(
    () => yTickRatios.map((ratio) => Math.ceil(leftMax * ratio)),
    [leftMax]
  );
  const rightTicks = useMemo(
    () => yTickRatios.map((ratio) => Number((rightMax * ratio).toFixed(0))),
    [rightMax]
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
              <span className={styles.legendBarSwatch} />총 건수
            </span>
            <span className={styles.legendItem}>
              <span className={styles.legendLineSwatch} />호실 평균 건수
            </span>
          </div>
        );
      },
    []
  );

  const monthlyChart = useMemo(() => {
    if (rechartsError) {
      return (
        <div className={styles.chartError} role="status" aria-live="polite">
          Recharts CDN 로드에 실패했습니다. 네트워크 또는 CSP 설정을 확인해 주세요.
        </div>
      );
    }

    if (typeof window === 'undefined' || !rechartsReady || !window.Recharts) {
      return <div className={styles.chartPlaceholder} aria-hidden />;
    }

    const { ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Legend, CartesianGrid, LabelList } =
      window.Recharts;

    return (
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
          />
          <YAxis
            yAxisId="right"
            orientation="right"
            tickLine={false}
            axisLine={{ stroke: 'rgba(148, 163, 184, 0.4)' }}
            tick={{ fill: '#cbd5e1', fontWeight: 700, fontSize: 12 }}
            domain={[0, rightMax]}
            ticks={rightTicks}
            allowDecimals={false}
          />
          <Legend verticalAlign="top" align="right" content={<ChartLegend />} />
          <Bar
            dataKey="totalCount"
            yAxisId="left"
            fill="url(#totalBarGradient)"
            barSize={18}
            radius={[6, 6, 0, 0]}
          >
            <LabelList dataKey="totalCount" position="top" content={<BarValueLabel />} />
          </Bar>
          <Line
            dataKey="averagePerRoom"
            yAxisId="right"
            type="monotone"
            stroke="#38bdf8"
            strokeWidth={1}
            dot={false}
            activeDot={false}
            connectNulls
          >
            <LabelList dataKey="averagePerRoom" position="top" content={<LineValueLabel />} />
          </Line>
          <defs>
            <linearGradient id="totalBarGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#22c55e" stopOpacity="0.9" />
              <stop offset="100%" stopColor="#16a34a" stopOpacity="0.9" />
            </linearGradient>
          </defs>
        </ComposedChart>
      </ResponsiveContainer>
    );
  }, [BarValueLabel, ChartLegend, LineValueLabel, leftMax, leftTicks, monthlyAverages, rechartsReady, rightMax, rightTicks]);

  return (
    <div className={styles.shell}>
      <Script
        src={rechartsCdn}
        strategy="afterInteractive"
        onLoad={() => setRechartsReady(true)}
        onError={() => setRechartsError(true)}
      />
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
