'use client';

import { useMemo, useState } from 'react';

import type { CleanerSnapshot, ProfileSummary } from './page';
import CommonHeader from './CommonHeader';
import CleanerPanel from './CleanerPanel';
import styles from './dashboard.module.css';

type Props = {
  profile: ProfileSummary;
  cleanerSnapshot: CleanerSnapshot | null;
};

const fallbackRoleMessages: Record<string, string> = {
  admin: '관리자 전용 화면을 곧 준비하겠습니다.',
  host: '호스트 화면은 정의서 업데이트 이후 구성됩니다.',
  butler: '버틀러 보드는 다음 단계에서 노출됩니다.'
};

export default function DashboardClient({ profile, cleanerSnapshot }: Props) {
  const roles = profile.roles;
  const [activeRole, setActiveRole] = useState<string | null>(() => {
    if (profile.primaryRole && roles.includes(profile.primaryRole)) {
      return profile.primaryRole;
    }

    if (roles.includes('cleaner')) {
      return 'cleaner';
    }

    return roles[0] ?? null;
  });

  const roleContent = useMemo(() => {
    if (!activeRole) {
      return (
        <article className={styles.roleEmpty}>
          <p>쿠키에 할당된 역할이 없습니다. 로그인 정보를 다시 확인해 주세요.</p>
        </article>
      );
    }

    if (activeRole === 'cleaner') {
      return <CleanerPanel snapshot={cleanerSnapshot} />;
    }

    return (
      <article className={styles.rolePlaceholder}>
        <header>
          <p className={styles.rolePlaceholderTitle}>{activeRole.toUpperCase()} 화면 준비중</p>
          <p className={styles.rolePlaceholderBody}>
            {fallbackRoleMessages[activeRole] ?? '이 역할에 맞는 패널은 추후 제공됩니다.'}
          </p>
        </header>
      </article>
    );
  }, [activeRole, cleanerSnapshot]);

  return (
    <div className={styles.dashboardStack}>
      <CommonHeader profile={profile} activeRole={activeRole} onRoleChange={setActiveRole} />
      <div className={styles.rolePanels}>{roleContent}</div>
    </div>
  );
}
