import { DateTime } from 'luxon';

import styles from './stats-table.module.css';

import type { StatsTableSnapshot } from '@/src/server/dashboardStatsTable';

const COLOR_POOL = ['#60a5fa', '#a78bfa', '#f472b6', '#f59e0b', '#22d3ee', '#34d399', '#c084fc', '#fca5a5'];

type LegendColorMap = Map<string, string>;

function resolveColor(key: string, map: LegendColorMap) {
  if (!map.has(key)) {
    map.set(key, COLOR_POOL[map.size % COLOR_POOL.length]);
  }
  return map.get(key) as string;
}

function formatMonthLabel(monthKey: string) {
  return DateTime.fromFormat(monthKey, 'yyyy-LL').toFormat('yy.MM');
}

function formatNumber(value: number) {
  return value.toLocaleString('ko-KR', { maximumFractionDigits: 1, minimumFractionDigits: 0 });
}

function Sparkline({ values, color, maxValue }: { values: number[]; color: string; maxValue?: number }) {
  const width = 1120;
  const height = 180;
  const max = Math.max(...values, maxValue ?? 1);
  const points = values
    .map((value, idx) => {
      const x = (width / Math.max(values.length - 1, 1)) * idx;
      const y = height - (height * value) / max;
      return `${x},${y}`;
    })
    .join(' ');

  return (
    <svg className={styles.sparkline} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      <polyline points={points} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export default function StatsTableDashboard({ snapshot }: { snapshot: StatsTableSnapshot }) {
  const legendColors: LegendColorMap = new Map();

  const monthLabels = snapshot.months.map((month) => ({
    key: month.key,
    label: formatMonthLabel(month.key)
  }));

  const maxMonthlyAverage = Math.max(
    ...snapshot.monthlySeries.flatMap((series) => series.values.map((value) => value.averagePerDay)),
    1
  );

  const monthlyBarSeries = snapshot.monthlySeries.filter((series) => series.plan === '건별제');
  const monthlyLineSeries = snapshot.monthlySeries.filter((series) => series.plan === '정액제');
  const monthYAxisTicks = Array.from({ length: 5 }, (_, idx) => (maxMonthlyAverage / 4) * idx);

  const compositeRoomSeries = snapshot.monthlyComposite.map((row) => row.roomAverage);
  const compositeBuildingSeries = snapshot.monthlyComposite.map((row) => row.buildingAverage);
  const compositeTotalSeries = snapshot.monthlyComposite.map((row) => row.total);
  const compositeMax = Math.max(...compositeRoomSeries, ...compositeBuildingSeries, ...compositeTotalSeries, 1);

  const weekdayMax = Math.max(...snapshot.weekdayStats.map((item) => item.averageTotal), 1);

  const referenceLabel = DateTime.fromISO(snapshot.referenceDate).toFormat('yyyy-LL-dd HH:mm');

  return (
    <div className={styles.shell}>
      <div className={styles.canvas}>
        <div className={styles.grid}>
          <section className={styles.quadrant}>
            <div className={styles.overlay}>
              <div className={styles.overlayTitle}>월별 평균 시계열</div>
              <div className={styles.overlayMeta}>
                월별 {snapshot.monthRange.start} ~ {snapshot.monthRange.end} · 기준 {referenceLabel} · 16:30 매일 갱신
              </div>
            </div>

              <div className={styles.monthChart}>
              <div className={styles.monthChartArea}>
                <div className={styles.monthGrid}>
                  {monthYAxisTicks.map((tick) => (
                    <div
                      key={`tick-${tick}`}
                      className={styles.monthGridLine}
                      style={{ bottom: `${(tick / Math.max(maxMonthlyAverage, 1)) * 100}%` }}
                    >
                      <span className={styles.monthGridLabel}>{formatNumber(tick)}</span>
                    </div>
                  ))}
                </div>

                {monthLabels.flatMap((month, monthIdx) => {
                  const columnWidth = 100 / monthLabels.length;
                  const barGroupWidth = columnWidth * 0.7;
                  const barWidth = monthlyBarSeries.length > 0 ? barGroupWidth / monthlyBarSeries.length : 0;
                  const startOffset = columnWidth * monthIdx + (columnWidth - barGroupWidth) / 2;

                  return monthlyBarSeries.map((series, barIdx) => {
                    const value = series.values[monthIdx];
                    const barHeight = (value.averagePerDay / maxMonthlyAverage) * 100;
                    const left = startOffset + barWidth * barIdx;

                    return (
                      <div
                        key={`${series.key}-${month.key}`}
                        className={styles.barDatum}
                        style={{
                          left: `${left}%`,
                          width: `${barWidth}%`,
                          height: `${barHeight}%`,
                          backgroundColor: resolveColor(series.key, legendColors)
                        }}
                      />
                    );
                  });
                })}

                {monthlyBarSeries.map((series) => {
                  const lastIdx = series.values.length - 1;
                  const columnWidth = 100 / monthLabels.length;
                  const barGroupWidth = columnWidth * 0.7;
                  const barWidth = monthlyBarSeries.length > 0 ? barGroupWidth / monthlyBarSeries.length : 0;
                  const startOffset = columnWidth * lastIdx + (columnWidth - barGroupWidth) / 2;
                  const value = series.values[lastIdx];
                  const barHeight = (value.averagePerDay / maxMonthlyAverage) * 100;
                  const left = startOffset + barWidth * monthlyBarSeries.indexOf(series) + barWidth / 2;
                  const bottom = Math.max(barHeight, 2);

                  return (
                    <div
                      key={`${series.key}-legend`}
                      className={styles.barLegendChip}
                      style={{
                        left: `${left}%`,
                        bottom: `${bottom + 4}%`,
                        backgroundColor: resolveColor(series.key, legendColors)
                      }}
                    >
                      {series.building}·{series.plan}
                    </div>
                  );
                })}

                <svg className={styles.lineChart} viewBox={`0 0 100 ${Math.max(maxMonthlyAverage, 1)}`} preserveAspectRatio="none">
                  {monthlyLineSeries.map((series) => {
                    const color = resolveColor(series.key, legendColors);
                    const points = series.values
                      .map((value, idx) => {
                        const x = (100 / Math.max(series.values.length - 1, 1)) * idx;
                        const y = Math.max(maxMonthlyAverage - value.averagePerDay, 0);
                        return `${x},${y}`;
                      })
                      .join(' ');

                    return <polyline key={series.key} points={points} fill="none" stroke={color} strokeWidth="1.6" />;
                  })}
                </svg>

                {monthlyLineSeries.map((series) => {
                  const lastIdx = series.values.length - 1;
                  const x = (100 / Math.max(series.values.length - 1, 1)) * lastIdx;
                  const y = Math.max(maxMonthlyAverage - series.values[lastIdx]?.averagePerDay, 0);

                  return (
                    <div
                      key={`${series.key}-line-legend`}
                      className={styles.lineLegendChip}
                      style={{ left: `${x}%`, top: `${(y / Math.max(maxMonthlyAverage, 1)) * 100}%`, color: '#0b1222' }}
                    >
                      {series.building}·{series.plan}
                    </div>
                  );
                })}
              </div>

              <div className={styles.monthAxis}>
                {monthLabels.map((month) => (
                  <div key={month.key} className={styles.monthTick}>
                    {month.label}
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className={styles.quadrant}>
            <div className={styles.overlay}>
              <div className={styles.overlayTitle}>월별 통계값</div>
              <div className={styles.overlayMeta}>
                월별 {snapshot.monthRange.start} ~ {snapshot.monthRange.end} · 기준 {referenceLabel}
              </div>
              <div className={styles.overlayLegendCompact}>
                <span className={styles.legendChip} style={{ backgroundColor: '#60a5fa' }}>호실평균</span>
                <span className={styles.legendChip} style={{ backgroundColor: '#fbbf24' }}>건물평균</span>
                <span className={styles.legendChip} style={{ backgroundColor: '#34d399' }}>총량</span>
              </div>
            </div>

            <div className={styles.compositeChart}>
              <div className={styles.compositeAxis}>
                {monthLabels.map((month) => (
                  <div key={month.key} className={styles.compositeTick}>
                    {month.label}
                  </div>
                ))}
              </div>

              <div className={styles.compositeLines}>
                <Sparkline values={compositeRoomSeries} color="#60a5fa" maxValue={compositeMax} />
                <Sparkline values={compositeBuildingSeries} color="#fbbf24" maxValue={compositeMax} />
                <Sparkline values={compositeTotalSeries} color="#34d399" maxValue={compositeMax} />
              </div>

              <div className={styles.compositeValues}>
                {snapshot.monthlyComposite.map((row) => (
                  <div key={row.month} className={styles.compositeCell}>
                    <div className={styles.valueRow}>
                      <span>호실평균</span>
                      <strong>{row.roomAverage.toFixed(1)}</strong>
                    </div>
                    <div className={styles.valueRow}>
                      <span>건물평균</span>
                      <strong>{row.buildingAverage.toFixed(1)}</strong>
                    </div>
                    <div className={styles.valueRow}>
                      <span>총량</span>
                      <strong>{formatNumber(row.total)}</strong>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className={styles.quadrant}>
            <div className={styles.overlay}>
              <div className={styles.overlayTitle}>요일별 통계값</div>
              <div className={styles.overlayMeta}>
                요일별 {snapshot.weekdayRange.start} ~ {snapshot.weekdayRange.end} · 기준 {referenceLabel} · 16:30 매일 갱신
              </div>
            </div>

            <div className={styles.weekdayGrid}>
              {snapshot.weekdayStats.map((stat) => {
                const denom = Math.max(weekdayMax, 1);
                return (
                  <div key={stat.weekday} className={styles.weekdayCell}>
                    <div className={styles.weekdayLabel}>{stat.weekday}</div>
                    <div className={styles.weekdayBarShell}>
                      <div
                        className={styles.weekdayTotalBar}
                        style={{ height: `${(stat.averageTotal / denom) * 100}%` }}
                        title={`평균 ${stat.averageTotal.toFixed(2)}건`}
                      />
                      <div className={styles.weekdayBuildings}>
                        {stat.buildings.map((building) => (
                          <div
                            key={`${stat.weekday}-${building.building}`}
                            className={styles.weekdayBuildingBar}
                            style={{
                              width: `${(building.average / Math.max(stat.averageTotal, 1)) * 100}%`,
                              backgroundColor: resolveColor(building.building, legendColors)
                            }}
                            title={`${building.building}: ${building.average.toFixed(2)}건`}
                          />
                        ))}
                      </div>
                    </div>
                    <div className={styles.weekdayValue}>{stat.averageTotal.toFixed(2)}건/일</div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className={styles.quadrant}>
            <div className={styles.overlay}>
              <div className={styles.overlayTitle}>박수기준 통계값</div>
              <div className={styles.overlayMeta}>매일 16:30 갱신 · 기준 {referenceLabel}</div>
            </div>
            <div className={styles.placeholder}>준비중입니다.</div>
          </section>
        </div>
      </div>
    </div>
  );
}
