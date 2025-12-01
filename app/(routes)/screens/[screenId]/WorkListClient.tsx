'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import CommonHeader from '@/app/(routes)/dashboard/CommonHeader';
import styles from './screens.module.css';
import type { AssignableWorker, WorkListEntry, WorkListSnapshot } from './server/getWorkListSnapshot';
import type { ProfileSummary } from '@/src/utils/profile';

type Props = {
  profile: ProfileSummary;
  snapshot: WorkListSnapshot;
};

const cleaningLabels = ['청소대기', '청소중', '마무리중', '청소종료'];
const tierLabels: Record<number, string> = {
  99: '관리자',
  7: '버틀러',
  6: '전문가',
  5: '숙련자',
  4: '비기너',
  3: '보류',
  2: '대기',
  1: '블랙'
};

function compareTimes(a: string, b: string) {
  const [aH, aM] = a?.split(':').map((v) => Number(v)) ?? [];
  const [bH, bM] = b?.split(':').map((v) => Number(v)) ?? [];
  const aMinutes = Number.isFinite(aH) && Number.isFinite(aM) ? aH * 60 + aM : Number.MAX_SAFE_INTEGER;
  const bMinutes = Number.isFinite(bH) && Number.isFinite(bM) ? bH * 60 + bM : Number.MAX_SAFE_INTEGER;
  return aMinutes - bMinutes;
}

function sortWorks(list: WorkListEntry[], mode: 'checkout' | 'roomDesc') {
  const buildingCounts = list.reduce<Record<number, number>>((acc, work) => {
    acc[work.buildingId] = (acc[work.buildingId] ?? 0) + 1;
    return acc;
  }, {});

  return [...list].sort((a, b) => {
    if (a.cleaningYn !== b.cleaningYn) {
      return Number(a.cleaningYn) - Number(b.cleaningYn);
    }

    const aSector = a.sectorValue || a.sectorCode;
    const bSector = b.sectorValue || b.sectorCode;
    if (aSector !== bSector) {
      return aSector.localeCompare(bSector, 'ko');
    }

    const countDiff = (buildingCounts[b.buildingId] ?? 0) - (buildingCounts[a.buildingId] ?? 0);
    if (countDiff !== 0) return countDiff;

    if (mode === 'checkout') {
      const checkoutDiff = compareTimes(a.checkoutTime, b.checkoutTime);
      if (checkoutDiff !== 0) return checkoutDiff;
    }

    const aRoom = parseInt(a.roomNo ?? '', 10);
    const bRoom = parseInt(b.roomNo ?? '', 10);

    if (!Number.isNaN(aRoom) && !Number.isNaN(bRoom) && aRoom !== bRoom) {
      return bRoom - aRoom;
    }

    return b.roomNo.localeCompare(a.roomNo, 'ko', { numeric: true, sensitivity: 'base' });
  });
}

function sortBuildingWorks(works: WorkListEntry[], mode: 'checkout' | 'roomDesc') {
  const noCleaning = works.filter((w) => !w.cleaningYn);
  const cleaning = works.filter((w) => w.cleaningYn);

  const byRoomDesc = (a: WorkListEntry, b: WorkListEntry) => {
    const aRoom = parseInt(a.roomNo ?? '', 10);
    const bRoom = parseInt(b.roomNo ?? '', 10);
    if (!Number.isNaN(aRoom) && !Number.isNaN(bRoom) && aRoom !== bRoom) {
      return bRoom - aRoom;
    }
    return (b.roomNo || '').localeCompare(a.roomNo || '');
  };

  noCleaning.sort(byRoomDesc);
  cleaning.sort((a, b) => {
    if (mode === 'checkout') {
      const timeDiff = compareTimes(a.checkoutTime, b.checkoutTime);
      if (timeDiff !== 0) return timeDiff;
    }
    return byRoomDesc(a, b);
  });

  return [...noCleaning, ...cleaning];
}

