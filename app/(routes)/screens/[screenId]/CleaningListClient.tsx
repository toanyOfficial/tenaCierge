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
  buildingKey: string | '';
  roomId: number | '';
  checkoutTime: string;
  checkinTime: string;
  blanketQty: number;
  amenitiesQty: number;
  requirements: string;
};

function buildTimeOptions(min: string, max: string, stepMinutes = 5) {
  const minVal = parseTimeString(min);
  const maxVal = parseTimeString(max);

  if (minVal === null || maxVal === null) {
    return [] as string[];
  }

  const options: string[] = [];
  for (let cursor = minVal; cursor <= maxVal; cursor += stepMinutes) {
    options.push(minutesToTimeString(cursor));
  }

  return options;
}

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
  const [collapsedSectors, setCollapsedSectors] = useState<Set<string>>(new Set());
  const [collapsedBuildings, setCollapsedBuildings] = useState<Record<string, Set<string>>>({});

  const viewingAsHost = activeRole === 'host';
  const viewingAsAdmin = activeRole === 'admin';
  const viewingAsButler = activeRole === 'butler';
  const viewingAsCleaner = activeRole === 'cleaner';
  const canSeeList = viewingAsHost || viewingAsAdmin || viewingAsButler || viewingAsCleaner;
  const canEdit = viewingAsAdmin || (viewingAsHost && snapshot.hostCanEdit);
  const canEditRequirements = viewingAsAdmin;
  const canAdd = viewingAsAdmin || (viewingAsHost && snapshot.hostCanAdd);

  const roomOptions = useMemo(() => {
    if (viewingAsAdmin) {
      if (snapshot.adminRoomOptions.length > 0) {
        return snapshot.adminRoomOptions;
      }
      return snapshot.hostRoomOptions;
    }

    if (viewingAsHost) {
      return snapshot.hostRoomOptions;
    }

    return [];
  }, [snapshot.adminRoomOptions, snapshot.hostRoomOptions, viewingAsAdmin, viewingAsHost]);

  const roomsByBuilding = useMemo<Record<string, RoomOption[]>>(() => {
    return roomOptions.reduce<Record<string, RoomOption[]>>((acc, room) => {
      const key = buildBuildingKey(room);
      if (!acc[key]) {
        acc[key] = [];
      }
      acc[key].push(room);
      return acc;
    }, {});
  }, [roomOptions]);

  const buildingOptions = useMemo(() => {
    const seen = new Set<string>();
    const list: { key: string; label: string }[] = [];

    roomOptions.forEach((room) => {
      const key = buildBuildingKey(room);
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      list.push({ key, label: room.buildingShortName || '빌딩' });
    });

    return list;
  }, [roomOptions]);

  const [addForm, setAddForm] = useState<AddFormState>(() => createAddFormState(roomOptions[0] ?? null));

  useEffect(() => {
    if (!roomOptions.length) {
      setAddForm(createAddFormState(null));
      setIsAddOpen(false);
      return;
    }

    setAddForm((prev) => {
      if (prev.roomId) {
        const currentRoom = roomOptions.find((room) => room.roomId === prev.roomId);
        if (currentRoom) {
          const key = buildBuildingKey(currentRoom);
          if (prev.buildingKey === key) {
            return prev;
          }
          return { ...prev, buildingKey: key };
        }
      }

      if (prev.buildingKey && roomsByBuilding[prev.buildingKey]?.length) {
        return createAddFormState(roomsByBuilding[prev.buildingKey][0], prev.buildingKey);
      }

      return createAddFormState(roomOptions[0]);
    });
  }, [roomOptions, roomsByBuilding]);

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

    if (viewingAsCleaner) {
      if (!snapshot.currentWorkerId) return [];
      return works.filter((work) => work.cleanerId === snapshot.currentWorkerId);
    }

    return [];
  }, [
    viewingAsHost,
    viewingAsAdmin,
    viewingAsButler,
    viewingAsCleaner,
    works,
    snapshot.hostRoomIds,
    snapshot.currentWorkerId
  ]);

  const batchingOnly = snapshot.window === 'edit' && !viewingAsAdmin;
  const hostRestrictionMessage = viewingAsHost
    ? snapshot.hostCanEdit
      ? '15:00~16:00 구간에서는 체크아웃/체크인·소모품 정보를 직접 조정할 수 있습니다.'
      : '현재 시간에는 호스트 수정이 제한됩니다. (15:00~16:00 허용)'
    : null;

  const roleGuardMessage = !canSeeList
    ? '화면 002는 Host, Butler, Admin 역할에게만 제공됩니다. 역할을 변경해 주세요.'
    : null;

  const groupedWorks = useMemo(() => {
    const sorted = sortWorks(visibleWorks);
    const sectorIndex: Record<string, number> = {};

    const groups: {
      key: string;
      label: string;
      count: number;
      buildings: { key: string; label: string; count: number; works: CleaningWork[] }[];
    }[] = [];

    sorted.forEach((work) => {
      const sectorKey = work.sectorValue || work.sectorCode || '구역 미정';
      const sectorLabel = sectorKey;

      if (sectorIndex[sectorKey] === undefined) {
        sectorIndex[sectorKey] = groups.length;
        groups.push({ key: sectorKey, label: sectorLabel, count: 0, buildings: [] });
      }

      const sector = groups[sectorIndex[sectorKey]];
      sector.count += 1;

      const buildingKey = `${sectorKey}::${work.buildingId}`;
      let building = sector.buildings.find((entry) => entry.key === buildingKey);

      if (!building) {
        building = {
          key: buildingKey,
          label: work.buildingShortName || work.buildingName || `건물 ${work.buildingId}`,
          count: 0,
          works: []
        };
        sector.buildings.push(building);
      }

      building.count += 1;
      building.works.push(work);
    });

    return groups;
  }, [visibleWorks]);

  const toggleSector = (key: string) => {
    setCollapsedSectors((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const toggleBuilding = (sectorKey: string, buildingKey: string) => {
    setCollapsedBuildings((prev) => {
      const next = { ...prev };
      const set = new Set(next[sectorKey] ?? []);

      if (set.has(buildingKey)) {
        set.delete(buildingKey);
      } else {
        set.add(buildingKey);
      }

      next[sectorKey] = set;
      return next;
    });
  };

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

  function handleRoleChange(nextRole: string) {
    if (profile.roles.includes(nextRole)) {
      setActiveRole(nextRole);
      persistRole(nextRole);
    }
  }

  function handleBuildingSelect(value: string) {
    if (!value) {
      setAddForm(createAddFormState(null));
      return;
    }

    const nextRoom = roomsByBuilding[value]?.[0] ?? null;
    setAddForm(createAddFormState(nextRoom, value));
  }

  function handleRoomSelect(value: string) {
    if (!value) {
      setAddForm((prev) => ({ ...prev, roomId: '' }));
      return;
    }

    const nextRoom = roomOptions.find((room) => room.roomId === Number(value));

    if (!nextRoom) {
      setAddForm((prev) => ({ ...prev, roomId: '' }));
      return;
    }

    setAddForm(createAddFormState(nextRoom));
  }

  const roomChoices =
    addForm.buildingKey && roomsByBuilding[addForm.buildingKey]?.length
      ? roomsByBuilding[addForm.buildingKey]
      : roomOptions;

  const addRoom = roomChoices.find((room) => room.roomId === addForm.roomId) ?? roomChoices[0] ?? null;
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
      setWorks((prev) => sortWorks([...prev, created]));
      setBaseline((prev) => sortWorks([...prev, created]));
      setAddStatus('새 작업이 생성되었습니다.');
      setAddForm(createAddFormState(addRoom));
    } catch (error) {
      setAddError(error instanceof Error ? error.message : '작업 생성 중 오류가 발생했습니다.');
    } finally {
      setIsAdding(false);
    }
  }

  const renderWorkCard = (work: CleaningWork) => {
    const checkoutBounds = getCheckoutBounds(work);
    const checkinBounds = getCheckinBounds(work);
    const blanketBounds = getBlanketBounds(work);
    const amenitiesBounds = getAmenitiesBounds(work);
    const isSaving = savingIds.includes(work.id);
    const hasChanges = isWorkDirty(work, baseline);
    const isMine = snapshot.currentWorkerId && work.cleanerId === snapshot.currentWorkerId;
    const isInspection = work.cleaningYn === false;
    const statusLabel = isInspection ? '상태 확인' : work.cancelYn ? '취소 상태' : '예약 유지';

    return (
      <article key={work.id} className={`${styles.workCard} ${isMine ? styles.workCardOwned : ''}`.trim()}>
        <header className={styles.workCardHeader}>
          <div className={styles.workHeaderRow}>
            <p className={styles.workTitle}>{work.roomName}</p>
            <div className={styles.workMetaRow}>
              <span className={isInspection ? styles.badgeMuted : work.cancelYn ? styles.badgeDanger : styles.badgeMuted}>
                {statusLabel}
              </span>
              {!isInspection ? (
                canEdit ? (
                  <button
                    type="button"
                    className={styles.cancelToggle}
                    onClick={() => handleFieldChange(work.id, 'cancelYn', !work.cancelYn)}
                  >
                    {work.cancelYn ? '취소철회' : '취소하기'}
                  </button>
                ) : (
                  <span className={work.cancelYn ? styles.badgeDanger : styles.badgeMuted}>
                    {work.cancelYn ? '취소됨' : '예약 유지'}
                  </span>
                )
              ) : null}
            </div>
            {work.cancelYn ? <p className={styles.cancelAlert}>이 청소 건은 취소된 상태입니다.</p> : null}
          </div>
        </header>

        <div className={styles.workFields}>
          <div className={styles.inlineFieldGroup}>
            <FieldRow label="체크아웃" description="L.C.최대2시간">
              <select
                className={styles.timeSelect}
                value={work.checkoutTime}
                disabled={!canEdit}
                onChange={(event) => handleTimeChange(work.id, 'checkoutTime', event.target.value, checkoutBounds)}
              >
                {buildTimeOptions(checkoutBounds.min, checkoutBounds.max).map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </FieldRow>
            <FieldRow label="체크인" description="E.C.최대2시간">
              <select
                className={styles.timeSelect}
                value={work.checkinTime}
                disabled={!canEdit}
                onChange={(event) => handleTimeChange(work.id, 'checkinTime', event.target.value, checkinBounds)}
              >
                {buildTimeOptions(checkinBounds.min, checkinBounds.max).map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </FieldRow>
          </div>

          <div className={styles.inlineFieldGroup}>
            <FieldRow label="침구 수량" description={`${blanketBounds.min}~${blanketBounds.max}세트`}>
              <QuantityStepper
                value={work.blanketQty}
                min={blanketBounds.min}
                max={blanketBounds.max}
                disabled={!canEdit}
                onChange={(next) => handleNumberChange(work.id, 'blanketQty', next, blanketBounds.min, blanketBounds.max)}
              />
            </FieldRow>
            <FieldRow label="어메니티" description={`${amenitiesBounds.min}~${amenitiesBounds.max}세트`}>
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
          </div>

          <FieldRow label="요청사항" description={canEditRequirements ? '255자 이내 수정 가능' : '열람 전용'}>
            {canEditRequirements ? (
              <textarea
                className={styles.compactTextarea}
                rows={3}
                value={work.requirements}
                onChange={(event) => handleFieldChange(work.id, 'requirements', event.target.value.slice(0, 255))}
              />
            ) : (
              <p className={styles.readonlyText}>{work.requirements || '요청 사항 없음'}</p>
            )}
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
  };

  return (
    <div className={styles.screenShell}>
      <CommonHeader profile={profile} activeRole={activeRole} onRoleChange={handleRoleChange} compact />

      <section className={styles.cleaningSection} data-screen-id="002">
        <header className={styles.sectionHeader}>
          <div>
            <p className={styles.sectionLabel}>화면 002 · 오더관리</p>
            <h1 className={styles.sectionTitle}>오더관리</h1>
          </div>
          <div className={styles.windowMeta}>
            <span className={styles.windowBadge}>{snapshot.targetTag}</span>
            <span className={styles.windowDate}>{snapshot.targetDateLabel}</span>
          </div>
        </header>

        {roleGuardMessage ? <p className={styles.notice}>{roleGuardMessage}</p> : null}
        {snapshot.message ? <p className={styles.notice}>{snapshot.message}</p> : null}
        {hostRestrictionMessage ? <p className={styles.subtle}>{hostRestrictionMessage}</p> : null}

        {canSeeList && !batchingOnly ? (
          <>
            <div className={styles.groupStack}>
              {groupedWorks.map((sector) => {
                const sectorCollapsed = collapsedSectors.has(sector.key);
                return (
                  <div className={styles.groupSection} key={sector.key}>
                    <button
                      type="button"
                      className={styles.groupHeader}
                      onClick={() => toggleSector(sector.key)}
                      aria-expanded={!sectorCollapsed}
                    >
                      <span className={styles.groupHeaderText}>{sector.label}</span>
                      <span className={styles.groupCount}>{sector.count}건</span>
                      <span className={styles.foldIcon} aria-hidden="true">
                        {sectorCollapsed ? '▼' : '▲'}
                      </span>
                    </button>
                    {!sectorCollapsed ? (
                      <div className={styles.buildingStack}>
                        {sector.buildings.map((building) => {
                          const collapsed = collapsedBuildings[sector.key]?.has(building.key) ?? false;
                          return (
                            <div className={styles.buildingGroup} key={building.key}>
                              <button
                                type="button"
                                className={styles.buildingHeader}
                                onClick={() => toggleBuilding(sector.key, building.key)}
                                aria-expanded={!collapsed}
                              >
                                <span>{building.label}</span>
                                <span className={styles.buildingCount}>{building.count}건</span>
                                <span className={styles.foldIcon} aria-hidden="true">
                                  {collapsed ? '▼' : '▲'}
                                </span>
                              </button>
                              {!collapsed ? (
                                <div className={styles.cardGrid}>
                                  {building.works.map((work) => renderWorkCard(work))}
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
                <div className={styles.addSelectors}>
                  <label className={styles.formControl}>
                    <span>빌딩</span>
                    <select value={addForm.buildingKey} onChange={(event) => handleBuildingSelect(event.target.value)}>
                      {buildingOptions.length === 0 ? (
                        <option value="">등록된 빌딩이 없습니다.</option>
                      ) : (
                        buildingOptions.map((building) => (
                          <option key={building.key} value={building.key}>
                            {building.label}
                          </option>
                        ))
                      )}
                    </select>
                  </label>
                  <label className={styles.formControl}>
                    <span>객실</span>
                    <select
                      value={addForm.roomId ? String(addForm.roomId) : ''}
                      onChange={(event) => handleRoomSelect(event.target.value)}
                      disabled={!roomChoices.length}
                    >
                      {roomChoices.length === 0 ? (
                        <option value="">선택 가능한 객실이 없습니다.</option>
                      ) : (
                        roomChoices.map((room) => (
                          <option key={room.roomId} value={room.roomId}>
                            {room.roomNo}
                          </option>
                        ))
                      )}
                    </select>
                  </label>
                </div>
                  <div className={styles.addGrid}>
                    <AddField label="체크아웃" hint="L.C.최대2시간">
                      <select
                        className={styles.timeSelect}
                        value={addForm.checkoutTime}
                        onChange={(event) =>
                          setAddForm((prev) => ({
                            ...prev,
                            checkoutTime: clampTime(event.target.value, addCheckoutBounds.min, addCheckoutBounds.max)
                          }))
                        }
                      >
                        {buildTimeOptions(addCheckoutBounds.min, addCheckoutBounds.max).map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </AddField>
                    <AddField label="체크인" hint="E.C.최대2시간">
                      <select
                        className={styles.timeSelect}
                        value={addForm.checkinTime}
                        onChange={(event) =>
                          setAddForm((prev) => ({
                            ...prev,
                            checkinTime: clampTime(event.target.value, addCheckinBounds.min, addCheckinBounds.max)
                          }))
                        }
                      >
                        {buildTimeOptions(addCheckinBounds.min, addCheckinBounds.max).map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </AddField>
                  </div>
                <div className={styles.addGrid}>
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
                  <AddField label="어메니티" hint={`${addAmenitiesBounds.min}~${addAmenitiesBounds.max}세트`}>
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
                      className={styles.compactTextarea}
                      rows={3}
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

function createAddFormState(room: RoomOption | null, forcedBuilding?: string): AddFormState {
  if (!room) {
    return {
      buildingKey: forcedBuilding ?? '',
      roomId: '',
      checkoutTime: '00:00',
      checkinTime: '00:00',
      blanketQty: 0,
      amenitiesQty: 0,
      requirements: ''
    };
  }

  return {
    buildingKey: forcedBuilding ?? buildBuildingKey(room),
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
  const buildingCounts = list.reduce<Record<number, number>>((acc, work) => {
    if (work.cleaningYn) {
      acc[work.buildingId] = (acc[work.buildingId] ?? 0) + 1;
    }
    return acc;
  }, {});

  return [...list].sort((a, b) => {
    const aSector = a.sectorValue || a.sectorCode;
    const bSector = b.sectorValue || b.sectorCode;
    if (aSector !== bSector) {
      return aSector.localeCompare(bSector, 'ko');
    }

    const countDiff = (buildingCounts[b.buildingId] ?? 0) - (buildingCounts[a.buildingId] ?? 0);
    if (countDiff !== 0) return countDiff;

    return b.roomNo.localeCompare(a.roomNo, 'ko', { numeric: true, sensitivity: 'base' });
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

function FieldRow({ label, description, children }: { label: string; description?: string; children: ReactNode }) {
  return (
    <div className={styles.fieldRow}>
      <div className={styles.fieldMeta}>
        <span className={styles.fieldLabel}>{label}</span>
        {description ? <small className={styles.fieldHint}>{description}</small> : null}
      </div>
      <div className={styles.fieldControl}>{children}</div>
    </div>
  );
}

function AddField({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className={styles.formControl}>
      <span className={styles.fieldLabel}>{label}</span>
      {hint ? (
        <small className={styles.fieldHint}>
          <em>{hint}</em>
        </small>
      ) : null}
      <div className={styles.fieldControl}>{children}</div>
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
      <span
        role="button"
        tabIndex={0}
        className={styles.stepperControl}
        aria-label="감소"
        aria-disabled={disabled || value <= min}
        onClick={() => !disabled && value > min && onChange(value - 1)}
        onKeyDown={(event) => {
          if (disabled) return;
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            if (value > min) onChange(value - 1);
          }
        }}
      >
        -
      </span>
      <span className={styles.stepperValue} aria-live="polite">
        {value}
      </span>
      <span
        role="button"
        tabIndex={0}
        className={styles.stepperControl}
        aria-label="증가"
        aria-disabled={disabled || value >= max}
        onClick={() => !disabled && value < max && onChange(value + 1)}
        onKeyDown={(event) => {
          if (disabled) return;
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            if (value < max) onChange(value + 1);
          }
        }}
      >
        +
      </span>
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

function buildBuildingKey(room: RoomOption) {
  return `${room.buildingName ?? ''}__${room.buildingShortName ?? ''}`;
}
