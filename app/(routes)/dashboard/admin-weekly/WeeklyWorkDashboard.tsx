'use client';

import { useEffect, useMemo, useState } from 'react';

import styles from '../admin/work-dashboard.module.css';
import type { ProfileSummary } from '@/src/utils/profile';

function formatTimeLabel(date: Date) {
  const pad = (val: number) => `${val}`.padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatDateLabel(date: string) {
  const parsed = new Date(`${date}T00:00:00`);
  const weekday = new Intl.DateTimeFormat('ko-KR', { weekday: 'short' }).format(parsed);
  return `${date}(${weekday})`;
}

const sectorPalette = ['#60a5fa', '#22d3ee', '#a78bfa', '#f472b6', '#fbbf24', '#34d399', '#f97316', '#38bdf8'];
const buildingPalette = ['#0ea5e9', '#22c55e', '#a855f7', '#f97316', '#eab308', '#06b6d4'];

const roomStatusMap = {
  assign: { label: '배', className: styles.statusAssign },
  charge: { label: '담', className: styles.statusCharge },
  clean: { label: '청', className: styles.statusClean },
  inspect: { label: '검', className: styles.statusInspect }
} as const;

type ProfileProps = { profile: ProfileSummary };

type SectorProgress = {
  code: string;
  sector: string;
  total: number;
  completed: number;
  buildings: { name: string; total: number; completed: number }[];
};

type StackedSegment = {
  key: string;
  label: string;
  buildingName: string;
  width: number;
  offset: number;
  completedWidth: number;
  color: string;
  sector: string;
  sectorCode: string;
  sectorTotal: number;
  sectorCompleted: number;
  isSectorHead: boolean;
  total: number;
  completed: number;
};

type RoomStatus = {
  room: string;
  sector: string;
  building: string;
  supplyComplete: boolean;
  assigned: boolean;
  cleaningComplete: boolean;
  inspected: boolean;
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
  sectors: { code: string; name: string; count: number }[];
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
                style={{ width: `${width}%`, backgroundColor: buildingPalette[(index + idx) % buildingPalette.length] }}
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

  const todayTotal = useMemo(
    () => todayProgress.reduce((acc, sector) => acc + sector.total, 0),
    [todayProgress]
  );

  const todayStacked: StackedSegment[] = useMemo(() => {
    if (todayTotal === 0) return [] as StackedSegment[];

    const sectorColorMap = new Map<string, string>();
    const getSectorColor = (code: string, index: number) => {
      if (sectorColorMap.has(code)) return sectorColorMap.get(code)!;
      const color = sectorPalette[index % sectorPalette.length];
      sectorColorMap.set(code, color);
      return color;
    };

    const sortedSectors = [...todayProgress].sort((a, b) => a.code.localeCompare(b.code));
    const segments: StackedSegment[] = [];
    let offset = 0;

    sortedSectors.forEach((sector, sectorIdx) => {
      const sortedBuildings = [...sector.buildings].sort((a, b) => a.name.localeCompare(b.name));
      const sectorColor = getSectorColor(sector.code, sectorIdx);

      sortedBuildings.forEach((building, idx) => {
        const width = todayTotal ? (building.total / todayTotal) * 100 : 0;
        const completedWidth = building.total ? (building.completed / building.total) * 100 : 0;
        const shade = `${sectorColor}e6`;
        segments.push({
          key: `${sector.code}-${building.name}`,
          label: `${sector.code}·${building.name}`,
          buildingName: building.name,
          width,
          offset,
          completedWidth,
          color: shade,
          sector: sector.sector,
          sectorCode: sector.code,
          sectorTotal: sector.total,
          sectorCompleted: sector.completed,
          isSectorHead: idx === 0,
          total: building.total,
          completed: building.completed
        });
        offset += width;
      });
    });

    return segments;
  }, [todayProgress, todayTotal]);

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

  const roomSteps = [
    { key: 'assign' as const, active: (room: RoomStatus) => room.supplyComplete },
    { key: 'charge' as const, active: (room: RoomStatus) => room.assigned },
    { key: 'clean' as const, active: (room: RoomStatus) => room.cleaningComplete },
    { key: 'inspect' as const, active: (room: RoomStatus) => room.inspected }
  ];

  const formatSectorCounts = (item: SummaryItem) =>
    item.sectors.map((sector) => sector.count).join(' / ') || '0';

  return (
    <div className={styles.weeklyShell}>
      <div className={styles.weeklyCanvas}>
        <div className={styles.summaryGrid}>
          {summary.map((item) => {
            const total = item.sectors.reduce((acc, sector) => acc + sector.count, 0);
            return (
              <div key={item.day} className={styles.summaryCell}>
                <div className={styles.summaryDate}>{formatDateLabel(item.date)}</div>
                <div className={styles.summaryTotal}>{total}건</div>
                <div className={styles.summarySectors}>{formatSectorCounts(item)}</div>
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
            } ${styles.todayCard}`}
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

            <div className={styles.stackedWrapper}>
              {todayStacked.length === 0 && !isLoading ? (
                <div className={styles.emptyState}>오늘 등록된 업무가 없습니다.</div>
              ) : (
                <>
                  <div className={styles.stackedBarShell}>
                    <div className={styles.overlayRowTop}>
                      {todayStacked.map((segment) => (
                        <div
                          key={`${segment.key}-top`}
                          className={styles.overlayBlock}
                          style={{ left: `${segment.offset}%`, width: `${segment.width}%` }}
                        >
                          <span className={styles.overlayStat}>
                            {segment.completed}/{segment.total} · {segment.completedWidth.toFixed(0)}%
                          </span>
                        </div>
                      ))}
                    </div>
                    <div className={styles.stackedBar}>
                      {todayStacked.map((segment) => (
                        <div
                          key={segment.key}
                          className={styles.stackedSegment}
                          style={{
                            width: `${segment.width}%`,
                            background: `linear-gradient(120deg, ${segment.color} 0%, ${segment.color.replace(/e6$/i, 'ff')} 85%)`
                          }}
                          title={`${segment.label} ${segment.width.toFixed(1)}%`}
                        >
                          <div className={styles.segmentProgress} style={{ width: `${segment.completedWidth}%` }} />
                          <span className={styles.segmentLabel}>{segment.buildingName}</span>
                        </div>
                      ))}
                    </div>
                    <div className={styles.overlayRowBottom}>
                      {todayStacked.map((segment) =>
                        segment.isSectorHead ? (
                          <div
                            key={`${segment.key}-sector`}
                            className={styles.overlayBlock}
                            style={{ left: `${segment.offset}%`, width: `${segment.width}%` }}
                          >
                            <span className={styles.overlaySector}>
                              {segment.sector} {segment.sectorTotal}건
                            </span>
                          </div>
                        ) : null
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>

            <div className={styles.roomGrid}>
              {roomStatuses.length === 0 && !isLoading ? (
                <div className={styles.emptyState}>배정된 호실이 없습니다.</div>
              ) : (
                roomStatuses.map((room) => {
                  return (
                    <div key={`${room.building}-${room.room}`} className={styles.roomChip}>
                      <span className={styles.roomName}>
                        {room.building} · {room.room}
                      </span>
                      <div className={styles.roomStatusRow}>
                        <span className={styles.roomValue}>{room.owner}</span>
                        <div className={styles.statusButtonRow}>
                          {roomSteps.map((step) => {
                            const statusInfo = roomStatusMap[step.key];
                            const active = step.active(room);
                            return (
                              <button
                                key={step.key}
                                type="button"
                                className={`${styles.statusStep} ${active ? statusInfo.className : ''}`}
                              >
                                {statusInfo.label}
                              </button>
                            );
                          })}
                        </div>
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
