'use client';

import { useEffect, useMemo, useState } from 'react';

import styles from '../admin/work-dashboard.module.css';
import type { ProfileSummary } from '@/src/utils/profile';

type ProfileProps = { profile: ProfileSummary };

type DayAttendance = {
  date: Date;
  workers: string[];
  workYn: boolean;
  cancelYn: boolean;
};

type WeekAttendance = {
  start: Date;
  end: Date;
  days: DayAttendance[];
  isCurrentWeek: boolean;
};

type WorkerScheduleException = {
  id: number;
  workerId: number;
  worker: string;
  date: Date;
  addWork: boolean;
  cancelWork: boolean;
};

type MonthlyApiResponse = {
  startDate: string;
  endDate: string;
  today: string;
  weeklyPatterns: { workerId: number; worker: string; weekday: number }[];
  exceptions: { id: number; workerId: number; worker: string; excptDate: string; addWorkYn: boolean; cancelWorkYn: boolean }[];
};

function formatDateKey(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatWeekLabel(start: Date, end: Date) {
  return `${start.getMonth() + 1}/${start.getDate()} - ${end.getMonth() + 1}/${end.getDate()}`;
}

function parseDate(dateString: string) {
  return new Date(`${dateString}T00:00:00`);
}

function buildWeeks(
  startKey: string,
  todayKey: string,
  weeklyPatterns: MonthlyApiResponse['weeklyPatterns'],
  exceptions: MonthlyApiResponse['exceptions']
): { weeks: WeekAttendance[]; exceptionRows: WorkerScheduleException[] } {
  const startDate = parseDate(startKey);
  const days: DayAttendance[] = [];
  const exceptionRows: WorkerScheduleException[] = exceptions
    .map((row) => ({
      id: row.id,
      workerId: row.workerId,
      worker: row.worker || `워커-${row.workerId}`,
      date: parseDate(row.excptDate),
      addWork: row.addWorkYn,
      cancelWork: row.cancelWorkYn
    }))
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  for (let i = 0; i < 6 * 7; i += 1) {
    const date = new Date(startDate);
    date.setDate(startDate.getDate() + i);
    const key = formatDateKey(date);
    const weekday = date.getDay();

    const baseWorkers = weeklyPatterns
      .filter((row) => row.weekday === weekday)
      .map((row) => ({ ...row, worker: row.worker || `워커-${row.workerId}` }));
    const dailyExceptions = exceptionRows.filter((row) => formatDateKey(row.date) === key);

    const workerNames = new Set(baseWorkers.map((row) => row.worker));

    dailyExceptions
      .filter((row) => row.addWork)
      .forEach((row) => {
        workerNames.add(row.worker);
      });

    dailyExceptions
      .filter((row) => row.cancelWork)
      .forEach((row) => {
        workerNames.delete(row.worker);
      });

    days.push({
      date,
      workers: Array.from(workerNames).sort(),
      workYn: workerNames.size > 0,
      cancelYn: dailyExceptions.some((row) => row.cancelWork)
    });

  const weeks: WeekAttendance[] = [];
  for (let i = 0; i < 6; i += 1) {
    const weekDays = days.slice(i * 7, (i + 1) * 7);
    weeks.push({
      start: weekDays[0]?.date ?? new Date(),
      end: weekDays[6]?.date ?? new Date(),
      days: weekDays,
      isCurrentWeek:
        todayKey >= formatDateKey(weekDays[0]?.date ?? new Date()) &&
        todayKey <= formatDateKey(weekDays[6]?.date ?? new Date())
    });
  }

  return { weeks, exceptionRows };
}

export default function MonthlyWorkDashboard({ profile: _profile }: ProfileProps) {
  const [weeks, setWeeks] = useState<WeekAttendance[]>([]);
  const [refreshedAt, setRefreshedAt] = useState<Date>(new Date());
  const [exceptions, setExceptions] = useState<WorkerScheduleException[]>([]);
  const [dateRange, setDateRange] = useState<{ start: string; end: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const todayKey = formatDateKey(new Date());

  useEffect(() => {
    async function load() {
      try {
        const response = await fetch('/api/admin/schedule/monthly-dashboard');
        if (!response.ok) {
          throw new Error('월간 데이터를 불러오지 못했습니다.');
        }
        const data: MonthlyApiResponse = await response.json();
        const { weeks: mappedWeeks, exceptionRows } = buildWeeks(
          data.startDate,
          data.today,
          data.weeklyPatterns,
          data.exceptions
        );
        setWeeks(mappedWeeks);
        setExceptions(exceptionRows);
        setDateRange({ start: data.startDate, end: data.endDate });
        setRefreshedAt(new Date());
        setError(null);
      } catch (err) {
        const message = err instanceof Error ? err.message : '월간 데이터를 불러오는 중 오류가 발생했습니다.';
        setError(message);
      }
    }

    load();
  }, []);

  const summary = useMemo(
    () =>
      weeks.map((week) => {
        const totalWorkers = week.days.reduce((acc, day) => acc + day.workers.length, 0);
        const workFlags = week.days.reduce(
          (acc, day) => ({
            work: acc.work + (day.workYn ? 1 : 0),
            cancel: acc.cancel + (day.cancelYn ? 1 : 0)
          }),
          { work: 0, cancel: 0 }
        );
        return { totalWorkers, workFlags };
      }),
    [weeks]
  );

  const exceptionTotals = useMemo(
    () => ({
      add: exceptions.filter((item) => item.addWork).length,
      cancel: exceptions.filter((item) => item.cancelWork).length
    }),
    [exceptions]
  );

  return (
    <div className={`${styles.weeklyShell} ${styles.monthlyShell}`}>
      <div className={`${styles.weeklyCanvas} ${styles.monthlyCanvas}`}>
        <header className={styles.pageHeader}>
          <div>
            <p className={styles.pageTitle}>대시보드 - 월간업무</p>
            <p className={styles.pageSubtitle}>
              worker_weekly_pattern · worker_schedule_exception 데이터 기반으로 이번 주 중심 6주 달력을 노출합니다.
            </p>
          </div>
          <div className={styles.pageBadges}>
            {dateRange && <span className={styles.pageMeta}>{dateRange.start} ~ {dateRange.end}</span>}
            <span className={styles.refreshBadge}>최신 기준 {formatDateKey(refreshedAt)}</span>
          </div>
        </header>

        {error ? <div className={styles.errorBadge}>{error}</div> : null}

        <div className={styles.monthlyGrid}>
          <section className={`${styles.calendarCard} ${styles.monthlyCard}`}>
            <div className={styles.calendarHeader}>
              <div>
                <p className={styles.cardTitle}>월간 출퇴근 현황(6주)</p>
                <p className={styles.cardMeta}>주간업무 톤앤매너 · 실데이터 캘린더</p>
              </div>
              <div className={styles.legend}>
                <span className={styles.legendItem}>
                  <span className={styles.legendDot} style={{ background: '#60a5fa' }} />
                  work_yn=1
                </span>
                <span className={styles.legendItem}>
                  <span className={styles.legendDot} style={{ background: '#f87171' }} />
                  cancel_yn=1
                </span>
              </div>
            </div>

            <div className={styles.weekList}>
              {weeks.length === 0 ? (
                <div className={styles.emptyState}>실제 달력 데이터를 준비하고 있습니다.</div>
              ) : (
                weeks.map((week, idx) => (
                  <div
                    key={formatDateKey(week.start)}
                    className={`${styles.weekRow} ${week.isCurrentWeek ? styles.currentWeekRow : ''}`}
                  >
                    <div className={styles.weekMeta}>
                      <div>
                        <p className={styles.weekLabel}>W{idx + 1} · {formatWeekLabel(week.start, week.end)}</p>
                        <p className={styles.weekRange}>
                          출근 합계 {summary[idx]?.totalWorkers ?? 0}명 · work_yn={summary[idx]?.workFlags.work ?? 0} · cancel_yn={
                            summary[idx]?.workFlags.cancel ?? 0
                          }
                        </p>
                      </div>
                      {week.isCurrentWeek && <span className={styles.refreshBadge}>이번주</span>}
                    </div>

                    <div className={styles.weekGrid}>
                      {['일', '월', '화', '수', '목', '금', '토'].map((label) => (
                        <div key={`${formatDateKey(week.start)}-${label}-label`} className={styles.weekday}>
                          {label}
                        </div>
                      ))}
                      {week.days.map((day) => {
                        const key = formatDateKey(day.date);
                        const isToday = key === todayKey;
                        return (
                          <div
                            key={key}
                            className={`${styles.weekCell} ${day.workYn ? styles.workCell : ''} ${
                              day.cancelYn ? styles.cancelCell : ''
                            } ${isToday ? styles.todayCell : ''}`}
                          >
                            <div className={styles.weekCellHeader}>
                              <span className={styles.dayNumber}>{day.date.getDate()}</span>
                              {isToday && <span className={styles.todayPill}>오늘</span>}
                            </div>
                            <span className={styles.dayCounts}>출근 인원 {day.workers.length}명</span>
                            <div className={styles.workerList}>
                              {day.workers.map((worker) => (
                                <span key={`${key}-${worker}`}>{worker}</span>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className={`${styles.summaryCardTall} ${styles.exceptionCard}`}>
            <div className={styles.summaryHeader}>
              <div>
                <p className={styles.cardTitle}>worker_schedule_exception</p>
                <p className={styles.cardMeta}>+{exceptionTotals.add} / -{exceptionTotals.cancel} · 6주 범위 사전 노출</p>
              </div>
              <span className={styles.refreshBadge}>실데이터</span>
            </div>

            <div className={styles.exceptionList}>
              {exceptions.length === 0 ? (
                <div className={styles.emptyState}>예외 근무가 없습니다.</div>
              ) : (
                exceptions.map((item) => {
                  const key = formatDateKey(item.date);
                  return (
                    <div key={`${item.id}-${key}`} className={styles.exceptionRow}>
                      <div className={styles.exceptionMeta}>
                        <p className={styles.exceptionDate}>{key}</p>
                        <p className={styles.exceptionWorker}>{item.worker}</p>
                      </div>
                      <div className={styles.exceptionBadges}>
                        {item.addWork && (
                          <span className={`${styles.exceptionPill} ${styles.workPill} ${styles.inlineExceptionPill}`}>
                            add_work_yn=1
                          </span>
                        )}
                        {item.cancelWork && (
                          <span className={`${styles.exceptionPill} ${styles.cancelPill} ${styles.inlineExceptionPill}`}>
                            cancel_work_yn=1
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
