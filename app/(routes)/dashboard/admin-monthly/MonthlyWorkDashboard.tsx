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
  currentCleanings: number;
  previousCleanings: number;
};

function formatDateKey(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
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

function buildSampleMonth(now: Date): DayAttendance[] {
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const days: DayAttendance[] = [];
  const sampleWorkers = ['김정윤', '이지훈', '박서연', '최민수', '윤다혜'];

  for (let d = 0; d < 31; d += 1) {
    const day = new Date(start);
    day.setDate(start.getDate() + d);
    if (day.getMonth() !== now.getMonth()) {
      break;
    }

    const workers = sampleWorkers.slice(0, ((d + 2) % sampleWorkers.length) + 1);
    const workYn = (d + 1) % 3 === 0;
    const cancelYn = d % 7 === 0;
    days.push({
      date: day,
      workers,
      workYn,
      cancelYn,
      currentCleanings: (d + 1) * 3,
      previousCleanings: (d + 1) * 2
    });
  }

  return days;
}

export default function MonthlyWorkDashboard({ profile }: ProfileProps) {
  const [monthSnapshot, setMonthSnapshot] = useState<DayAttendance[]>(() => buildSampleMonth(new Date()));
  const [refreshedAt, setRefreshedAt] = useState<Date>(new Date());

  const startWeekday = useMemo(() => new Date(monthSnapshot[0]?.date ?? new Date()).getDay(), [monthSnapshot]);
  const daysInMonth = useMemo(() => monthSnapshot.length, [monthSnapshot]);
  const todayKey = formatDateKey(new Date());

  useEffect(() =>
    withDailyRefresh(() => {
      setMonthSnapshot(buildSampleMonth(new Date()));
      setRefreshedAt(new Date());
    }),
  []);

  const cumulative = useMemo(() => {
    const current = monthSnapshot.reduce((acc, day) => acc + day.currentCleanings, 0);
    const previous = monthSnapshot.reduce((acc, day) => acc + day.previousCleanings, 0);
    return { current, previous };
  }, [monthSnapshot]);

  return (
    <div className={styles.dashboardShell}>
      <CommonHeader profile={profile} activeRole="admin" onRoleChange={() => {}} />

      <header className={styles.pageHeader}>
        <p className={styles.pageTitle}>대시보드 - 월간업무</p>
        <p className={styles.pageSubtitle}>출퇴근 캘린더와 월별 청소 누적 현황을 한 화면(1920x1080)으로 제공합니다.</p>
      </header>

      <div className={styles.calendarShell}>
        <section className={styles.calendarCard}>
          <div className={styles.calendarHeader}>
            <div>
              <p className={styles.cardTitle}>월간 출퇴근현황</p>
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

          <div className={styles.calendarGrid}>
            {['일', '월', '화', '수', '목', '금', '토'].map((label) => (
              <div key={label} className={styles.weekday}>
                {label}
              </div>
            ))}
            {Array.from({ length: startWeekday }).map((_, idx) => (
              <div key={`blank-${idx}`} />
            ))}
            {monthSnapshot.map((day) => {
              const key = formatDateKey(day.date);
              const isToday = key === todayKey;
              return (
                <div key={key} className={styles.dayCell} style={isToday ? { borderColor: '#3b82f6' } : undefined}>
                  <span className={styles.dayNumber}>{day.date.getDate()}</span>
                  <span className={styles.dayCounts}>출근 인원 {day.workers.length}명</span>
                  <div className={styles.workerList}>
                    {day.workers.map((worker) => (
                      <span key={`${key}-${worker}`}>{worker}</span>
                    ))}
                  </div>
                  {day.workYn && <span className={`${styles.exceptionPill} ${styles.workPill}`}>work_yn=1</span>}
                  {day.cancelYn && <span className={`${styles.exceptionPill} ${styles.cancelPill}`}>cancel_yn=1</span>}
                </div>
              );
            })}
            {Array.from({ length: (7 - ((startWeekday + daysInMonth) % 7)) % 7 }).map((_, idx) => (
              <div key={`tail-${idx}`} />
            ))}
          </div>
        </section>

        <section className={styles.summaryCardTall}>
          <div className={styles.summaryHeader}>
            <div>
              <p className={styles.cardTitle}>월별 누적 현황</p>
              <p className={styles.cardMeta}>전월 대비 당월 누적 청소 횟수</p>
            </div>
            <span className={styles.refreshBadge}>16:30 자동 새로고침</span>
          </div>

          <div className={styles.summaryList}>
            {monthSnapshot.map((day) => {
              const key = formatDateKey(day.date);
              return (
                <div key={`summary-${key}`} className={styles.summaryRow}>
                  <strong>{day.date.getDate()}일</strong>
                  <span>
                    <span className={styles.previousMonth}>{day.previousCleanings}회(전월)</span> → {day.currentCleanings}
                    회(당월)
                  </span>
                </div>
              );
            })}
          </div>

          <div className={styles.summaryRow}>
            <strong>월 누적 합계</strong>
            <span>
              <span className={styles.previousMonth}>{cumulative.previous}회(전월)</span> → {cumulative.current}회(당월)
            </span>
          </div>
        </section>
      </div>
    </div>
  );
}
