'use client';

import styles from './stats-dashboard.module.css';
import type { ProfileSummary } from '@/src/utils/profile';

type GraphCard = {
  title: string;
  description: string;
  bars: { label: string; value: number; baseline?: number }[];
  trend: number[];
};

const graphCards: GraphCard[] = [
  {
    title: '1번 그래프',
    description: '핵심 지표를 압축하여 한눈에 보여주는 영역입니다. 1920 x 1080 해상도에 맞춰 비율을 고정했습니다.',
    bars: [
      { label: 'Alpha', value: 78, baseline: 60 },
      { label: 'Beta', value: 54, baseline: 45 },
      { label: 'Gamma', value: 68, baseline: 50 },
      { label: 'Delta', value: 92, baseline: 70 }
    ],
    trend: [22, 40, 56, 48, 62, 74, 88]
  },
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

type Props = { profile: ProfileSummary };

export default function StatsDashboard(_: Props) {
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
