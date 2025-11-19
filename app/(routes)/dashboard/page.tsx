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
    <section className={styles.screen} data-child-id="1">
      <header className={styles.header}>
        <p className={styles.eyebrow}>공통 파트</p>
        <h1>업무 현황 기본 정보</h1>
        <p>
          어느 역할로 접속했든 동일하게 노출되는 사용자 프로필과 글로벌 조작 버튼입니다.
        </p>
      </header>

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
          <div className={`${styles.profileRow} ${styles.roleRow}`}>
            <dt>Role</dt>
            <dd>
              {profile.roles.length > 0 ? (
                <ul className={styles.roleList}>
                  {profile.roles.map((role) => (
                    <li key={role}>{role}</li>
                  ))}
                </ul>
              ) : (
                <span className={styles.emptyValue}>부여된 역할이 없습니다.</span>
              )}
            </dd>
          </div>
        </dl>
      </article>

      <div className={styles.controls} aria-label="global buttons">
        <button type="button">Home</button>
        <button type="button">Back</button>
        <button type="button" className={styles.logout}>Logout</button>
      </div>
    </section>
  );
}
