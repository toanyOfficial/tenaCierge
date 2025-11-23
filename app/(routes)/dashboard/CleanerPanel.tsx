import Link from 'next/link';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { useRouter } from 'next/navigation';

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
  const router = useRouter();

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
  const highlightWorklist = snapshot.highlightWorklist;
  const highlightApply = snapshot.highlightApply;

  const handleWorklistClick = async (event: ReactMouseEvent<HTMLAnchorElement>) => {
    if (!highlightWorklist) {
      event.preventDefault();
      return;
    }

    event.preventDefault();

    try {
      const res = await fetch('/api/work-access?role=cleaner');
      const body = await res.json().catch(() => ({}));

      if (!body?.allowed) {
        alert(body?.message ?? '오늘, 내일 중 업무 신청 사항이 없습니다.');
        return;
      }

      router.push('/screens/004');
    } catch (error) {
      alert('접근 검증 중 오류가 발생했습니다.');
    }
  };

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

      <div className={styles.cleanerCtas}>
        <Link
          href="/screens/003"
          className={`${styles.linkButton} ${highlightApply ? styles.ctaHighlight : styles.ctaDisabled}`}
          aria-disabled={!snapshot.canApplyNow}
          prefetch={false}
          tabIndex={snapshot.canApplyNow ? 0 : -1}
        >
          업무 신청하기
        </Link>
        <Link
          href="/screens/004"
          className={`${styles.linkButton} ${highlightWorklist ? styles.ctaHighlight : styles.ctaDisabled}`}
          aria-disabled={!highlightWorklist}
          prefetch={false}
          tabIndex={highlightWorklist ? 0 : -1}
          onClick={handleWorklistClick}
        >
          과업지시서
        </Link>
        <Link href="/screens/007" className={`${styles.linkButton} ${styles.ctaNeutral}`} prefetch={false}>
          평가이력
        </Link>
      </div>

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
              </li>
            ))
          ) : (
            <li className={styles.applicationEmpty}>신청된 근무가 없습니다.</li>
          )}
        </ul>
      </section>

    </section>
  );
}
