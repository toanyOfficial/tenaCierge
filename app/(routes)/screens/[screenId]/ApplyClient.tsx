'use client';

import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useRouter } from 'next/navigation';

import CommonHeader from '@/app/(routes)/dashboard/CommonHeader';
import type { ApplySnapshot, ApplySlot } from './server/getApplySnapshot';
import styles from './screens.module.css';
import type { ProfileSummary } from '@/src/utils/profile';

interface WorkerOption {
  id: number;
  name: string;
  phone: string | null;
  registerCode: string;
  tier: number;
  tierLabel: string;
}

type Props = {
  profile: ProfileSummary;
  snapshot: ApplySnapshot;
};

export default function ApplyClient({ profile, snapshot }: Props) {
  const router = useRouter();
  const [activeRole, setActiveRole] = useState(profile.primaryRole ?? profile.roles[0] ?? null);
  const [infoOpen, setInfoOpen] = useState(false);
  const [assignSlot, setAssignSlot] = useState<ApplySlot | null>(null);
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [statusMap, setStatusMap] = useState<Record<number, string>>({});
  const [errorMap, setErrorMap] = useState<Record<number, string>>({});

  const slots = useMemo(() => {
    return [...snapshot.slots].sort((a, b) => {
      const dateCompare = a.workDate.localeCompare(b.workDate);
      if (dateCompare !== 0) {
        return dateCompare;
      }
      return Number(a.isButlerSlot) - Number(b.isButlerSlot);
    });
  }, [snapshot.slots]);

  const guard = snapshot.guardMessage;
  const disabledMessage = !snapshot.isAdmin && !snapshot.canApplyNow ? snapshot.applyStartLabel : null;
  const emptyMessage = snapshot.hasAccess && slots.length === 0 ? '표시할 신청 가능 업무가 없습니다.' : null;

  async function persistRole(role: string) {
    try {
      await fetch('/api/role', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role })
      });
    } catch (error) {
      console.error('역할 저장 중 오류', error);
    }
  }

  async function handleAction(slot: ApplySlot, action: 'apply' | 'cancel', workerId?: number) {
    setPendingId(slot.id);
    setStatusMap((prev) => ({ ...prev, [slot.id]: '' }));
    setErrorMap((prev) => ({ ...prev, [slot.id]: '' }));

    try {
      const response = await fetch(`/api/work-apply/${slot.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, workerId })
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setErrorMap((prev) => ({ ...prev, [slot.id]: data.message || '처리 중 오류가 발생했습니다.' }));
        return;
      }

      setStatusMap((prev) => ({ ...prev, [slot.id]: data.message || '처리가 완료되었습니다.' }));
      router.refresh();
    } catch (error) {
      setErrorMap((prev) => ({ ...prev, [slot.id]: '요청 중 오류가 발생했습니다.' }));
    } finally {
      setPendingId(null);
    }
  }

  function handleSelfApply(slot: ApplySlot) {
    handleAction(slot, 'apply');
  }

  function handleSelfCancel(slot: ApplySlot) {
    if (window.confirm('신청을 취소하시겠습니까? ((7-남은날짜) X 2) 감점이 부과됩니다.')) {
      handleAction(slot, 'cancel');
    }
  }

  function handleAdminAssign(slot: ApplySlot) {
    setAssignSlot(slot);
  }

  function handleAdminCancel(slot: ApplySlot) {
    const name = slot.assignedWorkerName ?? '해당 작업자';
    if (window.confirm(`${name}님의 신청을 취소하시겠습니까?`)) {
      handleAction(slot, 'cancel');
    }
  }

  function renderButton(slot: ApplySlot) {
    const isPending = pendingId === slot.id;

    if (slot.isMine) {
      return (
        <button type="button" className={styles.applyButton} disabled={isPending} onClick={() => handleSelfCancel(slot)}>
          {isPending ? '처리 중...' : '신청취소'}
        </button>
      );
    }

    if (!slot.isTaken) {
      if (snapshot.isAdmin) {
        return (
          <button type="button" className={styles.applyButton} disabled={isPending} onClick={() => handleAdminAssign(slot)}>
            {isPending ? '처리 중...' : '신청하기'}
          </button>
        );
      }

      return (
        <button type="button" className={styles.applyButton} disabled={!slot.canApply || isPending} onClick={() => handleSelfApply(slot)}>
          {isPending ? '처리 중...' : '신청하기'}
        </button>
      );
    }

    const label = slot.assignedWorkerName || '다른 작업자';

    if (snapshot.isAdmin) {
      return (
        <button type="button" className={styles.applyGhostButton} disabled={isPending} onClick={() => handleAdminCancel(slot)}>
          {isPending ? '처리 중...' : label}
        </button>
      );
    }

    return (
      <button type="button" className={styles.applyGhostButton} disabled>
        {label}
      </button>
    );
  }

  function renderHelper(slot: ApplySlot) {
    if (statusMap[slot.id]) {
      return <p className={styles.applyStatus}>{statusMap[slot.id]}</p>;
    }

    if (errorMap[slot.id]) {
      return <p className={styles.applyError}>{errorMap[slot.id]}</p>;
    }

    if (!slot.isMine && !slot.isTaken && !snapshot.isAdmin && !slot.canApply && slot.disabledReason) {
      return <p className={styles.applyHint}>{slot.disabledReason}</p>;
    }

    if (slot.isTaken && !snapshot.isAdmin) {
      return <p className={styles.applyHint}>이미 배정된 일정입니다.</p>;
    }

    return null;
  }

  return (
    <div className={styles.screenShell}>
      <CommonHeader
        profile={profile}
        activeRole={activeRole}
        onRoleChange={(role) => {
          setActiveRole(role);
          persistRole(role);
        }}
      />

      <section className={styles.applySection}>
        <header className={styles.applyHeader}>
          <div>
            <p className={styles.applyLabel}>화면 003 · 업무신청</p>
            <h1 className={styles.applyTitle}>{snapshot.tierMessage}</h1>
          </div>
          <div className={styles.applyActions}>
            <span className={styles.applyBadge}>{snapshot.applyStartLabel}</span>
            <button type="button" className={styles.infoButton} onClick={() => setInfoOpen(true)}>
              설명보기
            </button>
          </div>
        </header>

        <p className={styles.applyWindow}>{snapshot.applyWindowHint}</p>
        {guard ? <p className={styles.guardNotice}>{guard}</p> : null}
        {disabledMessage && !guard ? <p className={styles.guardNotice}>현재 시각에는 신청 버튼이 비활성화됩니다. ({disabledMessage})</p> : null}

        {snapshot.hasAccess && !guard ? (
          <div className={styles.applyGrid}>
            <div className={styles.applyGridHead}>
              <span>일자</span>
              <span>섹터</span>
              <span>포지션</span>
              <span>신청</span>
            </div>
            {slots.map((slot) => (
              <article key={slot.id} className={styles.applyRow}>
                <div className={styles.applyCell}>
                  <p className={styles.applyDate}>{slot.workDateLabel}</p>
                  <span className={styles.applyDay}>{slot.daysUntil === 0 ? 'D0' : `D+${slot.daysUntil}`}</span>
                </div>
                <div className={styles.applyCell}>
                  <p className={styles.applySector}>{slot.sectorLabel}</p>
                </div>
                <div className={styles.applyCell}>
                  <span className={slot.isButlerSlot ? styles.positionButler : styles.positionCleaner}>{slot.positionLabel}</span>
                </div>
                <div className={styles.applyCell}>
                  {renderButton(slot)}
                  {renderHelper(slot)}
                </div>
              </article>
            ))}
            {emptyMessage ? <p className={styles.emptyMessage}>{emptyMessage}</p> : null}
          </div>
        ) : null}
      </section>

      {infoOpen ? <InfoModal text={snapshot.infoText} onClose={() => setInfoOpen(false)} /> : null}
      {assignSlot ? (
        <WorkerAssignModal
          slot={assignSlot}
          onClose={() => setAssignSlot(null)}
          onSelect={(worker) => {
            handleAction(assignSlot, 'apply', worker.id);
            setAssignSlot(null);
          }}
        />
      ) : null}
    </div>
  );
}

function InfoModal({ text, onClose }: { text: string; onClose: () => void }) {
  return (
    <div className={styles.modalBackdrop} role="dialog" aria-modal="true">
      <div className={styles.modalCard}>
        <header className={styles.modalHead}>
          <h2>랭크 안내</h2>
          <button type="button" onClick={onClose} aria-label="닫기">
            ×
          </button>
        </header>
        <pre className={styles.modalBody}>{text}</pre>
        <div className={styles.modalFoot}>
          <button type="button" onClick={onClose} className={styles.infoButton}>
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}

function WorkerAssignModal({ slot, onClose, onSelect }: { slot: ApplySlot; onClose: () => void; onSelect: (worker: WorkerOption) => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<WorkerOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError('');
    setResults([]);

    try {
      const response = await fetch(`/api/workers/search?q=${encodeURIComponent(query)}`);
      const data = await response.json();
      if (!response.ok) {
        setError(data.message || '검색 중 오류가 발생했습니다.');
        return;
      }
      setResults(data.results ?? []);
    } catch (err) {
      setError('검색 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.modalBackdrop} role="dialog" aria-modal="true">
      <div className={styles.modalCard}>
        <header className={styles.modalHead}>
          <h2>배정할 작업자 선택</h2>
          <button type="button" onClick={onClose} aria-label="닫기">
            ×
          </button>
        </header>
        <p className={styles.modalSub}>[{slot.workDateLabel}] {slot.sectorLabel} · {slot.positionLabel}</p>
        <form className={styles.workerSearch} onSubmit={handleSearch}>
          <input
            type="text"
            placeholder="휴대전화 또는 관리코드를 입력하세요"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <button type="submit" disabled={!query.trim() || loading}>
            {loading ? '검색 중...' : '검색'}
          </button>
        </form>
        {error ? <p className={styles.applyError}>{error}</p> : null}
        <ul className={styles.workerList}>
          {results.map((worker) => (
            <li key={worker.id}>
              <button type="button" onClick={() => onSelect(worker)}>
                <div>
                  <strong>{worker.name}</strong> <span>({worker.tierLabel})</span>
                </div>
                <p>{worker.phone || '전화번호 미등록'}</p>
                <small>관리코드 {worker.registerCode}</small>
              </button>
            </li>
          ))}
          {!loading && results.length === 0 && !error ? (
            <li className={styles.workerEmpty}>검색 결과가 없습니다.</li>
          ) : null}
        </ul>
      </div>
    </div>
  );
}