export default function WorkListClient({ profile, snapshot }: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const [activeRole, setActiveRole] = useState(profile.primaryRole ?? profile.roles[0] ?? null);
  const [works, setWorks] = useState(snapshot.works);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [detailOpen, setDetailOpen] = useState(false);
  const [activeWindow, setActiveWindow] = useState<'d0' | 'd1' | undefined>(snapshot.window);
  const [selectedDate, setSelectedDate] = useState(snapshot.targetDate);
  const [assignTarget, setAssignTarget] = useState<WorkListEntry | null>(null);
  const [assignSelection, setAssignSelection] = useState<number | 'noShow' | null>(null);
  const [assignQuery, setAssignQuery] = useState('');
  const [assignLoading, setAssignLoading] = useState(false);
  const [assignError, setAssignError] = useState('');
  const [infoTarget, setInfoTarget] = useState<WorkListEntry | null>(null);
  const [supplyTarget, setSupplyTarget] = useState<WorkListEntry | null>(null);
  const [photoTarget, setPhotoTarget] = useState<WorkListEntry | null>(null);
  const [searchResults, setSearchResults] = useState<AssignableWorker[]>([]);
  const [assignOptions, setAssignOptions] = useState<AssignableWorker[]>(snapshot.assignableWorkers);
  const [sortMode, setSortMode] = useState<'checkout' | 'roomDesc'>('checkout');
  const isHost = activeRole === 'host';
  const isAfterFour = snapshot.currentMinutes >= 16 * 60;
  const hostLocked = isHost && Boolean(snapshot.hostReadOnly);

  useEffect(() => {
    setWorks(snapshot.works);
    setActiveWindow(snapshot.window);
    setSelectedDate(snapshot.targetDate);
    setAssignOptions(snapshot.assignableWorkers);
    setSearchResults([]);
  }, [snapshot]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const saved = window.sessionStorage.getItem('worklist-scroll');
    if (!saved) return;
    const value = Number(saved);
    window.sessionStorage.removeItem('worklist-scroll');
    if (!Number.isNaN(value)) {
      window.scrollTo({ top: value, behavior: 'auto' });
    }
  }, []);

  const canSee = useMemo(
    () => ['admin', 'butler', 'host', 'cleaner'].some((role) => activeRole === role),
    [activeRole]
  );

  const canToggleSupply = (activeRole === 'admin' || activeRole === 'butler') && !hostLocked;
  const canToggleCleaning =
    (activeRole === 'admin' || activeRole === 'butler' || activeRole === 'cleaner') && !hostLocked;
  const canToggleSupervising = (activeRole === 'admin' || activeRole === 'butler') && !hostLocked;
  const canAssignCleaner = canToggleSupervising;

  const sortedWorks = useMemo(() => sortWorks(works, sortMode), [works, sortMode]);

  const groupedBySector = useMemo(() => {
    const sectors = new Map<
      string,
      {
        label: string;
        buildings: Map<
          number,
          {
            buildingId: number;
            buildingLabel: string;
            works: WorkListEntry[];
          }
        >;
      }
    >();

    sortedWorks.forEach((work) => {
      const sectorKey = work.sectorValue || work.sectorCode || '미지정';
      const sectorLabel = work.sectorValue || work.sectorCode || '미지정';
      if (!sectors.has(sectorKey)) {
        sectors.set(sectorKey, { label: sectorLabel, buildings: new Map() });
      }
      const sector = sectors.get(sectorKey)!;
      const buildingId = work.buildingId || 0;
      const buildingLabel = work.buildingShortName || '미지정 건물';
      if (!sector.buildings.has(buildingId)) {
        sector.buildings.set(buildingId, { buildingId, buildingLabel, works: [] });
      }
      sector.buildings.get(buildingId)!.works.push(work);
    });

    return Array.from(sectors.entries())
      .sort(([aKey], [bKey]) => aKey.localeCompare(bKey))
      .map(([key, value]) => {
        const buildings = Array.from(value.buildings.values())
          .map((b) => ({
            ...b,
            works: sortBuildingWorks(b.works, sortMode)
          }))
          .sort((a, b) => {
            if (b.works.length !== a.works.length) return b.works.length - a.works.length;
            return a.buildingLabel.localeCompare(b.buildingLabel);
          });

        return { key, label: value.label, buildings };
      });
  }, [sortedWorks, sortMode]);

  const persistRole = useCallback(async (role: string) => {
    try {
      await fetch('/api/role', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role })
      });
    } catch (error) {
      console.error('역할 저장 중 오류', error);
    }
  }, []);

  const handleRoleChange = useCallback(
    (nextRole: string) => {
      if (!profile.roles.includes(nextRole)) return;
      setActiveRole(nextRole);
      persistRole(nextRole).then(() => router.refresh()).catch(() => router.refresh());
    },
    [persistRole, profile.roles, router]
  );

  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    groupedBySector.forEach((g) => {
      initial[g.key] = true;
    });
    return initial;
  });

  useEffect(() => {
    setOpenGroups((prev) => {
      const next = { ...prev };
      groupedBySector.forEach((g) => {
        if (typeof next[g.key] === 'undefined') {
          next[g.key] = true;
        }
      });
    return next;
  });
}, [groupedBySector]);

  const [openBuildings, setOpenBuildings] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setOpenBuildings((prev) => {
      const next = { ...prev };
      groupedBySector.forEach((sector) => {
        sector.buildings.forEach((b) => {
          const key = `${sector.key}-${b.buildingId}`;
          if (typeof next[key] === 'undefined') {
            next[key] = true;
          }
        });
      });
      return next;
    });
  }, [groupedBySector]);

  const modalWorks = useMemo(() => works.filter((w) => w.cleaningYn), [works]);
  const finishedWorks = useMemo(
    () => modalWorks.filter((w) => w.supplyYn && w.cleaningFlag === 4 && Boolean(w.supervisingYn)),
    [modalWorks]
  );
  const inProgressWorks = useMemo(
    () => modalWorks.filter((w) => !finishedWorks.includes(w)),
    [modalWorks, finishedWorks]
  );

  const buildingTotals = useMemo(() => {
    const map: Record<
      string,
      {
        total: number;
        inProgress: number;
        finished: number;
        checkoutWarning: number;
        checkinWarning: number;
        supplyPending: number;
        cleaningPending: number;
      }
    > = {};

    const ensureEntry = (label: string) => {
      if (!map[label]) {
        map[label] = {
          total: 0,
          inProgress: 0,
          finished: 0,
          checkoutWarning: 0,
          checkinWarning: 0,
          supplyPending: 0,
          cleaningPending: 0
        };
      }
      return map[label];
    };

    modalWorks.forEach((work) => {
      const label = work.buildingShortName || '기타';
      const entry = ensureEntry(label);
      entry.total += 1;
      if (work.checkoutTime !== '12:00') entry.checkoutWarning += 1;
      if (work.checkinTime !== '16:00') entry.checkinWarning += 1;
      if (!work.supplyYn) entry.supplyPending += 1;
      if (work.cleaningFlag === 1) entry.cleaningPending += 1;
    });

    inProgressWorks.forEach((work) => {
      ensureEntry(work.buildingShortName || '기타').inProgress += 1;
    });

    finishedWorks.forEach((work) => {
      ensureEntry(work.buildingShortName || '기타').finished += 1;
    });

    return map;
  }, [finishedWorks, inProgressWorks, modalWorks]);

  const groupedByBuilding = useMemo(() => {
    const mapList = (list: WorkListEntry[]) =>
      list.reduce<Record<string, WorkListEntry[]>>((acc, work) => {
        const key = work.buildingShortName || '기타';
        if (!acc[key]) acc[key] = [];
        acc[key].push(work);
        return acc;
      }, {});

    const sortEntries = (entries: [string, WorkListEntry[]][]) =>
      entries.sort(([a], [b]) => a.localeCompare(b));

    return {
      inProgress: sortEntries(Object.entries(mapList(inProgressWorks))),
      finished: sortEntries(Object.entries(mapList(finishedWorks))),
    };
  }, [finishedWorks, inProgressWorks]);

  const combinedWorkers = useMemo(() => {
    const map = new Map<number, AssignableWorker>();
    assignOptions.forEach((w) => map.set(w.id, w));
    searchResults.forEach((w) => map.set(w.id, w));
    return Array.from(map.values());
  }, [assignOptions, searchResults]);

  const sortedWorkers = useMemo(
    () => [...combinedWorkers].sort((a, b) => a.name.localeCompare(b.name)),
    [combinedWorkers]
  );

  function cleaningTone(flag: number) {
    if (flag >= 4) return styles.cleaningDone;
    if (flag === 3) return styles.cleaningNearDone;
    if (flag === 2) return styles.cleaningProgress;
    return styles.cleaningIdle;
  }

  function handleWindowChange(next: 'd0' | 'd1') {
    setActiveWindow(next);
    setSelectedDate(next === 'd0' ? snapshot.windowDates.d0 : snapshot.windowDates.d1);
    const search = new URLSearchParams(params?.toString() ?? '');
    search.delete('date');
    search.set('window', next);
    router.push(`/screens/004?${search.toString()}`);
  }

  function handleDateChange(value: string) {
    setSelectedDate(value);
    setActiveWindow(value === snapshot.windowDates.d0 ? 'd0' : value === snapshot.windowDates.d1 ? 'd1' : undefined);
    const search = new URLSearchParams(params?.toString() ?? '');
    if (value) {
      search.set('date', value);
    } else {
      search.delete('date');
    }
    search.delete('window');
    const query = search.toString();
    const next = query ? `/screens/004?${query}` : '/screens/004';
    router.push(next);
  }

  async function updateWork(workId: number, payload: Record<string, unknown>) {
    setStatus('');
    setError('');
    if (hostLocked) {
      setError('D-1 16:00 이후에는 수정할 수 없습니다.');
      return;
    }
    const res = await fetch(`/api/workflow/${workId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body?.message ?? '저장 중 오류가 발생했습니다.');
      return;
    }

    const body = await res.json();
    setWorks((prev) =>
      prev.map((w) => {
        if (w.id !== workId) return w;
        const next = { ...w, ...body.work } as WorkListEntry;
        if (!next.cleanerName) {
          next.cleanerName = '';
        }
        return next;
      })
    );
    setStatus('저장되었습니다.');
  }

  function cycleCleaning(flag: number) {
    const next = flag + 1;
    return next > 4 ? 1 : next;
  }

  function resetAssignModal() {
    setAssignTarget(null);
    setAssignSelection(null);
    setAssignQuery('');
    setAssignError('');
    setAssignLoading(false);
    setSearchResults([]);
  }

  function handleRefresh() {
    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem('worklist-scroll', String(window.scrollY));
    }
    router.refresh();
  }

  async function handleAssignSave() {
    if (!assignTarget) return;
    if (assignSelection === 'noShow') {
      await updateWork(assignTarget.id, { noShow: true });
    } else {
      await updateWork(assignTarget.id, { cleanerId: assignSelection ?? null });
    }
    resetAssignModal();
  }

  async function handleAssignSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const term = assignQuery.trim();
    if (!term) return;
    setAssignLoading(true);
    setAssignError('');
    try {
      const res = await fetch(`/api/workers/search?q=${encodeURIComponent(term)}`);
      if (!res.ok) {
        setAssignError('검색 중 오류가 발생했습니다.');
        return;
      }
      const body = await res.json();
      const mapped: AssignableWorker[] = (body?.results ?? []).map((w: any) => ({
        id: Number(w.id),
        name: w.name ?? '이름 미상',
        phone: w.phone ?? null,
        registerCode: w.registerCode ?? '-',
        tier: Number(w.tier ?? 0)
      }));
      setSearchResults(mapped);
    } catch (error) {
      setAssignError('검색 중 오류가 발생했습니다.');
    } finally {
      setAssignLoading(false);
    }
  }

  return (
    <div className={styles.screenShell}>
      <CommonHeader profile={profile} activeRole={activeRole} onRoleChange={handleRoleChange} compact />

      <section className={styles.cleaningSection}>
        <div className={styles.sectionHeader}>
          <div>
            <p className={styles.sectionLabel}>ID 004 · work list</p>
            <p className={styles.sectionTitle}>과업지시서</p>
            <p className={styles.subtle}>현재 {snapshot.windowLabel} 업무 리스트</p>
          </div>
          <div className={styles.windowMeta}>
            {activeRole === 'butler' || activeRole === 'admin' || activeRole === 'cleaner' ? (
              <div className={styles.windowToggleRow}>
                <button
                  type="button"
                  className={`${styles.windowToggle} ${activeWindow === 'd0' ? styles.windowToggleActive : ''}`}
                  onClick={() => handleWindowChange('d0')}
                >
                  {activeWindow === 'd0'
                    ? `D0${snapshot.windowDates?.d0 ? ` (${snapshot.windowDates.d0})` : ''}`
                    : 'D0 보기'}
                </button>
                <button
                  type="button"
                  className={`${styles.windowToggle} ${activeWindow === 'd1' ? styles.windowToggleActive : ''}`}
                  onClick={() => handleWindowChange('d1')}
                >
                  {activeWindow === 'd1'
                    ? `D+1${snapshot.windowDates?.d1 ? ` (${snapshot.windowDates.d1})` : ''}`
                    : 'D+1 보기'}
                </button>
                <label className={styles.fieldLabel}>
                  날짜 선택
                  <select
                    className={styles.dateInput}
                    value={selectedDate}
                    onChange={(e) => handleDateChange(e.target.value)}
                  >
                    {snapshot.dateOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            ) : (
              <label className={styles.fieldLabel}>
                날짜 선택
                <select
                  className={styles.dateInput}
                  value={selectedDate}
                  onChange={(e) => handleDateChange(e.target.value)}
                >
                  {snapshot.dateOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        </div>

        <p className={styles.notice}>{snapshot.notice}</p>

        {!canSee ? (
          <p className={styles.helper}>화면 004는 관리자, 버틀러, 호스트, 클리너만 접근 가능합니다.</p>
        ) : null}

        {canSee ? (
          works.length === 0 ? (
            <p className={styles.helper}>{snapshot.emptyMessage ?? '표시할 업무가 없습니다.'}</p>
          ) : (
            <div className={styles.workList}>
              {groupedBySector.map((group) => {
                const sectorCounts = group.buildings.reduce(
                  (acc, building) => {
                    const cleaningCount = building.works.reduce((c, work) => c + Number(Boolean(work.cleaningYn)), 0);
                    const nonCleaningCount = building.works.length - cleaningCount;
                    acc.cleaning += cleaningCount;
                    acc.nonCleaning += nonCleaningCount;
                    return acc;
                  },
                  { cleaning: 0, nonCleaning: 0 }
                );
                const opened = openGroups[group.key] ?? true;
                return (
                  <article key={group.key} className={styles.groupCard}>
                    <header className={styles.groupHeader}>
                      <div>
                        <p className={styles.groupTitle}>{group.label}</p>
                        <p className={styles.subtle}>
                          {sectorCounts.cleaning}건 + {sectorCounts.nonCleaning}건
                        </p>
                      </div>
                      <button
                        type="button"
                        className={styles.iconButton}
                        aria-label={opened ? '섹터 접기' : '섹터 펼치기'}
                        onClick={() => setOpenGroups({ ...openGroups, [group.key]: !opened })}
                      >
                        {opened ? '▾' : '▸'}
                      </button>
                    </header>

                    {opened ? (
                      <div className={styles.groupBody}>
                        {group.buildings.map((building) => {
                          const buildingKey = `${group.key}-${building.buildingId}`;
                          const buildingCounts = building.works.reduce(
                            (acc, work) => {
                              if (work.cleaningYn) {
                                acc.cleaning += 1;
                              } else {
                                acc.nonCleaning += 1;
                              }
                              return acc;
                            },
                            { cleaning: 0, nonCleaning: 0 }
                          );
                          const buildingOpen = openBuildings[buildingKey] ?? true;
                          return (
                            <div key={buildingKey} className={styles.buildingCard}>
                              <header className={styles.buildingHeader}>
                                <div>
                                  <p className={styles.buildingTitle}>{building.buildingLabel}</p>
                                  <p className={styles.subtle}>
                                    {buildingCounts.cleaning}건 + {buildingCounts.nonCleaning}건
                                  </p>
                                </div>
                                <button
                                  type="button"
                                  className={styles.iconButton}
                                  aria-label={buildingOpen ? '건물 접기' : '건물 펼치기'}
                                  onClick={() => setOpenBuildings({ ...openBuildings, [buildingKey]: !buildingOpen })}
                                >
                                  {buildingOpen ? '▾' : '▸'}
                                </button>
                              </header>

                              {buildingOpen ? (
                                <div className={styles.groupBody}>
                                  {building.works.map((work) => {
                                    const cleaningLabel = cleaningLabels[(work.cleaningFlag || 1) - 1] ?? cleaningLabels[0];
                                    const supervisingLabel = work.supervisingYn ? '검수완료' : '검수대기';
                                    const disabledLine = !work.cleaningYn;
                                    const canViewRealtime = !isHost || work.realtimeOverviewYn;
                                    const canViewPhotos = !isHost || work.imagesYn;
                                    const canViewSupplyPurchase = !isHost || work.realtimeOverviewYn || isAfterFour;

                                    if (disabledLine) {
                                      return (
                                        <div key={work.id} className={`${styles.workCardMuted} ${styles.workCardMutedRow}`}>
                                          <span className={styles.workTitle}>{work.roomName}</span>
                                          <span className={styles.statusCheckBadge}>상태확인</span>
                                          <span className={styles.requirementsText}>{work.requirements || '요청사항 없음'}</span>
                                        </div>
                                      );
                                    }

                                    return (
                                      <div key={work.id} className={styles.workCard}>
                                      <div className={styles.workCardHeader}>
                                          <div className={styles.workTitleRow}>
                                            <p className={styles.workTitle}>{work.roomName}</p>
                                            <div className={styles.workTitleActions}>
                                              {work.hasPhotoReport && canViewPhotos ? (
                                                <button
                                                  type="button"
                                                  className={styles.infoButton}
                                                  onClick={() => setPhotoTarget(work)}
                                                  aria-label="업무 사진 보기"
                                                >
                                                  사진보기
                                                </button>
                                              ) : null}
                                              {work.hasSupplyReport && canViewSupplyPurchase ? (
                                                <button
                                                  type="button"
                                                  className={styles.infoButton}
                                                  onClick={() => setSupplyTarget(work)}
                                                  aria-label="소모품 구매 안내 보기"
                                                >
                                                  소모품 구매
                                                </button>
                                              ) : null}
                                              <button
                                                type="button"
                                                className={styles.infoButton}
                                                onClick={() => setInfoTarget(work)}
                                                aria-label="호실 정보 보기"
                                              >
                                                호실 정보
                                              </button>
                                            </div>
                                          </div>
                                          <p className={styles.workSubtitle}>
                                            체크아웃 {work.checkoutTime} · 체크인 {work.checkinTime} · 침구 {work.blanketQty} · 어메니티
                                            {` ${work.amenitiesQty}`}
                                          </p>
                                        </div>

                                        <p className={styles.requirementsText}>{work.requirements || '요청사항 없음'}</p>

                                        {canViewRealtime ? (
                                          <div className={styles.workRowCompact}>
                                            <button
                                              className={`${styles.toggleButton} ${work.supplyYn ? styles.supplyOn : styles.supplyOff}`}
                                              disabled={!canToggleSupply}
                                              onClick={() => updateWork(work.id, { supplyYn: !work.supplyYn })}
                                            >
                                              배급 {work.supplyYn ? '완료' : '대기'}
                                            </button>

                                            <button
                                              className={canAssignCleaner ? styles.toggleButton : styles.toggleButtonDisabled}
                                              disabled={!canAssignCleaner}
                                              onClick={() => {
                                                setAssignTarget(work);
                                                setAssignSelection(work.cleanerId ?? null);
                                                setAssignQuery('');
                                                setAssignError('');
                                              }}
                                            >
                                              {work.cleanerName ? `담당자 ${work.cleanerName}` : '배정하기'}
                                            </button>

                                            <button
                                              className={`${styles.toggleButton} ${cleaningTone(work.cleaningFlag)}`}
                                              disabled={!canToggleCleaning}
                                              onClick={() => {
                                                if (work.cleaningFlag === 3) {
                                                  const ok = window.confirm(
                                                    `${work.buildingShortName}${work.roomNo} 호실에 대하여 클리닝 완료 보고를 진행하시겠습니까?`
                                                  );
                                                  if (ok) {
                                                    router.push(`/screens/005?workId=${work.id}`);
                                                  }
                                                  return;
                                                }
                                                updateWork(work.id, { cleaningFlag: cycleCleaning(work.cleaningFlag) });
                                              }}
                                            >
                                              {cleaningLabel}
                                            </button>

                                            <button
                                              className={`${styles.toggleButton} ${work.supervisingYn ? styles.superviseOn : styles.superviseOff}`}
                                              disabled={!canToggleSupervising}
                                              onClick={() => {
                                                if (!work.supervisingYn) {
                                                  const ok = window.confirm(
                                                    `${work.buildingShortName}${work.roomNo} 호실에 대하여 수퍼바이징 완료 보고를 진행하시겠습니까?`
                                                  );
                                                  if (ok) {
                                                    router.push(`/screens/006?workId=${work.id}`);
                                                  }
                                                  return;
                                                }

                                                updateWork(work.id, { supervisingDone: !work.supervisingYn });
                                              }}
                                            >
                                              {supervisingLabel}
                                            </button>
                                          </div>
                                        ) : null}
                                      </div>
                                    );
                                  })}
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          )
        ) : null}

        {status ? <p className={styles.successText}>{status}</p> : null}
        {error ? <p className={styles.errorText}>{error}</p> : null}
      </section>

      {detailOpen ? (
        <div className={styles.modalOverlay} onClick={() => setDetailOpen(false)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <header className={styles.modalHeader}>
              <h3>현황 보기</h3>
              <button onClick={() => setDetailOpen(false)} className={styles.iconButton} aria-label="닫기">
                ✕
              </button>
            </header>
            <div className={styles.detailSection}>
              <p className={styles.sectionLabel}>진행중</p>
              <div className={styles.detailGridBody}>
                {groupedByBuilding.inProgress.map(([building, works]) => (
                  <div key={building} className={styles.detailBuildingBlock}>
                    <div className={styles.detailGridHeader}>
                      <span className={styles.detailColumnHeader}>
                        <span className={styles.detailColumnCount}>
                          {buildingTotals[building]?.inProgress ?? works.length}/{
                            buildingTotals[building]?.total ?? works.length
                          }
                        </span>
                        <span className={styles.buildingLabel}>{building}</span>
                      </span>
                      <span className={styles.detailColumnHeader}>
                        <span className={styles.detailColumnCount}>
                          {works.filter((work) => work.checkoutTime !== '12:00').length}/
                          {buildingTotals[building]?.total ?? works.length}
                        </span>
                        <span>쳌아웃</span>
                      </span>
                      <span className={styles.detailColumnHeader}>
                        <span className={styles.detailColumnCount}>
                          {works.filter((work) => work.checkinTime !== '16:00').length}/
                          {buildingTotals[building]?.total ?? works.length}
                        </span>
                        <span>체크인</span>
                      </span>
                      <span className={styles.detailColumnHeader}>
                        <span className={styles.detailColumnCount}>
                          {works.filter((work) => !work.supplyYn).length}/{
                            buildingTotals[building]?.total ?? works.length
                          }
                        </span>
                        <span>배급</span>
                      </span>
                      <span className={styles.detailColumnHeader}>
                        <span className={styles.detailColumnCount}>
                          {works.filter((work) => work.cleaningFlag === 1).length}/{
                            buildingTotals[building]?.total ?? works.length
                          }
                        </span>
                        <span>청소</span>
                      </span>
                    </div>
                    {works.map((work) => {
                      const cleaningLabel = cleaningLabels[(work.cleaningFlag || 1) - 1] ?? cleaningLabels[0];
                      const cleaningClass = (() => {
                        if (work.cleaningFlag >= 4) return styles.detailCleanDone;
                        if (work.cleaningFlag === 3) return styles.detailCleanNearDone;
                        return styles.detailCleanIdle;
                      })();

                      const checkoutClass = work.checkoutTime === '12:00' ? '' : styles.timeWarning;
                      const checkinClass = work.checkinTime === '16:00' ? '' : styles.timeWarning;

                      return (
                        <div key={work.id} className={styles.detailGridRow}>
                          <span>{work.roomNo}</span>
                          <span className={checkoutClass}>{work.checkoutTime}</span>
                          <span className={checkinClass}>{work.checkinTime}</span>
                          <span className={work.supplyYn ? styles.stateOn : styles.stateOff}>
                            {work.supplyYn ? '완료' : '대기'}
                          </span>
                          <span className={cleaningClass}>{cleaningLabel}</span>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>

            <div className={styles.detailSection}>
              <p className={styles.sectionLabel}>완료</p>
              <div className={styles.detailGridBody}>
                {groupedByBuilding.finished.map(([building, works]) => (
                  <div key={building} className={styles.detailBuildingBlock}>
                    <div className={styles.detailGridHeader}>
                      <span className={styles.detailColumnHeader}>
                        <span className={styles.detailColumnCount}>
                          {buildingTotals[building]?.finished ?? works.length}/{
                            buildingTotals[building]?.total ?? works.length
                          }
                        </span>
                        <span className={styles.buildingLabel}>{building}</span>
                      </span>
                      <span className={styles.detailColumnHeader}>
                        <span className={styles.detailColumnCount}>
                          {works.filter((work) => work.checkoutTime !== '12:00').length}/
                          {buildingTotals[building]?.total ?? works.length}
                        </span>
                        <span>쳌아웃</span>
                      </span>
                      <span className={styles.detailColumnHeader}>
                        <span className={styles.detailColumnCount}>
                          {works.filter((work) => work.checkinTime !== '16:00').length}/
                          {buildingTotals[building]?.total ?? works.length}
                        </span>
                        <span>체크인</span>
                      </span>
                      <span className={styles.detailColumnHeader}>
                        <span className={styles.detailColumnCount}>
                          {works.filter((work) => !work.supplyYn).length}/{
                            buildingTotals[building]?.total ?? works.length
                          }
                        </span>
                        <span>배급</span>
                      </span>
                      <span className={styles.detailColumnHeader}>
                        <span className={styles.detailColumnCount}>
                          {works.filter((work) => work.cleaningFlag === 1).length}/{
                            buildingTotals[building]?.total ?? works.length
                          }
                        </span>
                        <span>청소</span>
                      </span>
                    </div>
                    {works.map((work) => (
                      <div key={work.id} className={styles.detailGridRow}>
                        <span>{work.roomNo}</span>
                        <span className={work.checkoutTime === '12:00' ? '' : styles.timeWarning}>{work.checkoutTime}</span>
                        <span className={work.checkinTime === '16:00' ? '' : styles.timeWarning}>{work.checkinTime}</span>
                        <span className={styles.finishedValue}>완료</span>
                        <span className={styles.finishedValue}>청소종료</span>
                      </div>
                    ))}
                  </div>
                ))}
                {!finishedWorks.length ? <p className={styles.helper}>완료된 업무가 없습니다.</p> : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {infoTarget ? (
        <div className={styles.modalBackdrop}>
          <div className={styles.modalCard} role="dialog" aria-modal="true">
            <div className={styles.modalHead}>
              <span>호실 정보</span>
              <button onClick={() => setInfoTarget(null)} aria-label="닫기" className={styles.iconButton}>
                ✕
              </button>
            </div>

            <div className={styles.infoGrid}>
              <div>
                <p className={styles.infoLabel}>객실</p>
                <p className={`${styles.infoValue} ${styles.infoRoomName}`}>{infoTarget.roomName}</p>
              </div>
              {activeRole === 'admin' ? (
                <div>
                  <p className={styles.infoLabel}>고객사</p>
                  <p className={styles.infoValue}>{infoTarget.clientName || '정보 없음'}</p>
                </div>
              ) : null}
              <div>
                <p className={styles.infoLabel}>도로명 주소</p>
                <button
                  type="button"
                  className={`${styles.infoValue} ${styles.infoCopy}`}
                  onClick={() => {
                    const address = infoTarget.buildingAddressNew || '';
                    if (!address) {
                      window.alert('복사할 주소가 없습니다.');
                      return;
                    }
                    window.navigator.clipboard
                      ?.writeText(address)
                      .then(() => window.alert('도로명 주소를 복사했습니다.'))
                      .catch(() => window.alert('주소 복사에 실패했습니다. 다시 시도해주세요.'));
                  }}
                >
                  {infoTarget.buildingAddressNew || '정보 없음'}
                </button>
              </div>
              <div>
                <p className={styles.infoLabel}>일반 쓰레기</p>
                <p className={styles.infoValue}>{infoTarget.generalTrashInfo || '정보 없음'}</p>
              </div>
              <div>
                <p className={styles.infoLabel}>음식물 쓰레기</p>
                <p className={styles.infoValue}>{infoTarget.foodTrashInfo || '정보 없음'}</p>
              </div>
              <div>
                <p className={styles.infoLabel}>재활용 쓰레기</p>
                <p className={styles.infoValue}>{infoTarget.recycleTrashInfo || '정보 없음'}</p>
              </div>
              <div>
                <p className={styles.infoLabel}>중앙현관 비밀번호</p>
                <p className={styles.infoValue}>{infoTarget.centralPassword || infoTarget.buildingPassword || '정보 없음'}</p>
              </div>
              <div>
                <p className={styles.infoLabel}>도어락 비밀번호</p>
                <p className={styles.infoValue}>{infoTarget.doorPassword || '정보 없음'}</p>
              </div>
            </div>

            <div className={styles.modalFoot}>
              <button type="button" className={styles.primaryButton} onClick={() => setInfoTarget(null)}>
                닫기
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {photoTarget ? (
        <div className={styles.modalBackdrop}>
          <div className={styles.modalCard} role="dialog" aria-modal="true">
            <div className={styles.modalHead}>
              <span>사진 보기</span>
              <button onClick={() => setPhotoTarget(null)} aria-label="닫기" className={styles.iconButton}>
                ✕
              </button>
            </div>

            <div className={styles.photoModalBody}>
              {photoTarget.photos.length ? (
                <div className={styles.photoGrid}>
                  {photoTarget.photos.map((img, idx) => (
                    <figure key={`${img.url}-${idx}`} className={styles.photoTile}>
                      <img src={img.url} alt={`${photoTarget.roomName} 사진 ${idx + 1}`} className={styles.photoImage} />
                      <figcaption className={styles.photoActions}>
                        <a
                          className={styles.infoButton}
                          href={img.url}
                          download
                          target="_blank"
                          rel="noreferrer"
                        >
                          다운로드
                        </a>
                      </figcaption>
                    </figure>
                  ))}
                </div>
              ) : (
                <p className={styles.helper}>표시할 사진이 없습니다.</p>
              )}
            </div>

            <div className={styles.modalFoot}>
              <button type="button" className={styles.primaryButton} onClick={() => setPhotoTarget(null)}>
                닫기
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {supplyTarget ? (
        <div className={styles.modalBackdrop}>
          <div className={styles.modalCard} role="dialog" aria-modal="true">
            <div className={styles.modalHead}>
              <span>소모품 구매</span>
              <button onClick={() => setSupplyTarget(null)} aria-label="닫기" className={styles.iconButton}>
                ✕
              </button>
            </div>

            <div className={styles.supplyModalBody}>
              <div className={styles.supplyNotice}>
                <p>
                  1. 소모품은 가급적 바로바로 구매 해주시기 바랍니다. 소모품이 부족하면 청소 완성도가 떨어지고, 클리너들이
                  해당 방에 대한 소모품 부족 노티를 소홀히 여기게 됩니다.
                </p>
                <p>
                  2. 가급적 저희가 제안드리는 상품으로 구매해주시기 바랍니다. 2개 이하 번들로 구매하시면 재고가 완전히 소진되는
                  상황이 자주 발생합니다. 또한 수만건에 달하는 청소 경험과 그것을 바탕으로 한 매뉴얼에 기반하여 제안드리는 상품임을
                  꼭 고려해주시기 바랍니다. 아주 사소한 부분들에 까지 해당 제품이어야 하는 이유가 있는 제품들이오며 이 제품을
                  제안드림으로 인해 저희가 얻는 금전적 이득은 일절 없습니다.
                </p>
              </div>

              <div className={styles.supplyGrid}>
                {supplyTarget.supplyRecommendations.length ? (
                  supplyTarget.supplyRecommendations.map((item, idx) => (
                    <div key={`${item.title}-${idx}`} className={styles.supplyRow}>
                      <p className={styles.supplyTitle}>{item.title}</p>
                      {item.href ? (
                        <a className={styles.supplyLink} href={item.href} target="_blank" rel="noreferrer">
                          {item.description || '링크 바로가기'}
                        </a>
                      ) : (
                        <p className={styles.supplyDescription}>{item.description}</p>
                      )}
                    </div>
                  ))
                ) : (
                  <p className={styles.helper}>제안된 소모품 정보가 없습니다.</p>
                )}
              </div>
            </div>

            <div className={styles.modalFoot}>
              <button type="button" className={styles.primaryButton} onClick={() => setSupplyTarget(null)}>
                닫기
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {assignTarget ? (
        <div className={styles.modalBackdrop}>
          <div className={styles.modalCard} role="dialog" aria-modal="true">
            <div className={styles.modalHead}>
              <span>담당자 배정</span>
              <button onClick={resetAssignModal} aria-label="닫기">
                ✕
              </button>
            </div>

            <form className={styles.assignSearch} onSubmit={handleAssignSearch}>
              <label className={styles.fieldLabel}>
                이름 / 전화 / 관리코드 검색
                <div className={styles.searchRow}>
                  <input
                    value={assignQuery}
                    onChange={(e) => setAssignQuery(e.target.value)}
                    className={styles.textInput}
                    placeholder="예: 홍길동 또는 010"
                  />
                  <button type="submit" className={styles.secondaryButton} disabled={assignLoading}>
                    {assignLoading ? '검색 중…' : '검색'}
                  </button>
                </div>
              </label>
              {assignError ? <p className={styles.errorText}>{assignError}</p> : null}
            </form>

            <div className={styles.assignList}>
              <label className={styles.assignRow}>
                <input
                  type="radio"
                  name="assign"
                  value="none"
                  checked={assignSelection === null}
                  onChange={() => setAssignSelection(null)}
                />
                <span className={styles.assignName}>배정취소</span>
              </label>
              <label className={styles.assignRow}>
                <input
                  type="radio"
                  name="assign"
                  value="no-show"
                  checked={assignSelection === 'noShow'}
                  onChange={() => setAssignSelection('noShow')}
                />
                <div className={styles.assignMeta}>
                  <span className={styles.assignName}>노쇼 처리</span>
                  <span className={styles.assignDetail}>담당자를 해제하고 이전 사진으로 완료 처리</span>
                </div>
              </label>
              {sortedWorkers.map((worker) => (
                <label key={worker.id} className={styles.assignRow}>
                  <input
                    type="radio"
                    name="assign"
                    value={worker.id}
                    checked={assignSelection === worker.id}
                    onChange={() => setAssignSelection(worker.id)}
                  />
                  <div className={styles.assignMeta}>
                    <span className={styles.assignName}>{worker.name}</span>
                    <span className={styles.assignDetail}>
                      {tierLabels[worker.tier] ?? '무등급'} · {worker.phone ?? '전화 미상'} · {worker.registerCode}
                    </span>
                  </div>
                </label>
              ))}
              {!sortedWorkers.length ? <p className={styles.helper}>배정 가능한 인원이 없습니다.</p> : null}
            </div>

            <div className={styles.modalFoot}>
              <button type="button" className={styles.secondaryButton} onClick={resetAssignModal}>
                취소
              </button>
              <button type="button" className={styles.primaryButton} onClick={handleAssignSave} disabled={assignLoading}>
                저장
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <button type="button" className={styles.refreshBubble} onClick={handleRefresh} aria-label="새로고침">
        ↻
      </button>
    </div>
  );
}
