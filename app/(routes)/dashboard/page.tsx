import type { Metadata } from 'next';
import { cookies } from 'next/headers';

import styles from './dashboard.module.css';

export const metadata: Metadata = {
  title: '업무 현황 | TenaCierge Ops',
  description: '모든 역할에 공통으로 노출되는 프로필 및 제어 영역'
};

const roleOrder = ['admin', 'host', 'butler', 'cleaner'] as const;

function normalizeRoleList(list: string[]) {
  const unique = Array.from(new Set(list.map((role) => role.toLowerCase())));

  return unique
    .filter((role) => roleOrder.includes(role as (typeof roleOrder)[number]))
    .sort((a, b) => roleOrder.indexOf(a as (typeof roleOrder)[number]) - roleOrder.indexOf(b as (typeof roleOrder)[number]));
}

type ProfileSummary = {
  phone: string;
  registerNo: string;
  name: string;
  roles: string[];
};

function parseRoles(raw: string | undefined | null) {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);

    if (Array.isArray(parsed)) {
      return normalizeRoleList(parsed.map((role) => String(role)));
    }
  } catch (error) {
    // fall through to string parsing below
  }

  return normalizeRoleList(
    raw
      .split(',')
      .map((role) => role.trim())
  );
}

function getProfileSummary(): ProfileSummary {
  const cookieStore = cookies();
  const phone = cookieStore.get('tc_phone')?.value || '-';
  const registerNo = cookieStore.get('tc_register')?.value || '-';
  const name = cookieStore.get('tc_name')?.value || '이름 미지정';
  const roles = parseRoles(cookieStore.get('tc_roles')?.value);

  return {
    phone,
    registerNo,
    name,
    roles
  };
}

export default function DashboardPage() {
  const profile = getProfileSummary();

  return (
    <section className={styles.commonBar} data-child-id="1">
      <article className={styles.profileCard} aria-label="profiles">
        <dl>
          <div className={styles.profileRow}>
            <dt>휴대전화</dt>
            <dd>{profile.phone || '-'}</dd>
          </div>
          <div className={styles.profileRow}>
            <dt>관리번호</dt>
            <dd>{profile.registerNo || '-'}</dd>
          </div>
          <div className={styles.profileRow}>
            <dt>이름</dt>
            <dd>{profile.name || '이름 미지정'}</dd>
          </div>
        </dl>
      </article>

      <div className={styles.roleGroup} role="group" aria-label="사용자 역할">
        <span className={styles.roleLabel}>Role</span>
        <div className={styles.roleToggles}>
          {roleOrder.map((role) => {
            const isActive = profile.roles.includes(role);
            return (
              <button
                key={role}
                type="button"
                className={`${styles.roleToggle} ${isActive ? styles.roleToggleActive : ''}`}
                aria-pressed={isActive}
              >
                {role}
              </button>
            );
          })}
        </div>
      </div>

      <div className={styles.controls} aria-label="global buttons">
        <button type="button" aria-label="홈으로 이동">
          <HomeIcon />
        </button>
        <button type="button" aria-label="이전 화면">
          <BackIcon />
        </button>
        <button type="button" aria-label="로그아웃">
          <LogoutIcon />
        </button>
      </div>
    </section>
  );
}

function HomeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 10.5 12 3l9 7.5V21a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />
    </svg>
  );
}

function BackIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M10 5 3 12l7 7v-4h11v-6H10z" />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M14 3v4h-2V3H5v18h7v-4h2v4h5a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1z" />
      <path d="m11 9-2 3 2 3h9v-6z" />
    </svg>
  );
}
