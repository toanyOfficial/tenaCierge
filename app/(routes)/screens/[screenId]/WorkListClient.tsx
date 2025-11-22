'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import CommonHeader from '@/app/(routes)/dashboard/CommonHeader';
import styles from './screens.module.css';
import type { WorkListSnapshot } from './server/getWorkListSnapshot';
import type { ProfileSummary } from '@/src/utils/profile';

type Props = {
  profile: ProfileSummary;
  snapshot: WorkListSnapshot;
};

const cleaningLabels = ['청소대기', '청소중', '마무리중', '청소종료'];

export default function WorkListClient({ profile, snapshot }: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const [activeRole, setActiveRole] = useState(profile.primaryRole ?? profile.roles[0] ?? null);
  const [works, setWorks] = useState(snapshot.works);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [detailOpen, setDetailOpen] = useState(false);
  const [activeWindow, setActiveWindow] = useState<'d0' | 'd1' | undefined>(snapshot.window);

  useEffect(() => {
    setWorks(snapshot.works);
    setActiveWindow(snapshot.window);
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

  const finishedWorks = useMemo(
    () => works.filter((w) => w.supplyYn && w.cleaningFlag === 4 && Boolean(w.supervisingEndTime)),
    [works]
  );
  const inProgressWorks = useMemo(() => works.filter((w) => !finishedWorks.includes(w)), [works, finishedWorks]);

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
    setWorks((prev) => prev.map((w) => (w.id === workId ? { ...w, ...body.work } : w)));
    setStatus('저장되었습니다.');
  }

  function cycleCleaning(flag: number) {
    const next = flag + 1;
    return next > 4 ? 1 : next;
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
            {activeRole === 'butler' ? (
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
                        const supervisingLabel = work.supervisingEndTime ? '검수완료' : '검수대기';
                        const disabledLine = !work.cleaningYn;

                        if (disabledLine) {
                          return (
                            <div key={work.id} className={`${styles.workCardMuted} ${styles.workCardMutedRow}`}>
                              <p className={styles.workTitle}>{work.roomName}</p>
                              <p className={styles.requirementsText}>{work.requirements || '요청사항 없음'}</p>
                            </div>
                          );
                        }

                        return (
                          <div key={work.id} className={styles.workCard}>
                            <div className={styles.workCardHeader}>
                              <p className={styles.workTitle}>{work.roomName}</p>
                              <div className={styles.workMetaRow}>
                                <p className={styles.workSubtitle}>
                                  체크아웃 {work.checkoutTime} · 체크인 {work.checkinTime}
                                </p>
                                <span className={styles.badgePositive}>청소</span>
                              </div>
                            </div>

                            <div className={styles.workRowCompact}>
                              <span>침구 {work.blanketQty}</span>
                              <span>어메니티 {work.amenitiesQty}</span>
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
                                  const term = window.prompt('배정할 직원의 휴대폰 또는 관리코드를 입력하세요.');
                                  if (!term) return;
                                  updateWork(work.id, { assignTerm: term });
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
                                      router.push('/screens/005');
                                    }
                                    return;
                                  }
                                  updateWork(work.id, { cleaningFlag: cycleCleaning(work.cleaningFlag) });
                                }}
                              >
                                {cleaningLabel}
                              </button>

                              <button
                                className={`${styles.toggleButton} ${work.supervisingEndTime ? styles.superviseOn : styles.superviseOff}`}
                                disabled={!canToggleSupervising}
                                onClick={() => {
                                  if (!work.supervisingEndTime && work.cleaningFlag === 3) {
                                    const ok = window.confirm(
                                      `${work.buildingShortName}${work.roomNo} 호실에 대하여 수퍼바이징 완료 보고를 진행하시겠습니까?`
                                    );
                                    if (ok) {
                                      router.push('/screens/005');
                                    }
                                    return;
                                  }
                                  updateWork(work.id, { supervisingDone: !work.supervisingEndTime });
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
                  const cleaningLabel = work.cleaningYn
                    ? cleaningLabels[(work.cleaningFlag || 1) - 1] ?? cleaningLabels[0]
                    : '점검';
                  const cleaningClass = work.cleaningYn ? cleaningTone(work.cleaningFlag) : styles.inspectText;

                  return (
                    <div key={work.id} className={styles.detailGridRow}>
                      <span className={!work.conditionCheckYn ? styles.mutedText : ''}>{work.roomName}</span>
                      <span>{work.checkoutTime}</span>
                      <span>{work.checkinTime}</span>
                      <span className={work.supplyYn ? styles.stateOn : styles.stateOff}>{work.supplyYn ? '완료' : '대기'}</span>
                      <span className={cleaningClass}>{cleaningLabel}</span>
                      <span className={work.supervisingEndTime ? styles.stateOn : styles.stateOff}>
                        {work.supervisingEndTime ? '완료' : '대기'}
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
                    <span>{work.checkoutTime}</span>
                    <span>{work.checkinTime}</span>
                    <span className={styles.stateOn}>완료</span>
                    <span className={styles.cleaningDone}>청소종료</span>
                    <span className={styles.stateOn}>완료</span>
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
    </div>
  );
}
