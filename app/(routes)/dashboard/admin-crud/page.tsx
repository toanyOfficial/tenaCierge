import { redirect } from 'next/navigation';

import AdminCrudClient from './AdminCrudClient';

import { listAdminTables } from '@/src/server/adminCrud';
import { getProfileWithDynamicRoles } from '@/src/server/profile';

export const metadata = {
  title: '관리자 CRUD | TenaCierge Ops'
};

type Props = {
  searchParams?: {
    table?: string;
  };
};

export default async function AdminCrudPage({ searchParams }: Props) {
  const profile = await getProfileWithDynamicRoles();
  if (!profile.roles.includes('admin')) {
    redirect('/dashboard');
  }

  const tables = listAdminTables();
  const requestedTable = searchParams?.table;

  return <AdminCrudClient tables={tables} profile={profile} initialTable={requestedTable} />;
}
