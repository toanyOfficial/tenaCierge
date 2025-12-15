'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import { registerWebPush, type SubscriptionContext } from '@/src/client/push/register';
import { normalizePhone } from '@/src/utils/phone';
import type { ProfileSummary } from '@/src/utils/profile';
import styles from './dashboard.module.css';

type Props = {
  profile: ProfileSummary;
};

type BannerState =
  | { kind: 'idle'; message: string }
  | { kind: 'ready'; message: string }
  | { kind: 'loading'; message: string }
  | { kind: 'success'; message: string }
  | { kind: 'error'; message: string };

function buildContexts(profile: ProfileSummary): SubscriptionContext[] {
  const normalizedPhone = normalizePhone(profile.phone);
  const registerRaw = profile.registerNo?.trim().toUpperCase();
  const normalizedRegister = registerRaw && registerRaw !== '-' ? registerRaw : null;
  const contexts: SubscriptionContext[] = [];

  if (profile.roles.includes('host')) {
    contexts.push({ type: 'CLIENT', phone: normalizedPhone, registerNo: normalizedRegister });
  }

  if (profile.roles.some((role) => role === 'cleaner' || role === 'butler')) {
    contexts.push({ type: 'WORKER', phone: normalizedPhone, registerNo: normalizedRegister });
  }

  return contexts;
}

export default function WebPushEnrollment({ profile }: Props) {
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>('default');
  const [state, setState] = useState<BannerState>({ kind: 'idle', message: '로그인 후 푸시 알림을 받을 수 있습니다.' });
  const syncingRef = useRef(false);

  const contexts = useMemo(() => buildContexts(profile), [profile]);
  const hasContext = contexts.length > 0;

  useEffect(() => {
    if (typeof window === 'undefined' || typeof Notification === 'undefined') {
      setPermission('unsupported');
      return;
    }

    setPermission(Notification.permission);
  }, []);

  useEffect(() => {
    if (permission !== 'granted' || !hasContext || syncingRef.current) {
      return;
    }

    syncingRef.current = true;
    setState({ kind: 'loading', message: '기존 구독을 동기화하는 중입니다...' });

    registerWebPush(contexts).then((result) => {
      if (result.status === 'success') {
        setState({ kind: 'success', message: result.message ?? '푸시 구독이 저장되었습니다.' });
      } else if (result.status === 'unsupported') {
        setState({ kind: 'error', message: result.message });
      } else if (result.status === 'denied') {
        setState({ kind: 'error', message: '알림 권한을 허용해야 푸시를 받을 수 있습니다.' });
      } else if (result.status === 'skipped') {
        setState({ kind: 'error', message: result.message });
      } else {
        setState({ kind: 'error', message: result.message ?? '푸시 구독 처리 중 오류가 발생했습니다.' });
      }
    });
  }, [contexts, hasContext, permission]);

  const handleEnroll = async () => {
    if (!hasContext) {
      setState({ kind: 'error', message: '푸시를 등록할 수 있는 사용자 정보를 찾지 못했습니다.' });
      return;
    }

    setState({ kind: 'loading', message: '알림 권한을 요청하고 있습니다...' });

    const result = await registerWebPush(contexts);

    if (result.status === 'success') {
      const suffix = result.failures?.length
        ? ` (성공 ${result.successes.length} / 실패 ${result.failures.length}, 건너뜀 ${result.skipped.length})`
        : '';
      setState({ kind: 'success', message: `${result.message ?? '푸시 구독이 저장되었습니다.'}${suffix}` });
      setPermission('granted');
      return;
    }

    if (result.status === 'unsupported') {
      setState({ kind: 'error', message: result.message });
      return;
    }

    if (result.status === 'denied') {
      setState({ kind: 'error', message: '브라우저에서 알림 권한을 허용해야 합니다.' });
      setPermission('denied');
      return;
    }

    if (result.status === 'skipped') {
      setState({ kind: 'error', message: result.message });
      return;
    }

    setState({ kind: 'error', message: result.message ?? '푸시 구독을 저장하지 못했습니다.' });
  };

  if (permission === 'unsupported') {
    return (
      <section className={styles.pushBanner} role="status" aria-live="polite">
        <div>
          <p className={styles.pushBannerTitle}>웹푸시 미지원 브라우저</p>
          <p className={styles.pushBannerBody}>이 브라우저에서는 웹푸시 알림을 사용할 수 없습니다.</p>
        </div>
      </section>
    );
  }

  if (!hasContext) {
    return (
      <section className={styles.pushBanner} role="status" aria-live="polite">
        <div>
          <p className={styles.pushBannerTitle}>푸시 식별자 없음</p>
          <p className={styles.pushBannerBody}>휴대전화/관리번호 정보가 없어 푸시를 등록할 수 없습니다.</p>
        </div>
      </section>
    );
  }

  const showAction = permission !== 'granted' || state.kind === 'error';

  return (
    <section className={styles.pushBanner} role="status" aria-live="polite">
      <div>
        <p className={styles.pushBannerTitle}>모바일 웹푸시 알림 설정</p>
        <p className={styles.pushBannerBody}>
          {state.kind === 'loading'
            ? state.message
            : permission === 'granted'
              ? '기존 구독을 확인하고 있습니다. 문제가 있다면 다시 시도해 주세요.'
              : '로그인 기기에 대한 푸시 알림을 허용해 주세요.'}
        </p>
        {state.kind === 'error' ? <p className={styles.pushBannerError}>{state.message}</p> : null}
        {state.kind === 'success' ? <p className={styles.pushBannerSuccess}>{state.message}</p> : null}
      </div>
      {showAction ? (
        <div className={styles.pushBannerActions}>
          <button
            type="button"
            className={styles.pushBannerButton}
            onClick={handleEnroll}
            disabled={state.kind === 'loading'}
          >
            {permission === 'granted' ? '다시 동기화' : '푸시 허용하기'}
          </button>
        </div>
      ) : null}
    </section>
  );
}
