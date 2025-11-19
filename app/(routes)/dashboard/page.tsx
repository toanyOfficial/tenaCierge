import type { Metadata } from 'next';
import { cookies } from 'next/headers';

import CommonHeader from './CommonHeader';

export const metadata: Metadata = {
  title: '업무 현황 | TenaCierge Ops',
  description: '모든 역할에 공통으로 노출되는 프로필 및 제어 영역'
};

const roleOrder = ['admin', 'host', 'butler', 'cleaner'] as const;

function normalizeRoleList(list: string[]) {
  const unique = Array.from(new Set(list.map((role) => role.toLowerCase())));

  return unique
    .filter((role) => roleOrder.includes(role as (typeof roleOrder)[number]))
    .sort((a, b) => roleOrder.indexOf(a as (typeof roleOrder)[number]) - roleOrder.indexOf(b as (typeof roleOrder)[number]));
}

export type ProfileSummary = {
  phone: string;
  registerNo: string;
  name: string;
  roles: string[];
};

function parseRoles(raw: string | undefined | null) {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);

    if (Array.isArray(parsed)) {
      return normalizeRoleList(parsed.map((role) => String(role)));
    }
  } catch (error) {
    // fall through to string parsing below
  }

  return normalizeRoleList(
    raw
      .split(',')
      .map((role) => role.trim())
  );
}

function getProfileSummary(): ProfileSummary {
  const cookieStore = cookies();
  const phone = cookieStore.get('tc_phone')?.value || '-';
  const registerNo = cookieStore.get('tc_register')?.value || '-';
  const name = cookieStore.get('tc_name')?.value || '이름 미지정';
  const roles = parseRoles(cookieStore.get('tc_roles')?.value);

  return {
    phone,
    registerNo,
    name,
    roles
  };
}

export default function DashboardPage() {
  const profile = getProfileSummary();

  return <CommonHeader profile={profile} />;
}
