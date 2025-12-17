import { redirect } from 'next/navigation';

import StatsTableDashboard from './StatsTableDashboard';

import { fetchStatsTableSnapshot } from '@/src/server/dashboardStatsTable';
import { getProfileWithDynamicRoles } from '@/src/server/profile';

export const metadata = {
  title: '대시보드-통계표 | TenaCierge Ops'
};

export default async function AdminStatsTablePage() {
  const profile = await getProfileWithDynamicRoles();
  if (!profile.roles.includes('admin')) {
    redirect('/dashboard');
  }

  const snapshot = await fetchStatsTableSnapshot();

  return <StatsTableDashboard snapshot={snapshot} />;
}
