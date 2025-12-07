'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import CommonHeader from '@/app/(routes)/dashboard/CommonHeader';
import type { AdminEvaluationView, EvaluationGroup, EvaluationSnapshot } from '@/src/server/evaluations';
import type { ProfileSummary } from '@/src/utils/profile';

import styles from './screens.module.css';

type Props = {
  profile: ProfileSummary;
  snapshot: EvaluationSnapshot;
};

type WorkerResult = {
  id: number;
  name: string;
  registerCode: string;
  tierLabel: string;
};

export default function EvaluationHistoryClient({ profile, snapshot }: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const [activeRole, setActiveRole] = useState(
    profile.roles.includes('admin') ? 'admin' : profile.primaryRole ?? profile.roles[0] ?? 'admin'
  );
  const [groups, setGroups] = useState<EvaluationGroup[]>(snapshot.groups);
  const [nextCursor, setNextCursor] = useState<string | null>(snapshot.nextCursor ?? null);
  const [folded, setFolded] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<WorkerResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [targetDate, setTargetDate] = useState(snapshot.adminView?.targetDate ?? buildDefaultTargetDate());
  const [adminView, setAdminView] = useState<AdminEvaluationView | null>(snapshot.adminView ?? null);
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminError, setAdminError] = useState('');
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setGroups(snapshot.groups);
    setNextCursor(snapshot.nextCursor ?? null);
    setFolded({});
    setError('');
    setAdminView(snapshot.adminView ?? null);
    if (snapshot.adminView?.targetDate) {
      setTargetDate(snapshot.adminView.targetDate);
    }
  }, [snapshot.adminView, snapshot.groups, snapshot.nextCursor, snapshot.worker?.id]);

  const canSearch = profile.roles.includes('admin');
  const hasWorker = Boolean(snapshot.worker);
  const hasMore = Boolean(nextCursor);
  const shouldShowAdminPanel = profile.roles.includes('admin') && activeRole === 'admin';
  const adminData = adminView ?? { targetDate, dailyWages: [], tierChanges: [] };

  const dateOptions = useMemo(() => buildDateOptions(), []);

  const summaryCards = useMemo(
    () => [
      {
        label: '누적 점수',
        value: snapshot.summary?.totalScore ?? 0,
        accent: styles.statAccentBlue
      },
      {
        label: '최근 20일 점수',
        value: snapshot.summary?.recentScore ?? 0,
        accent: styles.statAccentGreen
      },
      {
        label: '상위 퍼센타일',
        value: snapshot.summary?.percentile != null && snapshot.summary.population
          ? `${snapshot.summary.percentile.toFixed(2)}%`
          : 'N/A',
        accent: styles.statAccentIndigo
      },
      {
        label: '현재 티어',
        value: snapshot.summary?.tierLabel ?? '미정',
        accent: styles.statAccentPurple
      }
    ],
    [snapshot.summary]
  );

  const toggleFold = (date: string) => {
    setFolded((prev) => ({ ...prev, [date]: !prev[date] }));
  };

  const loadMore = useCallback(async () => {
    if (!hasWorker || !nextCursor || loading || !snapshot.worker) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(
        `/api/evaluations?workerId=${snapshot.worker.id}&cursor=${encodeURIComponent(nextCursor)}`
      );
      if (!res.ok) {
        setError('추가 내역을 불러오지 못했습니다.');
        return;
      }
      const body = await res.json();
      setGroups((prev) => [...prev, ...(body.groups ?? [])]);
      setNextCursor(body.nextCursor ?? null);
    } catch (err) {
      setError('추가 내역을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, [hasWorker, loading, nextCursor, snapshot.worker]);

  useEffect(() => {
    if (!sentinelRef.current || !hasMore) return undefined;
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          loadMore();
        }
      });
    });
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [loadMore, hasMore]);

  const handleSearch = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!searchTerm.trim()) return;
    setSearching(true);
    setError('');
    try {
      const res = await fetch(`/api/workers/search?q=${encodeURIComponent(searchTerm.trim())}`);
      if (!res.ok) {
        setError('검색 중 오류가 발생했습니다.');
        return;
      }
      const body = await res.json();
      setSearchResults(body?.results ?? []);
    } catch (err) {
      setError('검색 중 오류가 발생했습니다.');
    } finally {
      setSearching(false);
    }
  };

  const handleSelectWorker = (workerId: number) => {
    const nextParams = new URLSearchParams(params?.toString() ?? '');
    nextParams.set('workerId', String(workerId));
    if (shouldShowAdminPanel && targetDate) {
      nextParams.set('targetDate', targetDate);
    }
    setSearchResults([]);
    setSearchTerm('');
    router.push(`/screens/007?${nextParams.toString()}`);
  };

  const handleTargetDateChange = async (value: string) => {
    setTargetDate(value);
    setAdminLoading(true);
    setAdminError('');
    try {
      const res = await fetch(`/api/evaluations/admin?targetDate=${encodeURIComponent(value)}`);
      if (!res.ok) {
        setAdminError('데이터를 불러오지 못했습니다.');
        setAdminView((prev) => prev ?? { targetDate: value, dailyWages: [], tierChanges: [] });
        return;
      }
      const body = (await res.json()) as AdminEvaluationView;
      setAdminView(body);
      if (body?.targetDate) {
        setTargetDate(body.targetDate);
      }
    } catch (err) {
      setAdminError('데이터를 불러오지 못했습니다.');
      setAdminView((prev) => prev ?? { targetDate: value, dailyWages: [], tierChanges: [] });
    } finally {
      setAdminLoading(false);
    }
  };

  useEffect(() => {
    if (!shouldShowAdminPanel || adminView || adminLoading) return;
    handleTargetDateChange(targetDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldShowAdminPanel, adminView, adminLoading, targetDate]);

  const handleDownload = () => {
    if (!shouldShowAdminPanel) return;
    const depositLabel = formatDepositLabel(adminData.targetDate);
    const header = [
      '입금은행',
      '입금계좌번호',
      '입금액',
      '예상예금주',
      '입금통장표시',
      '출금통장표시',
      '메모',
      'CMS코드',
      '받는분 휴대폰번호'
    ];

    const rows = adminData.dailyWages.map((row) => [
      safeString(row.bank),
      safeString(row.accountNo),
      formatMoney(row.dailyWage),
      row.name,
      depositLabel,
      depositLabel,
      '',
      '',
      safeString(row.phone)
    ]);

    const csv = [header, ...rows]
      .map((cols) => cols.map((col) => `"${col.replace(/"/g, '""')}"`).join(','))
      .join('\n');

    const utf8Bom = '\ufeff';
    const blob = new Blob([utf8Bom, csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `daily-wages-${adminData.targetDate}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className={styles.screenShell}>
      <CommonHeader profile={profile} activeRole={activeRole} onRoleChange={setActiveRole} compact />

      <section className={styles.cleaningSection}>
        <div className={styles.sectionHeaderSolo}>
          <div>
            <p className={styles.sectionLabel}>ID 007 · supervising report</p>
            <p className={styles.sectionTitle}>평가 이력 조회</p>
            <p className={styles.subtle}>점수 추이와 총평을 날짜별로 확인하세요.</p>
          </div>
          {snapshot.worker ? (
            <div className={styles.workerBadge}>
              <span className={styles.workerName}>{snapshot.worker.name}</span>
              <span className={styles.workerCode}>#{snapshot.worker.registerCode}</span>
            </div>
          ) : null}
        </div>

        {!hasWorker ? (
          <div className={styles.emptyState}>
            <p className={styles.lead}>{snapshot.message ?? '조회할 근로자를 선택해 주세요.'}</p>
          </div>
        ) : (
          <>
            {shouldShowAdminPanel ? (
              <section className={styles.adminPanel}>
                <div className={styles.sectionHeader}>
                  <div>
                    <p className={styles.sectionLabel}>일급/티어 현황</p>
                    <p className={styles.sectionTitle}>정산 및 티어 변동</p>
                  </div>
                  <div className={styles.adminControls}>
                    <label className={styles.datePicker}>
                      <span>대상 일자</span>
                      <select
                        className={styles.dateSelect}
                        value={targetDate}
                        onChange={(e) => handleTargetDateChange(e.target.value)}
                      >
                        {dateOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      className={styles.downloadButton}
                      onClick={handleDownload}
                      disabled={adminLoading || !adminData.dailyWages.length}
                    >
                      엑셀 다운로드
                    </button>
                  </div>
                </div>
                {adminError ? <p className={styles.errorText}>{adminError}</p> : null}
                <div className={styles.adminGrid}>
                  <div className={styles.adminCard}>
                    <div className={styles.adminCardHeader}>
                      <h3 className={styles.adminCardTitle}>일급계산표</h3>
                      <p className={styles.adminHint}>청소 시급 계산 기록</p>
                    </div>
                    <div className={styles.adminTableWrap}>
                      <table className={styles.adminTable}>
                        <thead>
                          <tr>
                            <th>이름</th>
                            <th>출근시간</th>
                            <th>퇴근시간</th>
                            <th>당일티어</th>
                            <th>당일시급</th>
                            <th>일급</th>
                            <th>은행</th>
                            <th>계좌번호</th>
                          </tr>
                        </thead>
                        <tbody>
                          {adminData.dailyWages.length === 0 ? (
                            <tr>
                              <td colSpan={8} className={styles.emptyCell}>
                                데이터가 없습니다.
                              </td>
                            </tr>
                          ) : (
                            adminData.dailyWages.map((row) => (
                              <tr key={row.workerId}>
                                <td>{row.name}</td>
                                <td>{formatTime(row.startTime)}</td>
                                <td>{formatTime(row.endTime)}</td>
                                <td>{row.tierLabel}</td>
                                <td>{formatMoney(row.hourlyWage)}</td>
                                <td>{formatMoney(row.dailyWage)}</td>
                                <td>{safeString(row.bank)}</td>
                                <td>{safeString(row.accountNo)}</td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  <div className={styles.adminCard}>
                    <div className={styles.adminCardHeader}>
                      <h3 className={styles.adminCardTitle}>티어변동표</h3>
                      <p className={styles.adminHint}>최근 20일 기준 가상 티어 산정</p>
                    </div>
                    <div className={styles.adminTableWrap}>
                      <table className={styles.adminTable}>
                        <thead>
                          <tr>
                            <th>이름</th>
                            <th>누적점수</th>
                            <th>최근20일점수</th>
                            <th>백분율</th>
                            <th>티어before</th>
                            <th>티어after</th>
                          </tr>
                        </thead>
                        <tbody>
                          {adminData.tierChanges.length === 0 ? (
                            <tr>
                              <td colSpan={6} className={styles.emptyCell}>
                                데이터가 없습니다.
                              </td>
                            </tr>
                          ) : (
                            adminData.tierChanges.map((row) => (
                              <tr key={row.workerId}>
                                <td>{row.name}</td>
                                <td>{row.totalScore}</td>
                                <td>{row.recentScore}</td>
                                <td>{row.percentile != null ? `${row.percentile.toFixed(2)}%` : 'N/A'}</td>
                                <td>{row.tierBeforeLabel}</td>
                                <td>{row.tierAfterLabel}</td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
                {canSearch && (
                  <div className={styles.adminSearchBlock}>
                    <form className={styles.searchBar} onSubmit={handleSearch}>
                      <div className={styles.searchInputWrap}>
                        <input
                          type="text"
                          placeholder="근로자 이름, 연락처 또는 등록번호로 검색"
                          value={searchTerm}
                          onChange={(e) => setSearchTerm(e.target.value)}
                        />
                        <button type="submit" className={styles.searchButton} disabled={searching}>
                          {searching ? '검색중...' : '검색'}
                        </button>
                      </div>
                    </form>
                    {searchResults.length > 0 && (
                      <div className={styles.searchResults}>
                        {searchResults.map((worker) => (
                          <button
                            key={worker.id}
                            type="button"
                            className={styles.searchResultRow}
                            onClick={() => handleSelectWorker(worker.id)}
                          >
                            <div className={styles.searchResultMeta}>
                              <span className={styles.workerName}>{worker.name}</span>
                              <span className={styles.workerCode}>{worker.registerCode}</span>
                            </div>
                            <span className={styles.workerTier}>{worker.tierLabel}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </section>
            ) : null}
            <div className={styles.statsGrid}>
              {summaryCards.map((card) => (
                <div key={card.label} className={styles.statCard}>
                  <div className={`${styles.statBadge} ${card.accent}`}>{card.label}</div>
                  <p className={styles.statValue}>{card.value}</p>
                </div>
              ))}
            </div>

            <div className={styles.evaluationList}>
              {groups.map((group) => {
                const total = group.works.reduce((sum, w) => sum + Number(w.score ?? 0), 0);
                const isFolded = folded[group.date] ?? false;
                return (
                  <article key={group.date} className={styles.evaluationCard}>
                    <header className={styles.evaluationHeaderRow}>
                      <div>
                        <p className={styles.sectionLabel}>{group.dateLabel}</p>
                        <p className={styles.evaluationTitle}>총점 {total}점</p>
                        {group.comment ? <p className={styles.evaluationComment}>{group.comment}</p> : null}
                      </div>
                      <button
                        type="button"
                        className={styles.foldButton}
                        onClick={() => toggleFold(group.date)}
                      >
                        {isFolded ? '펼치기' : '접기'}
                      </button>
                    </header>
                    {!isFolded && (
                      <ul className={styles.workScoreList}>
                        {group.works.map((work) => (
                          <li key={work.workId} className={styles.workScoreItem}>
                            <span className={styles.roomName}>{work.roomName}</span>
                            <span className={styles.scoreBadge}>{work.score}점</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </article>
                );
              })}
              {error ? <p className={styles.errorText}>{error}</p> : null}
              {hasMore && (
                <div className={styles.loadMore} ref={sentinelRef}>
                  {loading ? '불러오는 중...' : '아래로 스크롤하면 더 불러옵니다.'}
                </div>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

function buildDefaultTargetDate() {
  const now = new Date();
  const kstNow = new Date(now.getTime() + KST_OFFSET_MS);
  const hours = kstNow.getUTCHours();
  const minutes = kstNow.getUTCMinutes();
  const afterCutoff = hours > 16 || (hours === 16 && minutes >= 20);

  if (!afterCutoff) {
    kstNow.setUTCDate(kstNow.getUTCDate() - 1);
  }

  return formatKstDate(kstNow);
}

function buildDateOptions(): { value: string; label: string }[] {
  const now = Date.now();
  const options: { value: string; label: string }[] = [];

  for (let i = 0; i < 7; i += 1) {
    const kstDate = new Date(now + KST_OFFSET_MS - i * 24 * 60 * 60 * 1000);
    const iso = formatKstDate(kstDate);
    const label = i === 0 ? 'D0' : `D-${i}`;
    options.push({ value: iso, label: `${label} ${iso}` });
  }

  return options;
}

function formatTime(value: Date | null) {
  if (!value) return '-';
  const hours = value.getHours().toString().padStart(2, '0');
  const minutes = value.getMinutes().toString().padStart(2, '0');
  return `${hours}:${minutes}`;
}

function formatMoney(value: number | null) {
  if (value == null || Number.isNaN(value)) return '-';
  return `${value.toLocaleString('ko-KR')}원`;
}

function safeString(value: string | null | undefined) {
  return value?.trim() || '-';
}

function formatDepositLabel(targetDate: string) {
  const parsed = new Date(`${targetDate}T00:00:00+09:00`);
  if (Number.isNaN(parsed.getTime())) return '일급';
  const month = (parsed.getMonth() + 1).toString().padStart(2, '0');
  const day = parsed.getDate().toString().padStart(2, '0');
  return `${month}${day}일급`;
}

function formatKstDate(date: Date) {
  const kstDate = new Date(date.getTime());
  const year = kstDate.getUTCFullYear();
  const month = (kstDate.getUTCMonth() + 1).toString().padStart(2, '0');
  const day = kstDate.getUTCDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
}
