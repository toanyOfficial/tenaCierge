import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { NextResponse } from 'next/server';

import { logServerError } from '@/src/server/errorLogger';
import { getProfileWithDynamicRoles } from '@/src/server/profile';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const execFileAsync = promisify(execFile);

async function runForecast(scriptPath: string, pythonBin = 'python3') {
  return execFileAsync(pythonBin, [scriptPath, '--refresh-d1']);
}

async function ensureVenvAndInstall(requirementsPath: string) {
  const venvPath = path.join(process.cwd(), 'batchs', '.venv');
  const venvPython = path.join(venvPath, 'bin', 'python3');

  // venv 재생성은 idempotent하므로 매번 시도한다.
  await execFileAsync('python3', ['-m', 'venv', venvPath]);
  await execFileAsync(venvPython, ['-m', 'pip', 'install', '-r', requirementsPath]);

  return venvPython;
}

export async function POST() {
  const profile = await getProfileWithDynamicRoles();

  if (!profile.roles.includes('admin')) {
    return NextResponse.json({ message: '갱신 권한이 없습니다.' }, { status: 403 });
  }

  const scriptPath = path.join(process.cwd(), 'batchs', 'db_forecasting.py');

  try {
    const { stdout, stderr } = await runForecast(scriptPath);

    return NextResponse.json({ ok: true, stdout, stderr });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStderr = (error as { stderr?: string })?.stderr;
    const requirementsPath = path.join(process.cwd(), 'batchs', 'requirements.txt');
    const missingModule = /No module named/.test(errorMessage);
    const pep668Blocked = /externally-managed-environment/i.test(errorMessage);

    if (missingModule || pep668Blocked) {
      try {
        const venvPython = await ensureVenvAndInstall(requirementsPath);
        const { stdout, stderr } = await runForecast(scriptPath, venvPython);

        return NextResponse.json({ ok: true, stdout, stderr, usedVenv: true });
      } catch (installError) {
        await logServerError({
          appName: 'order-refresh',
          message: 'db_forecasting refresh-d1 의존성 설치 실패',
          error: installError,
          context: { scriptPath, requirementsPath, pep668Blocked }
        });

        return NextResponse.json(
          {
            message:
              '갱신 실행 중 의존성 설치에 실패했습니다. 리눅스 전역 pip 대신 가상환경을 생성하려 했으나 실패했습니다.',
            detail: (installError as Error).message
          },
          { status: 500 }
        );
      }
    }

    await logServerError({
      appName: 'order-refresh',
      message: 'db_forecasting refresh-d1 실행 실패',
      error,
      context: { scriptPath, errorMessage, errorStderr }
    });

    return NextResponse.json(
      { message: `갱신 실행 중 오류가 발생했습니다: ${errorMessage}` },
      { status: 500 }
    );
  }
}
