import { NextResponse } from 'next/server';

import { getProfileWithDynamicRoles } from '@/src/server/profile';
import { createWorkGlobalHeader, listWorkGlobalHeaders } from '@/src/server/workGlobal';
import { logServerError } from '@/src/server/errorLogger';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  const profile = await getProfileWithDynamicRoles();
  if (!profile.roles.includes('admin')) {
    return NextResponse.json({ message: '접근 권한이 없습니다.' }, { status: 403 });
  }

  const headers = await listWorkGlobalHeaders();
  return NextResponse.json({ headers });
}

export async function POST(req: Request) {
  const profile = await getProfileWithDynamicRoles();
  if (!profile.roles.includes('admin')) {
    return NextResponse.json({ message: '접근 권한이 없습니다.' }, { status: 403 });
  }

  try {
    const body = await req.json();
    const payload = {
      emoji: body.emoji ?? null,
      title: String(body.title ?? '').trim(),
      dscpt: String(body.dscpt ?? '').trim(),
      startDate: String(body.startDate ?? ''),
      endDate: body.endDate ? String(body.endDate) : null,
      remainQty: Number(body.remainQty ?? 0),
      closedYn: Boolean(body.closedYn ?? false),
      comment: body.comment ? String(body.comment) : null
    };

    if (!payload.title || !payload.dscpt || !payload.startDate) {
      return NextResponse.json({ message: '필수 입력값을 확인해 주세요.' }, { status: 400 });
    }

    const headers = await createWorkGlobalHeader(payload);
    return NextResponse.json({ headers });
  } catch (error) {
    await logServerError({ appName: 'work-global-headers', message: '전수작업 헤더 생성 실패', error });
    return NextResponse.json({ message: '저장 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
