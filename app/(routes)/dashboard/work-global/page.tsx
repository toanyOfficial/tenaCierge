import { redirect } from 'next/navigation';

import WorkGlobalClient from './WorkGlobalClient';

import { listWorkGlobalHeaders } from '@/src/server/workGlobal';
import { getProfileWithDynamicRoles } from '@/src/server/profile';

export const metadata = {
  title: '전수작업관리 | TenaCierge Ops'
};

export default async function WorkGlobalPage() {
  const profile = await getProfileWithDynamicRoles();
  if (!profile.roles.includes('admin')) {
    redirect('/dashboard');
  }

  const headers = await listWorkGlobalHeaders();

  return <WorkGlobalClient profile={profile} initialHeaders={headers} />;
}
