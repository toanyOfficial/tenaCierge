'use client';

import { useEffect, useMemo, useState } from 'react';
import type { FormEvent, MouseEvent } from 'react';
import { useRouter } from 'next/navigation';

import CommonHeader from '@/app/(routes)/dashboard/CommonHeader';
import type { ApplySnapshot, ApplySlot, TierRuleDisplay } from './server/getApplySnapshot';
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

type SectorGroup = {
  label: string;
  slots: ApplySlot[];
};

type DateGroup = {
  key: string;
  label: string;
  dayLabel: string;
  sectors: SectorGroup[];
  hasMine: boolean;
};

export default function ApplyClient({ profile, snapshot }: Props) {
  const router = useRouter();
  const [activeRole, setActiveRole] = useState(profile.primaryRole ?? profile.roles[0] ?? null);
  const [infoOpen, setInfoOpen] = useState(false);
  const [assignSlot, setAssignSlot] = useState<ApplySlot | null>(null);
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [statusMap, setStatusMap] = useState<Record<number, string>>({});
  const [errorMap, setErrorMap] = useState<Record<number, string>>({});
  const [openDates, setOpenDates] = useState<Set<string>>(new Set());
  const [createDate, setCreateDate] = useState(snapshot.todayKey);
  const [createSector, setCreateSector] = useState(() => {
    const first = snapshot.sectorOptions[0];
    return first ? `${first.codeGroup}__${first.code}` : '';
  });
  const [createPosition, setCreatePosition] = useState<1 | 2>(1);
  const [createStatus, setCreateStatus] = useState('');
  const [createError, setCreateError] = useState('');
  const [creating, setCreating] = useState(false);

  const slots = useMemo(() => {
    return [...snapshot.slots].sort((a, b) => {
      const dateCompare = a.workDate.localeCompare(b.workDate);
      if (dateCompare !== 0) {
        return dateCompare;
      }
      return Number(a.isButlerSlot) - Number(b.isButlerSlot);
    });
  }, [snapshot.slots]);

  const dateGroups = useMemo<DateGroup[]>(() => {
    const byDate = new Map<string, ApplySlot[]>();

    slots.forEach((slot) => {
      if (!byDate.has(slot.workDate)) {
        byDate.set(slot.workDate, []);
      }
      byDate.get(slot.workDate)!.push(slot);
    });

    return Array.from(byDate.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([dateKey, dateSlots]) => {
        const sectors = Array.from(
          dateSlots.reduce((acc, slot) => {
            const key = slot.sectorLabel || '미지정 섹터';
            if (!acc.has(key)) {
              acc.set(key, [] as ApplySlot[]);
            }
            acc.get(key)!.push(slot);
            return acc;
          }, new Map<string, ApplySlot[]>())
        )
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([label, sectorSlots]) => ({ label, slots: sectorSlots })) as SectorGroup[];

        const refSlot = dateSlots[0];
        const dayLabel = refSlot?.daysUntil === 0 ? 'D0' : `D+${refSlot?.daysUntil ?? ''}`;
        const hasMine = dateSlots.some((slot) => slot.isMine);

        return {
          key: dateKey,
          label: refSlot?.workDateLabel ?? dateKey,
          dayLabel,
          sectors,
          hasMine
        } satisfies DateGroup;
      });
  }, [slots]);

  useEffect(() => {
    setOpenDates(new Set(dateGroups.map((group) => group.key)));
  }, [dateGroups]);

  useEffect(() => {
    const first = snapshot.sectorOptions[0];
    if (first) {
      setCreateSector(`${first.codeGroup}__${first.code}`);
    }
    setCreateDate(snapshot.todayKey);
  }, [snapshot.sectorOptions, snapshot.todayKey]);

  const guard = snapshot.guardMessage;
  const penaltyNotice = snapshot.penaltyMessage;
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

  async function handleCreateSlot(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreateStatus('');
    setCreateError('');
    setCreating(true);

    const sector = snapshot.sectorOptions.find((option) => `${option.codeGroup}__${option.code}` === createSector);

    if (!sector) {
      setCreateError('섹터를 선택해 주세요.');
      setCreating(false);
      return;
    }

    try {
      const response = await fetch('/api/work-apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workDate: createDate,
          sectorCode: sector.codeGroup,
          sectorValue: sector.code,
          position: createPosition
        })
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setCreateError(data.message || '슬롯 생성 중 오류가 발생했습니다.');
        return;
      }

      setCreateStatus(data.message || '슬롯이 추가되었습니다.');
      router.refresh();
    } catch (error) {
      setCreateError('슬롯 생성 중 오류가 발생했습니다.');
    } finally {
      setCreating(false);
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

  async function handleDelete(slot: ApplySlot) {
    if (slot.isTaken) {
      setErrorMap((prev) => ({ ...prev, [slot.id]: '신청이 완료된 슬롯은 삭제할 수 없습니다.' }));
      return;
    }

    if (!window.confirm('해당 슬롯을 삭제하시겠습니까?')) {
      return;
    }

    setPendingId(slot.id);
    setStatusMap((prev) => ({ ...prev, [slot.id]: '' }));
    setErrorMap((prev) => ({ ...prev, [slot.id]: '' }));

    try {
      const response = await fetch(`/api/work-apply/${slot.id}`, { method: 'DELETE' });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setErrorMap((prev) => ({ ...prev, [slot.id]: data.message || '슬롯 삭제 중 오류가 발생했습니다.' }));
        return;
      }

      setStatusMap((prev) => ({ ...prev, [slot.id]: data.message || '슬롯이 삭제되었습니다.' }));
      router.refresh();
    } catch (error) {
      setErrorMap((prev) => ({ ...prev, [slot.id]: '슬롯 삭제 중 오류가 발생했습니다.' }));
    } finally {
      setPendingId(null);
    }
  }

  function renderButton(slot: ApplySlot, locked = false) {
    const isPending = pendingId === slot.id;

    if (locked && !slot.isMine) {
      return (
        <button type="button" className={styles.applyGhostButton} disabled>
          신청불가
        </button>
      );
    }

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

  function renderHelper(slot: ApplySlot, locked = false) {
    if (locked) {
      return <p className={styles.applyHint}>같은 날짜에는 한 건만 신청할 수 있습니다.</p>;
    }
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

  function toggleDate(key: string) {
    setOpenDates((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
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
        compact
      />

      <section className={styles.applySection}>
        <header className={styles.applyHeader}>
          <div>
            <p className={styles.applyLabel}>화면 003 · 업무신청</p>
            <h1 className={styles.applyTitle}>{snapshot.tierMessage}</h1>
          </div>
          <div className={styles.applyActions}>
            <button type="button" className={styles.infoButton} onClick={() => setInfoOpen(true)}>
              설명보기
            </button>
          </div>
        </header>

        {snapshot.isAdmin ? (
          <div className={styles.applyAdminCreate}>
            <div>
              <p className={styles.applyLabel}>관리자 전용</p>
              <h2 className={styles.applyAdminTitle}>업무 신청 슬롯 수기 추가</h2>
              <p className={styles.applyAdminHint}>날짜·섹터·포지션을 선택해 슬롯을 생성합니다. 생성 후 신청/배정 처리해 주세요.</p>
            </div>
            <form className={styles.applyAdminForm} onSubmit={handleCreateSlot}>
              <label className={styles.applyAdminField}>
                <span>날짜</span>
                <input type="date" value={createDate} onChange={(event) => setCreateDate(event.target.value)} />
              </label>
              <label className={styles.applyAdminField}>
                <span>섹터</span>
                <select value={createSector} onChange={(event) => setCreateSector(event.target.value)}>
                  {snapshot.sectorOptions.map((option) => (
                    <option key={`${option.codeGroup}-${option.code}`} value={`${option.codeGroup}__${option.code}`}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className={styles.applyAdminField}>
                <span>포지션</span>
                <select
                  value={createPosition}
                  onChange={(event) => setCreatePosition(event.target.value === '2' ? 2 : 1)}
                >
                  <option value={1}>클리너</option>
                  <option value={2}>버틀러</option>
                </select>
              </label>
              <button type="submit" className={styles.applyButton} disabled={creating || !snapshot.sectorOptions.length}>
                {creating ? '생성 중...' : '슬롯 생성'}
              </button>
              {createStatus ? <p className={styles.applyStatus}>{createStatus}</p> : null}
              {createError ? <p className={styles.applyError}>{createError}</p> : null}
            </form>
          </div>
        ) : null}

        <p className={styles.applyWindow}>{snapshot.applyWindowHint}</p>
        {guard ? <p className={styles.guardNotice}>{guard}</p> : null}
        {penaltyNotice && !guard ? <p className={styles.guardNotice}>{penaltyNotice}</p> : null}
        {disabledMessage && !guard ? <p className={styles.guardNotice}>현재 시각에는 신청 버튼이 비활성화됩니다. ({disabledMessage})</p> : null}

        {snapshot.hasAccess && !guard ? (
          dateGroups.length ? (
            <div className={styles.applyCardStack}>
              {dateGroups.map((group) => {
                const isOpen = openDates.has(group.key);
                return (
                  <article key={group.key} className={styles.applyCard}>
                    <header className={styles.applyCardHead}>
                      <div>
                        <p className={styles.applyDate}>{group.label}</p>
                        <span className={styles.applyDay}>{group.dayLabel}</span>
                      </div>
                      <button type="button" className={styles.collapseButton} onClick={() => toggleDate(group.key)}>
                        {isOpen ? '접기' : '펼치기'}
                      </button>
                    </header>
                    {isOpen ? (
                      <div className={styles.applyCardBody}>
                        {group.sectors.map((sector) => (
                          <div key={`${group.key}-${sector.label}`} className={styles.applySectorGroup}>
                            <header className={styles.applySectorHead}>
                              <p className={styles.applySector}>{sector.label}</p>
                              <span className={styles.applySlotCount}>{sector.slots.length}건</span>
                            </header>
                            <ul className={styles.applySlotList}>
                              {sector.slots.map((slot) => {
                                const takenByOther = slot.isTaken && !slot.isMine;
                                const locked = !snapshot.isAdmin && group.hasMine && !slot.isMine;
                                return (
                                  <li
                                    key={slot.id}
                                    className={`${styles.applySlot} ${takenByOther ? styles.applySlotTaken : ''} ${
                                      slot.isMine ? styles.applySlotMine : ''
                                    } ${locked ? styles.applySlotLocked : ''}`}
                                  >
                                    <div className={styles.applySlotMeta}>
                                      <span className={slot.isButlerSlot ? styles.positionButler : styles.positionCleaner}>
                                        {slot.positionLabel}
                                      </span>
                                      {slot.isTaken ? (
                                        <span className={styles.applyAssignee}>
                                          {slot.isMine ? '내 신청' : slot.assignedWorkerName || '신청완료'}
                                        </span>
                                      ) : null}
                                    </div>
                                    <div className={styles.applySlotAction}>
                                      {renderButton(slot, locked)}
                                      {snapshot.isAdmin ? (
                                        <button
                                          type="button"
                                          className={styles.applyDeleteButton}
                                          disabled={pendingId === slot.id || slot.isTaken}
                                          onClick={() => handleDelete(slot)}
                                        >
                                          삭제
                                        </button>
                                      ) : null}
                                    </div>
                                    <div className={styles.applySlotHelper}>{renderHelper(slot, locked)}</div>
                                  </li>
                                );
                              })}
                            </ul>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          ) : (
            <p className={styles.emptyMessage}>{emptyMessage ?? '표시할 신청 가능 업무가 없습니다.'}</p>
          )
        ) : null}
      </section>

      {infoOpen ? <InfoModal rules={snapshot.tierRules} onClose={() => setInfoOpen(false)} /> : null}
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

function InfoModal({ rules, onClose }: { rules: TierRuleDisplay[]; onClose: () => void }) {
  function handleBackdropClick(event: MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) {
      onClose();
    }
  }

  return (
    <div className={styles.modalBackdrop} role="dialog" aria-modal="true" onClick={handleBackdropClick}>
      <div className={styles.modalCard}>
        <header className={styles.modalHead}>
          <h2>랭크 안내</h2>
          <button type="button" onClick={onClose} aria-label="닫기">
            ×
          </button>
        </header>
        <div className={`${styles.modalBody} ${styles.modalScrollable}`}>
          <p className={styles.modalIntro}>
            최근 20일간 업무평가 점수를 합산해 매일 16:30에 랭크를 재조정합니다. 신청 후 취소 시 ((7-남은날짜) X 2)점
            감점이 부과됩니다.
          </p>
          <ul className={styles.ruleList}>
            {rules.map((rule) => (
              <li key={rule.tier} className={styles.ruleItem}>
                <div className={styles.ruleHead}>
                  <strong>{rule.tierLabel}</strong>
                  <span>{rule.rangeLabel}</span>
                </div>
                <dl className={styles.ruleFacts}>
                  <div>
                    <dt>신청 가능 시간</dt>
                    <dd>{rule.applyStartLabel} 이후</dd>
                  </div>
                  <div>
                    <dt>신청 가능 범위</dt>
                    <dd>D+{rule.horizonDays}</dd>
                  </div>
                  {rule.hourlyWage ? (
                    <div>
                      <dt>시급</dt>
                      <dd>{rule.hourlyWage.toLocaleString()}원</dd>
                    </div>
                  ) : null}
                  {rule.comment ? (
                    <div>
                      <dt>비고</dt>
                      <dd>{rule.comment}</dd>
                    </div>
                  ) : null}
                </dl>
              </li>
            ))}
          </ul>
        </div>
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

  function handleBackdropClick(event: MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) {
      onClose();
    }
  }

  return (
    <div className={styles.modalBackdrop} role="dialog" aria-modal="true" onClick={handleBackdropClick}>
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
            placeholder="이름 · 휴대전화 · 관리코드를 입력하세요"
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
