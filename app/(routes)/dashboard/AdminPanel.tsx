'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

import type { AdminNotice } from './page';
import styles from './dashboard.module.css';

type Props = {
  notice: AdminNotice | null;
};

const adminLinks = ['002', '003', '004', '007', '008', '009', '010'];

export default function AdminPanel({ notice }: Props) {
  const [currentNotice, setCurrentNotice] = useState<AdminNotice | null>(notice);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [draft, setDraft] = useState(() => notice?.text ?? '');
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    setCurrentNotice(notice);
  }, [notice]);

  const currentLength = draft.length;
  const canSave = currentLength > 0 && currentLength <= 255;

  const latestStamp = currentNotice?.updatedAtLabel ?? currentNotice?.dateLabel ?? null;

  const handleOpen = useCallback(() => {
    setDraft(currentNotice?.text ?? '');
    setFeedback(null);
    setIsModalOpen(true);
  }, [currentNotice?.text]);

  const handleClose = useCallback(() => {
    if (!saving) {
      setIsModalOpen(false);
    }
  }, [saving]);

  const handleSave = useCallback(async () => {
    if (!canSave) {
      setFeedback('255자 이내로 입력해 주세요.');
      return;
    }

    setSaving(true);
    setFeedback(null);

    try {
      const response = await fetch('/api/notice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notice: draft, id: currentNotice?.id ?? null })
      });

      if (!response.ok) {
        throw new Error('공지 저장 실패');
      }

      const payload = await response.json();
      setCurrentNotice({
        id: payload.id ?? currentNotice?.id ?? null,
        text: payload.notice ?? draft,
        dateLabel: formatNoticeDateLabel(payload.noticeDate) ?? currentNotice?.dateLabel ?? null,
        updatedAtLabel: formatNoticeDateTimeLabel(payload.updatedAt) ?? currentNotice?.updatedAtLabel ?? null
      });
      setDraft(payload.notice ?? draft);
      setIsModalOpen(false);
    } catch (error) {
      console.error(error);
      setFeedback('공지 저장 중 오류가 발생했습니다.');
    } finally {
      setSaving(false);
    }
  }, [canSave, currentNotice, draft]);

  const noticeSummary = useMemo(() => {
    if (!currentNotice || !currentNotice.text) {
      return '등록된 공지사항이 없습니다.';
    }
    return currentNotice.text;
  }, [currentNotice]);

  return (
    <section className={styles.adminPanel} data-child-id="8">
      <header className={styles.panelHeader}>
        <div>
          <p className={styles.panelTitle}>관리자 도구</p>
          <p className={styles.panelSubtitle}>{latestStamp ? `최근 업데이트 · ${latestStamp}` : '공지사항을 관리하고 화면을 호출하세요.'}</p>
        </div>
        <button type="button" className={styles.noticeButton} onClick={handleOpen}>
          공지사항 수정
        </button>
      </header>

      <article className={styles.noticeCard}>
        <header>
          <p>현재 공지</p>
          {currentNotice?.dateLabel ? <span>{currentNotice.dateLabel}</span> : null}
        </header>
        <p className={styles.noticeBody}>{noticeSummary}</p>
      </article>

      <div className={styles.quickLinkGrid}>
        {adminLinks.map((screenId) => (
          <Link key={screenId} href={`/screens/${screenId}`} className={styles.linkButton} prefetch={false}>
            화면 {screenId} 바로가기
          </Link>
        ))}
      </div>

      {isModalOpen ? (
        <div className={styles.noticeOverlay} role="dialog" aria-modal="true">
          <div className={styles.noticeModal}>
            <header>
              <p>공지사항 입력 (최대 255자)</p>
              <button type="button" onClick={handleClose} disabled={saving} aria-label="닫기">
                ×
              </button>
            </header>
            <textarea
              maxLength={255}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="공지 내용을 입력해 주세요."
            />
            <div className={styles.noticeActions}>
              <span>{currentLength} / 255</span>
              <div>
                <button type="button" onClick={handleClose} disabled={saving}>
                  취소
                </button>
                <button type="button" onClick={handleSave} disabled={!canSave || saving}>
                  저장
                </button>
              </div>
            </div>
            {feedback ? <p className={styles.noticeFeedback}>{feedback}</p> : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function formatNoticeDateLabel(raw?: string | null) {
  const date = parseNoticeDate(raw);
  if (!date) {
    return null;
  }

  return new Intl.DateTimeFormat('ko-KR', {
    month: 'long',
    day: 'numeric',
    weekday: 'short'
  }).format(date);
}

function formatNoticeDateTimeLabel(raw?: string | null) {
  const date = parseNoticeDate(raw);
  if (!date) {
    return null;
  }

  return new Intl.DateTimeFormat('ko-KR', {
    month: 'long',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(date);
}

function parseNoticeDate(raw?: string | null) {
  if (!raw) {
    return null;
  }

  const normalized = raw.includes('T') ? raw : `${raw}T00:00:00+09:00`;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
