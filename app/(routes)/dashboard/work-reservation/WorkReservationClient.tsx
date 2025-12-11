'use client';

import { useMemo, useState, type ChangeEvent, type FormEvent } from 'react';

import CommonHeader from '../CommonHeader';

import styles from './workReservation.module.css';

import type { BuildingRoomOption, WorkReservationRecord } from '@/src/server/workReservation';
import type { ProfileSummary } from '@/src/utils/profile';

type FormState = {
  workId: number | null;
  workDateLabel: string;
  buildingId: string;
  roomId: string;
  amenitiesQty: string;
  blanketQty: string;
  checkinTime: string;
  checkoutTime: string;
  requirements: string;
  cancelYn: boolean;
  reflectYn: boolean;
};

type Props = {
  profile: ProfileSummary;
  initialReservations: WorkReservationRecord[];
  buildingOptions: BuildingRoomOption[];
};

const EMPTY_FORM: FormState = {
  workId: null,
  workDateLabel: '미반영',
  buildingId: '',
  roomId: '',
  amenitiesQty: '0',
  blanketQty: '0',
  checkinTime: '',
  checkoutTime: '',
  requirements: '',
  cancelYn: false,
  reflectYn: false
};

function createEmptyForm(defaultWorkId: string): FormState {
  return {
    ...EMPTY_FORM,
    workDateLabel: defaultWorkId
  };
}

