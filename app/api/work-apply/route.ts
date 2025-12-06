import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';

import { db } from '@/src/db/client';
import { etcBaseCode } from '@/src/db/schema';
import { getProfileWithDynamicRoles } from '@/src/server/profile';
import { createApplySlot } from '@/src/server/workApply';
import { logServerError } from '@/src/server/errorLogger';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const ALLOWED_ROLE = 'admin';

export async function POST(request: Request) {
  try {
    const profile = await getProfileWithDynamicRoles();
    if (!profile.roles.includes(ALLOWED_ROLE)) {
      return NextResponse.json({ message: '관리자만 슬롯을 생성할 수 있습니다.' }, { status: 403 });
    }

    const body = (await request.json()) as {
      workDate?: string;
      sectorCode?: string;
      sectorValue?: string;
      position?: number;
    };

    if (!body.workDate || !body.sectorCode || !body.sectorValue || !body.position) {
      return NextResponse.json({ message: '날짜, 섹터, 포지션을 모두 입력해 주세요.' }, { status: 400 });
    }

    if (body.position !== 1 && body.position !== 2) {
      return NextResponse.json({ message: '포지션은 클리너(1) 또는 버틀러(2)만 선택할 수 있습니다.' }, { status: 400 });
    }

    console.info('[work-apply:create] request', {
      workDate: body.workDate,
      sectorCode: body.sectorCode,
      sectorValue: body.sectorValue,
      position: body.position
    });

    const sector = await db
      .select({ code: etcBaseCode.code })
      .from(etcBaseCode)
      .where(and(eq(etcBaseCode.codeGroup, body.sectorCode), eq(etcBaseCode.code, body.sectorValue)))
      .limit(1);

    if (!sector.length) {
      return NextResponse.json({ message: '등록된 섹터를 선택해 주세요.' }, { status: 400 });
    }

    const result = await createApplySlot({
      workDate: body.workDate,
      sectorCode: body.sectorCode,
      sectorValue: body.sectorValue,
      position: body.position
    });

    console.info('[work-apply:create] stored', {
      requestedDate: body.workDate,
      storedDate: result.storedDate,
      id: result.id
    });

    return NextResponse.json({ message: '슬롯이 추가되었습니다.', id: result.id, seq: result.seq, workDate: result.storedDate });
  } catch (error) {
    await logServerError({ appName: 'work-apply-create', message: '업무 신청 슬롯 생성 실패', error });
    return NextResponse.json({ message: '슬롯 생성 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
