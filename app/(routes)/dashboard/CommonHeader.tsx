'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { useRouter } from 'next/navigation';

import type { ProfileSummary } from '@/src/utils/profile';
import styles from './dashboard.module.css';

const roleLabels: Record<string, string> = {
  admin: 'Admin',
  host: 'Host',
  butler: 'Butler',
  cleaner: 'Cleaner'
};

const navLinksByRole: Record<string, { href: string; label: string }[]> = {
  cleaner: [
    { href: '/screens/003', label: '업무신청' },
    { href: '/screens/004', label: '과업지시서' },
    { href: '/screens/007', label: '평가이력' }
  ],
  butler: [
    { href: '/screens/003', label: '업무신청' },
    { href: '/screens/004', label: '과업지시서' },
    { href: '/screens/005', label: '업무보고' }
  ],
  host: [
    { href: '/screens/002', label: '오더관리' },
    { href: '/screens/004', label: '과업지시서' },
    { href: '/screens/008', label: '정산관리' },
    { href: '/screens/011', label: '소모품구매' }
  ],
  admin: [
    { href: '/dashboard/admin', label: '관리자 페이지' },
    { href: '/screens/002', label: '오더관리' },
    { href: '/screens/003', label: '업무신청' },
    { href: '/screens/004', label: '과업지시서' },
    { href: '/screens/007', label: '평가이력' },
    { href: '/screens/008', label: '정산관리' },
    { href: '/screens/011', label: '소모품구매' }
  ]
};

const roleOrder = ['admin', 'host', 'butler', 'cleaner'] satisfies Array<keyof typeof roleLabels>;

function sortRoles(roles: string[]) {
  return [...roles].sort(
    (a, b) => roleOrder.indexOf(a as (typeof roleOrder)[number]) - roleOrder.indexOf(b as (typeof roleOrder)[number])
  );
}

type Props = {
  profile: ProfileSummary;
  activeRole: string | null;
  onRoleChange?: (role: string) => void;
  compact?: boolean;
};

export default function CommonHeader({ profile, activeRole, onRoleChange, compact }: Props) {
  const router = useRouter();
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [navBusy, setNavBusy] = useState(false);

  const roles = useMemo(() => sortRoles(profile.roles), [profile.roles]);
  const roleSummary = roles.length ? roles.map((role) => roleLabels[role] ?? role).join(', ') : 'Role 없음';
  const triggerLabel = activeRole ? roleLabels[activeRole] ?? activeRole : roleSummary;

  const navLinks = useMemo(() => {
    const primary = activeRole && navLinksByRole[activeRole] ? activeRole : roles[0];
    if (!primary) return [] as { href: string; label: string }[];
    return navLinksByRole[primary] ?? [];
  }, [activeRole, roles]);

  const handleHome = useCallback(() => {
    router.push('/dashboard');
  }, [router]);

  const handleBack = useCallback(() => {
    router.back();
  }, [router]);

  const handleLogout = useCallback(async () => {
    try {
      const response = await fetch('/api/logout', { method: 'POST' });
      if (!response.ok) {
        console.error('로그아웃 처리 실패');
      }
    } catch (error) {
      console.error('로그아웃 처리 중 오류', error);
    } finally {
      router.replace('/login');
      router.refresh();
    }
  }, [router]);

  const toggleDropdown = useCallback(() => {
    setIsOpen((prev) => !prev);
  }, []);

  const handleRoleSelect = useCallback(
    (role: string) => {
      onRoleChange?.(role);
      setIsOpen(false);
    },
    [onRoleChange]
  );

  const handleNavClick = useCallback(
    async (event: ReactMouseEvent, href: string) => {
      event.preventDefault();

      const needsGuard = href === '/screens/004' && (activeRole === 'cleaner' || activeRole === 'butler');

      if (needsGuard) {
        try {
          setNavBusy(true);
          const res = await fetch(`/api/work-access?role=${activeRole ?? ''}`);
          const body = await res.json().catch(() => ({}));

          if (!body?.allowed) {
            alert(body?.message ?? '접근할 수 없습니다.');
            return;
          }
        } catch (error) {
          alert('접근 검증 중 오류가 발생했습니다.');
          return;
        } finally {
          setNavBusy(false);
        }
      }

      router.push(href);
    },
    [activeRole, router]
  );

  useEffect(() => {
    function handleOutsideClick(event: MouseEvent) {
      if (!dropdownRef.current) {
        return;
      }

      if (event.target instanceof Node && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleOutsideClick);
    }

    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
    };
  }, [isOpen]);

  return (
    <section
      className={`${styles.commonBar} ${compact ? styles.commonBarCompact : styles.commonBarFull}`}
      data-child-id="1"
    >
      <div className={`${styles.barTop} ${compact ? styles.barTopCompact : ''}`}>
        <article
          className={`${styles.profileCard} ${compact ? styles.profileCardCompact : ''}`}
          aria-label="profiles"
        >
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

        <div className={`${styles.roleCluster} ${compact ? styles.roleClusterCompact : ''}`} aria-label="역할 선택 및 글로벌 조작">
          <div className={styles.roleDropdown} ref={dropdownRef} aria-label="사용자 역할">
            <button
              type="button"
              className={`${styles.roleTrigger} ${compact ? styles.roleTriggerCompact : ''}`}
              onClick={toggleDropdown}
              aria-haspopup="listbox"
              aria-expanded={isOpen}
              title={roleSummary}
            >
              <span>{triggerLabel}</span>
              <ChevronIcon isOpen={isOpen} />
            </button>
            {isOpen ? (
              roles.length > 0 ? (
                <ul className={styles.roleMenu} role="listbox">
                  {roles.map((role) => (
                    <li key={role} role="option" aria-selected={role === activeRole} className={styles.roleMenuItem}>
                      <button type="button" onClick={() => handleRoleSelect(role)}>
                        <span>{roleLabels[role] ?? role}</span>
                        <span className={role === activeRole ? styles.roleStatus : styles.roleStatusMuted}>
                          {role === activeRole ? 'ON' : '선택'}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className={styles.roleMenuEmpty}>할당된 역할이 없습니다.</div>
              )
            ) : null}
          </div>

          <div className={`${styles.globalButtons} ${compact ? styles.globalButtonsCompact : ''}`}>
            <button
              type="button"
              aria-label="이전 화면"
              className={`${styles.iconButton} ${compact ? styles.iconButtonCompact : ''}`}
              onClick={handleBack}
            >
              <BackIcon />
            </button>
            <button
              type="button"
              aria-label="홈으로 이동"
              className={`${styles.iconButton} ${compact ? styles.iconButtonCompact : ''}`}
              onClick={handleHome}
            >
              <HomeIcon />
            </button>
            <button
              type="button"
              aria-label="로그아웃"
              className={`${styles.iconButton} ${compact ? styles.iconButtonCompact : ''}`}
              onClick={handleLogout}
            >
              <LogoutIcon />
            </button>
          </div>
        </div>
      </div>

      {navLinks.length ? (
        <nav className={`${styles.globalNav} ${compact ? styles.globalNavCompact : ''}`} aria-label="화면 이동">
          {navLinks.map((link) => (
            <button
              key={link.href}
              type="button"
              className={`${styles.navButton} ${styles.navButtonEnabled}`}
              onClick={(event) => handleNavClick(event, link.href)}
              disabled={navBusy}
            >
              {link.label}
            </button>
          ))}
        </nav>
      ) : null}
    </section>
  );
}

function ChevronIcon({ isOpen }: { isOpen: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={isOpen ? styles.chevronOpen : ''}>
      <path d="m6 9 6 6 6-6" />
    </svg>
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
