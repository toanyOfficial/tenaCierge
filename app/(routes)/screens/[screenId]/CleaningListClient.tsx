'use client';

import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';

import CommonHeader from '@/app/(routes)/dashboard/CommonHeader';
import type { CleaningSnapshot, RoomOption } from './server/getCleaningSnapshot';
import styles from './screens.module.css';

import type { ProfileSummary } from '@/src/utils/profile';
import type { CleaningWork } from '@/src/server/workTypes';
import { addMinutes, minutesToTimeString, parseTimeString } from '@/src/utils/time';

type Props = {
  profile: ProfileSummary;
  snapshot: CleaningSnapshot;
};

type WorkField = keyof Pick<
  CleaningWork,
  'checkoutTime' | 'checkinTime' | 'blanketQty' | 'amenitiesQty' | 'cancelYn' | 'requirements'
>;

type AddFormState = {
  roomId: number | '';
  checkoutTime: string;
  checkinTime: string;
  blanketQty: number;
  amenitiesQty: number;
  requirements: string;
};

export default function CleaningListClient({ profile, snapshot }: Props) {
  const initialRole = profile.primaryRole ?? profile.roles[0] ?? null;
  const [activeRole, setActiveRole] = useState(initialRole);
  const [works, setWorks] = useState(() => sortWorks(snapshot.works));
  const [baseline, setBaseline] = useState(() => sortWorks(snapshot.works));
  const [savingIds, setSavingIds] = useState<number[]>([]);
  const [statusMap, setStatusMap] = useState<Record<number, string>>({});
  const [errorMap, setErrorMap] = useState<Record<number, string>>({});
  const [isAdding, setIsAdding] = useState(false);
  const [addStatus, setAddStatus] = useState('');
  const [addError, setAddError] = useState('');
  const [isAddOpen, setIsAddOpen] = useState(false);

  const viewingAsHost = activeRole === 'host';
  const viewingAsAdmin = activeRole === 'admin';
  const viewingAsButler = activeRole === 'butler';
  const canSeeList = viewingAsHost || viewingAsAdmin || viewingAsButler;
  const canEdit = viewingAsAdmin || (viewingAsHost && snapshot.hostCanEdit);
  const canEditRequirements = viewingAsAdmin;
  const canAdd = viewingAsAdmin || (viewingAsHost && snapshot.hostCanAdd);

  const roomOptions = useMemo(() => {
    if (viewingAsAdmin && snapshot.adminRoomOptions.length > 0) {
      return snapshot.adminRoomOptions;
    }

    if (viewingAsHost) {
      return snapshot.hostRoomOptions;
    }

    if (viewingAsAdmin) {
      return snapshot.hostRoomOptions;
    }

    return [];
  }, [snapshot.adminRoomOptions, snapshot.hostRoomOptions, viewingAsAdmin, viewingAsHost]);

  const [addForm, setAddForm] = useState<AddFormState>(() => createAddFormState(roomOptions[0] ?? null));

  useEffect(() => {
    if (!roomOptions.length) {
      setAddForm(createAddFormState(null));
      setIsAddOpen(false);
      return;
    }

    setAddForm((prev) => {
      if (prev.roomId && roomOptions.some((room) => room.roomId === prev.roomId)) {
        return prev;
      }

      return createAddFormState(roomOptions[0]);
    });
  }, [roomOptions]);

  useEffect(() => {
    if (!isAddOpen) {
      setAddStatus('');
      setAddError('');
    }
  }, [isAddOpen]);

  const visibleWorks = useMemo(() => {
    if (viewingAsHost) {
      return works.filter((work) => snapshot.hostRoomIds.includes(work.roomId));
    }

    if (viewingAsAdmin || viewingAsButler) {
      return works;
    }

    return [];
  }, [viewingAsHost, viewingAsAdmin, viewingAsButler, works, snapshot.hostRoomIds]);

  const batchingOnly = snapshot.window === 'batching' && !viewingAsAdmin;
  const hostRestrictionMessage = viewingAsHost
    ? snapshot.hostCanEdit
      ? '15:00~16:00 구간에서는 체크아웃/체크인·소모품 정보를 직접 조정할 수 있습니다.'
      : '현재 시간에는 호스트 수정이 제한됩니다. (15:00~16:00 허용)'
    : null;

  const roleGuardMessage = !canSeeList
    ? '화면 002는 Host, Butler, Admin 역할에게만 제공됩니다. 역할을 변경해 주세요.'
    : null;

  const windowLabel = buildWindowLabel(snapshot.window);

  function handleFieldChange(id: number, field: WorkField, value: string | number | boolean) {
    setWorks((prev) => prev.map((work) => (work.id === id ? { ...work, [field]: value } : work)));
  }

  function handleNumberChange(
    id: number,
    field: Extract<WorkField, 'blanketQty' | 'amenitiesQty'>,
    nextValue: number,
    min: number,
    max: number
  ) {
    const clamped = clampNumber(nextValue, min, max);
    handleFieldChange(id, field, clamped);
  }

  function handleTimeChange(
    id: number,
    field: Extract<WorkField, 'checkoutTime' | 'checkinTime'>,
    nextValue: string,
    bounds: { min: string; max: string }
  ) {
    const clamped = clampTime(nextValue, bounds.min, bounds.max);
    handleFieldChange(id, field, clamped);
  }

  async function handleSave(workId: number) {
    const work = works.find((entry) => entry.id === workId);

    if (!work) {
      return;
    }

    setSavingIds((prev) => [...prev, workId]);
    setStatusMap((prev) => ({ ...prev, [workId]: '' }));
    setErrorMap((prev) => ({ ...prev, [workId]: '' }));

    try {
      const response = await fetch(`/api/works/${workId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          checkoutTime: work.checkoutTime,
          checkinTime: work.checkinTime,
          blanketQty: work.blanketQty,
          amenitiesQty: work.amenitiesQty,
          cancelYn: work.cancelYn,
          requirements: work.requirements
        })
      });

      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload?.message ?? '저장에 실패했습니다.');
      }

      const updated = payload.work as CleaningWork;
      setWorks((prev) => prev.map((entry) => (entry.id === workId ? updated : entry)));
      setBaseline((prev) => prev.map((entry) => (entry.id === workId ? updated : entry)));
      setStatusMap((prev) => ({ ...prev, [workId]: '저장되었습니다.' }));
    } catch (error) {
      setErrorMap((prev) => ({
        ...prev,
        [workId]: error instanceof Error ? error.message : '저장 중 오류가 발생했습니다.'
      }));
    } finally {
      setSavingIds((prev) => prev.filter((entry) => entry !== workId));
    }
  }

  function handleRoleChange(nextRole: string) {
    if (profile.roles.includes(nextRole)) {
      setActiveRole(nextRole);
    }
  }

  const addRoom = roomOptions.find((room) => room.roomId === addForm.roomId) ?? roomOptions[0] ?? null;
  const addBlanketBounds = addRoom ? getBlanketBounds(addRoom) : { min: 0, max: 0 };
  const addAmenitiesBounds = addRoom ? getAmenitiesBounds(addRoom) : { min: 0, max: 0 };
  const addCheckoutBounds = addRoom ? getCheckoutBounds(addRoom) : { min: '00:00', max: '00:00' };
  const addCheckinBounds = addRoom ? getCheckinBounds(addRoom) : { min: '00:00', max: '00:00' };

  async function handleAddSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!canAdd || !addRoom) {
      return;
    }

    setIsAdding(true);
    setAddStatus('');
    setAddError('');

    try {
      const response = await fetch('/api/works', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomId: addForm.roomId,
          checkoutTime: addForm.checkoutTime,
          checkinTime: addForm.checkinTime,
          blanketQty: addForm.blanketQty,
          amenitiesQty: addForm.amenitiesQty,
          requirements: addForm.requirements
        })
      });

      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload?.message ?? '작업 추가에 실패했습니다.');
      }

      const created = payload.work as CleaningWork;
      setWorks((prev) => [...prev, created]);
      setBaseline((prev) => [...prev, created]);
      setAddStatus('새 작업이 생성되었습니다.');
      setAddForm(createAddFormState(addRoom));
    } catch (error) {
      setAddError(error instanceof Error ? error.message : '작업 생성 중 오류가 발생했습니다.');
    } finally {
      setIsAdding(false);
    }
  }

  return (
    <div className={styles.screenShell}>
      <CommonHeader profile={profile} activeRole={activeRole} onRoleChange={handleRoleChange} />

      <section className={styles.cleaningSection} data-screen-id="002">
        <header className={styles.sectionHeader}>
          <div>
            <p className={styles.sectionLabel}>화면 002 · cleaning list</p>
            <h1 className={styles.sectionTitle}>청소리스트</h1>
          </div>
          <div className={styles.windowMeta}>
            <span className={styles.windowBadge}>{snapshot.targetTag}</span>
            <span className={styles.windowDate}>{snapshot.targetDateLabel}</span>
            <span className={styles.windowState}>{windowLabel}</span>
          </div>
        </header>

        {roleGuardMessage ? <p className={styles.notice}>{roleGuardMessage}</p> : null}
        {snapshot.message ? <p className={styles.notice}>{snapshot.message}</p> : null}
        {hostRestrictionMessage ? <p className={styles.subtle}>{hostRestrictionMessage}</p> : null}

        {canSeeList && !batchingOnly ? (
          <>
            <div className={styles.cardGrid}>
              {visibleWorks.map((work) => {
                const checkoutBounds = getCheckoutBounds(work);
                const checkinBounds = getCheckinBounds(work);
                const blanketBounds = getBlanketBounds(work);
                const amenitiesBounds = getAmenitiesBounds(work);
                const isSaving = savingIds.includes(work.id);
                const hasChanges = isWorkDirty(work, baseline);

                return (
                  <article key={work.id} className={styles.workCard}>
                    <header className={styles.workCardHeader}>
                      <div>
                        <p className={styles.workTitle}>{work.roomName}</p>
                        <p className={styles.workSubtitle}>{work.buildingName}</p>
                      </div>
                      <div className={styles.workHeaderActions}>
                        <span className={work.cancelYn ? styles.badgeDanger : styles.badgeMuted}>
                          {work.cancelYn ? '취소됨' : '예약 유지'}
                        </span>
                        {canEdit ? (
                          <button
                            type="button"
                            className={styles.cancelButton}
                            onClick={() => handleFieldChange(work.id, 'cancelYn', !work.cancelYn)}
                          >
                            {work.cancelYn ? '예약 복구' : '취소하기'}
                          </button>
                        ) : null}
                      </div>
                    </header>

                    <div className={styles.workFields}>
                      <FieldRow label="체크아웃" description={`기준 ${checkoutBounds.min} ~ 최대 ${checkoutBounds.max}`}>
                        <input
                          type="time"
                          value={work.checkoutTime}
                          min={checkoutBounds.min}
                          max={checkoutBounds.max}
                          disabled={!canEdit}
                          onChange={(event) =>
                            handleTimeChange(work.id, 'checkoutTime', event.target.value, checkoutBounds)
                          }
                        />
                      </FieldRow>
                      <FieldRow label="체크인" description={`최소 ${checkinBounds.min} ~ 기준 ${checkinBounds.max}`}>
                        <input
                          type="time"
                          value={work.checkinTime}
                          min={checkinBounds.min}
                          max={checkinBounds.max}
                          disabled={!canEdit}
                          onChange={(event) => handleTimeChange(work.id, 'checkinTime', event.target.value, checkinBounds)}
                        />
                      </FieldRow>
                      <FieldRow label="침구 수량" description={`${blanketBounds.min}~${blanketBounds.max}세트`}>
                        <QuantityStepper
                          value={work.blanketQty}
                          min={blanketBounds.min}
                          max={blanketBounds.max}
                          disabled={!canEdit}
                          onChange={(next) => handleNumberChange(work.id, 'blanketQty', next, blanketBounds.min, blanketBounds.max)}
                        />
                      </FieldRow>
                      <FieldRow label="편의물품" description={`${amenitiesBounds.min}~${amenitiesBounds.max}세트`}>
                        <QuantityStepper
                          value={work.amenitiesQty}
                          min={amenitiesBounds.min}
                          max={amenitiesBounds.max}
                          disabled={!canEdit}
                          onChange={(next) =>
                            handleNumberChange(work.id, 'amenitiesQty', next, amenitiesBounds.min, amenitiesBounds.max)
                          }
                        />
                      </FieldRow>
                      <FieldRow label="요청사항" description={canEditRequirements ? '255자 이내 수정 가능' : '열람 전용'}>
                        <textarea
                          value={work.requirements}
                          readOnly={!canEditRequirements}
                          aria-readonly={!canEditRequirements}
                          onChange={(event) => handleFieldChange(work.id, 'requirements', event.target.value.slice(0, 255))}
                        />
                      </FieldRow>
                    </div>

                    <div className={styles.cardActions}>
                      <button type="button" onClick={() => handleSave(work.id)} disabled={!canEdit || isSaving || !hasChanges}>
                        {isSaving ? '저장 중...' : '저장'}
                      </button>
                      <div className={styles.cardStatus}>
                        {statusMap[work.id] ? <span className={styles.statusOk}>{statusMap[work.id]}</span> : null}
                        {errorMap[work.id] ? <span className={styles.statusError}>{errorMap[work.id]}</span> : null}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
            {visibleWorks.length === 0 ? <p className={styles.emptyState}>표시할 작업이 없습니다.</p> : null}
          </>
        ) : null}

        {batchingOnly && canSeeList ? (
          <div className={styles.noticeCard}>익일 과업지시서를 작성중입니다. 잠시 후 다시 확인해 주세요.</div>
        ) : null}

        {canAdd && roomOptions.length > 0 ? (
          <div className={styles.addSection}>
            <button
              type="button"
              className={styles.addTrigger}
              onClick={() => setIsAddOpen((prev) => !prev)}
            >
              <span aria-hidden="true">+</span>
              <span>{isAddOpen ? '작업 추가 닫기' : '작업 추가'}</span>
            </button>
            {isAddOpen ? (
              <form className={styles.addForm} onSubmit={handleAddSubmit}>
                <p className={styles.subtle}>본인이 운영 중인 객실만 선택할 수 있습니다.</p>
                <label className={styles.formControl}>
                  <span>객실</span>
                  <select
                    value={addForm.roomId ? String(addForm.roomId) : ''}
                    onChange={(event) => {
                      const nextValue = event.target.value;
                      if (!nextValue) {
                        setAddForm(createAddFormState(null));
                        return;
                      }
                      const nextRoom = roomOptions.find((room) => room.roomId === Number(nextValue)) ?? null;
                      setAddForm(createAddFormState(nextRoom));
                    }}
                  >
                    {roomOptions.map((room) => (
                      <option key={room.roomId} value={room.roomId}>
                        {room.label}
                      </option>
                    ))}
                  </select>
                </label>
                <div className={styles.addGrid}>
                  <AddField label="체크아웃" hint={`기준 ${addCheckoutBounds.min} ~ 최대 ${addCheckoutBounds.max}`}>
                    <input
                      type="time"
                      value={addForm.checkoutTime}
                      min={addCheckoutBounds.min}
                      max={addCheckoutBounds.max}
                      onChange={(event) =>
                        setAddForm((prev) => ({
                          ...prev,
                          checkoutTime: clampTime(event.target.value, addCheckoutBounds.min, addCheckoutBounds.max)
                        }))
                      }
                    />
                  </AddField>
                  <AddField label="체크인" hint={`최소 ${addCheckinBounds.min} ~ 기준 ${addCheckinBounds.max}`}>
                    <input
                      type="time"
                      value={addForm.checkinTime}
                      min={addCheckinBounds.min}
                      max={addCheckinBounds.max}
                      onChange={(event) =>
                        setAddForm((prev) => ({
                          ...prev,
                          checkinTime: clampTime(event.target.value, addCheckinBounds.min, addCheckinBounds.max)
                        }))
                      }
                    />
                  </AddField>
                  <AddField label="침구 수량" hint={`${addBlanketBounds.min}~${addBlanketBounds.max}세트`}>
                    <QuantityStepper
                      value={addForm.blanketQty}
                      min={addBlanketBounds.min}
                      max={addBlanketBounds.max}
                      onChange={(next) =>
                        setAddForm((prev) => ({
                          ...prev,
                          blanketQty: clampNumber(next, addBlanketBounds.min, addBlanketBounds.max)
                        }))
                      }
                    />
                  </AddField>
                  <AddField label="편의물품" hint={`${addAmenitiesBounds.min}~${addAmenitiesBounds.max}세트`}>
                    <QuantityStepper
                      value={addForm.amenitiesQty}
                      min={addAmenitiesBounds.min}
                      max={addAmenitiesBounds.max}
                      onChange={(next) =>
                        setAddForm((prev) => ({
                          ...prev,
                          amenitiesQty: clampNumber(next, addAmenitiesBounds.min, addAmenitiesBounds.max)
                        }))
                      }
                    />
                  </AddField>
                </div>
                {viewingAsAdmin ? (
                  <label className={styles.formControl}>
                    <span>요청사항 (선택)</span>
                    <textarea
                      value={addForm.requirements}
                      maxLength={255}
                      onChange={(event) =>
                        setAddForm((prev) => ({ ...prev, requirements: event.target.value.slice(0, 255) }))
                      }
                    />
                  </label>
                ) : null}
                <button type="submit" disabled={!canAdd || !addRoom || isAdding}>
                  {isAdding ? '추가 중...' : '작업 추가'}
                </button>
                {addStatus ? <p className={styles.statusOk}>{addStatus}</p> : null}
                {addError ? <p className={styles.statusError}>{addError}</p> : null}
              </form>
            ) : null}
          </div>
        ) : null}
      </section>
    </div>
  );
}

function createAddFormState(room: RoomOption | null): AddFormState {
  if (!room) {
    return {
      roomId: '',
      checkoutTime: '00:00',
      checkinTime: '00:00',
      blanketQty: 0,
      amenitiesQty: 0,
      requirements: ''
    };
  }

  return {
    roomId: room.roomId,
    checkoutTime: room.defaultCheckout,
    checkinTime: room.defaultCheckin,
    blanketQty: room.bedCount,
    amenitiesQty: room.bedCount,
    requirements: ''
  };
}

function getCheckoutBounds(work: { defaultCheckout: string }) {
  return {
    min: work.defaultCheckout,
    max: addMinutes(work.defaultCheckout, 120) ?? work.defaultCheckout
  };
}

function getCheckinBounds(work: { defaultCheckin: string }) {
  return {
    min: addMinutes(work.defaultCheckin, -120) ?? work.defaultCheckin,
    max: work.defaultCheckin
  };
}

function getBlanketBounds(work: { bedCount: number }) {
  const min = work.bedCount;
  return { min, max: min + 1 };
}

function getAmenitiesBounds(work: { bedCount: number }) {
  const min = work.bedCount;
  return { min, max: min + 2 };
}

function sortWorks(list: CleaningWork[]) {
  return [...list].sort((a, b) => {
    if (a.buildingShortName !== b.buildingShortName) {
      return a.buildingShortName.localeCompare(b.buildingShortName, 'ko');
    }

    if (a.roomNo !== b.roomNo) {
      return a.roomNo.localeCompare(b.roomNo, 'ko', { numeric: true, sensitivity: 'base' });
    }

    return a.id - b.id;
  });
}

function isWorkDirty(work: CleaningWork, baseline: CleaningWork[]) {
  const origin = baseline.find((entry) => entry.id === work.id);

  if (!origin) {
    return true;
  }

  return (
    origin.checkoutTime !== work.checkoutTime ||
    origin.checkinTime !== work.checkinTime ||
    origin.blanketQty !== work.blanketQty ||
    origin.amenitiesQty !== work.amenitiesQty ||
    origin.cancelYn !== work.cancelYn ||
    origin.requirements !== work.requirements
  );
}

function buildWindowLabel(window: CleaningSnapshot['window']) {
  switch (window) {
    case 'today':
      return 'D0 기준 편성 중';
    case 'batching':
      return '익일 과업지시서 준비 중';
    case 'edit':
      return '익일 편성 + 수정 가능 (15~16시)';
    case 'locked':
      return '익일 편성 고정';
    default:
      return '';
  }
}

function FieldRow({ label, description, children }: { label: string; description?: string; children: ReactNode }) {
  return (
    <div className={styles.fieldRow}>
      <div className={styles.fieldMeta}>
        <span className={styles.fieldLabel}>{label}</span>
        {description ? <small>{description}</small> : null}
      </div>
      <div className={styles.fieldControl}>{children}</div>
    </div>
  );
}

function AddField({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className={styles.formControl}>
      <span>
        {label} {hint ? <em>{hint}</em> : null}
      </span>
      {children}
    </label>
  );
}

function QuantityStepper({
  value,
  min,
  max,
  disabled,
  onChange
}: {
  value: number;
  min: number;
  max: number;
  disabled?: boolean;
  onChange: (next: number) => void;
}) {
  return (
    <div className={styles.stepper}>
      <button type="button" onClick={() => onChange(value - 1)} disabled={disabled || value <= min}>
        -
      </button>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        disabled={disabled}
        onChange={(event) => {
          const parsed = Number(event.target.value);
          if (Number.isNaN(parsed)) {
            return;
          }
          onChange(parsed);
        }}
      />
      <button type="button" onClick={() => onChange(value + 1)} disabled={disabled || value >= max}>
        +
      </button>
    </div>
  );
}

function clampNumber(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function clampTime(value: string, min: string, max: string) {
  const current = parseTimeString(value);
  const minMinutes = parseTimeString(min);
  const maxMinutes = parseTimeString(max);

  if (current === null || minMinutes === null || maxMinutes === null) {
    return min;
  }

  const normalized = Math.max(minMinutes, Math.min(maxMinutes, current));
  return minutesToTimeString(normalized);
}
