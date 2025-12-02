'use client';

import { useMemo, useState } from 'react';

import CommonHeader from '@/app/(routes)/dashboard/CommonHeader';
import type { ProfileSummary } from '@/src/utils/profile';

import type { SuppliesSnapshot, SupplyHostGroup, SupplyItem } from './server/getSuppliesSnapshot';
import styles from './screens.module.css';

type Props = {
  snapshot: SuppliesSnapshot;
  profile: ProfileSummary;
};

function isLink(text: string | null) {
  if (!text) return false;
  const trimmed = text.trim();
  return /^https?:\/\//i.test(trimmed);
}

function getRoomLabel(building: string, room: string) {
  return `${building} ${room}`.trim();
}

export default function SuppliesClient({ snapshot, profile }: Props) {
  const initialRole = profile.primaryRole ?? profile.roles[0] ?? null;
  const [activeRole, setActiveRole] = useState(initialRole);
  const [groups, setGroups] = useState<SupplyHostGroup[]>(snapshot.groups);
  const [collapsedHosts, setCollapsedHosts] = useState<Record<number, boolean>>({});
  const [pending, setPending] = useState<Record<number, boolean>>({});
  const [feedback, setFeedback] = useState<string | null>(null);

  const totalItems = useMemo(
    () =>
      groups.reduce(
        (sum, host) =>
          sum + host.buildings.reduce((bSum, b) => bSum + b.rooms.reduce((rSum, room) => rSum + room.items.length, 0), 0),
        0
      ),
    [groups]
  );

  function toggleHost(hostId: number) {
    setCollapsedHosts((prev) => ({ ...prev, [hostId]: !prev[hostId] }));
  }

  function updateItemState(targetId: number, updater: (item: SupplyItem) => SupplyItem) {
    setGroups((prev) =>
      prev.map((host) => ({
        ...host,
        buildings: host.buildings.map((building) => ({
          ...building,
          rooms: building.rooms.map((room) => ({
            ...room,
            items: room.items.map((item) => (item.id === targetId ? updater(item) : item))
          }))
        }))
      }))
    );
  }

  async function handleToggle(item: SupplyItem) {
    const next = !item.buyYn;
    const confirmMessage = `${item.buildingShortName} ${item.roomNo} 호실의 ${item.title} 항목을 구매하셨나요?`;

    if (next) {
      const ok = window.confirm(confirmMessage);
      if (!ok) return;
    }

    setFeedback(null);
    setPending((prev) => ({ ...prev, [item.id]: true }));
    updateItemState(item.id, (current) => ({ ...current, buyYn: next }));

    try {
      const response = await fetch(`/api/client-supplements/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ buyYn: next })
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.message || '구매 여부를 저장하지 못했습니다.');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '구매 여부를 저장하지 못했습니다.';
      setFeedback(message);
      updateItemState(item.id, (current) => ({ ...current, buyYn: !next }));
    } finally {
      setPending((prev) => ({ ...prev, [item.id]: false }));
    }
  }

  return (
    <div className={styles.screenShell}>
      <CommonHeader profile={profile} activeRole={activeRole} onRoleChange={setActiveRole} compact />

      <section className={styles.noticeCard}>
        <h1 className={styles.sectionTitle}>소모품 구매 안내</h1>
        <ol className={styles.noticeList}>
          <li>
            소모품은 가급적 바로바로 구매 해주시기 바랍니다. 소모품이 부족하면 청소 완성도가 떨어지고, 클리너들이 해당 방에 대한
            소모품 부족 노티를 소홀히 여기게 됩니다.
          </li>
          <li>
            가급적 저희가 제안드리는 상품으로 구매해주시기 바랍니다. 2개 이하 번들로 구매하시면 재고가 완전히 소진되는 상황이 자주
            발생합니다. 또한 수만건에 달하는 청소 경험과 그것을 바탕으로 한 매뉴얼에 기반하여 제안드리는 상품임을 꼭 고려해주시기
            바랍니다. 아주 사소한 부분들에 까지 해당 제품이어야 하는 이유가 있는 제품들이오며 이 제품을 제안드림으로 인해 저희가
            얻는 금전적 이득은 일절 없습니다.
          </li>
        </ol>
        <p className={styles.noticeFootnote}>총 {totalItems}건의 구매 요청이 있습니다.</p>
        {feedback ? <p className={styles.errorText}>{feedback}</p> : null}
      </section>

      {groups.length === 0 ? (
        <section className={styles.emptyCard}>
          <p className={styles.lead}>표시할 소모품 구매 요청이 없습니다.</p>
          <p className={styles.helper}>새로 적재된 요청이 있으면 이곳에 나타납니다.</p>
        </section>
      ) : (
        groups.map((host) => (
          <article key={host.hostId} className={styles.supplyGroup}>
            <header className={styles.supplyGroupHeader}>
              <div>
                <p className={styles.sectionLabel}>Host</p>
                <p className={styles.sectionTitle}>{host.hostName}</p>
              </div>
              <div className={styles.supplyActions}>
                <span className={styles.metaPill}>
                  {host.buildings.reduce((count, b) => count + b.rooms.reduce((r, room) => r + room.items.length, 0), 0)} 건
                </span>
                <button type="button" className={styles.secondaryButton} onClick={() => toggleHost(host.hostId)}>
                  {collapsedHosts[host.hostId] ? '펼치기' : '접기'}
                </button>
              </div>
            </header>

            {collapsedHosts[host.hostId]
              ? null
              : host.buildings.map((building) => (
                  <div key={`${host.hostId}-${building.shortName}`} className={styles.supplyBuilding}>
                    <header className={styles.supplyBuildingHeader}>
                      <p className={styles.sectionLabel}>건물</p>
                      <p className={styles.supplyBuildingTitle}>{building.shortName}</p>
                    </header>

                    <div className={styles.supplyRoomGrid}>
                      {building.rooms.map((room) => (
                        <section
                          key={`${host.hostId}-${building.shortName}-${room.roomNo}`}
                          className={styles.supplyRoomCard}
                        >
                          <header className={styles.supplyRoomHeader}>
                            <div>
                              <p className={styles.sectionLabel}>호실</p>
                              <p className={styles.roomTitle}>{getRoomLabel(building.shortName, room.roomNo)}</p>
                            </div>
                            <span className={styles.metaPill}>{room.items.length} 건</span>
                          </header>

                          <div className={styles.supplyGridHeader}>
                            <span>일자</span>
                            <span>다음체크인</span>
                            <span>항목</span>
                            <span>내용</span>
                            <span>구매</span>
                          </div>

                          {room.items.map((item) => (
                            <div key={item.id} className={styles.supplyRow}>
                              <span className={styles.mono}>{item.dateLabel}</span>
                              <span className={styles.mono}>{item.nextDateLabel ?? '-'}</span>
                              <span className={styles.strongText}>{item.title}</span>
                              <span>
                                {isLink(item.description) ? (
                                  <a href={item.description ?? '#'} target="_blank" rel="noopener noreferrer" className={styles.linkButtonGhost}>
                                    링크 이동
                                  </a>
                                ) : (
                                  item.description ?? '-'
                                )}
                              </span>
                              <label className={styles.checkboxCell}>
                                <input
                                  type="checkbox"
                                  checked={item.buyYn}
                                  onChange={() => handleToggle(item)}
                                  disabled={pending[item.id]}
                                />
                              </label>
                            </div>
                          ))}
                        </section>
                      ))}
                    </div>
                  </div>
                ))}
          </article>
        ))
      )}
    </div>
  );
}
