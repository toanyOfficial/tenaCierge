'use client';

import { useMemo, useState } from 'react';
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

  const canSee = useMemo(
    () => ['admin', 'butler', 'host', 'cleaner'].some((role) => activeRole === role),
    [activeRole]
  );

  const canToggleSupply = activeRole === 'admin' || activeRole === 'butler';
  const canToggleCleaning = activeRole === 'admin' || activeRole === 'butler' || activeRole === 'cleaner';
  const canToggleSupervising = activeRole === 'admin' || activeRole === 'butler';
  const canAssignCleaner = canToggleSupervising;

  function handleDateChange(next: string) {
    const search = new URLSearchParams(params?.toString() ?? '');
    if (next) {
      search.set('date', next);
    } else {
      search.delete('date');
    }
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
            <label className={styles.fieldLabel}>
              날짜 선택
              <input
                type="date"
                className={styles.dateInput}
                defaultValue={snapshot.targetDate}
                onChange={(e) => handleDateChange(e.target.value)}
              />
            </label>
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
            {works.map((work) => {
              const cleaningLabel = cleaningLabels[(work.cleaningFlag || 1) - 1] ?? cleaningLabels[0];
              const supervisingLabel = work.supervisingEndTime ? '검수완료' : '검수대기';
              const disabledLine = !work.cleaningYn;

              return (
                <div key={work.id} className={styles.workCard}>
                  <div className={styles.workCardHeader}>
                    <p className={styles.workTitle}>{work.roomName}</p>
                    <div className={styles.workMetaRow}>
                      <p className={styles.workSubtitle}>
                        체크아웃 {work.checkoutTime} · 체크인 {work.checkinTime}
                      </p>
                      {disabledLine ? <span className={styles.badgeMuted}>청소없음</span> : null}
                    </div>
                  </div>

                  <div className={styles.workRowCompact}>
                    <span>침구 {work.blanketQty}</span>
                    <span>어메니티 {work.amenitiesQty}</span>
                  </div>

                  <p className={styles.requirementsText}>{work.requirements || '요청사항 없음'}</p>

                  <div className={styles.workRowCompact}>
                    <button
                      className={canToggleSupply ? styles.toggleButton : styles.toggleButtonDisabled}
                      disabled={!canToggleSupply}
                      onClick={() => updateWork(work.id, { supplyYn: !work.supplyYn })}
                    >
                      배급 {work.supplyYn ? '완료' : '대기'}
                    </button>

                    <button
                      className={canToggleCleaning ? styles.toggleButton : styles.toggleButtonDisabled}
                      disabled={!canToggleCleaning}
                      onClick={() => updateWork(work.id, { cleaningFlag: cycleCleaning(work.cleaningFlag) })}
                    >
                      {cleaningLabel}
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
                      담당자 {work.cleanerName || '미지정'}
                    </button>

                    <button
                      className={canToggleSupervising ? styles.toggleButton : styles.toggleButtonDisabled}
                      disabled={!canToggleSupervising}
                      onClick={() => updateWork(work.id, { supervisingDone: !work.supervisingEndTime })}
                    >
                      {supervisingLabel}
                    </button>
                  </div>

                  {disabledLine ? <p className={styles.helper}>상태 확인만 필요한 객실입니다.</p> : null}
                </div>
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
            <div className={styles.detailGridHeader}>
              <span>호실</span>
              <span>쳌아웃</span>
              <span>체크인</span>
              <span>배급</span>
              <span>청소</span>
              <span>담당자</span>
            </div>
            <div className={styles.detailGridBody}>
              {works.map((work) => (
                <div key={work.id} className={styles.detailGridRow}>
                  <span className={!work.conditionCheckYn ? styles.mutedText : ''}>{work.roomName}</span>
                  <span>{work.checkoutTime}</span>
                  <span>{work.checkinTime}</span>
                  <span>{work.supplyYn ? '완료' : '대기'}</span>
                  <span>{cleaningLabels[(work.cleaningFlag || 1) - 1] ?? cleaningLabels[0]}</span>
                  <span>{work.cleanerName || '-'}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
