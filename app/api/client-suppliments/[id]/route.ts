import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';

import { db } from '@/src/db/client';
import { clientHeader, clientRooms, clientSupplements } from '@/src/db/schema';
import { findClientByProfile } from '@/src/server/clients';
import { logServerError } from '@/src/server/errorLogger';
import { getProfileWithDynamicRoles } from '@/src/server/profile';
import { withUpdateAuditFields } from '@/src/server/audit';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  let supplyId: number | null = null;

  try {
    supplyId = Number(params.id);

    if (!Number.isFinite(supplyId)) {
      return NextResponse.json({ message: '잘못된 소모품 ID 입니다.' }, { status: 400 });
    }

    const body = (await request.json().catch(() => null)) ?? {};
    const buyYn = Boolean(body.buyYn);

    const profile = await getProfileWithDynamicRoles();
    const isAdmin = profile.roles.includes('admin');
    const isHost = profile.roles.includes('host');

    if (!isAdmin && !isHost) {
      return NextResponse.json({ message: '수정 권한이 없습니다.' }, { status: 403 });
    }

    const [row] = await db
      .select({
        id: clientSupplements.id,
        clientId: clientHeader.id
      })
      .from(clientSupplements)
      .innerJoin(clientRooms, eq(clientRooms.id, clientSupplements.roomId))
      .innerJoin(clientHeader, eq(clientHeader.id, clientRooms.clientId))
      .where(eq(clientSupplements.id, supplyId))
      .limit(1);

    if (!row) {
      return NextResponse.json({ message: '대상을 찾을 수 없습니다.' }, { status: 404 });
    }

    if (!isAdmin) {
      const client = await findClientByProfile(profile);
      if (!client || client.id !== row.clientId) {
        return NextResponse.json({ message: '해당 항목을 수정할 수 없습니다.' }, { status: 403 });
      }
    }

    await db
      .update(clientSupplements)
      .set(withUpdateAuditFields({ buyYn }, profile.registerNo))
      .where(eq(clientSupplements.id, supplyId));

    return NextResponse.json({ id: supplyId, buyYn });
  } catch (error) {
    await logServerError({ appName: 'client-suppliments', message: '소모품 구매 여부 업데이트 실패', error, context: { supplyId } });
    return NextResponse.json({ message: '소모품 정보를 수정하는 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
