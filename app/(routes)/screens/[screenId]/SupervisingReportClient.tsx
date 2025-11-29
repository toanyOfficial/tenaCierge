"use client";
/* eslint-disable @next/next/no-img-element */

import type { KeyboardEvent, MouseEvent } from 'react';
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
  onRequestFile: (
    slotKey: string,
    inputEl: HTMLInputElement | null,
    options?: {
      triggerClick?: boolean;
    }
  ) => void;
  captureMode: 'camera' | 'album';
  isDesktop: boolean;
};

function ImageTile({ slot, selectedFile, previewUrl, onChange, onRequestFile, required, captureMode, isDesktop }: ImageTileProps) {
  const slotKey = String(slot.id);
  const hintText = selectedFile?.name ?? (previewUrl ? '기존 이미지' : '파일을 선택하세요');
  const inputRef = useRef<HTMLInputElement | null>(null);

  const handleInputClick = (event: MouseEvent<HTMLInputElement>) => {
    if (captureMode !== 'album' && !isDesktop) {
      event.preventDefault();
      event.stopPropagation();
      onRequestFile(slotKey, inputRef.current, { triggerClick: true });
      return;
    }

    onRequestFile(slotKey, inputRef.current, { triggerClick: false });
  };

  const handleKeyOpen = (event: KeyboardEvent<HTMLLabelElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    event.stopPropagation();
    onRequestFile(slotKey, inputRef.current, { triggerClick: true });
  };

  return (
    <label
      className={`${styles.imageTile} ${required ? styles.imageTileRequired : styles.imageTileOptional}`.trim()}
      aria-label={`${required ? '필수' : '선택'} 이미지 ${slot.title}`}
      onKeyDown={handleKeyOpen}
      tabIndex={0}
    >
      <input
        type="file"
        accept="image/*"
        onChange={(e) => onChange(slotKey, e.target.files)}
        onClick={handleInputClick}
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
  const {
    work,
    cleaningChecklist,
    suppliesChecklist,
    imageSlots,
    existingSupervisingFindingChecks,
    existingSupervisingCompletionChecks,
    existingSupplyChecks,
    existingSupplyNotes,
    savedImages
  } = snapshot;
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

  const scoredChecklistIds = useMemo(
    () => cleaningChecklist.filter((item) => Number(item.score) > 0).map(({ id }) => id),
    [cleaningChecklist]
  );

  const visibleCleaningChecklist = useMemo(
    () => cleaningChecklist.filter((item) => Number(item.score) <= 0),
    [cleaningChecklist]
  );

  const findingDefaults = useMemo(
    () => ({
      ...Object.fromEntries(cleaningChecklist.map(({ id }) => [id, false] as const)),
      ...existingSupervisingFindingChecks,
      ...Object.fromEntries(scoredChecklistIds.map((id) => [id, true] as const))
    }),
    [cleaningChecklist, existingSupervisingFindingChecks, scoredChecklistIds]
  );

  const completionDefaults = useMemo(
    () => ({
      ...Object.fromEntries(cleaningChecklist.map(({ id }) => [id, false] as const)),
      ...existingSupervisingCompletionChecks,
      ...Object.fromEntries(scoredChecklistIds.map((id) => [id, true] as const))
    }),
    [cleaningChecklist, existingSupervisingCompletionChecks, scoredChecklistIds]
  );

  const [supervisingFindingChecks, setSupervisingFindingChecks] = useState<Record<number, boolean>>(findingDefaults);
  const [supervisingCompletionChecks, setSupervisingCompletionChecks] = useState<Record<number, boolean>>(completionDefaults);
  const [supplyChecks, setSupplyChecks] = useState<Set<number>>(new Set(existingSupplyChecks ?? []));
  const [supplyNotes, setSupplyNotes] = useState<Record<number, string>>(existingSupplyNotes ?? {});
  const [imageSelections, setImageSelections] = useState<Record<string, File | null>>(initialImageSelections);
  const [imagePreviews, setImagePreviews] = useState<Record<string, string | null>>(initialImagePreviews);
  const [status, setStatus] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [noteModal, setNoteModal] = useState<{ open: boolean; targetId: number | null; draft: string }>(
    {
      open: false,
      targetId: null,
      draft: ''
    }
  );

  const requiredImagesReady = useMemo(
    () => requiredImageSlots.every((slot) => imageSelections[String(slot.id)] || imagePreviews[String(slot.id)]),
    [requiredImageSlots, imageSelections, imagePreviews]
  );

  const readinessMessages = useMemo(() => {
    const messages: string[] = [];

    if (!requiredImagesReady && requiredImageSlots.length > 0) messages.push('필수 사진 항목을 확인하세요.');
    const hasIncomplete = visibleCleaningChecklist.some((item) => !supervisingCompletionChecks[item.id]);
    if (hasIncomplete) messages.push('완료여부를 모두 체크해주세요.');

    return messages;
  }, [requiredImagesReady, requiredImageSlots, supervisingCompletionChecks, visibleCleaningChecklist]);

  const isReadyToSubmit = readinessMessages.length === 0;

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

  const openNoteModal = (id: number) => {
    setNoteModal({
      open: true,
      targetId: id,
      draft: supplyNotes[id] ?? ''
    });
  };

  const closeNoteModal = () => {
    setNoteModal({ open: false, targetId: null, draft: '' });
  };

  const saveNote = () => {
    if (noteModal.targetId == null) return;
    const targetId = noteModal.targetId;
    const trimmed = noteModal.draft.trim();

    setSupplyNotes((prev) => {
      const next = { ...prev };
      if (trimmed) {
        next[targetId] = trimmed;
      } else {
        delete next[targetId];
      }
      return next;
    });

    setSupplyChecks((prev) => {
      const next = new Set(prev);
      next.add(targetId);
      return next;
    });

    closeNoteModal();
  };

  const toggleFindingFlag = (id: number) => {
    setSupervisingFindingChecks((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const toggleCompletionFlag = (id: number) => {
    setSupervisingCompletionChecks((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleImageChange = (slotKey: string, files: FileList | null) => {
    if (!files || !files[0]) return;
    const [file] = files;
    setImageSelections((prev) => ({ ...prev, [slotKey]: file }));
    setImagePreviews((prev) => ({ ...prev, [slotKey]: URL.createObjectURL(file) }));
  };

  const handleRequestFile = async (
    _slotKey: string,
    inputEl: HTMLInputElement | null,
    options?: { triggerClick?: boolean }
  ) => {
    if (!inputEl) return;

    const shouldTrigger = options?.triggerClick ?? false;
    inputEl.value = '';
    const effectiveMode = isDesktop ? 'album' : captureMode;

    if (effectiveMode === 'album') {
      inputEl.removeAttribute('capture');
      if (shouldTrigger) inputEl.click();
      return;
    }

    try {
      inputEl.setAttribute('capture', 'environment');
      inputEl.setAttribute('accept', 'image/*');
      if (shouldTrigger) inputEl.click();
    } catch (err) {
      window.alert('카메라 앱 실행에 실패하여 앨범 모드로 전환합니다.');
      setCaptureMode('album');
      inputEl.removeAttribute('capture');
      if (shouldTrigger) inputEl.click();
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
      formData.append('supervisingFindings', JSON.stringify(supervisingFindingChecks));
      formData.append('supervisingCompletion', JSON.stringify(supervisingCompletionChecks));
      formData.append('supplyChecks', JSON.stringify(Array.from(supplyChecks)));

      const normalizedNotes = Object.entries(supplyNotes).reduce((acc, [key, val]) => {
        const trimmed = val.trim();
        if (trimmed) {
          acc[key] = trimmed;
        }
        return acc;
      }, {} as Record<string, string>);

      if (Object.keys(normalizedNotes).length) {
        formData.append('supplyNotes', JSON.stringify(normalizedNotes));
      }
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
            {cleaningChecklist.length === 0 ? (
              <p className={styles.reportEmpty}>체크리스트가 없습니다.</p>
            ) : (
              <div className={styles.supervisingChecklistWrapper}>
                <div className={styles.supervisingGuide}>
                  <div className={styles.supervisingGuideItem}>
                    <span className={styles.checkColumnTitle}>미흡여부</span>
                    <span className={styles.checkDescription}>청소완료상태가 미흡한 경우 체크합니다.</span>
                  </div>
                  <div className={styles.supervisingGuideItem}>
                    <span className={styles.checkColumnTitle}>완료여부</span>
                    <span className={styles.checkDescription}>하나하나 체크하며 점검해주세요</span>
                  </div>
                </div>

                <div className={styles.supervisingGrid}>
                  <div className={`${styles.supervisingGridRow} ${styles.supervisingGridHeader}`}>
                    <div className={styles.supervisingColumnHead}>미흡여부</div>
                    <div className={styles.supervisingColumnHead}>완료여부</div>
                    <div className={styles.supervisingItemHead}>항목</div>
                  </div>
                  {visibleCleaningChecklist.map((item) => (
                    <div key={item.id} className={styles.supervisingGridRow}>
                      <label className={styles.supervisingCheckCell}>
                        <input
                          type="checkbox"
                          checked={supervisingFindingChecks[item.id] ?? false}
                          onChange={() => toggleFindingFlag(item.id)}
                        />
                      </label>
                      <label className={styles.supervisingCheckCell}>
                        <input
                          type="checkbox"
                          checked={supervisingCompletionChecks[item.id] ?? false}
                          onChange={() => toggleCompletionFlag(item.id)}
                        />
                      </label>
                      <div className={styles.supervisingItemCell}>
                        <span className={styles.checkTitle}>{item.title}</span>
                        {item.description ? <span className={styles.checkDescription}>{item.description}</span> : null}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </article>

          <article className={styles.reportCardWide}>
            <header className={styles.reportCardHeader}>부족한 소모품을 체크해주세요.</header>
            {suppliesChecklist.length === 0 ? (
              <p className={styles.reportEmpty}>소모품 체크리스트가 없습니다.</p>
            ) : (
              <ul className={styles.checklist}>
                {suppliesChecklist.map((item) => (
                  <li key={item.id} className={styles.checkItem}>
                    <div className={styles.checkRow}>
                      <label className={styles.checkLabel}>
                        <input
                          type="checkbox"
                          checked={supplyChecks.has(item.id)}
                          onChange={() => toggleCheck(item.id, supplyChecks, setSupplyChecks)}
                        />
                        <span>{item.title}</span>
                      </label>
                      {!item.description ? (
                        <button type="button" className={styles.noteButton} onClick={() => openNoteModal(item.id)}>
                          내용입력
                        </button>
                      ) : null}
                      {supplyNotes[item.id] ? (
                        <p className={styles.checkNote}>
                          <strong>입력내용</strong>
                          <span>{supplyNotes[item.id]}</span>
                        </p>
                      ) : null}
                    </div>
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

      {noteModal.open ? (
        <div className={styles.modalBackdrop} role="dialog" aria-modal="true" aria-label="소모품 내용 입력">
          <div className={styles.modalCard}>
            <div className={styles.modalHead}>
              <span>소모품 내용 입력</span>
              <button type="button" onClick={closeNoteModal} aria-label="닫기">
                ×
              </button>
            </div>
            <div className={styles.modalBody}>
              <p className={styles.modalSub}>필요한 내용을 입력하면 해당 소모품 항목에 기록됩니다.</p>
              <textarea
                className={styles.noteTextarea}
                rows={4}
                value={noteModal.draft}
                onChange={(e) => setNoteModal((prev) => ({ ...prev, draft: e.target.value }))}
                placeholder="필요한 내용을 입력하세요"
              />
            </div>
            <div className={styles.modalFoot}>
              <button type="button" className={styles.secondaryButton} onClick={closeNoteModal}>
                취소
              </button>
              <button type="button" className={styles.primaryButton} onClick={saveNote}>
                저장
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
