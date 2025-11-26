import { redirect } from 'next/navigation';

import AdminCrudClient from './AdminCrudClient';

import { listAdminTables } from '@/src/server/adminCrud';
import { getProfileWithDynamicRoles } from '@/src/server/profile';

export const metadata = {
  title: '관리자 CRUD | TenaCierge Ops'
};

export default async function AdminCrudPage() {
  const profile = await getProfileWithDynamicRoles();
  if (!profile.roles.includes('admin')) {
    redirect('/dashboard');
  }

  const tables = listAdminTables();

  return <AdminCrudClient tables={tables} />;
}