export default function WorkReservationClient({ profile, initialReservations, buildingOptions }: Props) {
  const defaultRole = useMemo(() => (profile.roles.includes('admin') ? 'admin' : profile.roles[0] ?? null), [profile.roles]);
  const [activeRole, setActiveRole] = useState<string | null>(defaultRole);
  const [reservations, setReservations] = useState<WorkReservationRecord[]>(initialReservations);
  const [form, setForm] = useState<FormState>(() => createEmptyForm('미반영'));
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const roomOptions = useMemo(() => {
    const buildingId = Number(form.buildingId);
    if (!buildingId) return [];
    return buildingOptions.find((b) => b.buildingId === buildingId)?.rooms ?? [];
  }, [buildingOptions, form.buildingId]);

  const selectedRoom = useMemo(() => {
    const roomId = Number(form.roomId);
    if (!roomId) return null;
    return roomOptions.find((room) => room.roomId === roomId) ?? null;
  }, [roomOptions, form.roomId]);

  function handleInputChange(event: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) {
    const { name, value, type, checked } = event.target as HTMLInputElement;
    setForm((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
  }

  function handleBuildingChange(event: ChangeEvent<HTMLSelectElement>) {
    const nextBuilding = event.target.value;
    setForm((prev) => ({ ...prev, buildingId: nextBuilding, roomId: '' }));
  }

  function handleRoomChange(event: ChangeEvent<HTMLSelectElement>) {
    const nextRoomId = event.target.value;
    const nextRoom = roomOptions.find((room) => String(room.roomId) === nextRoomId);

    setForm((prev) => ({
      ...prev,
      roomId: nextRoomId,
      amenitiesQty: nextRoom ? String(nextRoom.bedCount ?? 0) : prev.amenitiesQty,
      blanketQty: nextRoom ? String(nextRoom.bedCount ?? 0) : prev.blanketQty,
      checkinTime: nextRoom?.checkinTime ?? prev.checkinTime,
      checkoutTime: nextRoom?.checkoutTime ?? prev.checkoutTime
    }));
  }

  function resetForm() {
    setForm(createEmptyForm('미반영'));
    setSelectedId(null);
    setFeedback(null);
    setError(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setFeedback(null);
    setError(null);

    const payload = {
      workId: form.workId,
      roomId: Number(form.roomId || 0),
      amenitiesQty: Number(form.amenitiesQty || 0),
      blanketQty: Number(form.blanketQty || 0),
      checkinTime: form.checkinTime,
      checkoutTime: form.checkoutTime,
      requirements: form.requirements.trim() || null,
      cancelYn: form.cancelYn,
      reflectYn: form.reflectYn
    };

    if (!payload.roomId || !payload.checkinTime || !payload.checkoutTime) {
      setError('필수 입력값을 확인해 주세요.');
      setSaving(false);
      return;
    }

    try {
      const method = selectedId ? 'PUT' : 'POST';
      const url = selectedId ? `/api/work-reservations/${selectedId}` : '/api/work-reservations';
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.message ?? '저장에 실패했습니다.');
      }

      const data = await response.json();
      setReservations(data.reservations ?? []);
      setFeedback('저장되었습니다.');
      if (!selectedId) {
        resetForm();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : '요청을 처리할 수 없습니다.';
      setError(message);
    } finally {
      setSaving(false);
    }
  }

  function handleRowClick(reservation: WorkReservationRecord) {
    setSelectedId(reservation.id);
    setForm({
      workId: reservation.workId,
      workDateLabel: reservation.workDateLabel,
      buildingId: reservation.buildingId ? String(reservation.buildingId) : '',
      roomId: String(reservation.roomId),
      amenitiesQty: String(reservation.amenitiesQty ?? 0),
      blanketQty: String(reservation.blanketQty ?? 0),
      checkinTime: reservation.checkinTime,
      checkoutTime: reservation.checkoutTime,
      requirements: reservation.requirements ?? '',
      cancelYn: reservation.cancelYn,
      reflectYn: reservation.reflectYn
    });
    setFeedback(null);
    setError(null);
  }

  function handleCancelToggle() {
    if (form.cancelYn) {
      setForm((prev) => ({ ...prev, cancelYn: false }));
      return;
    }

    const confirmed = window.confirm('이 요청사항을 폐기하시겠습니까?');
    if (!confirmed) return;
    setForm((prev) => ({ ...prev, cancelYn: true }));
  }

  return (
    <div className={styles.page}>
      <CommonHeader profile={profile} activeRole={activeRole} onRoleChange={setActiveRole} />

      <section className={styles.card}>
        <header className={styles.cardHeader}>
          <div>
            <p className={styles.cardTitle}>요청사항관리</p>
            <p className={styles.cardSubtitle}>work_reservation 데이터를 생성·수정합니다.</p>
          </div>
        </header>

        <form className={styles.form} onSubmit={handleSubmit}>
          <div className={styles.formGrid}>
            <label className={styles.field}>
              <span>작업일 (반영 시 표시)</span>
              <input type="text" name="workId" value={form.workDateLabel || '미반영'} readOnly />
              <p className={styles.inlineNote}>
                배치 반영 전에는 미반영 상태로 표시되며, 반영되면 작업일이 자동 입력됩니다.
              </p>
            </label>

            <label className={styles.field}>
              <span>빌딩 *</span>
              <select name="buildingId" value={form.buildingId} onChange={handleBuildingChange} required>
                <option value="">빌딩 선택</option>
                {buildingOptions.map((building) => (
                  <option key={building.buildingId} value={building.buildingId}>
                    {building.buildingShortName}
                  </option>
                ))}
              </select>
            </label>

            <label className={styles.field}>
              <span>객실 *</span>
              <select name="roomId" value={form.roomId} onChange={handleRoomChange} required>
                <option value="">객실 선택</option>
                {roomOptions.map((room) => (
                  <option key={room.roomId} value={room.roomId}>
                    {room.roomNo}
                  </option>
                ))}
              </select>
            </label>

            <label className={styles.field}>
              <span>반영 여부</span>
              <label className={styles.switch}>
                <input type="checkbox" name="reflectYn" checked={form.reflectYn} onChange={handleInputChange} />
                <span className={styles.slider} />
                <span className={styles.switchLabel}>{form.reflectYn ? '반영됨' : '미반영'}</span>
              </label>
            </label>

            <label className={styles.field}>
              <span>
                어메니티 수량
                {selectedRoom ? <em className={styles.guide}>(기본 {selectedRoom.bedCount})</em> : null}
              </span>
              <input type="number" name="amenitiesQty" min={0} value={form.amenitiesQty} onChange={handleInputChange} />
            </label>

            <label className={styles.field}>
              <span>
                이불 수량
                {selectedRoom ? <em className={styles.guide}>(기본 {selectedRoom.bedCount})</em> : null}
              </span>
              <input type="number" name="blanketQty" min={0} value={form.blanketQty} onChange={handleInputChange} />
            </label>

            <label className={styles.field}>
              <span>
                체크인 시간 *
                {selectedRoom?.checkinTime ? <em className={styles.guide}>(기본 {selectedRoom.checkinTime})</em> : null}
              </span>
              <input type="time" name="checkinTime" value={form.checkinTime} onChange={handleInputChange} required />
            </label>

            <label className={styles.field}>
              <span>
                체크아웃 시간 *
                {selectedRoom?.checkoutTime ? <em className={styles.guide}>(기본 {selectedRoom.checkoutTime})</em> : null}
              </span>
              <input type="time" name="checkoutTime" value={form.checkoutTime} onChange={handleInputChange} required />
            </label>

            <label className={`${styles.field} ${styles.fullWidth}`}>
              <span>특이사항</span>
              <input
                type="text"
                name="requirements"
                value={form.requirements}
                onChange={handleInputChange}
                maxLength={30}
                placeholder="최대 30자"
              />
            </label>
          </div>

          <div className={styles.cancelRow}>
            <div className={styles.cancelText}>
              {form.cancelYn ? (
                <span className={styles.cancelNotice}>이 요청사항은 폐기되었습니다.</span>
              ) : (
                <span className={styles.subtle}>요청사항이 불필요해지면 폐기할 수 있습니다.</span>
              )}
            </div>
            <button
              type="button"
              className={form.cancelYn ? styles.restoreButton : styles.dangerButton}
              onClick={handleCancelToggle}
              disabled={saving}
            >
              {form.cancelYn ? '되살리기' : '요청사항 폐기'}
            </button>
          </div>

          <div className={styles.footerRow}>
            <div className={styles.actions}>
              <button type="submit" className={styles.primaryButton} disabled={saving}>
                {selectedId ? '수정하기' : '등록하기'}
              </button>
              <button type="button" className={styles.secondaryButton} onClick={resetForm} disabled={saving}>
                초기화
              </button>
            </div>
            <div className={styles.feedbackZone}>
              {feedback ? <span className={styles.feedback}>{feedback}</span> : null}
              {error ? <span className={styles.error}>{error}</span> : null}
            </div>
          </div>
        </form>
      </section>

      <section className={styles.card}>
        <header className={styles.cardHeader}>
          <div>
            <p className={styles.cardTitle}>요청사항 목록</p>
            <p className={styles.cardSubtitle}>하단에서 항목을 클릭하면 상단에 불러옵니다.</p>
          </div>
        </header>

        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>작업일</th>
                <th>반영</th>
                <th>객실</th>
                <th>어메니티</th>
                <th>이불</th>
                <th>체크인</th>
                <th>체크아웃</th>
                <th>특이사항</th>
                <th>취소</th>
              </tr>
            </thead>
            <tbody>
              {reservations.length === 0 ? (
                <tr>
                  <td className={styles.empty} colSpan={9}>
                    등록된 요청사항이 없습니다.
                  </td>
                </tr>
              ) : (
                reservations.map((reservation) => {
                  const isActive = reservation.id === selectedId;
                  return (
                    <tr
                      key={reservation.id}
                      className={isActive ? styles.activeRow : undefined}
                      onClick={() => handleRowClick(reservation)}
                    >
                      <td>{reservation.workDateLabel}</td>
                      <td>
                        <span className={reservation.reflectYn ? styles.badgeSuccess : styles.badgeMuted}>
                          {reservation.reflectYn ? '반영됨' : '미반영'}
                        </span>
                      </td>
                      <td>
                        {reservation.buildingShortName ?? '-'} {reservation.roomNo ?? ''}
                      </td>
                      <td>{reservation.amenitiesQty}</td>
                      <td>{reservation.blanketQty}</td>
                      <td>{reservation.checkinTime}</td>
                      <td>{reservation.checkoutTime}</td>
                      <td>{reservation.requirements || '-'}</td>
                      <td>{reservation.cancelYn ? 'Y' : '-'}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
