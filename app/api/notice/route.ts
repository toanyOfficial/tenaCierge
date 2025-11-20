import { NextResponse } from 'next/server';
import { desc, eq } from 'drizzle-orm';

import { etcNotice } from '@/src/db/schema';

export async function GET() {
  try {
    const { db } = await import('@/src/db/client');
    const [latest] = await db
      .select({
        id: etcNotice.id,
        notice: etcNotice.notice,
        noticeDate: etcNotice.noticeDate,
        updatedAt: etcNotice.updatedAt
      })
      .from(etcNotice)
      .orderBy(desc(etcNotice.updatedAt))
      .limit(1);

    return NextResponse.json({
      id: latest?.id ?? null,
      notice: latest?.notice ?? '',
      noticeDate: latest?.noticeDate ?? null,
      updatedAt: latest?.updatedAt ?? null
    });
  } catch (error) {
    console.error('공지 조회 실패', error);
    return NextResponse.json(
      { error: '공지 사항을 불러오지 못했습니다.' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const noticeInput = typeof body?.notice === 'string' ? body.notice.trim() : '';
  const requestedId = typeof body?.id === 'number' ? body.id : null;

  if (!noticeInput) {
    return NextResponse.json({ error: '공지 내용을 입력해 주세요.' }, { status: 400 });
  }

  if (noticeInput.length > 255) {
    return NextResponse.json({ error: '공지 내용은 255자를 초과할 수 없습니다.' }, { status: 400 });
  }

  try {
    const { db } = await import('@/src/db/client');
    const today = formatDateKey(getKstNow());

    if (requestedId) {
      await db.update(etcNotice).set({ notice: noticeInput, noticeDate: today }).where(eq(etcNotice.id, requestedId));
    } else {
      const [latest] = await db.select({ id: etcNotice.id }).from(etcNotice).orderBy(desc(etcNotice.updatedAt)).limit(1);

      if (latest) {
        await db.update(etcNotice).set({ notice: noticeInput, noticeDate: today }).where(eq(etcNotice.id, latest.id));
      } else {
        await db.insert(etcNotice).values({ notice: noticeInput, noticeDate: today });
      }
    }

    const [saved] = await db
      .select({
        id: etcNotice.id,
        notice: etcNotice.notice,
        noticeDate: etcNotice.noticeDate,
        updatedAt: etcNotice.updatedAt
      })
      .from(etcNotice)
      .orderBy(desc(etcNotice.updatedAt))
      .limit(1);

    return NextResponse.json(saved ?? { id: null, notice: noticeInput, noticeDate: today, updatedAt: null });
  } catch (error) {
    console.error('공지 저장 실패', error);
    return NextResponse.json({ error: '공지 저장 중 오류가 발생했습니다.' }, { status: 500 });
  }
}

function getKstNow() {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  return new Date(utc + 9 * 60 * 60000);
}

function formatDateKey(date: Date) {
  return date.toISOString().split('T')[0];
}
