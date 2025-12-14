'use client';

import { useEffect, useMemo, useState } from 'react';

import styles from '../admin/work-dashboard.module.css';
import type { ProfileSummary } from '@/src/utils/profile';

type ProfileProps = { profile: ProfileSummary };

type WorkerDisplay = {
  name: string;
  status: 'base' | 'added' | 'canceled';
};

type DayAttendance = {
  date: Date;
  workers: WorkerDisplay[];
  workYn: boolean;
  cancelYn: boolean;
  addYn: boolean;
  baseWorkerCount: number;
  effectiveWorkerCount: number;
};

type DayCell = DayAttendance & { isCurrentWeek: boolean; isCurrentMonth: boolean };

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
  prevMonthStartDate: string;
  currentMonthStartDate: string;
  endDate: string;
  today: string;
  weeklyPatterns: { workerId: number; worker: string; weekday: number }[];
  exceptions: {
    id: number;
    workerId: number;
    worker: string;
    excptDate: string;
    addWorkYn: boolean;
    cancelWorkYn: boolean;
  }[];
  workCounts: { date: string; count: number }[];
};

function formatDateKey(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseDate(dateString: string) {
  return new Date(`${dateString}T00:00:00`);
}

const WEEKDAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'];

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

    const cancelWorkers = dailyExceptions.filter((row) => row.cancelWork);
    const cancelWorkerNames = new Set(cancelWorkers.map((row) => row.worker));

    const activeBaseWorkers = baseWorkers
      .filter((row) => !cancelWorkerNames.has(row.worker))
      .map((row) => row.worker);

    const addedWorkers = dailyExceptions
      .filter((row) => row.addWork)
      .map((row) => row.worker)
      .filter((name) => name);

    const workerEntries: WorkerDisplay[] = [
      ...activeBaseWorkers.map((name) => ({ name, status: 'base' as const })),
      ...addedWorkers.map((name) => ({ name, status: 'added' as const })),
      ...cancelWorkers.map((row) => ({ name: row.worker, status: 'canceled' as const }))
    ].sort((a, b) => a.name.localeCompare(b.name));

    const effectiveWorkerCount = activeBaseWorkers.length + addedWorkers.length;

    days.push({
      date,
      workers: workerEntries,
      workYn: effectiveWorkerCount > 0,
      cancelYn: cancelWorkers.length > 0,
      addYn: addedWorkers.length > 0,
      baseWorkerCount: baseWorkers.length,
      effectiveWorkerCount
    });
  }

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

function formatDisplayDate(date: Date) {
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  const weekday = WEEKDAY_LABELS[date.getDay()];
  return `${month}/${day} (${weekday})`;
}

function chunkWorkers(workers: WorkerDisplay[], size: number) {
  const rows: WorkerDisplay[][] = [];
  for (let i = 0; i < workers.length; i += size) {
    rows.push(workers.slice(i, i + size));
  }
  return rows;
}

function buildCumulativeCounts(
  startDate: Date,
  endDate: Date,
  workCounts: MonthlyApiResponse['workCounts'],
  currentMonthIndex: number,
  currentYear: number
) {
  const totals: Record<string, { prev: number; current: number }> = {};
  const prevMonthDate = new Date(currentYear, currentMonthIndex - 1, 1);
  const prevMonthIndex = prevMonthDate.getMonth();
  const prevMonthYear = prevMonthDate.getFullYear();

  const prevMonthDays = new Date(prevMonthYear, prevMonthIndex + 1, 0).getDate();
  const currentMonthDays = new Date(currentYear, currentMonthIndex + 1, 0).getDate();

  let prevRunning = 0;
  let currentRunning = 0;

  const prevDailyCounts = Array.from({ length: prevMonthDays + 1 }).fill(0) as number[];
  const currentDailyCounts = Array.from({ length: currentMonthDays + 1 }).fill(0) as number[];

  workCounts.forEach((row) => {
    const date = parseDate(row.date);
    const day = date.getDate();
    if (date.getFullYear() === prevMonthYear && date.getMonth() === prevMonthIndex) {
      prevDailyCounts[day] += row.count;
    }
    if (date.getFullYear() === currentYear && date.getMonth() === currentMonthIndex) {
      currentDailyCounts[day] += row.count;
    }
  });

  const prevTotals: number[] = [];
  for (let day = 1; day <= prevMonthDays; day += 1) {
    prevRunning += prevDailyCounts[day] ?? 0;
    prevTotals[day] = prevRunning;
  }

  const currentTotals: number[] = [];
  for (let day = 1; day <= currentMonthDays; day += 1) {
    currentRunning += currentDailyCounts[day] ?? 0;
    currentTotals[day] = currentRunning;
  }

  const dayDiff = Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));

  const currentMonthStart = new Date(currentYear, currentMonthIndex, 1).getTime();

  for (let i = 0; i <= dayDiff; i += 1) {
    const date = new Date(startDate);
    date.setDate(startDate.getDate() + i);
    const key = formatDateKey(date);
    const dayOfMonth = date.getDate();

    const prevIndex = Math.min(dayOfMonth, prevMonthDays);
    const currentIndex = Math.min(dayOfMonth, currentMonthDays);

    const prevCount = prevTotals[prevIndex] ?? prevTotals[prevTotals.length - 1] ?? 0;

    let currentCount = 0;
    if (date.getFullYear() === currentYear && date.getMonth() === currentMonthIndex) {
      currentCount = currentTotals[currentIndex] ?? currentTotals[currentTotals.length - 1] ?? 0;
    } else if (date.getTime() >= currentMonthStart) {
      currentCount = currentTotals[currentMonthDays] ?? currentTotals[currentTotals.length - 1] ?? 0;
    }

    totals[key] = { prev: prevCount, current: currentCount };
  }

  return totals;
}

