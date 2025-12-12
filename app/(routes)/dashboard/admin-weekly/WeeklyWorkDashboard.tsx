'use client';

import { useEffect, useMemo, useState } from 'react';

import styles from '../admin/work-dashboard.module.css';
import type { ProfileSummary } from '@/src/utils/profile';

function formatTimeLabel(date: Date) {
  const pad = (val: number) => `${val}`.padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const barPalette = ['#dbeafe', '#bfdbfe', '#93c5fd', '#60a5fa', '#3b82f6', '#2563eb'];

const roomStatusMap = {
  assign: { label: '배', className: styles.statusAssign },
  charge: { label: '담', className: styles.statusCharge },
  clean: { label: '청', className: styles.statusClean },
  inspect: { label: '검', className: styles.statusInspect }
} as const;

type ProfileProps = { profile: ProfileSummary };

type SectorProgress = {
  sector: string;
  total: number;
  completed: number;
  buildings: { name: string; total: number; completed: number }[];
};

type RoomStatus = {
  room: string;
  status: keyof typeof roomStatusMap;
  owner: string;
};

type ApplyRow = {
  title: string;
  subtitle: string;
  status: string;
};

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

export default function WeeklyWorkDashboard({ profile }: ProfileProps) {
  const [layoutMode, setLayoutMode] = useState<'todayDominant' | 'tomorrowDominant'>('todayDominant');
  const [summaryUpdatedAt, setSummaryUpdatedAt] = useState<Date>(new Date());
  const [todayUpdatedAt, setTodayUpdatedAt] = useState<Date>(new Date());
  const [tomorrowUpdatedAt, setTomorrowUpdatedAt] = useState<Date>(new Date());

  const summary = useMemo(
    () => [
      { day: 'D0', sectors: { 신논현: 18, 역삼: 11, 논현: 6 } },
      { day: 'D1', sectors: { 신논현: 12, 역삼: 9, 논현: 7 } },
      { day: 'D2', sectors: { 신논현: 14, 역삼: 11, 논현: 8 } },
      { day: 'D3', sectors: { 신논현: 15, 역삼: 10, 논현: 9 } },
      { day: 'D4', sectors: { 신논현: 13, 역삼: 12, 논현: 10 } },
      { day: 'D5', sectors: { 신논현: 10, 역삼: 8, 논현: 6 } },
      { day: 'D6', sectors: { 신논현: 9, 역삼: 7, 논현: 5 } },
      { day: 'D7', sectors: { 신논현: 8, 역삼: 6, 논현: 4 } }
    ],
    []
  );

  const todayProgress: SectorProgress[] = useMemo(
    () => [
      {
        sector: '신논현',
        total: 22,
        completed: 14,
        buildings: [
          { name: 'A동', total: 8, completed: 6 },
          { name: 'B동', total: 6, completed: 4 },
          { name: 'C동', total: 8, completed: 4 }
        ]
      },
      {
        sector: '역삼',
        total: 18,
        completed: 9,
        buildings: [
          { name: '리버타워', total: 10, completed: 6 },
          { name: '센터포인트', total: 8, completed: 3 }
        ]
      },
      {
        sector: '논현',
        total: 12,
        completed: 7,
        buildings: [
          { name: '논현힐', total: 5, completed: 3 },
          { name: '논현라움', total: 7, completed: 4 }
        ]
      }
    ],
    []
  );

  const roomStatuses: RoomStatus[] = useMemo(
    () => [
      { room: '1201', status: 'assign', owner: '배정 완료' },
      { room: '1202', status: 'charge', owner: '담당자 배치' },
      { room: '1203', status: 'clean', owner: '청소 진행' },
      { room: '1204', status: 'inspect', owner: '검수 대기' },
      { room: '1205', status: 'clean', owner: '청소 진행' },
      { room: '1206', status: 'charge', owner: '담당자 배치' },
      { room: '1207', status: 'inspect', owner: '검수 대기' },
      { room: '1208', status: 'assign', owner: '배정 완료' }
    ],
    []
  );

  const tomorrowApply: ApplyRow[] = useMemo(
    () => [
      { title: '신논현 · A동', subtitle: '대기 3건 / 확정 5건', status: '확정률 62%' },
      { title: '역삼 · 리버타워', subtitle: '대기 2건 / 확정 4건', status: '확정률 67%' },
      { title: '논현 · 논현힐', subtitle: '대기 1건 / 확정 2건', status: '확정률 67%' }
    ],
    []
  );

  useEffect(() => withDailyRefresh(() => setSummaryUpdatedAt(new Date())), []);

  useEffect(() => {
    const refresh = () => setTodayUpdatedAt(new Date());
    const timer = setInterval(refresh, 10 * 60 * 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const refresh = () => setTomorrowUpdatedAt(new Date());
    const timer = setInterval(refresh, 30 * 60 * 1000);
    return () => clearInterval(timer);
  }, []);

  const renderProgressRow = (row: SectorProgress, index: number) => {
    const sectorPercent = (row.completed / row.total) * 100;
    return (
      <div key={row.sector} className={styles.progressRow}>
        <div className={styles.rowTop}>
          <span className={styles.rowLabel}>{row.sector}</span>
          <span className={styles.rowValue}>
            {row.completed} / {row.total} 완료
          </span>
        </div>
        <div className={styles.progressBar}>
          {row.buildings.map((building, idx) => {
            const width = (building.total / row.total) * 100;
            return (
              <div
                key={building.name}
                className={styles.progressSegment}
                style={{ width: `${width}%`, backgroundColor: barPalette[idx % barPalette.length] }}
                title={`${building.name} ${building.completed}/${building.total}`}
              >
                {width > 10 ? building.name : ''}
              </div>
            );
          })}
          <span className={styles.progressMarker} style={{ left: `${sectorPercent}%` }} />
        </div>
      </div>
    );
  };

  const isTodayDominant = layoutMode === 'todayDominant';

  return (
    <div className={styles.weeklyShell}>
      <div className={styles.weeklyCanvas}>
        <div className={styles.summaryStrip}>
          {summary.map((item) => {
            const total = Object.values(item.sectors).reduce((acc, val) => acc + val, 0);
            return (
              <div key={item.day} className={styles.summaryCard}>
                <span className={styles.summaryLabel}>{item.day}</span>
                <span className={styles.summaryValue}>{total}건</span>
                <span className={styles.summaryMeta}>
                  {Object.entries(item.sectors)
                    .map(([sector, count]) => `${sector} ${count}`)
                    .join(' / ')}
                </span>
              </div>
            );
          })}
        </div>

        <div className={styles.layoutToolbar}>
          <div className={styles.toolbarLeft}>
            <button
              type="button"
              className={styles.toggleButton}
              onClick={() => setLayoutMode(isTodayDominant ? 'tomorrowDominant' : 'todayDominant')}
            >
              {isTodayDominant ? 'D+1가 넓게 보기 (8:2)' : 'D0가 넓게 보기 (2:8)'}
            </button>
            <span className={styles.refreshNote}>시점과 무관하게 균형/우선 카드 레이아웃을 전환합니다.</span>
          </div>
          <div className={styles.toolbarRight}>
            <span className={styles.refreshBadge}>업데이트 {formatTimeLabel(summaryUpdatedAt)}</span>
          </div>
        </div>

        <div
          className={`${styles.cardGrid} ${
            isTodayDominant ? styles.cardGridTodayDominant : styles.cardGridTomorrowDominant
          }`}
        >
          <section
            className={`${styles.workCard} ${
              isTodayDominant ? styles.dominantCard : styles.compactCard
            }`}
          >
            <div className={styles.cardHeader}>
              <div>
                <p className={styles.cardTitle}>D0 업무 진행</p>
                <p className={styles.cardMeta}>10분마다 새로고침 · {formatTimeLabel(todayUpdatedAt)}</p>
              </div>
              <span className={styles.badgeSoft}>실시간</span>
            </div>
            <div className={styles.progressList}>{todayProgress.map(renderProgressRow)}</div>
            <div className={styles.roomGrid}>
              {roomStatuses.map((room) => {
                const statusInfo = roomStatusMap[room.status];
                return (
                  <div key={room.room} className={styles.roomChip}>
                    <span className={styles.roomName}>{room.room}</span>
                    <div className={styles.roomStatusRow}>
                      <span className={`${styles.roomPill} ${statusInfo.className}`}>
                        ⚡ {statusInfo.label}
                      </span>
                      <span className={styles.roomValue}>{room.owner}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section
            className={`${styles.workCard} ${
              !isTodayDominant ? styles.dominantCard : styles.compactCard
            }`}
          >
            <div className={styles.cardHeader}>
              <div>
                <p className={styles.cardTitle}>D+1 준비 현황</p>
                <p className={styles.cardMeta}>30분마다 새로고침 · {formatTimeLabel(tomorrowUpdatedAt)}</p>
              </div>
              <span className={styles.badgeSoft}>배치 모니터링</span>
            </div>
            <div className={styles.progressList}>
              {todayProgress.map((row, index) => (
                <div key={row.sector} className={styles.progressRow}>
                  <div className={styles.rowTop}>
                    <span className={styles.rowLabel}>{row.sector}</span>
                    <span className={styles.rowValue}>빌딩 {row.buildings.length}개 · 총 {row.total}건</span>
                  </div>
                  <div className={styles.progressBar}>
                    {row.buildings.map((building, idx) => {
                      const width = (building.total / row.total) * 100;
                      return (
                        <div
                          key={`${building.name}-${idx}`}
                          className={styles.progressSegment}
                          style={{ width: `${width}%`, backgroundColor: barPalette[(index + idx) % barPalette.length] }}
                          title={`${building.name} ${building.total}건`}
                        >
                          {width > 14 ? `${building.name} ${building.total}` : ''}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            <div className={styles.applyList}>
              {tomorrowApply.map((row) => (
                <div key={row.title} className={styles.applyRow}>
                  <div className={styles.applyMeta}>
                    <span className={styles.applyTitle}>{row.title}</span>
                    <span className={styles.applySubtitle}>{row.subtitle}</span>
                  </div>
                  <span className={styles.applyBadge}>{row.status}</span>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
