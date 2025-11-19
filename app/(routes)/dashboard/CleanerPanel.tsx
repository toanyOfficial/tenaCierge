import Link from 'next/link';

import type { CleanerSnapshot, ProfileSummary } from './page';
import styles from './dashboard.module.css';

type Props = {
  profile: ProfileSummary;
  snapshot: CleanerSnapshot | null;
};

function getStatusLabel(snapshot: CleanerSnapshot) {
  if (snapshot.workApplied) {
    return '오늘 근무 신청 완료';
  }

  if (snapshot.canApplyNow) {
    return '지금 신청 가능';
  }

  return '신청 대기중';
}

export default function CleanerPanel({ profile, snapshot }: Props) {
  if (!snapshot) {
    return (
      <section className={styles.cleanerPanel} data-child-id="5">
        <header className={styles.cleanerHeader}>
          <div>
            <p className={styles.cleanerTitle}>클리너 개인 일정</p>
            <p className={styles.cleanerSubtitle}>현재 쿠키 정보로는 클리너 세부 정보를 찾을 수 없습니다.</p>
          </div>
        </header>
        <p className={styles.cleanerMessage}>로그인을 다시 시도하거나 운영팀에 문의해 주세요.</p>
      </section>
    );
  }

  const statusLabel = getStatusLabel(snapshot);

  return (
    <section className={styles.cleanerPanel} data-child-id="5">
      <header className={styles.cleanerHeader}>
        <div>
          <p className={styles.cleanerTitle}>클리너 개인 일정</p>
          <p className={styles.cleanerSubtitle}>{snapshot.workDateLabel}</p>
        </div>
        <div className={styles.tierChip} aria-label="클리너 등급">
          <span>Tier</span>
          <strong>{snapshot.tier ?? '-'}</strong>
        </div>
      </header>

      <p className={styles.cleanerMessage}>{snapshot.message}</p>

      <div className={styles.statusRow}>
        <span className={styles.statusBadge}>{statusLabel}</span>
        <span className={styles.statusTime}>현재 시각 (KST) · {snapshot.currentTimeLabel}</span>
      </div>

      {snapshot.canApplyNow ? (
        <div className={styles.primaryCtaWrap}>
          <Link href="/screens/003" className={`${styles.linkButton} ${styles.primaryCta}`} prefetch={false}>
            업무 신청 화면으로 이동 (ID 003)
          </Link>
        </div>
      ) : null}

      <div className={styles.metaGrid}>
        <div className={styles.metaTile}>
          <p className={styles.metaLabel}>클리너</p>
          <p className={styles.metaValue}>{profile.name}</p>
        </div>
        <div className={styles.metaTile}>
          <p className={styles.metaLabel}>근무 구역</p>
          <p className={styles.metaValue}>{snapshot.assignmentSummary ?? snapshot.sectorName ?? '미정'}</p>
        </div>
        <div className={styles.metaTile}>
          <p className={styles.metaLabel}>신청 가능 시간</p>
          <p className={styles.metaValue}>{snapshot.applyAvailableAt}</p>
        </div>
        <div className={styles.metaTile}>
          <p className={styles.metaLabel}>근무 신청 여부</p>
          <p className={styles.metaValue}>{snapshot.workApplied ? 'Y' : 'N'}</p>
        </div>
      </div>

      <div className={styles.secondaryCtas}>
        <Link href="/screens/004" className={styles.linkButton} prefetch={false}>
          화면 004 바로가기
        </Link>
        <Link href="/screens/007" className={styles.linkButton} prefetch={false}>
          화면 007 바로가기
        </Link>
      </div>
    </section>
  );
}
