import { redirect } from 'next/navigation';

import AdminLandingClient from './AdminLandingClient';

import { getProfileWithDynamicRoles } from '@/src/server/profile';

export const metadata = {
  title: '관리자 진입 | TenaCierge Ops'
};
export default async function AdminLandingPage() {
  const profile = await getProfileWithDynamicRoles();
  if (!profile.roles.includes('admin')) {
    redirect('/dashboard');
  }

  return <AdminLandingClient profile={profile} />;
}
