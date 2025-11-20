import { cookies } from 'next/headers';

const roleOrder = ['admin', 'host', 'butler', 'cleaner'] as const;

export type ProfileSummary = {
  phone: string;
  registerNo: string;
  name: string;
  roles: string[];
  primaryRole: string | null;
};

function normalizeRoleList(list: string[]) {
  const unique = Array.from(new Set(list.map((role) => role.toLowerCase())));

  return unique
    .filter((role) => roleOrder.includes(role as (typeof roleOrder)[number]))
    .sort((a, b) => roleOrder.indexOf(a as (typeof roleOrder)[number]) - roleOrder.indexOf(b as (typeof roleOrder)[number]));
}

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
    // ignore
  }

  return normalizeRoleList(
    raw
      .split(',')
      .map((role) => role.trim())
  );
}

export function getProfileSummary(): ProfileSummary {
  const cookieStore = cookies();
  const phone = cookieStore.get('phone')?.value || cookieStore.get('tc_phone')?.value || '-';
  const registerNo = cookieStore.get('register_no')?.value || cookieStore.get('tc_register')?.value || '-';
  const name = cookieStore.get('name')?.value || cookieStore.get('tc_name')?.value || '이름 미지정';
  const roles = parseRoles(cookieStore.get('role_arrange')?.value ?? cookieStore.get('tc_roles')?.value);
  const primaryRoleCookie = cookieStore.get('role')?.value?.trim();

  return {
    phone,
    registerNo,
    name,
    roles,
    primaryRole: primaryRoleCookie && roles.includes(primaryRoleCookie) ? primaryRoleCookie : roles[0] ?? null
  };
}
