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
  sector: string;
  building: string;
  status: keyof typeof roomStatusMap;
  owner: string;
};

type ApplyRow = {
  title: string;
  subtitle: string;
  status: string;
};

type SummaryItem = {
  day: string;
  date: string;
  sectors: { name: string; count: number }[];
};

type DashboardSnapshot = {
  summary: SummaryItem[];
  todayProgress: SectorProgress[];
  tomorrowProgress: SectorProgress[];
  roomStatuses: RoomStatus[];
  tomorrowApply: ApplyRow[];
  capturedAt: string;
};

function renderProgressRow(row: SectorProgress, index: number) {
  const percent = row.total ? (row.completed / row.total) * 100 : 0;
  return (
    <div key={`${row.sector}-${index}`} className={styles.progressRow}>
      <div className={styles.rowTop}>
        <span className={styles.rowLabel}>{row.sector}</span>
        <span className={styles.rowValue}>
          {row.completed} / {row.total} 완료
        </span>
      </div>
      <div className={styles.progressBar}>
        {row.buildings.map((building, idx) => {
          const width = row.total ? (building.total / row.total) * 100 : 0;
          return (
            <div
              key={`${building.name}-${idx}`}
              className={styles.progressSegment}
              style={{ width: `${width}%`, backgroundColor: barPalette[(index + idx) % barPalette.length] }}
              title={`${building.name} ${building.completed}/${building.total}`}
            >
              {width > 12 ? building.name : ''}
            </div>
          );
        })}
        <span className={styles.progressMarker} style={{ left: `${percent}%` }} />
      </div>
    </div>
  );
}

export default function WeeklyWorkDashboard({ profile: _profile }: ProfileProps) {
  const [layoutMode, setLayoutMode] = useState<'todayDominant' | 'tomorrowDominant'>('todayDominant');
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const summary = useMemo(() => snapshot?.summary ?? [], [snapshot]);
  const todayProgress: SectorProgress[] = useMemo(() => snapshot?.todayProgress ?? [], [snapshot]);
  const tomorrowProgress: SectorProgress[] = useMemo(() => snapshot?.tomorrowProgress ?? [], [snapshot]);
  const roomStatuses: RoomStatus[] = useMemo(() => snapshot?.roomStatuses ?? [], [snapshot]);
  const tomorrowApply: ApplyRow[] = useMemo(() => snapshot?.tomorrowApply ?? [], [snapshot]);
  const summaryUpdatedAt = useMemo(() => (snapshot ? new Date(snapshot.capturedAt) : new Date()), [snapshot]);
  const todayUpdatedAt = summaryUpdatedAt;
  const tomorrowUpdatedAt = summaryUpdatedAt;

  useEffect(() => {
    let canceled = false;

    const load = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/dashboard/admin-weekly');
        if (!res.ok) {
          throw new Error('주간 대시보드를 불러오지 못했습니다.');
        }
        const data = (await res.json()) as DashboardSnapshot;
        if (!canceled) {
          setSnapshot(data);
        }
      } catch (err) {
        if (!canceled) {
          setError(err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.');
        }
      } finally {
        if (!canceled) {
          setIsLoading(false);
        }
      }
    };

    load();
    const timer = setInterval(load, 10 * 60 * 1000);
    return () => {
      canceled = true;
      clearInterval(timer);
    };
  }, []);

  const isTodayDominant = layoutMode === 'todayDominant';

  return (
    <div className={styles.weeklyShell}>
      <div className={styles.weeklyCanvas}>
        <div className={styles.summaryStrip}>
          {summary.map((item) => {
            const total = item.sectors.reduce((acc, sector) => acc + sector.count, 0);
            return (
              <div key={item.day} className={styles.summaryCard}>
                <span className={styles.summaryLabel}>
                  {item.day} · {item.date}
                </span>
                <span className={styles.summaryValue}>{total}건</span>
                <span className={styles.summaryMeta}>
                  {item.sectors.map(({ name, count }) => `${name} ${count}`).join(' / ') || '예약 없음'}
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
            {error && <span className={styles.errorBadge}>{error}</span>}
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
                <p className={styles.cardMeta}>
                  {isLoading ? '데이터 로딩 중' : `실시간 동기화 · ${formatTimeLabel(todayUpdatedAt)}`}
                </p>
              </div>
              <span className={styles.badgeSoft}>실시간</span>
            </div>
            <div className={styles.progressList}>
              {todayProgress.length === 0 && !isLoading ? (
                <div className={styles.emptyState}>오늘 등록된 업무가 없습니다.</div>
              ) : (
                todayProgress.map(renderProgressRow)
              )}
            </div>
            <div className={styles.roomGrid}>
              {roomStatuses.length === 0 && !isLoading ? (
                <div className={styles.emptyState}>배정된 호실이 없습니다.</div>
              ) : (
                roomStatuses.map((room) => {
                  const statusInfo = roomStatusMap[room.status];
                  return (
                    <div key={`${room.building}-${room.room}`} className={styles.roomChip}>
                      <span className={styles.roomName}>
                        {room.building} · {room.room}
                      </span>
                      <div className={styles.roomStatusRow}>
                        <span className={`${styles.roomPill} ${statusInfo.className}`}>
                          ⚡ {statusInfo.label}
                        </span>
                        <span className={styles.roomValue}>{room.owner}</span>
                      </div>
                    </div>
                  );
                })
              )}
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
                <p className={styles.cardMeta}>
                  {isLoading ? '데이터 로딩 중' : `30분 주기 동기화 · ${formatTimeLabel(tomorrowUpdatedAt)}`}
                </p>
              </div>
              <span className={styles.badgeSoft}>배치 모니터링</span>
            </div>
            <div className={styles.progressList}>
              {tomorrowProgress.length === 0 && !isLoading ? (
                <div className={styles.emptyState}>다가오는 업무 예약이 없습니다.</div>
              ) : (
                tomorrowProgress.map(renderProgressRow)
              )}
            </div>
            <div className={styles.applyList}>
              {tomorrowApply.length === 0 && !isLoading ? (
                <div className={styles.emptyState}>D+1 배치가 비어 있습니다.</div>
              ) : (
                tomorrowApply.map((row) => (
                  <div key={row.title} className={styles.applyRow}>
                    <div className={styles.applyMeta}>
                      <span className={styles.applyTitle}>{row.title}</span>
                      <span className={styles.applySubtitle}>{row.subtitle}</span>
                    </div>
                    <span className={styles.applyBadge}>{row.status}</span>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
