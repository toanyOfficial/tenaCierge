"use client";

import { useMemo, useState } from 'react';

import styles from './screens.module.css';
import type { CleaningReportSnapshot } from './server/getCleaningReportSnapshot';

type Props = {
  snapshot: CleaningReportSnapshot;
};

const requiredImageSlots = [
  { key: 'entrance', title: '현관', icon: '🚪' },
  { key: 'bathroom', title: '욕실', icon: '🛁' },
  { key: 'bed', title: '침구', icon: '🛏️' },
  { key: 'amenities', title: '어메니티', icon: '🧴' }
];

export default function CleaningReportClient({ snapshot }: Props) {
  const { work, cleaningChecklist, suppliesChecklist } = snapshot;
  const initialImageSelections = useMemo(
    () => Object.fromEntries(requiredImageSlots.map(({ key }) => [key, null])) as Record<string, File | null>,
    []
  );
  const [cleaningChecks, setCleaningChecks] = useState<Set<number>>(new Set());
  const [supplyChecks, setSupplyChecks] = useState<Set<number>>(new Set());
  const [imageSelections, setImageSelections] = useState<Record<string, File | null>>(initialImageSelections);
  const [status, setStatus] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);

  const roomTitle = useMemo(() => `${work.buildingShortName}${work.roomNo}`, [work.buildingShortName, work.roomNo]);

  const toggleCheck = (id: number, target: Set<number>, setter: (next: Set<number>) => void) => {
    const next = new Set(target);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setter(next);
  };

  const handleImageChange = (slotKey: string, files: FileList | null) => {
    if (!files || !files[0]) return;
    setImageSelections((prev) => ({ ...prev, [slotKey]: files[0] }));
  };

  const handleSubmit = async () => {
    setStatus('');
    setError('');
    setSubmitting(true);

    try {
      const formData = new FormData();
      const selectedImages = Object.values(imageSelections).filter(Boolean) as File[];

      formData.append('workId', String(work.id));
      formData.append('cleaningChecks', JSON.stringify(Array.from(cleaningChecks)));
      formData.append('supplyChecks', JSON.stringify(Array.from(supplyChecks)));
      selectedImages.forEach((file) => formData.append('images', file));

      const res = await fetch('/api/work-reports', {
        method: 'POST',
        body: formData
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || '저장 중 오류가 발생했습니다.');
      }

      setStatus('청소 완료 보고가 저장되었습니다.');
      setCleaningChecks(new Set());
      setSupplyChecks(new Set());
      setImageSelections(initialImageSelections);
    } catch (err) {
      const message = err instanceof Error ? err.message : '저장 중 오류가 발생했습니다.';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={styles.screenShell}>
      <section className={styles.cleaningSection}>
        <div className={styles.sectionHeaderSolo}>
          <div>
            <p className={styles.sectionTitle}>청소완료보고</p>
            <p className={styles.subtle}>호실 정보를 확인하고 체크리스트 및 사진을 제출하세요.</p>
          </div>
          <p className={styles.windowBadge}>작업일 {work.date}</p>
        </div>

        <div className={styles.reportGridSimple}>
          <article className={styles.reportCard}>
            <header className={styles.reportCardHeader}>호실 정보</header>
            <dl className={styles.roomInfoGrid}>
              <div>
                <dt>호실</dt>
                <dd>{roomTitle}</dd>
              </div>
              <div>
                <dt>건물명</dt>
                <dd>{work.buildingName}</dd>
              </div>
              <div>
                <dt>체크인</dt>
                <dd>{work.checkinTime}</dd>
              </div>
              <div>
                <dt>체크아웃</dt>
                <dd>{work.checkoutTime}</dd>
              </div>
            </dl>
          </article>

          <div className={styles.reportCard}>
            <header className={styles.reportCardHeader}>청소 체크리스트</header>
            {cleaningChecklist.length === 0 ? (
              <p className={styles.reportEmpty}>청소 체크리스트가 없습니다.</p>
            ) : (
              <ul className={styles.checklist}>
                {cleaningChecklist.map((item) => (
                  <li key={item.id} className={styles.checkItem}>
                    <label>
                      <input
                        type="checkbox"
                        checked={cleaningChecks.has(item.id)}
                        onChange={() => toggleCheck(item.id, cleaningChecks, setCleaningChecks)}
                      />
                      <span>{item.title}</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className={styles.reportCard}>
            <header className={styles.reportCardHeader}>소모품 체크</header>
            {suppliesChecklist.length === 0 ? (
              <p className={styles.reportEmpty}>소모품 체크리스트가 없습니다.</p>
            ) : (
              <ul className={styles.checklist}>
                {suppliesChecklist.map((item) => (
                  <li key={item.id} className={styles.checkItem}>
                    <label>
                      <input
                        type="checkbox"
                        checked={supplyChecks.has(item.id)}
                        onChange={() => toggleCheck(item.id, supplyChecks, setSupplyChecks)}
                      />
                      <span>{item.title}</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className={styles.reportCard}>
            <header className={styles.reportCardHeader}>이미지 업로드</header>
            <div className={styles.imageGrid}>
              {requiredImageSlots.map((slot) => (
                <label key={slot.key} className={styles.imageTile}>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => handleImageChange(slot.key, e.target.files)}
                    className={styles.imageInput}
                  />
                  <span className={styles.imageIcon}>{slot.icon}</span>
                  <span className={styles.imageLabel}>{slot.title}</span>
                  <span className={styles.imageHint}>
                    {imageSelections[slot.key]?.name ? imageSelections[slot.key]?.name : '이미지 선택'}
                  </span>
                </label>
              ))}
            </div>
          </div>
        </div>

        <footer className={styles.reportFooter}>
          <button className={styles.primaryButton} disabled={submitting} onClick={handleSubmit}>
            {submitting ? '저장 중...' : '청소완료 보고 저장'}
          </button>
          {status ? <p className={styles.successText}>{status}</p> : null}
          {error ? <p className={styles.errorText}>{error}</p> : null}
        </footer>
      </section>
    </div>
  );
}
