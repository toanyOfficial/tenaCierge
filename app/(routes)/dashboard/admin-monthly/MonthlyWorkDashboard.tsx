'use client';

import { useEffect, useMemo, useState } from 'react';

import styles from '../admin/work-dashboard.module.css';
import CommonHeader from '../CommonHeader';
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
  worker: string;
  date: Date;
  addWork: boolean;
  cancelWork: boolean;
  note?: string;
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

function startOfWeek(date: Date) {
  const clone = new Date(date);
  const day = clone.getDay();
  clone.setDate(clone.getDate() - day);
  clone.setHours(0, 0, 0, 0);
  return clone;
}

function withDailyRefresh(callback: () => void) {
  const now = new Date();
  const next = new Date(now);
  next.setHours(16, 30, 0, 0);
  if (next <= now) {
    next.setDate(next.getDate() + 1);
  }
  const delay = next.getTime() - now.getTime();
  let interval: ReturnType<typeof setInterval> | undefined;
  const timeout = setTimeout(() => {
    callback();
    interval = setInterval(callback, 24 * 60 * 60 * 1000);
  }, delay);
  return () => {
    clearTimeout(timeout);
    if (interval) {
      clearInterval(interval);
    }
  };
}

function buildSampleWeeks(now: Date): WeekAttendance[] {
  const sampleWorkers = ['김정윤', '이지훈', '박서연', '최민수', '윤다혜', '정유나', '박도현'];
  const anchor = startOfWeek(now);
  const start = new Date(anchor);
  start.setDate(anchor.getDate() - 14); // before 2 weeks

  return Array.from({ length: 6 }).map((_, weekIndex) => {
    const weekStart = new Date(start);
    weekStart.setDate(start.getDate() + weekIndex * 7);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);

    const days: DayAttendance[] = Array.from({ length: 7 }).map((__, dayIndex) => {
      const day = new Date(weekStart);
      day.setDate(weekStart.getDate() + dayIndex);
      const workerSlice = ((weekIndex + 1) * (dayIndex + 2)) % sampleWorkers.length;
      const workerCount = Math.max(2, workerSlice);
      const workers = sampleWorkers.slice(0, workerCount);
      const workYn = (weekIndex + dayIndex) % 3 === 0;
      const cancelYn = (weekIndex + dayIndex + 1) % 6 === 0;
      return { date: day, workers, workYn, cancelYn };
    });

    const isCurrentWeek = now >= weekStart && now <= weekEnd;

    return { start: weekStart, end: weekEnd, days, isCurrentWeek };
  });
}

function buildSampleExceptions(): WorkerScheduleException[] {
  const base = startOfWeek(new Date());
  const exceptions: WorkerScheduleException[] = [
    { worker: '김정윤', date: new Date(base), addWork: true, cancelWork: false, note: '긴급 투입' },
    { worker: '이지훈', date: new Date(base), addWork: false, cancelWork: true, note: '연차' },
    { worker: '박서연', date: new Date(base.getTime() + 3 * 24 * 60 * 60 * 1000), addWork: true, cancelWork: false },
    { worker: '최민수', date: new Date(base.getTime() - 5 * 24 * 60 * 60 * 1000), addWork: false, cancelWork: true, note: '병가' },
    { worker: '윤다혜', date: new Date(base.getTime() + 9 * 24 * 60 * 60 * 1000), addWork: true, cancelWork: false, note: '현장 요청' },
    { worker: '정유나', date: new Date(base.getTime() + 11 * 24 * 60 * 60 * 1000), addWork: false, cancelWork: true }
  ];

  return exceptions.sort((a, b) => a.date.getTime() - b.date.getTime());
}

export default function MonthlyWorkDashboard({ profile }: ProfileProps) {
  const [weeks, setWeeks] = useState<WeekAttendance[]>(() => buildSampleWeeks(new Date()));
  const [refreshedAt, setRefreshedAt] = useState<Date>(new Date());
  const [exceptions, setExceptions] = useState<WorkerScheduleException[]>(() => buildSampleExceptions());

  const todayKey = formatDateKey(new Date());

  useEffect(() =>
    withDailyRefresh(() => {
      setWeeks(buildSampleWeeks(new Date()));
      setExceptions(buildSampleExceptions());
      setRefreshedAt(new Date());
    }),
  []);

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
        <CommonHeader profile={profile} activeRole="admin" onRoleChange={() => {}} />

        <header className={styles.pageHeader}>
          <div>
            <p className={styles.pageTitle}>대시보드 - 월간업무</p>
            <p className={styles.pageSubtitle}>
              주간업무 UI 톤앤매너를 그대로 적용한 6주 범위(이전 2주 + 이번 주 + 이후 3주) 달력입니다.
            </p>
          </div>
          <div className={styles.pageBadges}>
            <span className={styles.refreshBadge}>16:30 자동 새로고침</span>
            <span className={styles.pageMeta}>기준: 이번 주 중심</span>
          </div>
        </header>

        <div className={styles.monthlyGrid}>
          <section className={`${styles.calendarCard} ${styles.monthlyCard}`}>
            <div className={styles.calendarHeader}>
              <div>
                <p className={styles.cardTitle}>월간 출퇴근 현황(6주 라인)</p>
                <p className={styles.cardMeta}>매일 16:30 새로고침 · {formatDateKey(refreshedAt)}</p>
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
              {weeks.map((week, idx) => (
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
              ))}
            </div>
          </section>

          <section className={`${styles.summaryCardTall} ${styles.exceptionCard}`}>
            <div className={styles.summaryHeader}>
              <div>
                <p className={styles.cardTitle}>worker_schedule_exception</p>
                <p className={styles.cardMeta}>+{exceptionTotals.add} / -{exceptionTotals.cancel} · 6주 범위 사전 노출</p>
              </div>
              <span className={styles.refreshBadge}>주간업무 톤앤매너</span>
            </div>

            <div className={styles.exceptionList}>
              {exceptions.map((item) => {
                const key = formatDateKey(item.date);
                return (
                  <div key={`${item.worker}-${key}`} className={styles.exceptionRow}>
                    <div className={styles.exceptionMeta}>
                      <p className={styles.exceptionDate}>{key}</p>
                      <p className={styles.exceptionWorker}>{item.worker}</p>
                      {item.note && <p className={styles.exceptionNote}>{item.note}</p>}
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
              })}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
