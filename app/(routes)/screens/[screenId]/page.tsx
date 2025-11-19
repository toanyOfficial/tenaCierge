import type { Metadata } from 'next';
import Link from 'next/link';

import styles from './screens.module.css';
import CleaningListClient from './CleaningListClient';
import { getCleaningSnapshot } from './server/getCleaningSnapshot';
import { getProfileSummary } from '@/src/utils/profile';

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

export default async function ScreenPage({ params }: Props) {
  const { screenId } = params;

  if (screenId !== '002') {
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

  const profile = getProfileSummary();
  const snapshot = await getCleaningSnapshot(profile);

  return (
    <div className={styles.screenWrapper}>
      <CleaningListClient profile={profile} snapshot={snapshot} />
    </div>
  );
}
