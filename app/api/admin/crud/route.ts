import { NextResponse } from 'next/server';

import {
  deleteRow,
  fetchTableSnapshot,
  handleAdminError,
  insertRow,
  listAdminTables,
  updateRow
} from '@/src/server/adminCrud';
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
  const limit = Math.min(Number(url.searchParams.get('limit') ?? '20') || 20, 100);
  const offset = Number(url.searchParams.get('offset') ?? '0') || 0;

  if (!table) {
    return NextResponse.json({ tables: listAdminTables() });
  }

  try {
    const snapshot = await fetchTableSnapshot(table, offset, limit);
    return NextResponse.json(snapshot);
  } catch (error) {
    await handleAdminError(error);
    return NextResponse.json({ message: '테이블 조회 중 오류가 발생했습니다.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const isAdmin = await ensureAdmin();
  if (!isAdmin) {
    return NextResponse.json({ message: '관리자만 접근 가능합니다.' }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const table = typeof body?.table === 'string' ? body.table : null;
  const data = (body?.data as Record<string, unknown>) ?? {};

  if (!table) {
    return NextResponse.json({ message: 'table 파라미터가 필요합니다.' }, { status: 400 });
  }

  try {
    await insertRow(table, data);
    const snapshot = await fetchTableSnapshot(table);
    return NextResponse.json(snapshot);
  } catch (error) {
    await handleAdminError(error);
    return NextResponse.json({ message: '데이터 생성 중 오류가 발생했습니다.' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const isAdmin = await ensureAdmin();
  if (!isAdmin) {
    return NextResponse.json({ message: '관리자만 접근 가능합니다.' }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const table = typeof body?.table === 'string' ? body.table : null;
  const key = (body?.key as Record<string, unknown>) ?? {};
  const data = (body?.data as Record<string, unknown>) ?? {};

  if (!table) {
    return NextResponse.json({ message: 'table 파라미터가 필요합니다.' }, { status: 400 });
  }

  try {
    await updateRow(table, key, data);
    const snapshot = await fetchTableSnapshot(table);
    return NextResponse.json(snapshot);
  } catch (error) {
    await handleAdminError(error);
    return NextResponse.json({ message: '데이터 수정 중 오류가 발생했습니다.' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const isAdmin = await ensureAdmin();
  if (!isAdmin) {
    return NextResponse.json({ message: '관리자만 접근 가능합니다.' }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const table = typeof body?.table === 'string' ? body.table : null;
  const key = (body?.key as Record<string, unknown>) ?? {};

  if (!table) {
    return NextResponse.json({ message: 'table 파라미터가 필요합니다.' }, { status: 400 });
  }

  try {
    await deleteRow(table, key);
    const snapshot = await fetchTableSnapshot(table);
    return NextResponse.json(snapshot);
  } catch (error) {
    await handleAdminError(error);
    return NextResponse.json({ message: '데이터 삭제 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
