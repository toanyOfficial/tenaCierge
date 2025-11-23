"use client";

import { useMemo, useState } from 'react';

import styles from './screens.module.css';
import CommonHeader from '@/app/(routes)/dashboard/CommonHeader';
import type { CleaningReportSnapshot } from './server/getCleaningReportSnapshot';

type Props = {
  snapshot: CleaningReportSnapshot;
};

const slotIcon = (title: string) => {
  if (title.includes('현관')) return '🚪';
  if (title.includes('욕실') || title.includes('화장실')) return '🛁';
  if (title.includes('침대') || title.includes('침구')) return '🛏️';
  if (title.includes('어메니티') || title.includes('비품')) return '🧴';
  if (title.includes('거실')) return '🛋️';
  if (title.includes('주방')) return '🍳';
  return '📷';
};

export default function CleaningReportClient({ snapshot }: Props) {
  const { work, cleaningChecklist, suppliesChecklist, imageSlots } = snapshot;
  const imageSlotKeys = useMemo(() => imageSlots.map((slot) => String(slot.id)), [imageSlots]);
  const initialImageSelections = useMemo(
    () => Object.fromEntries(imageSlotKeys.map((key) => [key, null])) as Record<string, File | null>,
    [imageSlotKeys]
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
        <header className={styles.roomHero}>
          <p className={styles.heroLabel}>호실</p>
          <p className={styles.heroTitle}>{roomTitle}</p>
          <p className={styles.heroSub}>작업일 {work.date}</p>
        </header>

        <div className={styles.reportGridStacked}>
          <article className={styles.reportCardWide}>
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
          </article>

          <article className={styles.reportCardWide}>
            <header className={styles.reportCardHeader}>소모품 체크리스트</header>
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
          </article>

          <article className={styles.reportCardWide}>
            <header className={styles.reportCardHeader}>이미지 업로드</header>
            {imageSlots.length === 0 ? (
              <p className={styles.reportEmpty}>업로드할 이미지가 없습니다.</p>
            ) : (
              <div className={styles.imageGrid}>
                {imageSlots.map((slot) => {
                  const key = String(slot.id);
                  return (
                    <label key={key} className={styles.imageTile}>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(e) => handleImageChange(key, e.target.files)}
                        className={styles.imageInput}
                      />
                      <span className={styles.imageIcon}>{slotIcon(slot.title)}</span>
                      <span className={styles.imageLabel}>{slot.title}</span>
                      <span className={styles.imageHint}>
                        {imageSelections[key]?.name
                          ? imageSelections[key]?.name
                          : slot.required
                            ? '필수 이미지 선택'
                            : '이미지 선택'}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </article>
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
