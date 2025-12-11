'use client';

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';

import CommonHeader from '../CommonHeader';

import styles from './workGlobal.module.css';

import type { WorkGlobalHeaderRecord, WorkGlobalReport } from '@/src/server/workGlobal';
import type { ProfileSummary } from '@/src/utils/profile';

type FormState = {
  emoji: string;
  title: string;
  dscpt: string;
  startDate: string;
  endDate: string;
  remainQty: string;
  closedYn: boolean;
  comment: string;
};

type Props = {
  profile: ProfileSummary;
  initialHeaders: WorkGlobalHeaderRecord[];
};

const EMPTY_FORM: FormState = {
  emoji: '',
  title: '',
  dscpt: '',
  startDate: '',
  endDate: '',
  remainQty: '0',
  closedYn: false,
  comment: ''
};

export default function WorkGlobalClient({ profile, initialHeaders }: Props) {
  const defaultRole = useMemo(() => (profile.roles.includes('admin') ? 'admin' : profile.roles[0] ?? null), [profile.roles]);
  const [activeRole, setActiveRole] = useState<string | null>(defaultRole);
  const [headers, setHeaders] = useState<WorkGlobalHeaderRecord[]>(initialHeaders);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [mode, setMode] = useState<'create' | 'edit'>('create');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [report, setReport] = useState<WorkGlobalReport | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [mutatingRoomId, setMutatingRoomId] = useState<number | null>(null);
  const emojiRef = useRef<HTMLInputElement | null>(null);

  const selectedHeader = selectedId ? headers.find((h) => h.id === selectedId) ?? null : null;

  useEffect(() => {
    if (mode === 'edit' && emojiRef.current) {
      emojiRef.current.focus();
    }
  }, [mode, selectedId]);

  function mapHeaderToForm(header: WorkGlobalHeaderRecord): FormState {
    return {
      emoji: header.emoji ?? '',
      title: header.title,
      dscpt: header.dscpt,
      startDate: header.startDate,
      endDate: header.endDate ?? '',
      remainQty: String(header.remainQty ?? ''),
      closedYn: Boolean(header.closedYn),
      comment: header.comment ?? ''
    };
  }

  function resetForm() {
    setForm(EMPTY_FORM);
    setMode('create');
    setSelectedId(null);
    setFeedback(null);
    setError(null);
  }

  function handleInputChange(event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) {
    const { name, value, type, checked } = event.target;
    setForm((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setFeedback(null);
    setError(null);

    const payload = {
      emoji: form.emoji || null,
      title: form.title.trim(),
      dscpt: form.dscpt.trim(),
      startDate: form.startDate,
      endDate: form.endDate || null,
      remainQty: Number(form.remainQty || 0),
      closedYn: form.closedYn,
      comment: form.comment.trim() || null
    };

    if (!payload.title || !payload.dscpt || !payload.startDate) {
      setError('필수 입력값을 확인해 주세요.');
      setSaving(false);
      return;
    }

    try {
      const url = mode === 'edit' && selectedId ? `/api/work-global/headers/${selectedId}` : '/api/work-global/headers';
      const method = mode === 'edit' && selectedId ? 'PUT' : 'POST';
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
      setHeaders(data.headers ?? []);
      setFeedback('저장되었습니다.');

      if (method === 'POST') {
        resetForm();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : '요청을 처리할 수 없습니다.';
      setError(message);
    } finally {
      setSaving(false);
    }
  }

  function handleRowClick(header: WorkGlobalHeaderRecord) {
    setSelectedId(header.id);
    setForm(mapHeaderToForm(header));
    setMode('edit');
    setFeedback(null);
    setError(null);
  }

  async function loadReport(headerId: number) {
    setReportLoading(true);
    setReportError(null);
    try {
      const response = await fetch(`/api/work-global/details?headerId=${headerId}`);
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.message ?? '조회에 실패했습니다.');
      }
      const data = await response.json();
      setReport(data.report ?? null);
    } catch (err) {
      const message = err instanceof Error ? err.message : '조회 중 오류가 발생했습니다.';
      setReportError(message);
    } finally {
      setReportLoading(false);
    }
  }

  function openReport() {
    if (!selectedId) {
      setError('상단에서 헤더를 선택해 주세요.');
      return;
    }
    setReportOpen(true);
    loadReport(selectedId);
  }

  function updateRoomCompletion(roomId: number, completedAt: string | null) {
    setReport((prev) => {
      if (!prev) return prev;
      const rooms = prev.rooms.map((room) => (room.roomId === roomId ? { ...room, completedAt } : room));
      const totalRooms = rooms.length;
      const completedRooms = rooms.filter((room) => room.completedAt).length;
      const completionRate = totalRooms ? Math.round((completedRooms / totalRooms) * 100) : 0;
      const remainingMap = rooms.reduce<Map<string, number>>((acc, room) => {
        if (room.completedAt) return acc;
        acc.set(room.sector, (acc.get(room.sector) ?? 0) + 1);
        return acc;
      }, new Map());
      const sectorRemainings = Array.from(remainingMap.entries())
        .map(([sector, remaining]) => ({ sector, remaining }))
        .sort((a, b) => a.sector.localeCompare(b.sector));

      return {
        ...prev,
        rooms,
        completedRooms,
        completionRate,
        sectorRemainings
      };
    });
  }

  async function handleComplete(roomId: number) {
    if (!selectedId) return;
    setMutatingRoomId(roomId);
    try {
      const response = await fetch('/api/work-global/details', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ headerId: selectedId, roomId })
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.message ?? '완료 처리에 실패했습니다.');
      }

      const data = await response.json();
      updateRoomCompletion(roomId, data.completedAt ?? null);
    } catch (err) {
      const message = err instanceof Error ? err.message : '완료 처리 중 오류가 발생했습니다.';
      setReportError(message);
    } finally {
      setMutatingRoomId(null);
    }
  }

  async function handleRevert(roomId: number) {
    if (!selectedId) return;
    const confirmed = window.confirm('작업이 완료되지 않은 상태로 되돌리시겠습니까?');
    if (!confirmed) return;

    setMutatingRoomId(roomId);
    try {
      const response = await fetch('/api/work-global/details', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ headerId: selectedId, roomId })
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.message ?? '취소 처리에 실패했습니다.');
      }

      updateRoomCompletion(roomId, null);
    } catch (err) {
      const message = err instanceof Error ? err.message : '취소 처리 중 오류가 발생했습니다.';
      setReportError(message);
    } finally {
      setMutatingRoomId(null);
    }
  }

  function renderSummary() {
    if (!report) return null;
    const sectorSummary =
      report.sectorRemainings.length === 0
        ? '남아있는 객실이 없습니다.'
        : `${report.sectorRemainings.map((item) => `${item.sector}에 ${item.remaining}개`).join(', ')} 객실이 남아있습니다.`;

    return `${report.reportDate} 현재 '${report.header.title}'업무는 총 ${report.totalRooms}개의 객실에 대하여 ${report.completedRooms}개가 진행되어 ${report.completionRate}% 완료된 것으로 집계됩니다. ${sectorSummary}`;
  }

  return (
    <div className={styles.page}>
      <CommonHeader profile={profile} activeRole={activeRole} onRoleChange={setActiveRole} />

      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <div>
            <p className={styles.cardTitle}>전수작업 관리</p>
            <p className={styles.cardSubtitle}>전사 작업 헤더를 등록하거나 수정하고, 객실별 진행 현황을 조회합니다.</p>
          </div>
          <div className={styles.actions}>
            <button className={styles.secondaryButton} type="button" onClick={resetForm} disabled={saving}>
              신규 작성
            </button>
            <button
              className={styles.primaryButton}
              type="button"
              onClick={openReport}
              disabled={!selectedId}
              title={selectedId ? '선택한 헤더의 상세현황을 봅니다.' : '헤더를 선택해 주세요.'}
            >
              상세보기
            </button>
          </div>
        </div>

        <form className={styles.form} onSubmit={handleSubmit}>
          <div className={styles.formGrid}>
            <label className={styles.field}>
              <span>이모지</span>
              <input
                ref={emojiRef}
                type="text"
                name="emoji"
                maxLength={10}
                value={form.emoji}
                onChange={handleInputChange}
                placeholder="😀"
              />
            </label>
            <label className={styles.field}>
              <span>제목*</span>
              <input type="text" name="title" maxLength={20} value={form.title} onChange={handleInputChange} required />
            </label>
            <label className={styles.field}>
              <span>설명*</span>
              <input type="text" name="dscpt" maxLength={50} value={form.dscpt} onChange={handleInputChange} required />
            </label>
            <label className={styles.field}>
              <span>시작일*</span>
              <input type="date" name="startDate" value={form.startDate} onChange={handleInputChange} required />
            </label>
            <label className={styles.field}>
              <span>종료일</span>
              <input type="date" name="endDate" value={form.endDate} onChange={handleInputChange} />
            </label>
            <label className={styles.field}>
              <span>남은 수량</span>
              <input type="number" name="remainQty" min={0} value={form.remainQty} onChange={handleInputChange} />
            </label>
            <label className={styles.checkboxField}>
              <input type="checkbox" name="closedYn" checked={form.closedYn} onChange={handleInputChange} />
              <span>종료 처리</span>
            </label>
            <label className={`${styles.field} ${styles.fullWidth}`}>
              <span>비고</span>
              <textarea name="comment" maxLength={255} value={form.comment} onChange={handleInputChange} rows={2} />
            </label>
          </div>

          <div className={styles.footerRow}>
            <div className={styles.feedbackZone}>
              {feedback ? <span className={styles.feedback}>{feedback}</span> : null}
              {error ? <span className={styles.error}>{error}</span> : null}
            </div>
            <div className={styles.actions}>
              <button className={styles.primaryButton} type="submit" disabled={saving}>
                {mode === 'edit' ? '수정하기' : '생성하기'}
              </button>
            </div>
          </div>
        </form>
      </section>

      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <div>
            <p className={styles.cardTitle}>등록된 전수작업</p>
            <p className={styles.cardSubtitle}>행을 클릭하면 상단 입력란에서 수정할 수 있습니다.</p>
          </div>
        </div>

        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>ID</th>
                <th>제목</th>
                <th>설명</th>
                <th>기간</th>
                <th>잔여</th>
                <th>상태</th>
              </tr>
            </thead>
            <tbody>
              {headers.map((header) => (
                <tr
                  key={header.id}
                  className={selectedId === header.id ? styles.activeRow : ''}
                  onClick={() => handleRowClick(header)}
                >
                  <td>{header.id}</td>
                  <td>{`${header.emoji ?? ''} ${header.title}`.trim()}</td>
                  <td>{header.dscpt}</td>
                  <td>
                    {header.startDate}
                    {header.endDate ? ` ~ ${header.endDate}` : ''}
                  </td>
                  <td>{header.remainQty}</td>
                  <td>{header.closedYn ? '종료' : '진행'}</td>
                </tr>
              ))}
              {!headers.length ? (
                <tr>
                  <td colSpan={6} className={styles.empty}>
                    등록된 헤더가 없습니다.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      {reportOpen ? (
        <div className={styles.modalOverlay} role="dialog" aria-modal="true">
          <div className={styles.modal}>
            <div className={styles.modalHeader}>
              <div>
                <p className={styles.cardTitle}>상세현황</p>
                <p className={styles.cardSubtitle}>{selectedHeader?.title ?? ''}</p>
              </div>
              <button className={styles.secondaryButton} type="button" onClick={() => setReportOpen(false)}>
                닫기
              </button>
            </div>

            {reportLoading ? <p className={styles.subtle}>불러오는 중...</p> : null}
            {reportError ? <p className={styles.error}>{reportError}</p> : null}
            {!reportLoading && report ? <p className={styles.summary}>{renderSummary()}</p> : null}

            {!reportLoading && report ? (
              <div className={styles.tableWrapper}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>섹터</th>
                      <th>빌딩</th>
                      <th>호실</th>
                      <th>complete_yn</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.rooms.map((room) => (
                      <tr key={room.roomId}>
                        <td>{room.sector}</td>
                        <td>{room.buildingShortName}</td>
                        <td>{room.roomNo}</td>
                        <td>
                          {room.completedAt ? (
                            <button
                              type="button"
                              className={styles.linkButton}
                              onClick={() => handleRevert(room.roomId)}
                              disabled={mutatingRoomId === room.roomId}
                            >
                              {room.completedAt}
                            </button>
                          ) : (
                            <button
                              type="button"
                              className={styles.primaryButton}
                              onClick={() => handleComplete(room.roomId)}
                              disabled={mutatingRoomId === room.roomId}
                            >
                              수동완료처리
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
