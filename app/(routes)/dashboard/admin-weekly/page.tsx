import { redirect } from 'next/navigation';

import WeeklyWorkDashboard from './WeeklyWorkDashboard';

import { getProfileWithDynamicRoles } from '@/src/server/profile';

export const metadata = {
  title: '대시보드 - 주간업무 | TenaCierge Ops'
};

export default async function AdminWeeklyWorkPage() {
  const profile = await getProfileWithDynamicRoles();
  if (!profile.roles.includes('admin')) {
    redirect('/dashboard');
  }

  return <WeeklyWorkDashboard profile={profile} />;
}
