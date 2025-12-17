import { redirect } from 'next/navigation';

import StatsDashboard from './StatsDashboard';

import { getProfileWithDynamicRoles } from '@/src/server/profile';

export const metadata = {
  title: '대시보드 - 통계표 | TenaCierge Ops'
};

export default async function AdminStatsDashboardPage() {
  const profile = await getProfileWithDynamicRoles();
  if (!profile.roles.includes('admin')) {
    redirect('/dashboard');
  }

  return <StatsDashboard profile={profile} />;
}
