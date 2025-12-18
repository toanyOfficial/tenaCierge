import { NextResponse } from 'next/server';

import { runWebPushWorker } from '@/src/server/push/webPush';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type WorkerPayload = {
  limit?: number;
  lockedBy?: string;
};

function parseBody(json: unknown): WorkerPayload {
  if (!json || typeof json !== 'object') return {};
  const value = json as Record<string, unknown>;
  const limit = typeof value.limit === 'number' ? value.limit : Number(value.limit);
  const lockedBy = typeof value.lockedBy === 'string' && value.lockedBy.trim() ? value.lockedBy.trim() : undefined;

  return { limit: Number.isFinite(limit) && limit > 0 ? limit : undefined, lockedBy };
}

function authorize(request: Request) {
  const requiredToken = process.env.PUSH_WORKER_TOKEN;
  if (!requiredToken) return true;

  const provided = request.headers.get('x-worker-token');
  return provided === requiredToken;
}

export async function POST(request: Request) {
  if (!authorize(request)) {
    return NextResponse.json({ message: 'unauthorized' }, { status: 401 });
  }

  let payload: WorkerPayload = {};
  try {
    payload = parseBody(await request.json());
  } catch (error) {
    payload = {};
  }

  const limitFromEnv = process.env.PUSH_WORKER_BATCH_SIZE ? Number(process.env.PUSH_WORKER_BATCH_SIZE) : undefined;
  const limit = payload.limit ?? (Number.isFinite(limitFromEnv) && (limitFromEnv as number) > 0 ? (limitFromEnv as number) : 50);

  const lockedBy = payload.lockedBy ?? process.env.PUSH_WORKER_ID ?? 'webpush-cron';

  try {
    const results = await runWebPushWorker({ limit, lockedBy });
    const summary = results.reduce(
      (acc, curr) => {
        acc.jobs += 1;
        acc.sent += curr.sent;
        acc.failed += curr.failed;
        return acc;
      },
      { jobs: 0, sent: 0, failed: 0 }
    );

    if (!results.length) {
      console.info('[web-push] worker idle', { limit, lockedBy });
    } else {
      console.info('[web-push] worker run complete', { summary, limit, lockedBy });
    }

    return NextResponse.json({ summary, results });
  } catch (error) {
    console.error('[web-push] worker run failed', error);
    return NextResponse.json({ message: 'worker 실행 실패' }, { status: 500 });
  }
}
