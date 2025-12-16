'use client';

import { useMemo, useState } from 'react';

import type { AdminNotice, ButlerSnapshotOption, CleanerSnapshot } from './page';
import type { ProfileSummary } from '@/src/utils/profile';
import CommonHeader from './CommonHeader';
import CleanerPanel from './CleanerPanel';
import ButlerPanel from './ButlerPanel';
import HostPanel from './HostPanel';
import AdminPanel from './AdminPanel';
import styles from './dashboard.module.css';

type Props = {
  profile: ProfileSummary;
  cleanerSnapshot: CleanerSnapshot | null;
  butlerSnapshots: ButlerSnapshotOption[];
  adminNotice: AdminNotice | null;
};

export default function DashboardClient({ profile, cleanerSnapshot, butlerSnapshots, adminNotice }: Props) {
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

  const [activeButlerKey, setActiveButlerKey] = useState<string | null>(() => {
    const preferred = butlerSnapshots.find((snap) => snap.preferredDefault)?.key;
    const todayKey = butlerSnapshots.find((snap) => snap.isToday)?.key;
    return preferred ?? todayKey ?? butlerSnapshots[0]?.key ?? null;
  });

  async function persistRole(role: string) {
    try {
      await fetch('/api/role', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role })
      });
    } catch (error) {
      console.error('역할 저장 중 오류', error);
    }
  }

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
      return (
        <ButlerPanel
          snapshots={butlerSnapshots}
          activeKey={activeButlerKey}
          onChangeDate={(key) => setActiveButlerKey(key)}
        />
      );
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
  }, [activeRole, adminNotice, activeButlerKey, butlerSnapshots, cleanerSnapshot]);

  return (
    <div className={styles.dashboardStack}>
      <CommonHeader
        profile={profile}
        activeRole={activeRole}
        onRoleChange={(role) => {
          setActiveRole(role);
          persistRole(role);
        }}
      />
      <div className={styles.rolePanels}>{roleContent}</div>
    </div>
  );
}
