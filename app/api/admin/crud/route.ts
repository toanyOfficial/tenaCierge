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

type DbError = {
  code?: string;
  message?: string;
};

async function ensureAdmin() {
  const profile = await getProfileWithDynamicRoles();
  if (!profile.roles.includes('admin')) {
    return null;
  }
  return profile;
}

export async function GET(request: Request) {
  const profile = await ensureAdmin();
  if (!profile) {
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
  const profile = await ensureAdmin();
  if (!profile) {
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
    await handleAdminError(error, { table, data });
    const message = buildUserFacingErrorMessage(error, table);
    return NextResponse.json({ message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const profile = await ensureAdmin();
  if (!profile) {
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
    await updateRow(table, key, data, profile.registerNo);
    const snapshot = await fetchTableSnapshot(table);
    return NextResponse.json(snapshot);
  } catch (error) {
    await handleAdminError(error);
    return NextResponse.json({ message: '데이터 수정 중 오류가 발생했습니다.' }, { status: 500 });
  }
}

function buildUserFacingErrorMessage(error: unknown, table?: string) {
  const dbError = error as DbError;

  if (dbError?.code === 'ER_DUP_ENTRY' && typeof dbError.message === 'string') {
    if (dbError.message.includes('client_header.ux_client_header_phone')) {
      return '이미 등록된 연락처입니다. 기존 고객 정보와 중복되지 않는 휴대전화 번호를 입력해주세요.';
    }

    if (dbError.message.includes('client_header.ux_client_header_register_no')) {
      return '이미 생성된 고객번호입니다. 새로고침 후 다시 시도해주세요.';
    }

    return '이미 존재하는 데이터가 있습니다. 입력값의 중복 여부를 확인해주세요.';
  }

  if (dbError?.code === 'ER_NO_REFERENCED_ROW_2') {
    return '연결된 정보가 없어서 저장할 수 없습니다. 선택한 참조 데이터를 다시 확인해주세요.';
  }

  const target = table ? `${table} 데이터` : '데이터';
  return `${target} 생성 중 오류가 발생했습니다. 입력값을 다시 확인한 후 시도해주세요.`;
}

export async function DELETE(request: Request) {
  const profile = await ensureAdmin();
  if (!profile) {
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
