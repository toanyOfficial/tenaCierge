'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';

import CommonHeader from '../CommonHeader';

import styles from '../dashboard.module.css';
import type { ProfileSummary } from '@/src/utils/profile';

type Props = {
  profile: ProfileSummary;
};

type Shortcut = {
  id: string;
  label: string;
  href: string;
  description: string;
};

const shortcuts: Shortcut[] = [
  {
    id: 'people',
    label: '인원관리',
    href: '/dashboard/admin-crud?table=worker_header',
    description: '근무자 정보를 확인하고 수정합니다.'
  },
  {
    id: 'clients',
    label: '고객관리',
    href: '/dashboard/admin-crud?table=client_header',
    description: '고객사 기본 정보를 관리합니다.'
  },
  {
    id: 'rooms',
    label: '객실관리',
    href: '/dashboard/admin-crud?table=client_rooms',
    description: '객실 및 현장 세부 정보를 확인합니다.'
  },
  {
    id: 'schedule-attendance',
    label: '스케쥴관리(출근표)',
    href: '/dashboard/schedule/attendance',
    description: '출근 패턴과 요일별 근무 여부를 관리합니다.'
  },
  {
    id: 'schedule-vacation',
    label: '스케쥴관리(휴가관리)',
    href: '/dashboard/schedule/vacation',
    description: '휴가·예외 근무 일정을 관리합니다.'
  },
  {
    id: 'additional-fees',
    label: '추가비용관리',
    href: '/dashboard/admin-crud?table=client_additional_price',
    description: '추가 금액 및 공제 항목을 관리합니다.'
  },
  {
    id: 'admin-crud',
    label: 'admin CRUD',
    href: '/dashboard/admin-crud',
    description: '전체 테이블을 조회·수정하는 관리 도구입니다.'
  },
  {
    id: 'global-work',
    label: '전수작업관리',
    href: '/dashboard/work-global',
    description: '전수 대상 업무를 만들고 객실 완료 현황을 확인합니다.'
  },
  {
    id: 'work-reservation',
    label: '요청사항관리',
    href: '/dashboard/work-reservation',
    description: 'work_reservation 요청을 조회하고 수정합니다.'
  },
  {
    id: 'weekly-work',
    label: '대시보드-주간업무',
    href: '/dashboard/admin-weekly',
    description: '주간 업무 합계와 D0/D+1 카드 레이아웃을 한 화면에서 확인합니다.'
  },
  {
    id: 'monthly-work',
    label: '대시보드-월간업무',
    href: '/dashboard/admin-monthly',
    description: '출퇴근 캘린더와 월별 누적 청소 현황을 조회합니다.'
  }
];

export default function AdminLandingClient({ profile }: Props) {
  const defaultRole = useMemo(() => (profile.roles.includes('admin') ? 'admin' : profile.roles[0] ?? null), [profile.roles]);
  const [activeRole, setActiveRole] = useState<string | null>(defaultRole);

  return (
    <div className={styles.dashboardStack}>
      <CommonHeader profile={profile} activeRole={activeRole} onRoleChange={setActiveRole} />

      <div className={styles.rolePanels}>
        <section className={styles.adminPanel}>
          <header className={styles.panelHeader}>
            <div>
              <p className={styles.panelTitle}>관리자 진입</p>
              <p className={styles.panelSubtitle}>자주 사용하는 관리 기능을 선택해 주세요.</p>
            </div>
          </header>

          <div className={styles.adminLandingGrid}>
            {shortcuts.map((item) => (
              <Link key={item.id} href={item.href} className={styles.adminLandingCard} prefetch={false}>
                <span className={styles.adminLandingLabel}>{item.label}</span>
                <span className={styles.adminLandingHint}>{item.description}</span>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
