import { redirect } from 'next/navigation';

import AdminCrudClient from '../../admin-crud/AdminCrudClient';

import { listAdminTables } from '@/src/server/adminCrud';
import { getProfileWithDynamicRoles } from '@/src/server/profile';

export const metadata = {
  title: '스케쥴관리(휴가관리) | TenaCierge Ops'
};

export default async function ScheduleVacationPage() {
  const profile = await getProfileWithDynamicRoles();
  if (!profile.roles.includes('admin')) {
    redirect('/dashboard');
  }

  const tableOptions = listAdminTables()
    .filter((table) => table.name === 'worker_schedule_exception')
    .map((table) => ({ ...table, label: '스케쥴관리(휴가관리)' }));

  const initialTable = tableOptions[0]?.name ?? null;

  return (
    <AdminCrudClient
      tables={tableOptions}
      profile={profile}
      initialTable={initialTable}
      title="스케쥴관리(휴가관리)"
    />
  );
}
