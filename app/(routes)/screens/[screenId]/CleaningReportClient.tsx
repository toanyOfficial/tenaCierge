"use client";

import { useMemo, useState } from 'react';

import styles from './screens.module.css';
import CommonHeader from '@/app/(routes)/dashboard/CommonHeader';
import type { CleaningReportSnapshot } from './server/getCleaningReportSnapshot';
import type { ProfileSummary } from '@/src/utils/profile';

type Props = {
  snapshot: CleaningReportSnapshot;
  profile: ProfileSummary;
};

export default function CleaningReportClient({ snapshot, profile }: Props) {
  const { work, cleaningChecklist, suppliesChecklist } = snapshot;
  const [activeRole, setActiveRole] = useState(profile.primaryRole ?? profile.roles[0] ?? null);
  const [cleaningChecks, setCleaningChecks] = useState<Set<number>>(new Set());
  const [supplyChecks, setSupplyChecks] = useState<Set<number>>(new Set());
  const [images, setImages] = useState<File[]>([]);
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

  const handleImages = (files: FileList | null) => {
    if (!files) return;
    setImages(Array.from(files));
  };

  const handleSubmit = async () => {
    setStatus('');
    setError('');
    setSubmitting(true);

    try {
      const formData = new FormData();
      formData.append('workId', String(work.id));
      formData.append('cleaningChecks', JSON.stringify(Array.from(cleaningChecks)));
      formData.append('supplyChecks', JSON.stringify(Array.from(supplyChecks)));
      images.forEach((file) => formData.append('images', file));

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
      setImages([]);
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
        <div className={styles.sectionHeader}>
          <div>
            <p className={styles.sectionLabel}>ID 005 · work report</p>
            <p className={styles.sectionTitle}>청소완료보고</p>
            <p className={styles.subtle}>작업 정보를 확인한 뒤 체크리스트와 사진을 제출하세요.</p>
          </div>
          <div className={styles.windowMeta}>
            <span className={styles.windowBadge}>작업일 {work.date}</span>
            <span className={styles.badgeMuted}>총 침대 {work.bedCount}개</span>
          </div>
        </div>

        <div className={styles.reportSummaryGrid}>
          <article className={styles.workCard}>
            <header className={styles.workCardHeader}>
              <p className={styles.workTitle}>{roomTitle}</p>
              <p className={styles.workSubtitle}>{work.buildingName}</p>
            </header>
            <div className={styles.workMetaRow}>
              <span className={styles.badgeMuted}>Work #{work.id}</span>
              <span className={styles.badgePositive}>{work.sectorValue || '섹터 미지정'}</span>
            </div>
            <div className={styles.workMetaRow}>
              <span className={styles.windowBadge}>체크아웃 {work.checkoutTime}</span>
              <span className={styles.windowBadge}>체크인 {work.checkinTime}</span>
            </div>
          </article>

          <article className={styles.workCard}>
            <header className={styles.workCardHeader}>
              <p className={styles.workTitle}>요청 사항</p>
              <p className={styles.workSubtitle}>담요 {work.blanketQty}개 · 어메니티 {work.amenitiesQty}개</p>
            </header>
            <p className={styles.requirementsText}>{work.requirements || '추가 요청 사항이 없습니다.'}</p>
            {work.cancelYn ? (
              <p className={styles.badgeDanger}>취소된 작업</p>
            ) : (
              <p className={styles.badgeMuted}>진행 예정</p>
            )}
          </article>
        </div>

        <div className={styles.reportGrid}>
          <div className={styles.reportCard}>
            <header className={styles.reportCardHeader}>
              <h2>청소 체크리스트</h2>
              <p className={styles.reportHint}>청소 결과를 선택해 주세요.</p>
            </header>
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
            <header className={styles.reportCardHeader}>
              <h2>소모품 체크</h2>
              <p className={styles.reportHint}>필요한 소모품을 선택해 주세요.</p>
            </header>
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
            <header className={styles.reportCardHeader}>
              <h2>사진 업로드</h2>
              <p className={styles.reportHint}>필요한 사진을 업로드해 주세요.</p>
            </header>
            <label className={styles.uploadBox}>
              <input type="file" accept="image/*" multiple onChange={(e) => handleImages(e.target.files)} />
              <span>이미지 선택</span>
            </label>
            {images.length ? (
              <ul className={styles.fileList}>
                {images.map((file) => (
                  <li key={file.name}>{file.name}</li>
                ))}
              </ul>
            ) : null}
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
