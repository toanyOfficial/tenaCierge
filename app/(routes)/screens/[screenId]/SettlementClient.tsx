"use client";

import { Fragment, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import styles from './settlement.module.css';

import type { SettlementSnapshot } from './server/getSettlementSnapshot';
import { settlementBusinessInfo, settlementStampDataUrl } from './settlementConstants';
import CommonHeader from '@/app/(routes)/dashboard/CommonHeader';
import type { ProfileSummary } from '@/src/utils/profile';

type Props = {
  snapshot: SettlementSnapshot;
  isAdmin: boolean;
  profile: ProfileSummary;
};

function formatCurrency(value: number) {
  return value.toLocaleString('ko-KR', { maximumFractionDigits: 0 });
}

export default function SettlementClient({ snapshot, isAdmin, profile }: Props) {
  const [activeRole, setActiveRole] = useState<string | null>(profile.roles[0] ?? null);
  const router = useRouter();
  const searchParams = useSearchParams();

  const month = snapshot.month;
  const hostId = snapshot.appliedHostId ? String(snapshot.appliedHostId) : searchParams.get('hostId') ?? '';

  const totalRow = useMemo(() => {
    const cleaning = snapshot.summary.reduce((sum, row) => sum + row.cleaning, 0);
    const facility = snapshot.summary.reduce((sum, row) => sum + row.facility, 0);
    const monthly = snapshot.summary.reduce((sum, row) => sum + row.monthly, 0);
    const misc = snapshot.summary.reduce((sum, row) => sum + row.misc, 0);
    const total = snapshot.summary.reduce((sum, row) => sum + row.total, 0);
    const vat = snapshot.summary.reduce((sum, row) => sum + row.vat, 0);
    const grandTotal = snapshot.summary.reduce((sum, row) => sum + row.grandTotal, 0);
    return { cleaning, facility, monthly, misc, total, vat, grandTotal };
  }, [snapshot.summary]);

  const handleFilterChange = (nextMonth: string, nextHostId: string) => {
    const params = new URLSearchParams();
    if (nextMonth) params.set('month', nextMonth);
    if (nextHostId) params.set('hostId', nextHostId);

    router.push(`/screens/008?${params.toString()}`);
  };

  const business = settlementBusinessInfo;

  const renderAmount = (line: SettlementSnapshot['statements'][number]['lines'][number]) => {
    if (line.ratioYn) {
      const percent = line.ratioValue ?? line.amount;
      const applied = formatCurrency(Math.abs(line.total));
      const sign = line.total < 0 ? '-' : '+';
      return `${percent}% / ${sign}${applied}`;
    }

    return formatCurrency(line.amount);
  };

  const renderRatioLineText = (line: SettlementSnapshot['statements'][number]['lines'][number]) => {
    if (!line.ratioYn) return line.priceTitle ?? line.item;

    const percent = line.ratioValue ?? line.amount;
    const discountValue = line.total;
    const sign = discountValue < 0 ? '-' : '+';
    const formattedValue = `${sign}${formatCurrency(Math.abs(discountValue))}원`;

    return (
      <span className={styles.ratioTextBlock}>
        <span className={styles.ratioTitle}>{line.priceTitle ?? line.item}</span>
        <span className={styles.ratioNote}>{`할인율 ${percent}%`}{'\n'}{`할인금액 ${formattedValue}`}</span>
      </span>
    );
  };

    return (
      <div className={styles.screenShell}>
        <div className={styles.headerRow}>
          <div className={styles.headerInner}>
            <CommonHeader profile={profile} activeRole={activeRole} onRoleChange={setActiveRole} compact />
          </div>
        </div>

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
                      <th>VAT(10%)</th>
                      <th>총액(VAT포함)</th>
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
                        <td>{formatCurrency(row.vat)}</td>
                        <td>{formatCurrency(row.grandTotal)}</td>
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
                      <td>{formatCurrency(totalRow.vat)}</td>
                      <td>{formatCurrency(totalRow.grandTotal)}</td>
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

            <div className={styles.metaHighlight}>
              <div className={styles.metaItem}>
                <span className={styles.metaLabel}>합계</span>
                <strong className={styles.metaValue}>{formatCurrency(statement.totals.total)} 원</strong>
              </div>
              <div className={styles.metaItem}>
                <span className={styles.metaLabel}>VAT(10%)</span>
                <strong className={styles.metaValue}>{formatCurrency(statement.totals.vat)} 원</strong>
              </div>
              <div className={`${styles.metaItem} ${styles.metaGrand}`}>
                <span className={styles.metaLabel}>총액(VAT포함)</span>
                <strong className={styles.metaValue}>{formatCurrency(statement.totals.grandTotal)} 원</strong>
              </div>
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
                          {room.discounts.map((line) => {
                            const percent = line.ratioValue ?? line.amount;
                            const discountValue = line.total;
                            const sign = discountValue < 0 ? '-' : '+';
                            return (
                              <span key={line.id} className={`${styles.totalValueRow} ${styles.negative}`}>
                                <span className={styles.muted}>{line.priceTitle ?? line.item}</span>
                                <strong>
                                  {sign}
                                  {formatCurrency(Math.abs(discountValue))}
                                </strong>
                                원
                                {line.ratioYn && (
                                <span className={styles.noteSmall}>
                                  {`할인율 ${percent}%`}
                                  {'\n'}
                                  {`할인금액 ${sign}${formatCurrency(Math.abs(discountValue))}원`}
                                </span>
                                )}
                              </span>
                            );
                          })}
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
                            <div className={`${styles.lineCell} ${line.ratioYn ? styles.ratioText : ''}`}>
                              {renderRatioLineText(line)}
                            </div>
                            <div className={styles.lineCell}>{formatCurrency(line.total)}</div>
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
                              <div className={`${styles.lineCell} ${line.ratioYn ? styles.ratioText : ''}`}>
                                {renderRatioLineText(line)}
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
              <span className={styles.businessInfoItem}>사업자등록번호: {business.registration}</span>
              <span className={styles.businessInfoItem}>
                사업체명: {business.company}
                <img
                  src={settlementStampDataUrl}
                  alt="회사 도장"
                  className={`${styles.stamp} ${styles.printOnly}`}
                  loading="lazy"
                />
              </span>
              <span className={styles.businessInfoItem}>대표자명: {business.ceo}</span>
              <span className={styles.businessInfoItem}>사업장주소: {business.address}</span>
            </div>
          </div>
        ))}
        </div>
      </div>
    </div>
  );
}
