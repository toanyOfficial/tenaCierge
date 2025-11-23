import { NextResponse } from 'next/server';

import { searchWorkersByTerm } from '@/src/server/workers';
import { getProfileWithDynamicRoles } from '@/src/server/profile';

export async function GET(request: Request) {
  const profile = await getProfileWithDynamicRoles();

  if (!profile.roles.includes('admin')) {
    return NextResponse.json({ message: '관리자만 검색할 수 있습니다.' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q') ?? '';
  const results = await searchWorkersByTerm(query, 20);

  return NextResponse.json({ results });
}
