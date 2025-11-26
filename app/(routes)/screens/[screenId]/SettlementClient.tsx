"use client";

import { Fragment, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import styles from './settlement.module.css';

import type { SettlementSnapshot } from './server/getSettlementSnapshot';
import { settlementBusinessInfo } from './settlementConstants';

type Props = {
  snapshot: SettlementSnapshot;
  isAdmin: boolean;
};

function formatCurrency(value: number) {
  return value.toLocaleString('ko-KR', { maximumFractionDigits: 0 });
}

export default function SettlementClient({ snapshot, isAdmin }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const month = snapshot.month;
  const hostId = snapshot.appliedHostId ? String(snapshot.appliedHostId) : searchParams.get('hostId') ?? '';

  const totalRow = useMemo(() => {
    const cleaning = snapshot.summary.reduce((sum, row) => sum + row.cleaning, 0);
    const facility = snapshot.summary.reduce((sum, row) => sum + row.facility, 0);
    const monthly = snapshot.summary.reduce((sum, row) => sum + row.monthly, 0);
    const misc = snapshot.summary.reduce((sum, row) => sum + row.misc, 0);
    return {
      cleaning,
      facility,
      monthly,
      misc,
      total: cleaning + facility + monthly + misc
    };
  }, [snapshot.summary]);

  const handleFilterChange = (nextMonth: string, nextHostId: string) => {
    const params = new URLSearchParams();
    if (nextMonth) params.set('month', nextMonth);
    if (nextHostId) params.set('hostId', nextHostId);

    router.push(`/screens/008?${params.toString()}`);
  };

  const business = settlementBusinessInfo;

  const renderAmount = (line: SettlementSnapshot['statements'][number]['lines'][number]) => {
    return line.ratioYn ? `${line.ratioValue ?? line.amount}%` : formatCurrency(line.amount);
  };

  return (
    <div className={styles.wrapper}>
      <div className={styles.panel}>
        <div className={styles.filters}>
          <label>
            정산 월
            <input
              type="month"
              value={month}
              onChange={(e) => handleFilterChange(e.target.value, hostId)}
            />
          </label>
          {isAdmin && (
            <label>
              호스트
              <select value={hostId} onChange={(e) => handleFilterChange(month, e.target.value)}>
                <option value="">전체</option>
                {snapshot.hostOptions.map((host) => (
                  <option key={host.id} value={host.id}>
                    {host.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button className={styles.printButton} type="button" onClick={() => window.print()}>
            PDF 다운로드
          </button>
        </div>

        <div className={styles.card}>
          <div className={styles.badgeRow}>
            <h3 className={styles.sectionTitle}>호스트별 합계</h3>
            <span className={styles.chip}>청소비용 · 시설관리비용 · 월정액 · 기타</span>
          </div>
          {snapshot.summary.length === 0 ? (
            <div className={styles.emptyState}>표시할 정산 데이터가 없습니다.</div>
          ) : (
            <table className={styles.summaryTable}>
              <thead>
                <tr>
                  <th>호스트</th>
                  <th>청소비용</th>
                  <th>시설관리비용</th>
                  <th>월정액비용</th>
                  <th>기타비용</th>
                  <th>합계</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.summary.map((row) => (
                  <tr key={row.hostId}>
                    <td>{row.hostName}</td>
                    <td>{formatCurrency(row.cleaning)}</td>
                    <td>{formatCurrency(row.facility)}</td>
                    <td>{formatCurrency(row.monthly)}</td>
                    <td>{formatCurrency(row.misc)}</td>
                    <td>{formatCurrency(row.total)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>합계</td>
                  <td>{formatCurrency(totalRow.cleaning)}</td>
                  <td>{formatCurrency(totalRow.facility)}</td>
                  <td>{formatCurrency(totalRow.monthly)}</td>
                  <td>{formatCurrency(totalRow.misc)}</td>
                  <td>{formatCurrency(totalRow.total)}</td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>

        {snapshot.statements.map((statement) => (
          <div key={statement.hostId} className={styles.card}>
            <div className={styles.badgeRow}>
              <h3 className={styles.sectionTitle}>{statement.hostName} 정산서</h3>
              <span className={styles.chip}>{month}</span>
            </div>

            <div className={styles.meta}>
              <div>청소비용: {formatCurrency(statement.totals.cleaning)} 원</div>
              <div>시설관리비용: {formatCurrency(statement.totals.facility)} 원</div>
              <div>월정액비용: {formatCurrency(statement.totals.monthly)} 원</div>
              <div>기타비용: {formatCurrency(statement.totals.misc)} 원</div>
              <div>합계: {formatCurrency(statement.totals.total)} 원</div>
            </div>

          {statement.lines.length === 0 && (
            <div className={styles.emptyState}>정산 항목이 없습니다.</div>
          )}

          {Array.from(
              statement.lines.reduce(
                (map, line) => {
                  const entry = map.get(line.roomId) ?? {
                    roomId: line.roomId,
                    roomLabel: line.roomLabel,
                    monthly: [] as typeof statement.lines,
                    perWork: [] as typeof statement.lines,
                    discounts: [] as typeof statement.lines
                  };
                if (line.minusYn) {
                  entry.discounts.push(line);
                } else if (line.category === 'monthly') {
                  entry.monthly.push(line);
                } else {
                  entry.perWork.push(line);
                }
                map.set(line.roomId, entry);
                return map;
              },
              new Map<number, {
                roomId: number;
                roomLabel: string;
                monthly: typeof statement.lines;
                perWork: typeof statement.lines;
                discounts: typeof statement.lines;
              }>()
            ).values()
          ).map((room) => {
              const monthlyTotal = room.monthly.reduce((sum, line) => sum + line.total, 0);
              const perWorkTotal = room.perWork.reduce((sum, line) => sum + line.total, 0);

              const discountTotal = room.discounts.reduce((sum, line) => sum + line.total, 0);

              const monthlyBase = monthlyTotal;
              const perWorkBase = perWorkTotal;

              const roomBase = monthlyBase + perWorkBase;
              const roomTotal = roomBase + discountTotal;
              const hasDiscount = discountTotal !== 0;

              return (
                <div key={room.roomId} className={styles.roomSection}>
                  <div className={styles.roomHeader}>
                    <h4 className={styles.roomTitle}>{room.roomLabel}</h4>
                    <span className={styles.roomMeta}>{month}</span>
                  </div>

                  <div className={styles.roomTotals}>
                    <span>
                      월 비용 합계:{' '}
                      <strong className={monthlyTotal < 0 ? styles.negative : ''}>{formatCurrency(monthlyTotal)}</strong>
                    </span>
                    <span>
                      회당 비용 합계:{' '}
                      <strong className={perWorkTotal < 0 ? styles.negative : ''}>{formatCurrency(perWorkTotal)}</strong>
                    </span>
                    <span className={styles.totalStack}>
                      <span className={styles.totalLabel}>객실 총 금액</span>
                      {hasDiscount ? (
                        <>
                          <span className={styles.totalValueRow}>
                            <span className={styles.muted}>할인 전</span>
                            <strong>{formatCurrency(roomBase)}</strong>원
                          </span>
                          <span className={`${styles.totalValueRow} ${styles.negative}`}>
                            <span className={styles.muted}>할인/공제</span>
                            <strong>{formatCurrency(discountTotal)}</strong>원
                          </span>
                          <span className={styles.totalValueRow}>
                            <span className={styles.muted}>최종</span>
                            <strong className={roomTotal < 0 ? styles.negative : styles.emphasis}>
                              {formatCurrency(roomTotal)}
                            </strong>
                            원
                          </span>
                        </>
                      ) : (
                        <span className={styles.totalValueRow}>
                          <span className={styles.muted}>총액</span>
                          <strong className={roomTotal < 0 ? styles.negative : styles.emphasis}>
                            {formatCurrency(roomTotal)}
                          </strong>
                          원
                        </span>
                      )}
                    </span>
                  </div>

                  {room.monthly.length > 0 && (
                    <div className={styles.subsection}>
                      <div className={styles.subsectionTitle}>월 비용</div>
                      <div className={styles.monthlyGrid}>
                        <div className={styles.lineHeader}>항목</div>
                        <div className={styles.lineHeader}>금액</div>

                        {room.monthly.map((line) => (
                          <Fragment key={line.id}>
                            <div className={styles.lineCell}>
                              {line.item}
                              {line.ratioYn && (
                                <div className={styles.note}>비율 {line.ratioValue ?? line.amount}% · 적용금액 {formatCurrency(line.total)}</div>
                              )}
                            </div>
                            <div className={styles.lineCell}>
                              {formatCurrency(line.total)}
                            </div>
                          </Fragment>
                        ))}

                        <div className={styles.totalLabel}>합계</div>
                        <div className={`${styles.totalValue} ${monthlyTotal < 0 ? styles.negative : ''}`}>
                          {formatCurrency(monthlyTotal)}
                        </div>
                      </div>
                    </div>
                  )}

                  <div className={styles.subsection}>
                    <div className={styles.subsectionTitle}>회당 비용</div>
                    <div className={styles.workGrid}>
                      <div className={styles.lineHeader}>날짜</div>
                      <div className={styles.lineHeader}>항목</div>
                      <div className={styles.lineHeader}>단가</div>
                      <div className={styles.lineHeader}>수량</div>
                      <div className={styles.lineHeader}>합계금액</div>

                      {room.perWork.length === 0 ? (
                        <div className={styles.emptyState} style={{ gridColumn: '1 / -1' }}>
                          회당 비용 항목이 없습니다.
                        </div>
                      ) : (
                        <>
                          {room.perWork.map((line) => (
                            <div key={line.id} className={styles.lineRow}>
                              <div className={styles.lineCell}>{line.date}</div>
                              <div className={styles.lineCell}>
                                {line.item}
                                {line.ratioYn && (
                                  <div className={styles.note}>비율 {line.ratioValue ?? line.amount}% · 적용금액 {formatCurrency(line.total)}</div>
                                )}
                              </div>
                            <div className={styles.lineCell}>{renderAmount(line)}</div>
                            <div className={styles.lineCell}>{line.quantity}</div>
                            <div className={styles.lineCell}>
                              {formatCurrency(line.total)}
                            </div>
                          </div>
                        ))}

                          <div className={styles.totalRow}>
                            <div className={styles.totalLabel}>합계</div>
                            <div className={styles.totalLabel}></div>
                            <div className={styles.totalLabel}></div>
                            <div className={styles.totalLabel}></div>
                            <div
                              className={`${styles.totalValue} ${perWorkTotal < 0 ? styles.negative : ''}`}
                            >
                              {formatCurrency(perWorkTotal)}
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}

            <hr className={styles.sectionDivider} />
            <div className={styles.businessInfo}>
              <span>사업자등록번호: {business.registration}</span>
              <span>사업체명: {business.company}</span>
              <span>대표자명: {business.ceo}</span>
              <span>사업장주소: {business.address}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
