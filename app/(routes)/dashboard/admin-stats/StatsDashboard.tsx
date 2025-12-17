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

export default function StatsDashboard({ monthlyAverages }: Props) {
  const monthlyMax = Math.max(
    1,
    ...monthlyAverages.map((row) => Math.max(row.perOrder, row.subscription, 0))
  );
  const yTicks = yTickRatios.map((ratio) => Math.ceil(monthlyMax * ratio));

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
              <div className={styles.monthlyLegend}>
                <span className={styles.legendItem}>
                  <span className={styles.legendSwatchPerOrder} />건별제
                </span>
                <span className={styles.legendItem}>
                  <span className={styles.legendSwatchSubscription} />정액제
                </span>
              </div>

              <div className={styles.monthlyGridLines}>
                {yTicks.map((tick) => (
                  <span key={`tick-${tick}`} className={styles.monthlyGridLine}>
                    <em>{tick}</em>
                  </span>
                ))}
              </div>

              <svg
                className={styles.perOrderLine}
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <defs>
                  <linearGradient id="perOrderGradient" x1="0%" x2="100%" y1="0%" y2="0%">
                    <stop offset="0%" stopColor="#38bdf8" />
                    <stop offset="100%" stopColor="#6366f1" />
                  </linearGradient>
                </defs>

                <path
                  className={styles.perOrderPath}
                  d={`M ${monthlyAverages
                    .map((row, index) => {
                      const x = (index / (monthlyAverages.length - 1)) * 100;
                      const y = 100 - Math.min(100, (row.perOrder / monthlyMax) * 100);
                      return `${x.toFixed(3)} ${y.toFixed(3)}`;
                    })
                    .join(' L ')}`}
                />

                {monthlyAverages.map((row, index) => {
                  const x = (index / (monthlyAverages.length - 1)) * 100;
                  const y = 100 - Math.min(100, (row.perOrder / monthlyMax) * 100);
                  const labelY = Math.max(6, y - 4);

                  return (
                    <g key={`perorder-${row.label}-${index}`}>
                      <circle className={styles.perOrderDot} cx={x} cy={y} r={1} />
                      {row.perOrder !== 0 && (
                        <text className={styles.perOrderValue} x={x} y={labelY}>
                          {formatValue(row.perOrder)}
                        </text>
                      )}
                    </g>
                  );
                })}
              </svg>

              <div className={styles.monthlyBarArea}>
                {monthlyAverages.map((row, index) => {
                  const subscriptionHeight = (row.subscription / monthlyMax) * 100;

                  return (
                    <div key={`${row.label}-${index}`} className={styles.monthlyColumn}>
                      <div className={styles.subscriptionBarWrapper}>
                        <div
                          className={styles.subscriptionBar}
                          style={{ height: `${subscriptionHeight}%` }}
                          aria-label={`정액제 ${row.label}월 평균 ${row.subscription}`}
                        />
                        {row.subscription !== 0 && (
                          <span className={styles.barValueLabel}>{formatValue(row.subscription)}</span>
                        )}
                      </div>
                      <span className={styles.monthLabel}>{row.label}</span>
                    </div>
                  );
                })}
              </div>
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
