import { NextResponse } from 'next/server';

import {
  queueCleanSchedulePush,
  queueSupplementsPendingPush,
  queueWorkApplyOpenPush
} from '@/src/server/push/scenarios';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type ScenarioPayload =
  | { scenario: 'CLEAN_SCHEDULE'; runDate: string; offsetDays?: number; createdBy?: string }
  | { scenario: 'SUPPLEMENTS_PENDING'; today?: string; createdBy?: string }
  | { scenario: 'WORK_APPLY_OPEN'; today?: string; horizonDays?: number; createdBy?: string };

function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  const dt = new Date(value);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

export async function POST(request: Request) {
  let payload: ScenarioPayload | null = null;
  try {
    payload = (await request.json()) as ScenarioPayload;
  } catch (error) {
    return NextResponse.json({ message: '유효한 JSON 본문이 필요합니다.' }, { status: 400 });
  }

  if (!payload || typeof payload !== 'object' || typeof (payload as { scenario?: unknown }).scenario !== 'string') {
    return NextResponse.json({ message: 'scenario 필드가 필요합니다.' }, { status: 400 });
  }

  switch (payload.scenario) {
    case 'CLEAN_SCHEDULE': {
      const runDate = parseDate(payload.runDate);
      if (!runDate) {
        return NextResponse.json({ message: 'runDate가 필요합니다.' }, { status: 400 });
      }

      try {
        const result = await queueCleanSchedulePush({
          runDate,
          offsetDays: payload.offsetDays ?? 0,
          createdBy: payload.createdBy ?? 'api/push/scenario'
        });

        if (!result.created) {
          console.info('[web-push] CLEAN_SCHEDULE dedup 또는 대상 없음', {
            targetDate: result.targetDate,
            attempted: result.attempted
          });
        }
        return NextResponse.json(result);
      } catch (error) {
        console.error('[web-push] CLEAN_SCHEDULE enqueue 실패', error);
        return NextResponse.json({ message: 'enqueue 실패' }, { status: 500 });
      }
    }

    case 'SUPPLEMENTS_PENDING': {
      const today = parseDate(payload.today ?? undefined) ?? new Date();
      try {
        const result = await queueSupplementsPendingPush({
          today,
          createdBy: payload.createdBy ?? 'api/push/scenario'
        });
        if (!result.created) {
          console.info('[web-push] SUPPLEMENTS_PENDING dedup 또는 대상 없음', {
            attempted: result.attempted
          });
        }
        return NextResponse.json(result);
      } catch (error) {
        console.error('[web-push] SUPPLEMENTS_PENDING enqueue 실패', error);
        return NextResponse.json({ message: 'enqueue 실패' }, { status: 500 });
      }
    }

    case 'WORK_APPLY_OPEN': {
      const today = parseDate(payload.today ?? undefined) ?? new Date();
      try {
        const result = await queueWorkApplyOpenPush({
          today,
          horizonDays: payload.horizonDays,
          createdBy: payload.createdBy ?? 'api/push/scenario'
        });
        if (!result.created) {
          console.info('[web-push] WORK_APPLY_OPEN dedup 또는 대상 없음', {
            attempted: result.attempted,
            openCount: result.openCount
          });
        }
        return NextResponse.json(result);
      } catch (error) {
        console.error('[web-push] WORK_APPLY_OPEN enqueue 실패', error);
        return NextResponse.json({ message: 'enqueue 실패' }, { status: 500 });
      }
    }

    default:
      return NextResponse.json({ message: '지원하지 않는 scenario 입니다.' }, { status: 400 });
  }
}
