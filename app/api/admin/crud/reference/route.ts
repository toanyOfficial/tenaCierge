import { NextResponse } from 'next/server';

import { fetchReferenceLabels, fetchReferenceOptions, handleAdminError, listAdminTables } from '@/src/server/adminCrud';
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
  const table = url.searchParams.get('table');
  const column = url.searchParams.get('column');
  const keyword = url.searchParams.get('q') ?? '';
  const limit = Math.min(Number(url.searchParams.get('limit') ?? '20') || 20, 50);
  const basecodeGroup = url.searchParams.get('basecodeGroup') ?? undefined;
  const valuesParam = url.searchParams.get('values');
  const values = valuesParam
    ? valuesParam
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)
    : [];

  if (!table || !column) {
    return NextResponse.json({ message: 'table, column 파라미터가 필요합니다.', tables: listAdminTables() }, { status: 400 });
  }

  try {
    if (values.length) {
      const labels = await fetchReferenceLabels(table, column, values, basecodeGroup);
      return NextResponse.json({ labels });
    }

    const options = await fetchReferenceOptions(table, column, keyword, limit, basecodeGroup);
    return NextResponse.json({ options });
  } catch (error) {
    await handleAdminError(error);
    const message = error instanceof Error ? error.message : '연관 데이터 조회 중 오류가 발생했습니다.';
    const status = message.includes('레퍼런스 정보') ? 400 : 500;
    return NextResponse.json({ message }, { status });
  }
}
