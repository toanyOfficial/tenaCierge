"use client";

import { useMemo } from 'react';
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

            <div className={styles.linesGrid}>
              <div className={styles.lineHeader}>날짜</div>
              <div className={styles.lineHeader}>항목</div>
              <div className={styles.lineHeader}>비용</div>
              <div className={styles.lineHeader}>수량</div>
              <div className={styles.lineHeader}>합계금액</div>

              {statement.lines.length === 0 && (
                <div className={styles.emptyState} style={{ gridColumn: '1 / -1' }}>
                  정산 항목이 없습니다.
                </div>
              )}

              {statement.lines.map((line) => (
                <div key={line.id} className={styles.lineRow}>
                  <div className={styles.lineCell}>{line.date}</div>
                  <div className={styles.lineCell}>{line.item}</div>
                  <div className={styles.lineCell}>{formatCurrency(line.amount)}</div>
                  <div className={styles.lineCell}>{line.quantity}</div>
                  <div className={styles.lineCell}>{formatCurrency(line.total)}</div>
                </div>
              ))}
            </div>

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
