import Link from 'next/link';

import type { CleanerSnapshot } from './page';
import styles from './dashboard.module.css';

type Props = {
  snapshot: CleanerSnapshot | null;
};

function getStatusLabel(snapshot: CleanerSnapshot) {
  if (snapshot.tomorrowWorkApplied) {
    return '내일 근무 신청 완료';
  }

  if (snapshot.workApplied) {
    return '오늘 근무 신청 완료';
  }

  if (snapshot.canApplyNow) {
    return '지금 신청 가능';
  }

  return '신청 대기중';
}

export default function CleanerPanel({ snapshot }: Props) {
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
          <span>클리너 등급</span>
          <strong>{snapshot.tierLabel}</strong>
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
            업무 신청하기
          </Link>
        </div>
      ) : null}

      <section className={styles.applicationPanel} aria-label="신청현황">
        <header>
          <p>신청현황</p>
          <span>날짜 · 구역</span>
        </header>
        <ul className={styles.applicationList}>
          {snapshot.applications.length ? (
            snapshot.applications.map((application) => (
              <li key={application.id} className={styles.applicationRow}>
                <div className={styles.applicationMeta}>
                  <p className={styles.applicationDate}>{application.dateLabel}</p>
                  <p className={styles.applicationArea}>{application.sectorLabel}</p>
                </div>
                <button type="button" className={styles.applicationCancel} aria-label={`${application.dateLabel} 신청 취소`}>
                  취소하기
                </button>
              </li>
            ))
          ) : (
            <li className={styles.applicationEmpty}>신청된 근무가 없습니다.</li>
          )}
        </ul>
      </section>

      <div className={styles.secondaryCtas}>
        <Link href="/screens/004" className={styles.linkButton} prefetch={false}>
          과업지시서 (ID 004)
        </Link>
        <Link href="/screens/007" className={styles.linkButton} prefetch={false}>
          평가이력 (ID 007)
        </Link>
      </div>
    </section>
  );
}
