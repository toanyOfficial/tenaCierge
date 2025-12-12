import { redirect } from 'next/navigation';

import MonthlyWorkDashboard from './MonthlyWorkDashboard';

import { getProfileWithDynamicRoles } from '@/src/server/profile';

export const metadata = {
  title: '대시보드 - 월간업무 | TenaCierge Ops'
};

export default async function AdminMonthlyWorkPage() {
  const profile = await getProfileWithDynamicRoles();
  if (!profile.roles.includes('admin')) {
    redirect('/dashboard');
  }

  return <MonthlyWorkDashboard profile={profile} />;
}
