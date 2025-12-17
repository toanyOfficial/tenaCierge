import { redirect } from 'next/navigation';

import { DateTime } from 'luxon';

import StatsTableDashboard from './StatsTableDashboard';

import { fetchStatsTableSnapshot } from '@/src/server/dashboardStatsTable';
import { getProfileWithDynamicRoles } from '@/src/server/profile';
import { KST } from '@/src/lib/time';

export const metadata = {
  title: '대시보드-통계표 | TenaCierge Ops'
};

export default async function AdminStatsTablePage() {
  const profile = await getProfileWithDynamicRoles();
  if (!profile.roles.includes('admin')) {
    redirect('/dashboard');
  }

  const reference = DateTime.fromISO('2025-12-17T22:36', { zone: KST });
  const snapshot = await fetchStatsTableSnapshot(reference);

  return <StatsTableDashboard snapshot={snapshot} />;
}
