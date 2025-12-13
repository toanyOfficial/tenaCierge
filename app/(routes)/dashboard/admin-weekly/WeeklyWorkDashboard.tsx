'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

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

const roomSteps = [
  {
    key: 'assign' as const,
    label: '배',
    resolveClassName: (room: RoomStatus) =>
      room.supplyYn ? styles.statusSupplyOn : styles.statusSupplyOff
  },
  {
    key: 'charge' as const,
    label: '담',
    resolveClassName: (room: RoomStatus) => {
      const cleaningDone = (room.cleaningFlag ?? 1) >= 4;
      const isNoShow = !room.cleanerId && room.supplyYn && cleaningDone && room.supervisingYn;
      if (isNoShow) return styles.statusAssignNoShow;
      return room.cleanerId ? styles.statusAssignOn : styles.statusAssignOff;
    }
  },
  {
    key: 'clean' as const,
    label: '청',
    resolveClassName: (room: RoomStatus) => {
      const flag = room.cleaningFlag ?? 1;
      if (flag >= 4) return styles.statusCleaningDone;
      if (flag === 3) return styles.statusCleaningNearDone;
      if (flag === 2) return styles.statusCleaningProgress;
      return styles.statusCleaningIdle;
    }
  },
  {
    key: 'inspect' as const,
    label: '검',
    resolveClassName: (room: RoomStatus) =>
      room.supervisingYn ? styles.statusInspectOn : styles.statusInspectOff
  }
];

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
  sectorCode: string;
  buildingCode: number | null;
  room: string;
  sector: string;
  building: string;
  supplyYn: boolean;
  cleanerId: number | null;
  cleaningFlag: number | null;
  supervisingYn: boolean;
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

