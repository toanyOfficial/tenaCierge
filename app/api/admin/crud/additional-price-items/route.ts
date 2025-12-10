import { NextResponse } from 'next/server';

import { fetchReferenceOptions } from '@/src/server/adminCrud';
import { getProfileWithDynamicRoles } from '@/src/server/profile';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

async function ensureAdmin() {
  const profile = await getProfileWithDynamicRoles();
  if (!profile.roles.includes('admin')) {
    return false;
  }
  return true;
}

export async function GET(request: Request) {
  const isAdmin = await ensureAdmin();
  if (!isAdmin) {
    return NextResponse.json({ message: '관리자만 접근 가능합니다.' }, { status: 403 });
  }

  const url = new URL(request.url);
  const keyword = url.searchParams.get('q') ?? '';

  try {
    const options = await fetchReferenceOptions('client_additional_price', 'title', keyword, 100);
    return NextResponse.json(options);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ message: '추가비용 항목 조회 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
