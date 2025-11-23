"use client";

import { useMemo, useState } from 'react';
import { FontAwesomeIcon } from '@/src/vendor/fontawesome/react-fontawesome';
import {
  faBath,
  faBed,
  faBuilding,
  faCamera,
  faDoorOpen,
  faHouseUser,
  faKitchenSet,
  faShower,
  faSprayCanSparkles
} from '@/src/vendor/fontawesome/free-solid-svg-icons';

import styles from './screens.module.css';
import type { CleaningReportSnapshot, ImageSlot } from './server/getCleaningReportSnapshot';

type Props = {
  snapshot: CleaningReportSnapshot;
};

const slotIcon = (title: string) => {
  const normalized = title.toLowerCase();

  if (normalized.includes('현관') || normalized.includes('문')) return faDoorOpen;
  if (normalized.includes('욕실') || normalized.includes('화장실') || normalized.includes('샤워')) return faBath;
  if (normalized.includes('침대') || normalized.includes('침구') || normalized.includes('침실')) return faBed;
  if (normalized.includes('거실')) return faBuilding;
  if (normalized.includes('주방') || normalized.includes('키친')) return faKitchenSet;
  if (normalized.includes('소독') || normalized.includes('살균')) return faSprayCanSparkles;
  if (normalized.includes('세면') || normalized.includes('샤워')) return faShower;
  if (normalized.includes('출입') || normalized.includes('체크인')) return faHouseUser;

  return faCamera;
};

type ImageTileProps = {
  slot: ImageSlot;
  selectedFile?: File | null;
  onChange: (slotKey: string, files: FileList | null) => void;
  required?: boolean;
};

function ImageTile({ slot, selectedFile, onChange, required }: ImageTileProps) {
  const slotKey = String(slot.id);

  return (
    <label
      className={`${styles.imageTile} ${required ? styles.imageTileRequired : styles.imageTileOptional}`.trim()}
      aria-label={`${required ? '필수' : '선택'} 이미지 ${slot.title}`}
    >
      <input
        type="file"
        accept="image/*"
        onChange={(e) => onChange(slotKey, e.target.files)}
        className={styles.imageInput}
      />

      <span className={styles.imageIconCircle}>
        <FontAwesomeIcon icon={slotIcon(slot.title)} size="lg" />
      </span>

      <div className={styles.imageTextBlock}>
        <span className={styles.imageLabel}>{slot.title}</span>
        {slot.comment ? <span className={styles.imageComment}>{slot.comment}</span> : null}
        <span className={styles.imageHint}>
          {selectedFile?.name
            ? selectedFile.name
            : required
              ? '필수 이미지 선택'
              : '선택 이미지'}
        </span>
      </div>
    </label>
  );
}

export default function CleaningReportClient({ snapshot }: Props) {
  const { work, cleaningChecklist, suppliesChecklist, imageSlots } = snapshot;
  const requiredImageSlots = useMemo(() => imageSlots.filter((slot) => slot.required), [imageSlots]);
  const optionalImageSlots = useMemo(() => imageSlots.filter((slot) => !slot.required), [imageSlots]);
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

  const isReadyToSubmit = useMemo(
    () => requiredImageSlots.every((slot) => imageSelections[String(slot.id)]),
    [requiredImageSlots, imageSelections]
  );

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

    const missingRequired = requiredImageSlots.filter((slot) => !imageSelections[String(slot.id)]);
    if (missingRequired.length > 0) {
      setError('필수 이미지를 모두 첨부해 주세요.');
      return;
    }

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
              <div className={styles.imageGroupStack}>
                {requiredImageSlots.length > 0 ? (
                  <div className={styles.imageGroup}>
                    <div className={styles.imageGroupHeader}>
                      <span className={styles.imageGroupTitle}>필수 이미지</span>
                      <span className={styles.imageBadgeRequired}>모두 첨부 필요</span>
                    </div>
                    <div className={styles.imageGrid}>
                      {requiredImageSlots.map((slot) => (
                        <ImageTile
                          key={slot.id}
                          slot={slot}
                          selectedFile={imageSelections[String(slot.id)]}
                          onChange={handleImageChange}
                          required
                        />
                      ))}
                    </div>
                  </div>
                ) : null}

                {optionalImageSlots.length > 0 ? (
                  <div className={styles.imageGroup}>
                    <div className={styles.imageGroupHeader}>
                      <span className={styles.imageGroupTitle}>선택 이미지</span>
                      <span className={styles.imageBadgeOptional}>선택 제출</span>
                    </div>
                    <div className={styles.imageGrid}>
                      {optionalImageSlots.map((slot) => (
                        <ImageTile
                          key={slot.id}
                          slot={slot}
                          selectedFile={imageSelections[String(slot.id)]}
                          onChange={handleImageChange}
                        />
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            )}
          </article>
        </div>

        <footer className={styles.reportFooter}>
          <button className={styles.primaryButton} disabled={submitting || !isReadyToSubmit} onClick={handleSubmit}>
            {submitting ? '저장 중...' : '청소완료 보고 저장'}
          </button>
          {status ? <p className={styles.successText}>{status}</p> : null}
          {error ? <p className={styles.errorText}>{error}</p> : null}
        </footer>
      </section>
    </div>
  );
}