function isRoomCompleted(room: RoomStatus) {
  return (room.cleaningFlag ?? 0) >= 4 && room.supervisingYn;
}

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
  const getDefaultLayoutMode = () => {
    const now = new Date();
    const switchPoint = new Date(now);
    switchPoint.setHours(15, 30, 0, 0);
    return now >= switchPoint ? 'tomorrowDominant' : 'todayDominant';
  };

  const [layoutMode, setLayoutMode] = useState<'todayDominant' | 'tomorrowDominant'>(getDefaultLayoutMode);
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [currentPage, setCurrentPage] = useState(0);
  const compactListRef = useRef<HTMLDivElement | null>(null);
  const sampleRowRef = useRef<HTMLDivElement | null>(null);

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
    const syncLayoutByTime = () => {
      const nextMode = getDefaultLayoutMode();
      setLayoutMode((prev) => (prev === nextMode ? prev : nextMode));
    };

    syncLayoutByTime();
    const timer = setInterval(syncLayoutByTime, 60 * 1000);
    return () => clearInterval(timer);
  }, []);

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
  const isCompactView = layoutMode === 'tomorrowDominant';

  const sortedRooms = useMemo(() => {
    const buildingCounts = new Map<string, number>();

    roomStatuses.forEach((room) => {
      const buildingKey = room.buildingCode ?? Number.MAX_SAFE_INTEGER;
      const key = `${room.sectorCode}|||${buildingKey}`;
      buildingCounts.set(key, (buildingCounts.get(key) ?? 0) + 1);
    });

    return [...roomStatuses].sort((a, b) => {
      const sectorCompare = a.sectorCode.localeCompare(b.sectorCode);
      if (sectorCompare !== 0) return sectorCompare;

      const aBuildingCode = a.buildingCode ?? Number.MAX_SAFE_INTEGER;
      const bBuildingCode = b.buildingCode ?? Number.MAX_SAFE_INTEGER;
      const aKey = `${a.sectorCode}|||${aBuildingCode}`;
      const bKey = `${b.sectorCode}|||${bBuildingCode}`;
      const aCount = buildingCounts.get(aKey) ?? 0;
      const bCount = buildingCounts.get(bKey) ?? 0;
      if (aCount !== bCount) return bCount - aCount;

      if (aBuildingCode !== bBuildingCode) return aBuildingCode - bBuildingCode;

      return b.room.localeCompare(a.room, undefined, { numeric: true, sensitivity: 'base' });
    });
  }, [roomStatuses]);

  const ROOM_GRID_SLOTS = 36;
  const visibleRooms = sortedRooms.slice(0, ROOM_GRID_SLOTS);
  const roomPlaceholders = Math.max(ROOM_GRID_SLOTS - visibleRooms.length, 0);
  const showEmptyRooms = !isLoading && visibleRooms.length === 0;

  const activeRooms = useMemo(() => sortedRooms.filter((room) => !isRoomCompleted(room)), [sortedRooms]);

  const sectorSummaries = useMemo(() => {
    const sectorMap = new Map<string, { sector: string; code: string; count: number }>();

    activeRooms.forEach((room) => {
      const key = room.sectorCode;
      const current = sectorMap.get(key) || { sector: room.sector || key, code: key, count: 0 };
      current.count += 1;
      sectorMap.set(key, current);
    });

    return Array.from(sectorMap.values())
      .filter((sector) => sector.count > 0)
      .sort((a, b) => a.code.localeCompare(b.code));
  }, [activeRooms]);

  useEffect(() => {
    if (!isCompactView) return undefined;

    const computeRowsPerPage = () => {
      const containerHeight = compactListRef.current?.clientHeight ?? 0;
      const rowHeight = sampleRowRef.current?.clientHeight ?? 0;
      if (!containerHeight || !rowHeight) return;
      const rows = Math.max(1, Math.floor(containerHeight / rowHeight));
      setRowsPerPage(rows);
      setCurrentPage((prev) => Math.min(prev, Math.max(Math.ceil(activeRooms.length / rows) - 1, 0)));
    };

    computeRowsPerPage();
    const resizeHandler = () => computeRowsPerPage();
    window.addEventListener('resize', resizeHandler);
    return () => window.removeEventListener('resize', resizeHandler);
    }, [activeRooms.length, isCompactView]);

  useEffect(() => {
    if (!isCompactView) return undefined;
    const totalPages = rowsPerPage > 0 ? Math.ceil(activeRooms.length / rowsPerPage) : 0;
    if (totalPages <= 1) {
      setCurrentPage(0);
      return undefined;
    }

    const timer = setInterval(() => {
      setCurrentPage((prev) => ((prev + 1) % totalPages + totalPages) % totalPages);
    }, 60 * 1000);
    return () => clearInterval(timer);
  }, [activeRooms.length, isCompactView, rowsPerPage]);

  const paginatedRooms = useMemo(() => {
    if (!isCompactView) return [] as RoomStatus[];
    if (rowsPerPage <= 0) return activeRooms;
    const start = currentPage * rowsPerPage;
    return activeRooms.slice(start, start + rowsPerPage);
  }, [activeRooms, currentPage, isCompactView, rowsPerPage]);

  const formatSectorCounts = (item: SummaryItem) =>
    item.sectors.map((sector) => sector.count).join(' / ') || '0';

  if (isCompactView) {
    const compactRooms = paginatedRooms.length > 0 || rowsPerPage > 0 ? paginatedRooms : activeRooms;
    const showCompactThankYou = !isLoading && activeRooms.length === 0;

    return (
      <div className={styles.weeklyShell}>
        <div className={`${styles.weeklyCanvas} ${styles.compactOnly}`}>
          <div className={styles.compactSectorSummary}>
            {sectorSummaries.map((sector) => (
              <div key={sector.code} className={styles.compactSectorLine}>
                {`${sector.sector} : 총 ${sector.count} 건이 현재 진행중입니다.`}
              </div>
            ))}
          </div>

          <div className={styles.compactList} ref={compactListRef}>
            {showCompactThankYou ? (
              <div className={styles.compactEmpty}>오늘 하루도 수고하셨습니다.</div>
            ) : isLoading ? (
              <div className={styles.compactEmpty}>데이터를 불러오는 중입니다…</div>
            ) : (
              compactRooms.map((room, index) => (
                <div
                  key={`${room.building}-${room.room}-${index}`}
                  className={styles.compactRow}
                  ref={index === 0 ? sampleRowRef : null}
                >
                  <div className={styles.compactRoomMeta}>
                    <span className={styles.compactRoomName}>
                      {room.sector} · {room.building} · {room.room}
                    </span>
                    <span className={styles.compactRoomOwner}>{room.owner}</span>
                  </div>
                  <div className={styles.compactStatusRow}>
                    {roomSteps.map((step) => (
                      <button
                        key={step.key}
                        type="button"
                        className={`${styles.statusStep} ${step.resolveClassName(room)}`}
                      >
                        {step.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    );
  }

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
              {!isCompactView && (
              <div className={styles.cardHeader}>
                <div>
                  <p className={styles.cardTitle}>D0 업무 진행</p>
                  <p className={styles.cardMeta}>
                    {isLoading ? '데이터 로딩 중' : `실시간 동기화 · ${formatTimeLabel(todayUpdatedAt)}`}
                  </p>
                </div>
                <span className={styles.badgeSoft}>실시간</span>
              </div>
            )}

              {isCompactView ? (
              <div className={styles.compactPanel}>
                <div className={styles.compactSectorSummary}>
                  {sectorSummaries.map((sector) => (
                    <div key={sector.code} className={styles.compactSectorLine}>
                      {`${sector.sector} : 총 ${sector.count} 건이 현재 진행중입니다.`}
                    </div>
                  ))}
                </div>

                <div className={styles.compactList} ref={compactListRef}>
                  {!isLoading && activeRooms.length === 0 ? (
                    <div className={styles.compactEmpty}>오늘 하루도 수고하셨습니다.</div>
                  ) : isLoading ? (
                    <div className={styles.compactEmpty}>데이터를 불러오는 중입니다…</div>
                  ) : (
                    (paginatedRooms.length > 0 ? paginatedRooms : activeRooms).map((room, index) => (
                      <div
                        key={`${room.building}-${room.room}-${index}`}
                        className={styles.compactRow}
                        ref={index === 0 ? sampleRowRef : null}
                      >
                        <div className={styles.compactRoomMeta}>
                          <span className={styles.compactRoomName}>
                            {room.sector} · {room.building} · {room.room}
                          </span>
                          <span className={styles.compactRoomOwner}>{room.owner}</span>
                        </div>
                        <div className={styles.compactStatusRow}>
                          {roomSteps.map((step) => (
                            <button
                              key={step.key}
                              type="button"
                              className={`${styles.statusStep} ${step.resolveClassName(room)}`}
                            >
                              {step.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            ) : (
              <>
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
                  {showEmptyRooms ? (
                    <div className={`${styles.roomChip} ${styles.roomPlaceholder}`}>
                      <div className={styles.emptyState}>배정된 호실이 없습니다.</div>
                    </div>
                  ) : (
                    <>
                      {visibleRooms.map((room) => {
                        return (
                          <div key={`${room.building}-${room.room}`} className={styles.roomChip}>
                            <span className={styles.roomName}>
                              {room.building} · {room.room}
                            </span>
                            <div className={styles.roomStatusRow}>
                              <span className={styles.roomValue}>{room.owner}</span>
                              <div className={styles.statusButtonRow}>
                                {roomSteps.map((step) => (
                                  <button
                                    key={step.key}
                                    type="button"
                                    className={`${styles.statusStep} ${step.resolveClassName(room)}`}
                                  >
                                    {step.label}
                                  </button>
                                ))}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </>
                  )}
                  {Array.from({ length: roomPlaceholders - (showEmptyRooms ? 1 : 0) }).map((_, idx) => (
                    <div key={`placeholder-${idx}`} className={`${styles.roomChip} ${styles.roomPlaceholder}`} aria-hidden />
                  ))}
                </div>
              </>
            )}
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
      <button
        type="button"
        aria-label="레이아웃 전환"
        className={styles.toggleBubble}
        onClick={() => {
          setLayoutMode(isTodayDominant ? 'tomorrowDominant' : 'todayDominant');
        }}
        title={isTodayDominant ? 'D+1가 넓게 보기 (8:2)' : 'D0가 넓게 보기 (2:8)'}
      >
        ↔
      </button>
    </div>
  );
}
