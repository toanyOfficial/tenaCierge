import { NextResponse } from 'next/server';

import { fetchWeeklyDashboardData } from '@/src/server/dashboardWeekly';
import { getProfileWithDynamicRoles } from '@/src/server/profile';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  const profile = await getProfileWithDynamicRoles();
  if (!profile.roles.includes('admin')) {
    return NextResponse.json({ message: '관리자만 접근 가능합니다.' }, { status: 403 });
  }

  const snapshot = await fetchWeeklyDashboardData();
  return NextResponse.json(snapshot);
}
