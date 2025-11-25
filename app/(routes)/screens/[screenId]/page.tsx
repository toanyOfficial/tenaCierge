import type { Metadata } from 'next';
import Link from 'next/link';

import styles from './screens.module.css';
import CleaningListClient from './CleaningListClient';
import ApplyClient from './ApplyClient';
import WorkListClient from './WorkListClient';
import CleaningReportClient from './CleaningReportClient';
import SupervisingReportClient from './SupervisingReportClient';
import { getCleaningSnapshot } from './server/getCleaningSnapshot';
import { getApplySnapshot } from './server/getApplySnapshot';
import { getWorkListSnapshot } from './server/getWorkListSnapshot';
import { getCleaningReportSnapshot } from './server/getCleaningReportSnapshot';
import { getSupervisingReportSnapshot } from './server/getSupervisingReportSnapshot';
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
}: Props & { searchParams?: { date?: string; window?: 'd0' | 'd1'; workId?: string } }) {
  const { screenId } = params;

  if (!['002', '003', '004', '005', '006'].includes(screenId)) {
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

  if (screenId === '005') {
    const workId = searchParams?.workId ? Number(searchParams.workId) : null;

    if (!workId || Number.isNaN(workId)) {
      return (
        <section className={styles.placeholder}>
          <div className={styles.card}>
            <p className={styles.lead}>청소완료보고를 조회하려면 workId 파라미터가 필요합니다.</p>
            <p className={styles.helper}>업무 목록에서 원하는 업무를 선택해 이동해 주세요.</p>
            <Link className={styles.backLink} href="/screens/004">
              업무 목록으로 돌아가기
            </Link>
          </div>
        </section>
      );
    }

    try {
      const snapshot = await getCleaningReportSnapshot(profile, workId);

      return (
        <div className={styles.screenWrapper}>
          <CleaningReportClient profile={profile} snapshot={snapshot} />
        </div>
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : '청소완료보고 데이터를 불러오지 못했습니다.';

      return (
        <section className={styles.placeholder}>
          <div className={styles.card}>
            <p className={styles.lead}>청소완료보고 화면을 불러오지 못했습니다.</p>
            <p className={styles.helper}>{message}</p>
            <Link className={styles.backLink} href="/screens/004">
              업무 목록으로 돌아가기
            </Link>
          </div>
        </section>
      );
    }
  }

  if (screenId === '006') {
    const workId = searchParams?.workId ? Number(searchParams.workId) : null;

    if (!workId || Number.isNaN(workId)) {
      return (
        <section className={styles.placeholder}>
          <div className={styles.card}>
            <p className={styles.lead}>수퍼바이징 완료보고를 조회하려면 workId 파라미터가 필요합니다.</p>
            <p className={styles.helper}>과업지시서에서 검수완료 버튼을 눌러 이동해 주세요.</p>
            <Link className={styles.backLink} href="/screens/004">
              과업지시서로 돌아가기
            </Link>
          </div>
        </section>
      );
    }

    try {
      const snapshot = await getSupervisingReportSnapshot(profile, workId);

      return (
        <div className={styles.screenWrapper}>
          <SupervisingReportClient profile={profile} snapshot={snapshot} />
        </div>
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : '수퍼바이징 완료보고 데이터를 불러오지 못했습니다.';

      return (
        <section className={styles.placeholder}>
          <div className={styles.card}>
            <p className={styles.lead}>수퍼바이징 완료보고 화면을 불러오지 못했습니다.</p>
            <p className={styles.helper}>{message}</p>
            <Link className={styles.backLink} href="/screens/004">
              과업지시서로 돌아가기
            </Link>
          </div>
        </section>
      );
    }
  }

  const snapshot = await getCleaningSnapshot(profile);

  return (
    <div className={styles.screenWrapper}>
      <CleaningListClient profile={profile} snapshot={snapshot} />
    </div>
  );
}
