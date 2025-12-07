"use client";
/* eslint-disable @next/next/no-img-element */

import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import CommonHeader from '@/app/(routes)/dashboard/CommonHeader';
import styles from './screens.module.css';
import { resizeImageFile } from './clientImageResize';
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
  onChange: (slotKey: string, files: FileList | null) => void | Promise<void>;
  required?: boolean;
};

function ImageTile({ slot, selectedFile, previewUrl, onChange, required }: ImageTileProps) {
  const slotKey = String(slot.id);
  const hintText = selectedFile?.name ?? (previewUrl ? '기존 이미지' : '파일을 선택하세요');
  const inputRef = useRef<HTMLInputElement | null>(null);

  const prepareInput = () => {
    const inputEl = inputRef.current;
    if (!inputEl) return;

    inputEl.value = '';
    inputEl.removeAttribute('capture');
    inputEl.setAttribute('accept', 'image/*');
  };

  return (
    <label
      className={`${styles.imageTile} ${required ? styles.imageTileRequired : styles.imageTileOptional}`.trim()}
      aria-label={`${required ? '필수' : '선택'} 이미지 ${slot.title}`}
    >
      <input
        type="file"
        accept="image/*"
        onClick={prepareInput}
        onChange={(e) => onChange(slotKey, e.target.files)}
        ref={inputRef}
        className={styles.imageInput}
        tabIndex={-1}
        aria-hidden
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

  const autoCheckedChecklistIds = useMemo(
    () => cleaningChecklist.filter((item) => Number(item.score) > 0 || Number(item.listScore) > 0).map(({ id }) => id),
    [cleaningChecklist]
  );

  const visibleCleaningChecklist = useMemo(
    () => cleaningChecklist.filter((item) => Number(item.score) <= 0 && Number(item.listScore) <= 0),
    [cleaningChecklist]
  );

  const findingDefaults = useMemo(
    () => ({
      ...Object.fromEntries(cleaningChecklist.map(({ id }) => [id, false] as const)),
      ...existingSupervisingFindingChecks,
      ...Object.fromEntries(autoCheckedChecklistIds.map((id) => [id, true] as const))
    }),
    [autoCheckedChecklistIds, cleaningChecklist, existingSupervisingFindingChecks]
  );

  const completionDefaults = useMemo(
    () => ({
      ...Object.fromEntries(cleaningChecklist.map(({ id }) => [id, false] as const)),
      ...existingSupervisingCompletionChecks,
      ...Object.fromEntries(autoCheckedChecklistIds.map((id) => [id, true] as const))
    }),
    [autoCheckedChecklistIds, cleaningChecklist, existingSupervisingCompletionChecks]
  );

  const baseChecklistFlags = useMemo(
    () => Object.fromEntries(cleaningChecklist.map(({ id }) => [id, false] as const)),
    [cleaningChecklist]
  );

  const autoCheckedFlags = useMemo(
    () => Object.fromEntries(autoCheckedChecklistIds.map((id) => [id, true] as const)),
    [autoCheckedChecklistIds]
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

  const handleImageChange = async (slotKey: string, files: FileList | null) => {
    if (!files || !files[0]) return;
    const [file] = files;

    const resizedFile = await resizeImageFile(file);
    setImageSelections((prev) => ({ ...prev, [slotKey]: resizedFile }));
    setImagePreviews((prev) => ({ ...prev, [slotKey]: URL.createObjectURL(resizedFile) }));
  };

  const handleSubmit = async () => {
    setStatus('');
    setError('');

    if (!isReadyToSubmit) {
      setError(readinessMessages.join(' / '));
      return;
    }

    const trimmedRequirements = work.requirements?.trim();
    if (trimmedRequirements) {
      window.alert(`요구사항 : ${trimmedRequirements} 을 확인 하셨나요?`);
    }

    setSubmitting(true);

    try {
      const formData = new FormData();
      const selectedImages = imageSlotKeys
        .map((key) => ({ key, file: imageSelections[key] }))
        .filter((entry) => Boolean(entry.file)) as { key: string; file: File }[];

      const persistableFindingChecks = {
        ...baseChecklistFlags,
        ...supervisingFindingChecks,
        ...autoCheckedFlags
      };

      const persistableCompletionChecks = {
        ...baseChecklistFlags,
        ...supervisingCompletionChecks,
        ...autoCheckedFlags
      };

      formData.append('workId', String(work.id));
      formData.append('supervisingFindings', JSON.stringify(persistableFindingChecks));
      formData.append('supervisingCompletion', JSON.stringify(persistableCompletionChecks));
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
      if (message.toLowerCase().includes('failed to fetch')) {
        setError('네트워크 연결이 불안정합니다. 잠시 후 다시 시도해주세요.');
      } else {
        setError(message);
      }
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
            <p className={styles.captureToggleHint}>
              이미지는 앨범 보기에서 바로 선택됩니다. 필요하면 앨범 내 카메라로 촬영 후 추가해주세요.
            </p>
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
