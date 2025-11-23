"use client";
/* eslint-disable @next/next/no-img-element */

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
  previewUrl?: string | null;
  onChange: (slotKey: string, files: FileList | null) => void;
  required?: boolean;
};

function ImageTile({ slot, selectedFile, previewUrl, onChange, required }: ImageTileProps) {
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
        {previewUrl ? <img src={previewUrl} alt={`${slot.title} 미리보기`} className={styles.imagePreview} /> : null}
        <span className={styles.imageHint}>
          {selectedFile?.name
            ? selectedFile.name
            : previewUrl
              ? '업로드된 이미지를 사용합니다.'
              : required
                ? '필수 이미지 선택'
                : '선택 이미지'}
        </span>
      </div>
    </label>
  );
}

export default function CleaningReportClient({ snapshot }: Props) {
  const { work, cleaningChecklist, suppliesChecklist, imageSlots, existingCleaningChecks, existingSupplyChecks, savedImages } = snapshot;
  const requiredImageSlots = useMemo(() => imageSlots.filter((slot) => slot.required), [imageSlots]);
  const optionalImageSlots = useMemo(() => imageSlots.filter((slot) => !slot.required), [imageSlots]);
  const imageSlotKeys = useMemo(() => imageSlots.map((slot) => String(slot.id)), [imageSlots]);
  const initialImageSelections = useMemo(
    () => Object.fromEntries(imageSlotKeys.map((key) => [key, null])) as Record<string, File | null>,
    [imageSlotKeys]
  );
  const initialImagePreviews = useMemo(() => {
    const mapping = Object.fromEntries(imageSlotKeys.map((key) => [key, null])) as Record<string, string | null>;

    savedImages.forEach((img) => {
      const key = String(img.slotId);
      if (mapping[key] === undefined) return;
      mapping[key] = img.url;
    });

    return mapping;
  }, [imageSlotKeys, savedImages]);

  const [cleaningChecks, setCleaningChecks] = useState<Set<number>>(new Set(existingCleaningChecks ?? []));
  const [supplyChecks, setSupplyChecks] = useState<Set<number>>(new Set(existingSupplyChecks ?? []));
  const [imageSelections, setImageSelections] = useState<Record<string, File | null>>(initialImageSelections);
  const [imagePreviews, setImagePreviews] = useState<Record<string, string | null>>(initialImagePreviews);
  const [status, setStatus] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);

  const cleaningComplete = useMemo(
    () => cleaningChecklist.length === 0 || cleaningChecklist.every((item) => cleaningChecks.has(item.id)),
    [cleaningChecklist, cleaningChecks]
  );

  const suppliesComplete = useMemo(
    () => suppliesChecklist.length === 0 || suppliesChecklist.every((item) => supplyChecks.has(item.id)),
    [suppliesChecklist, supplyChecks]
  );

  const requiredImagesReady = useMemo(
    () => requiredImageSlots.every((slot) => imageSelections[String(slot.id)] || imagePreviews[String(slot.id)]),
    [requiredImageSlots, imageSelections, imagePreviews]
  );

  const isReadyToSubmit = cleaningComplete && suppliesComplete && requiredImagesReady;

  const readinessMessages = useMemo(() => {
    const messages: string[] = [];

    if (!cleaningComplete || !suppliesComplete) messages.push('체크리스트를 확인하세요');
    if (!requiredImagesReady) messages.push('필수 사진 항목을 확인하세요.');

    return messages;
  }, [cleaningComplete, suppliesComplete, requiredImagesReady]);

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
    const [file] = files;
    setImageSelections((prev) => ({ ...prev, [slotKey]: file }));
    setImagePreviews((prev) => ({ ...prev, [slotKey]: URL.createObjectURL(file) }));
  };

  const handleSubmit = async () => {
    setStatus('');
    setError('');

    if (!isReadyToSubmit) {
      setError(readinessMessages.join(' / '));
      return;
    }

    setSubmitting(true);

    try {
      const formData = new FormData();
      const selectedImages = imageSlotKeys
        .map((key) => ({ key, file: imageSelections[key] }))
        .filter((entry) => Boolean(entry.file)) as { key: string; file: File }[];

      formData.append('workId', String(work.id));
      formData.append('cleaningChecks', JSON.stringify(Array.from(cleaningChecks)));
      formData.append('supplyChecks', JSON.stringify(Array.from(supplyChecks)));
      selectedImages.forEach((entry) => formData.append('images', entry.file));
      formData.append(
        'imageFileSlots',
        JSON.stringify(selectedImages.map((entry) => Number.parseInt(entry.key, 10)).filter((v) => Number.isFinite(v)))
      );
      formData.append(
        'existingImages',
        JSON.stringify(
          imageSlotKeys
            .map((key) => ({ slotId: Number.parseInt(key, 10), url: imagePreviews[key], file: imageSelections[key] }))
            .filter((item) => item.url && !item.file)
            .map((item) => ({ slotId: item.slotId, url: item.url }))
        )
      );

      const res = await fetch('/api/work-reports', {
        method: 'POST',
        body: formData
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.message || '저장 중 오류가 발생했습니다.');
      }

      setStatus('청소 완료 보고가 저장되었습니다.');
      setCleaningChecks(new Set(cleaningChecks));
      setSupplyChecks(new Set(supplyChecks));
      setImageSelections(initialImageSelections);
      if (Array.isArray(data.images)) {
        const nextPreviews = { ...initialImagePreviews };
        data.images.forEach((img: { slotId?: number; url?: string }) => {
          if (!img || typeof img.slotId !== 'number' || !img.url) return;
          nextPreviews[String(img.slotId)] = img.url;
        });
        setImagePreviews(nextPreviews);
      } else {
        setImagePreviews(initialImagePreviews);
      }
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
                    previewUrl={imagePreviews[String(slot.id)]}
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
                          previewUrl={imagePreviews[String(slot.id)]}
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
          {!isReadyToSubmit && readinessMessages.length ? (
            <p className={styles.readinessText}>{readinessMessages.join(' / ')}</p>
          ) : null}
          {status ? <p className={styles.successText}>{status}</p> : null}
          {error ? <p className={styles.errorText}>{error}</p> : null}
        </footer>
      </section>
    </div>
  );
}
