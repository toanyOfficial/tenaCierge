import styles from './dashboard.module.css';
import type { ButlerSnapshot } from './page';

type Props = {
  snapshot: ButlerSnapshot | null;
};

export default function ButlerPanel({ snapshot }: Props) {
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

      <section className={styles.butlerSection} aria-label="합계표">
        <header className={styles.sectionHeader}>
          <h3>합계표</h3>
          <p>sector · building · checkout 시간별 인원</p>
        </header>
        {snapshot.sectorSummaries.length ? (
          <div className={styles.butlerSummaryGrid}>
            {snapshot.sectorSummaries.map((sector) => (
              <article key={sector.sectorLabel} className={styles.sectorCard}>
                <header>
                  <p>{sector.sectorLabel}</p>
                  <span>{sector.totalWorkers}명</span>
                </header>
                <ul>
                  {sector.buildings.map((building) => (
                    <li key={`${sector.sectorLabel}-${building.buildingName}`}>
                      <div className={styles.buildingRow}>
                        <strong>{building.buildingName}</strong>
                        <span>{building.totalWorkers}명</span>
                      </div>
                      <div className={styles.checkoutRow}>
                        {building.checkoutGroups.map((group) => (
                          <span key={`${building.buildingName}-${group.checkoutTimeLabel}`}>
                            {group.checkoutTimeLabel} · {group.count}명
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
          <div className={styles.butlerDetailList}>
            {snapshot.details.map((detail) => (
              <article key={detail.id} className={styles.detailRow}>
                <div>
                  <p className={styles.detailSector}>{detail.sectorLabel}</p>
                  <p className={styles.detailBuilding}>{detail.buildingName}</p>
                </div>
                <div className={styles.detailMeta}>
                  <span>{detail.checkoutTimeLabel}</span>
                  <strong>Room {detail.roomNo}</strong>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className={styles.panelEmpty}>상세 데이터가 없습니다.</p>
        )}
      </section>
    </section>
  );
}
