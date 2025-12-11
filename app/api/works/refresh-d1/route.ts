import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { NextResponse } from 'next/server';

import { logServerError } from '@/src/server/errorLogger';
import { getProfileWithDynamicRoles } from '@/src/server/profile';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const execFileAsync = promisify(execFile);

export async function POST() {
  const profile = await getProfileWithDynamicRoles();

  if (!profile.roles.includes('admin')) {
    return NextResponse.json({ message: '갱신 권한이 없습니다.' }, { status: 403 });
  }

  const scriptPath = path.join(process.cwd(), 'batchs', 'db_forecasting.py');

  try {
    const { stdout, stderr } = await execFileAsync('python3', [scriptPath, '--refresh-d1']);

    return NextResponse.json({ ok: true, stdout, stderr });
  } catch (error) {
    await logServerError({
      appName: 'order-refresh',
      message: 'db_forecasting refresh-d1 실행 실패',
      error,
      context: { scriptPath }
    });

    return NextResponse.json({ message: '갱신 실행 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
