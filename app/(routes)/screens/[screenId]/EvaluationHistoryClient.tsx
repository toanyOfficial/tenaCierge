'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import CommonHeader from '@/app/(routes)/dashboard/CommonHeader';
import type { EvaluationGroup, EvaluationSnapshot } from '@/src/server/evaluations';
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
  const [activeRole, setActiveRole] = useState(profile.primaryRole ?? profile.roles[0] ?? 'admin');
  const [groups, setGroups] = useState<EvaluationGroup[]>(snapshot.groups);
  const [nextCursor, setNextCursor] = useState<string | null>(snapshot.nextCursor ?? null);
  const [folded, setFolded] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<WorkerResult[]>([]);
  const [searching, setSearching] = useState(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setGroups(snapshot.groups);
    setNextCursor(snapshot.nextCursor ?? null);
    setFolded({});
    setError('');
  }, [snapshot.groups, snapshot.nextCursor, snapshot.worker?.id]);

  const canSearch = profile.roles.includes('admin');
  const hasWorker = Boolean(snapshot.worker);
  const hasMore = Boolean(nextCursor);

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
        label: '현재 랭킹',
        value:
          snapshot.summary?.rank && snapshot.summary.population
            ? `${snapshot.summary.rank}위 / ${snapshot.summary.population}명`
            : '집계 중',
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
    setSearchResults([]);
    setSearchTerm('');
    router.push(`/screens/007?${nextParams.toString()}`);
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

        {canSearch && (
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
          </form>
        )}

        {!hasWorker ? (
          <div className={styles.emptyState}>
            <p className={styles.lead}>{snapshot.message ?? '조회할 근로자를 선택해 주세요.'}</p>
          </div>
        ) : (
          <>
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
