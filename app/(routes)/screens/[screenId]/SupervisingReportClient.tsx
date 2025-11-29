"use client";
/* eslint-disable @next/next/no-img-element */

import type { MouseEvent } from 'react';
import { useMemo, useRef, useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

import CommonHeader from '@/app/(routes)/dashboard/CommonHeader';
import styles from './screens.module.css';
import type { ImageSlot, SupervisingReportSnapshot } from './server/getSupervisingReportSnapshot';
import type { ProfileSummary } from '@/src/utils/profile';

type Props = {
  profile: ProfileSummary;
  snapshot: SupervisingReportSnapshot;
};

type ImageTileProps = {
  slot: ImageSlot;
  selectedFile?: File | null;
  previewUrl?: string | null;
  onChange: (slotKey: string, files: FileList | null) => void;
  required?: boolean;
  onRequestFile: (slotKey: string, inputEl: HTMLInputElement | null) => void;
  captureMode: 'camera' | 'album';
  isDesktop: boolean;
};

function ImageTile({ slot, selectedFile, previewUrl, onChange, onRequestFile, required, captureMode, isDesktop }: ImageTileProps) {
  const slotKey = String(slot.id);
  const hintText = selectedFile?.name ?? (previewUrl ? '기존 이미지' : '파일을 선택하세요');
  const inputRef = useRef<HTMLInputElement | null>(null);

  const handleOpen = (event: MouseEvent) => {
    event.preventDefault();
    onRequestFile(slotKey, inputRef.current);
  };

  return (
    <label
      className={`${styles.imageTile} ${required ? styles.imageTileRequired : styles.imageTileOptional}`.trim()}
      aria-label={`${required ? '필수' : '선택'} 이미지 ${slot.title}`}
      onClick={handleOpen}
    >
      <input
        type="file"
        accept="image/*"
        onChange={(e) => onChange(slotKey, e.target.files)}
        ref={inputRef}
        capture={captureMode === 'camera' && !isDesktop ? 'environment' : undefined}
        className={styles.imageInput}
      />

      <div className={styles.imageTextBlock}>
        <span className={styles.imageLabel}>{slot.title}</span>
        {slot.comment ? <span className={styles.imageComment}>{slot.comment}</span> : null}
        {previewUrl ? <img src={previewUrl} alt={`${slot.title} 미리보기`} className={styles.imagePreview} /> : null}
        <span className={styles.imageHint}>{hintText}</span>
      </div>
    </label>
  );
}

export default function SupervisingReportClient({ profile, snapshot }: Props) {
  const { work, cleaningChecklist, suppliesChecklist, imageSlots, existingCleaningChecks, existingSupplyChecks, savedImages } =
    snapshot;
  const router = useRouter();
  const [activeRole, setActiveRole] = useState(profile.primaryRole ?? profile.roles[0] ?? null);
  const requiredImageSlots = useMemo(() => imageSlots.filter((slot) => slot.required), [imageSlots]);
  const optionalImageSlots = useMemo(() => imageSlots.filter((slot) => !slot.required), [imageSlots]);
  const imageSlotKeys = useMemo(() => imageSlots.map((slot) => String(slot.id)), [imageSlots]);
  const [captureMode, setCaptureMode] = useState<'camera' | 'album'>('camera');
  const isDesktop = useMemo(() => {
    if (typeof navigator === 'undefined') return false;
    return !/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  }, []);
  useEffect(() => {
    setCaptureMode(isDesktop ? 'album' : 'camera');
  }, [isDesktop]);
  const lockedCleaningCheckIds = useMemo(
    () => new Set(cleaningChecklist.filter((item) => item.score > 0).map((item) => item.id)),
    [cleaningChecklist]
  );
  const visibleCleaningChecklist = useMemo(
    () => cleaningChecklist.filter((item) => item.score <= 0),
    [cleaningChecklist]
  );
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

  const [cleaningChecks, setCleaningChecks] = useState<Set<number>>(
    () => new Set([...lockedCleaningCheckIds, ...(existingCleaningChecks ?? [])])
  );
  const [supplyChecks, setSupplyChecks] = useState<Set<number>>(new Set(existingSupplyChecks ?? []));
  const [imageSelections, setImageSelections] = useState<Record<string, File | null>>(initialImageSelections);
  const [imagePreviews, setImagePreviews] = useState<Record<string, string | null>>(initialImagePreviews);
  const [status, setStatus] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);

  const requiredImagesReady = useMemo(
    () => requiredImageSlots.every((slot) => imageSelections[String(slot.id)] || imagePreviews[String(slot.id)]),
    [requiredImageSlots, imageSelections, imagePreviews]
  );

  const readinessMessages = useMemo(() => {
    const messages: string[] = [];

    if (!requiredImagesReady && requiredImageSlots.length > 0) messages.push('필수 사진 항목을 확인하세요.');

    return messages;
  }, [requiredImagesReady, requiredImageSlots]);

  const isReadyToSubmit = readinessMessages.length === 0;

  const roomTitle = useMemo(() => `${work.buildingShortName}${work.roomNo}`, [work.buildingShortName, work.roomNo]);

  const toggleCheck = (id: number, target: Set<number>, setter: (next: Set<number>) => void, locked?: Set<number>) => {
    if (locked?.has(id)) return;

    const next = new Set(target);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }

    locked?.forEach((lockedId) => next.add(lockedId));
    setter(next);
  };

  const handleImageChange = (slotKey: string, files: FileList | null) => {
    if (!files || !files[0]) return;
    const [file] = files;
    setImageSelections((prev) => ({ ...prev, [slotKey]: file }));
    setImagePreviews((prev) => ({ ...prev, [slotKey]: URL.createObjectURL(file) }));
  };

  const handleRequestFile = async (_slotKey: string, inputEl: HTMLInputElement | null) => {
    if (!inputEl) return;

    inputEl.value = '';
    const effectiveMode = isDesktop ? 'album' : captureMode;

    if (effectiveMode === 'album') {
      inputEl.removeAttribute('capture');
      inputEl.click();
      return;
    }

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('카메라를 초기화할 수 없습니다.');
      }

      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      stream.getTracks().forEach((track) => track.stop());
      inputEl.setAttribute('capture', 'environment');
      inputEl.click();
    } catch (err) {
      window.alert('카메라 앱 실행에 실패하여 앨범 모드로 전환합니다.');
      setCaptureMode('album');
      inputEl.removeAttribute('capture');
      inputEl.click();
    }
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

      const res = await fetch('/api/supervising-reports', {
        method: 'POST',
        body: formData
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.message || '저장 중 오류가 발생했습니다.');
      }

      setStatus('수퍼바이징 완료보고가 저장되었습니다.');
      window.alert('보고가 정상적으로 제출되었습니다.');
      router.push('/screens/004');
    } catch (err) {
      const message = err instanceof Error ? err.message : '저장 중 오류가 발생했습니다.';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={styles.screenShell}>
      <CommonHeader profile={profile} activeRole={activeRole} onRoleChange={setActiveRole} compact />
      <section className={styles.cleaningSection}>
        <header className={styles.roomHero}>
          <p className={styles.heroLabel}>호실</p>
          <p className={styles.heroTitle}>{roomTitle}</p>
          <p className={styles.heroSub}>작업일 {work.date}</p>
        </header>

        <div className={styles.reportGridStacked}>
          <article className={styles.reportCardWide}>
            <header className={styles.reportCardHeader}>수퍼바이징 체크리스트</header>
            {visibleCleaningChecklist.length === 0 ? (
              <p className={styles.reportEmpty}>체크리스트가 없습니다.</p>
            ) : (
              <ul className={styles.checklist}>
                {visibleCleaningChecklist.map((item) => (
                  <li key={item.id} className={styles.checkItem}>
                    <label>
                      <input
                        type="checkbox"
                        checked={cleaningChecks.has(item.id)}
                        onChange={() => toggleCheck(item.id, cleaningChecks, setCleaningChecks, lockedCleaningCheckIds)}
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
            <div className={styles.captureToggleRow}>
              <div className={styles.captureToggleLabel}>촬영 방식</div>
              <div className={styles.captureToggleGroup}>
                <button
                  type="button"
                  className={`${styles.captureToggleButton} ${captureMode === 'camera' && !isDesktop ? styles.captureToggleActive : ''}`.trim()}
                  onClick={() => setCaptureMode('camera')}
                  aria-pressed={captureMode === 'camera' && !isDesktop}
                >
                  카메라 모드
                </button>
                <button
                  type="button"
                  className={`${styles.captureToggleButton} ${captureMode === 'album' || isDesktop ? styles.captureToggleActive : ''}`.trim()}
                  onClick={() => setCaptureMode('album')}
                  aria-pressed={captureMode === 'album' || isDesktop}
                >
                  앨범 모드
                </button>
              </div>
              <p className={styles.captureToggleHint}>
                기본은 카메라 모드이며, 실행 실패 또는 PC 환경에서는 자동으로 앨범 모드로 전환됩니다.
              </p>
            </div>
            {imageSlots.length === 0 ? (
              <p className={styles.reportEmpty}>업로드할 이미지가 없습니다.</p>
            ) : (
              <div className={styles.imageGroupStack}>
                {requiredImageSlots.length > 0 ? (
                  <div className={styles.imageGroup}>
                    <div className={styles.imageGroupHeader}>
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
                          onRequestFile={handleRequestFile}
                          captureMode={captureMode}
                          isDesktop={isDesktop}
                          required
                        />
                      ))}
                    </div>
                  </div>
                ) : null}

                {optionalImageSlots.length > 0 ? (
                  <div className={styles.imageGroup}>
                    <div className={styles.imageGroupHeader}>
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
                          onRequestFile={handleRequestFile}
                          captureMode={captureMode}
                          isDesktop={isDesktop}
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
            {submitting ? '저장 중...' : '수퍼바이징 완료보고 저장'}
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
