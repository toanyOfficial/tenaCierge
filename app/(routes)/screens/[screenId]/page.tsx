import type { Metadata } from 'next';
import Link from 'next/link';

import styles from './screens.module.css';
import CleaningListClient from './CleaningListClient';
import ApplyClient from './ApplyClient';
import WorkListClient from './WorkListClient';
import { getCleaningSnapshot } from './server/getCleaningSnapshot';
import { getApplySnapshot } from './server/getApplySnapshot';
import { getWorkListSnapshot } from './server/getWorkListSnapshot';
import { getProfileWithDynamicRoles } from '@/src/server/profile';

type Props = {
  params: {
    screenId: string;
  };
};

export function generateMetadata({ params }: Props): Metadata {
  return {
    title: `화면 ${params.screenId} | TenaCierge Ops`
  };
}

export default async function ScreenPage({
  params,
  searchParams
}: Props & { searchParams?: { date?: string; window?: 'd0' | 'd1' } }) {
  const { screenId } = params;

  if (!['002', '003', '004'].includes(screenId)) {
    return (
      <section className={styles.placeholder}>
        <div className={styles.card}>
          <p className={styles.lead}>화면 ID {screenId}</p>
          <p className={styles.helper}>해당 화면 정의서는 docsForCodex/화면정의서/id-{screenId}.txt 파일을 참고해 주세요.</p>
          <Link className={styles.backLink} href="/dashboard">
            업무 현황으로 돌아가기
          </Link>
        </div>
      </section>
    );
  }

  const profile = await getProfileWithDynamicRoles();

  const isButlerOnlyView =
    screenId === '002' &&
    profile.roles.includes('butler') &&
    !profile.roles.includes('admin') &&
    !profile.roles.includes('host');

  if (isButlerOnlyView) {
    return (
      <section className={styles.placeholder}>
        <div className={styles.card}>
          <p className={styles.lead}>오더관리 화면은 버틀러용으로 제공되지 않습니다.</p>
          <Link className={styles.backLink} href="/dashboard">
            대시보드로 돌아가기
          </Link>
        </div>
      </section>
    );
  }

  if (screenId === '003') {
    const snapshot = await getApplySnapshot(profile);
    return (
      <div className={styles.screenWrapper}>
        <ApplyClient profile={profile} snapshot={snapshot} />
      </div>
    );
  }

  if (screenId === '004') {
    const snapshot = await getWorkListSnapshot(profile, searchParams?.date, searchParams?.window);
    return (
      <div className={styles.screenWrapper}>
        <WorkListClient profile={profile} snapshot={snapshot} />
      </div>
    );
  }

  const snapshot = await getCleaningSnapshot(profile);

  return (
    <div className={styles.screenWrapper}>
      <CleaningListClient profile={profile} snapshot={snapshot} />
    </div>
  );
}
