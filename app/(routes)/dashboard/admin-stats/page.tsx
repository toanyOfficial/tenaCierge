import { redirect } from 'next/navigation';

import dynamic from 'next/dynamic';

const StatsDashboard = dynamic(() => import('./StatsDashboard'), {
  ssr: false
});
import { fetchMonthlyAverages } from './server/fetchMonthlyAverages';
import { fetchMonthlyOverview } from './server/fetchMonthlyOverview';
import { fetchWeekdayStats } from './server/fetchWeekdayStats';

import { getProfileWithDynamicRoles } from '@/src/server/profile';

export const metadata = {
  title: '대시보드 - 통계표 | TenaCierge Ops'
};

export default async function AdminStatsDashboardPage() {
  const profile = await getProfileWithDynamicRoles();
  if (!profile.roles.includes('admin')) {
    redirect('/dashboard');
  }

  const [monthlyAverages, monthlyOverview, weekdayStats] = await Promise.all([
    fetchMonthlyAverages(),
    fetchMonthlyOverview(),
    fetchWeekdayStats()
  ]);

  return (
    <StatsDashboard
      profile={profile}
      monthlyAverages={monthlyAverages}
      monthlyOverview={monthlyOverview}
      weekdayStats={weekdayStats}
    />
  );
}
