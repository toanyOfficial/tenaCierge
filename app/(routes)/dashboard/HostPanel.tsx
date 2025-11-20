import Link from 'next/link';

import styles from './dashboard.module.css';

const hostLinks = [
  { screenId: '002', label: '오더관리' },
  { screenId: '004', label: '과업지시서' },
  { screenId: '008', label: '정산관리' }
];

export default function HostPanel() {
  return (
    <section className={styles.hostPanel} data-child-id="6">
      <header className={styles.panelHeader}>
        <div>
          <p className={styles.panelTitle}>호스트 바로가기</p>
          <p className={styles.panelSubtitle}>자주 사용하는 화면으로 빠르게 이동하세요.</p>
        </div>
      </header>

      <div className={styles.quickLinkGrid}>
        {hostLinks.map((link) => (
          <Link key={link.screenId} href={`/screens/${link.screenId}`} className={styles.linkButton} prefetch={false}>
            {link.label}
          </Link>
        ))}
      </div>
    </section>
  );
}
