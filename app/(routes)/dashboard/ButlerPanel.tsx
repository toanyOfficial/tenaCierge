import Link from 'next/link';
import { useMemo, useState } from 'react';

import styles from './dashboard.module.css';
import type { ButlerDetailEntry, ButlerSnapshotOption } from './page';

const SECTOR_ORDER = ['신논현', '역삼', '논현'];

type Props = {
  snapshots: ButlerSnapshotOption[];
  activeKey: string | null;
  onChangeDate: (key: string) => void;
};

export default function ButlerPanel({ snapshots, activeKey, onChangeDate }: Props) {
  const snapshot = useMemo(() => {
    if (!snapshots.length) return null;
    if (activeKey) {
      return snapshots.find((option) => option.key === activeKey) ?? snapshots[0];
    }
    return snapshots[0];
  }, [activeKey, snapshots]);

  if (!snapshot) {
    return (
      <section className={styles.butlerPanel} data-child-id="7">
        <header className={styles.panelHeader}>
          <div>
            <p className={styles.panelTitle}>버틀러 현황</p>
            <p className={styles.panelSubtitle}>조회 가능한 근무 데이터가 없습니다.</p>
          </div>
        </header>
        <p className={styles.panelEmpty}>버틀러 권한으로 확인 가능한 데이터가 없습니다.</p>
      </section>
    );
  }

  const toggles = snapshots.slice(0, 2);

  return (
    <section className={styles.butlerPanel} data-child-id="7">
      <header className={styles.panelHeader}>
        <div>
          <p className={styles.panelTitle}>버틀러 현황</p>
          <p className={styles.panelSubtitle}>
            {snapshot.isToday ? '오늘자' : '내일자'} · {snapshot.targetDateLabel}
          </p>
        </div>
        <span className={styles.countBadge}>{snapshot.totalWorks}건</span>
      </header>

      <div className={styles.cleanerCtas}>
        <Link href="/screens/002" className={`${styles.linkButton} ${styles.ctaNeutral}`} prefetch={false}>
          오더관리
        </Link>
        <Link href="/screens/003" className={`${styles.linkButton} ${styles.ctaNeutral}`} prefetch={false}>
          업무신청
        </Link>
        <Link href="/screens/004" className={`${styles.linkButton} ${styles.ctaNeutral}`} prefetch={false}>
          과업지시서
        </Link>
        <Link href="/screens/005" className={`${styles.linkButton} ${styles.ctaNeutral}`} prefetch={false}>
          평가이력
        </Link>
      </div>

      <div className={styles.toggleRow}>
        {toggles.map((option) => (
          <button
            key={option.key}
            type="button"
            className={`${styles.linkButton} ${option.key === snapshot.key ? styles.ctaHighlight : styles.ctaNeutral}`}
            onClick={() => onChangeDate(option.key)}
          >
            {option.key === snapshot.key
              ? `${option.isToday ? 'D0' : 'D+1'} · ${option.targetDateLabel}`
              : option.isToday
              ? 'D0보기'
              : 'D+1보기'}
          </button>
        ))}
      </div>

      <section className={styles.butlerSection} aria-label="합계표">
        <header className={styles.sectionHeader}>
          <h3>합계표</h3>
          <p>sector · building · checkout 시간별 건수</p>
        </header>
        {snapshot.sectorSummaries.length ? (
          <div className={styles.butlerSummaryGrid}>
            {snapshot.sectorSummaries.map((sector) => (
              <article key={sector.sectorLabel} className={`${styles.sectorCard} ${styles.sectorTotal}`}>
                <header>
                  <p>{sector.sectorLabel}</p>
                  <span>{sector.totalWorkers}개</span>
                </header>
                <ul>
                  {sector.buildings.map((building) => (
                    <li key={`${sector.sectorLabel}-${building.buildingName}`}>
                      <div className={styles.buildingRow}>
                        <strong>{building.buildingName}</strong>
                        <span>{building.totalWorkers}개</span>
                      </div>
                      <div className={styles.checkoutRow}>
                        {building.checkoutGroups.map((group) => (
                          <span key={`${building.buildingName}-${group.checkoutTimeLabel}`}>
                            {group.checkoutTimeLabel} · {group.count}개
                          </span>
                        ))}
                      </div>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        ) : (
          <p className={styles.panelEmpty}>표시할 합계 데이터가 없습니다.</p>
        )}
      </section>

      <section className={styles.butlerSection} aria-label="상세">
        <header className={styles.sectionHeader}>
          <h3>Detail</h3>
          <p>sector → building → checkout → room 순</p>
        </header>
        {snapshot.details.length ? (
          <DetailList details={snapshot.details} preferred={snapshot.preferredSectors} />
        ) : (
          <p className={styles.panelEmpty}>상세 데이터가 없습니다.</p>
        )}
      </section>
    </section>
  );
}

function DetailList({ details, preferred }: { details: ButlerDetailEntry[]; preferred: string[] }) {
  const [openMap, setOpenMap] = useState<Record<string, boolean>>(() => {
    const defaults: Record<string, boolean> = {};
    details.forEach((detail) => {
      const key = detail.sectorLabel;
      if (!(key in defaults)) {
        defaults[key] = true;
      }
    });
    return defaults;
  });

  const grouped = useMemo(() => {
    const map = new Map<string, ButlerDetailEntry[]>();
    details.forEach((detail) => {
      if (!map.has(detail.sectorLabel)) {
        map.set(detail.sectorLabel, []);
      }
      map.get(detail.sectorLabel)!.push(detail);
    });

    const groups = Array.from(map.entries()).sort(([a], [b]) => {
      const aPreferred = preferred.includes(a);
      const bPreferred = preferred.includes(b);

      if (aPreferred && !bPreferred) return -1;
      if (!aPreferred && bPreferred) return 1;

      const idxA = SECTOR_ORDER.indexOf(a);
      const idxB = SECTOR_ORDER.indexOf(b);
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
      if (idxA !== -1) return -1;
      if (idxB !== -1) return 1;
      return a.localeCompare(b, 'ko');
    });

    return groups.map(([sectorLabel, entries]) => ({
      sectorLabel,
      entries: entries.sort((a, b) => a.checkoutTimeLabel.localeCompare(b.checkoutTimeLabel, 'ko'))
    }));
  }, [details, preferred]);

  return (
    <div className={styles.butlerDetailList}>
      {grouped.map((group) => (
        <article key={group.sectorLabel} className={styles.detailGroup}>
          <header className={styles.detailGroupHeader}>
            <div className={styles.detailGroupTitle}>
              <p className={styles.detailSector}>{group.sectorLabel}</p>
              <span className={styles.detailCount}>{group.entries.length}개</span>
            </div>
            <button
              type="button"
              className={styles.collapseToggle}
              onClick={() => setOpenMap((prev) => ({ ...prev, [group.sectorLabel]: !prev[group.sectorLabel] }))}
            >
              {openMap[group.sectorLabel] ?? true ? '접기' : '펼치기'}
            </button>
          </header>

          {openMap[group.sectorLabel] ?? true ? (
            <div className={styles.detailRows}>
              {group.entries.map((detail) => (
                <div key={detail.id} className={styles.detailRow}>
                  <div className={styles.detailPrimary}>
                    <strong className={styles.detailRoom}>
                      {detail.buildingName} · {detail.roomNo}
                    </strong>
                    <div className={styles.detailChips}>
                      <span
                        className={`${styles.detailBadge} ${detail.isCleaning ? styles.cleanBadge : styles.inspectBadge}`}
                      >
                        {detail.workTypeLabel}
                      </span>
                      <span className={styles.detailBadge}>{detail.checkoutTimeLabel}</span>
                      <span className={styles.detailComment}>{detail.comment || '메모 없음'}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </article>
      ))}
    </div>
  );
}
