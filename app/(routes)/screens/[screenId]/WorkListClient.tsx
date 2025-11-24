'use client';

import { useEffect, useMemo, useState } from 'react';
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

export default function WorkListClient({ profile, snapshot }: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const [activeRole, setActiveRole] = useState(profile.primaryRole ?? profile.roles[0] ?? null);
  const [works, setWorks] = useState(snapshot.works);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [detailOpen, setDetailOpen] = useState(false);
  const [activeWindow, setActiveWindow] = useState<'d0' | 'd1' | undefined>(snapshot.window);
  const [assignTarget, setAssignTarget] = useState<WorkListEntry | null>(null);
  const [assignSelection, setAssignSelection] = useState<number | null>(null);
  const [assignQuery, setAssignQuery] = useState('');
  const [assignLoading, setAssignLoading] = useState(false);
  const [assignError, setAssignError] = useState('');
  const [infoTarget, setInfoTarget] = useState<WorkListEntry | null>(null);
  const [searchResults, setSearchResults] = useState<AssignableWorker[]>([]);
  const [assignOptions, setAssignOptions] = useState<AssignableWorker[]>(snapshot.assignableWorkers);

  useEffect(() => {
    setWorks(snapshot.works);
    setActiveWindow(snapshot.window);
    setAssignOptions(snapshot.assignableWorkers);
    setSearchResults([]);
  }, [snapshot]);

  const canSee = useMemo(
    () => ['admin', 'butler', 'host', 'cleaner'].some((role) => activeRole === role),
    [activeRole]
  );

  const canToggleSupply = activeRole === 'admin' || activeRole === 'butler';
  const canToggleCleaning = activeRole === 'admin' || activeRole === 'butler' || activeRole === 'cleaner';
  const canToggleSupervising = activeRole === 'admin' || activeRole === 'butler';
  const canAssignCleaner = canToggleSupervising;

  const groupedBySector = useMemo(() => {
    const groups = new Map<string, { label: string; works: WorkListEntry[] }>();
    works.forEach((work) => {
      const key = work.sectorValue || work.sectorCode || '미지정';
      const label = work.sectorValue || work.sectorCode || '미지정';
      if (!groups.has(key)) {
        groups.set(key, { label, works: [] });
      }
      groups.get(key)!.works.push(work);
    });
    return Array.from(groups.entries()).map(([key, value]) => ({ key, ...value }));
  }, [works]);

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

  const modalWorks = useMemo(() => works.filter((w) => w.cleaningYn), [works]);
  const finishedWorks = useMemo(
    () => modalWorks.filter((w) => w.supplyYn && w.cleaningFlag === 4 && Boolean(w.supervisingYn)),
    [modalWorks]
  );
  const inProgressWorks = useMemo(
    () => modalWorks.filter((w) => !finishedWorks.includes(w)),
    [modalWorks, finishedWorks]
  );

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
    const search = new URLSearchParams(params?.toString() ?? '');
    search.delete('date');
    search.set('window', next);
    router.push(`/screens/004?${search.toString()}`);
  }

  async function updateWork(workId: number, payload: Record<string, unknown>) {
    setStatus('');
    setError('');
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

  async function handleAssignSave() {
    if (!assignTarget) return;
    await updateWork(assignTarget.id, { cleanerId: assignSelection ?? null });
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
      const mapped: AssignableWorker[] = (body?.workers ?? []).map((w: any) => ({
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
      <CommonHeader profile={profile} activeRole={activeRole} onRoleChange={setActiveRole} compact />

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
              </div>
            ) : (
              <label className={styles.fieldLabel}>
                날짜 선택
                <input
                  type="date"
                  className={styles.dateInput}
                  defaultValue={snapshot.targetDate}
                  onChange={(e) => {
                    const next = e.target.value;
                    const search = new URLSearchParams(params?.toString() ?? '');
                    if (next) {
                      search.set('date', next);
                    } else {
                      search.delete('date');
                    }
                    router.push(`/screens/004?${search.toString()}`);
                  }}
                />
              </label>
            )}
            <button className={styles.secondaryButton} onClick={() => setDetailOpen(true)}>
              현황보기
            </button>
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
              const opened = openGroups[group.key] ?? true;
              return (
                <article key={group.key} className={styles.groupCard}>
                  <header className={styles.groupHeader}>
                    <div>
                      <p className={styles.groupTitle}>{group.label}</p>
                      <p className={styles.subtle}>{group.works.length}건</p>
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
                      {group.works.map((work) => {
                        const cleaningLabel = cleaningLabels[(work.cleaningFlag || 1) - 1] ?? cleaningLabels[0];
                        const supervisingLabel = work.supervisingYn ? '검수완료' : '검수대기';
                        const disabledLine = !work.cleaningYn;

                        if (disabledLine) {
                          return (
                            <div key={work.id} className={`${styles.workCardMuted} ${styles.workCardMutedRow}`}>
                              <span className={styles.workTitle}>{work.roomName}</span>
                              <span className={styles.requirementsText}>{work.requirements || '요청사항 없음'}</span>
                            </div>
                          );
                        }

                        return (
                          <div key={work.id} className={styles.workCard}>
                            <div className={styles.workCardHeader}>
                              <div className={styles.workTitleRow}>
                                <p className={styles.workTitle}>{work.roomName}</p>
                                <button
                                  type="button"
                                  className={styles.infoButton}
                                  onClick={() => setInfoTarget(work)}
                                  aria-label="호실 정보 보기"
                                >
                                  호실 정보
                                </button>
                              </div>
                              <p className={styles.workSubtitle}>
                                체크아웃 {work.checkoutTime} · 체크인 {work.checkinTime} · 침구 {work.blanketQty} · 어메니티
                                {` ${work.amenitiesQty}`}
                              </p>
                            </div>

                            <p className={styles.requirementsText}>{work.requirements || '요청사항 없음'}</p>

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
                                    if (work.cleaningFlag < 3) {
                                      window.alert('청소 완료 보고 이후에 수퍼바이징을 진행할 수 있습니다.');
                                      return;
                                    }

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
        <div className={styles.modalOverlay}>
          <div className={styles.modal}>
            <header className={styles.modalHeader}>
              <h3>현황 보기</h3>
              <button onClick={() => setDetailOpen(false)} className={styles.iconButton} aria-label="닫기">
                ✕
              </button>
            </header>
            <div className={styles.detailSection}>
              <p className={styles.sectionLabel}>진행중</p>
              <div className={styles.detailGridHeader}>
                <span>호실</span>
                <span>쳌아웃</span>
                <span>체크인</span>
                <span>배급</span>
                <span>청소</span>
                <span>검수</span>
              </div>
              <div className={styles.detailGridBody}>
                {inProgressWorks.map((work) => {
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
                      <span>{work.roomName}</span>
                      <span className={checkoutClass}>{work.checkoutTime}</span>
                      <span className={checkinClass}>{work.checkinTime}</span>
                      <span className={work.supplyYn ? styles.stateOn : styles.stateOff}>{work.supplyYn ? '완료' : '대기'}</span>
                      <span className={cleaningClass}>{cleaningLabel}</span>
                      <span className={work.supervisingYn ? styles.stateOn : styles.stateOff}>
                        {work.supervisingYn ? '완료' : '대기'}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className={styles.detailSection}>
              <p className={styles.sectionLabel}>완료</p>
              <div className={styles.detailGridHeader}>
                <span>호실</span>
                <span>쳌아웃</span>
                <span>체크인</span>
                <span>배급</span>
                <span>청소</span>
                <span>검수</span>
              </div>
              <div className={styles.detailGridBody}>
                {finishedWorks.map((work) => (
                  <div key={work.id} className={styles.detailGridRow}>
                    <span>{work.roomName}</span>
                    <span className={work.checkoutTime === '12:00' ? '' : styles.timeWarning}>{work.checkoutTime}</span>
                    <span className={work.checkinTime === '16:00' ? '' : styles.timeWarning}>{work.checkinTime}</span>
                    <span className={styles.finishedValue}>완료</span>
                    <span className={styles.finishedValue}>청소종료</span>
                    <span className={styles.finishedValue}>완료</span>
                  </div>
                ))}
                {!finishedWorks.length ? (
                  <p className={styles.helper}>완료된 업무가 없습니다.</p>
                ) : null}
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
              <button onClick={() => setInfoTarget(null)} aria-label="닫기">
                ✕
              </button>
            </div>

            <div className={styles.infoGrid}>
              <div>
                <p className={styles.infoLabel}>객실</p>
                <p className={styles.infoValue}>{infoTarget.roomName}</p>
              </div>
              <div>
                <p className={styles.infoLabel}>도로명 주소</p>
                <p className={styles.infoValue}>{infoTarget.buildingAddressNew || '정보 없음'}</p>
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
    </div>
  );
}
