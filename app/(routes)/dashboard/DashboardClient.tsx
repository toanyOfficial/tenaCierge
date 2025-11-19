'use client';

import { useMemo, useState } from 'react';

import type { AdminNotice, ButlerSnapshot, CleanerSnapshot, ProfileSummary } from './page';
import CommonHeader from './CommonHeader';
import CleanerPanel from './CleanerPanel';
import ButlerPanel from './ButlerPanel';
import HostPanel from './HostPanel';
import AdminPanel from './AdminPanel';
import styles from './dashboard.module.css';

type Props = {
  profile: ProfileSummary;
  cleanerSnapshot: CleanerSnapshot | null;
  butlerSnapshot: ButlerSnapshot | null;
  adminNotice: AdminNotice | null;
};

export default function DashboardClient({ profile, cleanerSnapshot, butlerSnapshot, adminNotice }: Props) {
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

    if (activeRole === 'host') {
      return <HostPanel />;
    }

    if (activeRole === 'butler') {
      return <ButlerPanel snapshot={butlerSnapshot} />;
    }

    if (activeRole === 'admin') {
      return <AdminPanel notice={adminNotice} />;
    }

    return (
      <article className={styles.rolePlaceholder}>
        <header>
          <p className={styles.rolePlaceholderTitle}>{activeRole.toUpperCase()} 화면 준비중</p>
          <p className={styles.rolePlaceholderBody}>이 역할에 맞는 패널은 추후 제공됩니다.</p>
        </header>
      </article>
    );
  }, [activeRole, adminNotice, butlerSnapshot, cleanerSnapshot]);

  return (
    <div className={styles.dashboardStack}>
      <CommonHeader profile={profile} activeRole={activeRole} onRoleChange={setActiveRole} />
      <div className={styles.rolePanels}>{roleContent}</div>
    </div>
  );
}