export default function MonthlyWorkDashboard({ profile: _profile }: ProfileProps) {
  const [weeks, setWeeks] = useState<WeekAttendance[]>([]);
  const [currentMonthIndex, setCurrentMonthIndex] = useState<number>(new Date().getMonth());
  const [currentYear, setCurrentYear] = useState<number>(new Date().getFullYear());
  const [exceptions, setExceptions] = useState<WorkerScheduleException[]>([]);
  const [cumulativeCounts, setCumulativeCounts] = useState<Record<string, { prev: number; current: number }>>({});
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
        const prevMonthStartDate = parseDate(data.prevMonthStartDate);
        const currentMonthStartDate = parseDate(data.currentMonthStartDate);
        const { weeks: mappedWeeks, exceptionRows } = buildWeeks(
          data.startDate,
          data.today,
          data.weeklyPatterns,
          data.exceptions
        );
        const calendarStartDate = parseDate(data.startDate);
        const calendarEndDate = parseDate(data.endDate);

        const counts = buildCumulativeCounts(
          prevMonthStartDate,
          calendarEndDate,
          data.workCounts,
          currentMonthStartDate.getMonth(),
          currentMonthStartDate.getFullYear()
        );
        setWeeks(mappedWeeks);
        setExceptions(exceptionRows);
        setCurrentMonthIndex(currentMonthStartDate.getMonth());
        setCurrentYear(currentMonthStartDate.getFullYear());
        setCumulativeCounts(counts);
        setError(null);
      } catch (err) {
        const message = err instanceof Error ? err.message : '월간 데이터를 불러오는 중 오류가 발생했습니다.';
        setError(message);
      }
    }

    load();
  }, []);

  const dayCells: DayCell[] = useMemo(
    () =>
      weeks.flatMap((week) =>
        week.days.map((day) => ({
          ...day,
          isCurrentWeek: week.isCurrentWeek,
          isCurrentMonth: day.date.getMonth() === currentMonthIndex
        }))
      ),
    [weeks, currentMonthIndex]
  );

  return (
    <div className={`${styles.weeklyShell} ${styles.monthlyShell}`}>
      <div className={`${styles.weeklyCanvas} ${styles.monthlyCanvas}`}>
        {error ? <div className={styles.errorBadge}>{error}</div> : null}

        <div className={styles.monthlyGrid}>
          <section className={styles.calendarPanel}>
            <div className={styles.calendarGrid}>
              {WEEKDAY_LABELS.map((label) => (
                <div key={`weekday-${label}`} className={styles.weekday}>
                  {label}
                </div>
              ))}

              {dayCells.length === 0 ? (
                <div className={styles.emptyState} style={{ gridColumn: '1 / span 7' }}>
                  실제 달력 데이터를 준비하고 있습니다.
                </div>
              ) : (
                dayCells.map((day) => {
                  const key = formatDateKey(day.date);
                  const isToday = key === todayKey;
                  const isAddedOffDay = day.baseWorkerCount === 0 && day.addYn;
                  const totals = cumulativeCounts[key] ?? { prev: 0, current: 0 };
                  const dayNumber = `${`${day.date.getDate()}`.padStart(2, '0')}`;
                  const dayGauge = `(${totals.prev}/${totals.current})`;
                  const workerRows = chunkWorkers(day.workers, 3);
                  return (
                    <div
                      key={key}
                      className={`${styles.calendarCell} ${day.workYn ? styles.workCell : ''} ${
                        day.cancelYn ? styles.cancelCell : ''
                      } ${isAddedOffDay ? styles.addedOffDayCell : ''} ${
                        isToday ? 'today' : ''
                      } ${day.isCurrentWeek ? styles.currentWeekCell : ''} ${
                        day.isCurrentMonth ? '' : styles.outsideMonth
                      }`}
                    >
                      <div className={styles.calendarCellHeader}>
                        <div className={styles.dayMeta}>
                          <span className={styles.dayNumber}>{dayNumber}</span>
                          <span className={styles.dayCounts}>{dayGauge}</span>
                        </div>
                        {isToday && <span className={styles.todayPill}>오늘</span>}
                      </div>
                      <div className={styles.workerList}>
                        {day.workers.length === 0 ? (
                          <span className={styles.noWorker}>근무 없음</span>
                        ) : (
                          workerRows.map((row, rowIndex) => (
                            <div key={`${key}-row-${rowIndex}`} className={styles.workerRow}>
                              {row.map((worker) => (
                                <span
                                  key={`${key}-${worker.name}-${worker.status}`}
                                  className={`${styles.workerTag} ${
                                    worker.status === 'added'
                                      ? styles.workerAdded
                                      : worker.status === 'canceled'
                                        ? styles.workerCanceled
                                        : ''
                                  }`}
                                >
                                  {worker.name}
                                </span>
                              ))}
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </section>

          <section className={`${styles.summaryCardTall} ${styles.exceptionCard}`}>
            <div className={styles.sideHeader}>
              <p className={styles.sideMonth}>{`${currentYear}-${`${currentMonthIndex + 1}`.padStart(2, '0')}`}</p>
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
                        <p className={styles.exceptionDate}>{formatDisplayDate(item.date)}</p>
                        <p className={styles.exceptionWorker}>{item.worker}</p>
                      </div>
                      <div className={styles.exceptionBadges}>
                        {item.addWork && (
                          <span className={`${styles.exceptionPill} ${styles.workPill} ${styles.inlineExceptionPill}`}>
                            휴무일 근무 추가
                          </span>
                        )}
                        {item.cancelWork && (
                          <span className={`${styles.exceptionPill} ${styles.cancelPill} ${styles.inlineExceptionPill}`}>
                            근무 취소
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
