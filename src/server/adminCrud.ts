import type { RowDataPacket } from 'mysql2';

import { getPool } from '@/src/db/client';
import { logServerError } from '@/src/server/errorLogger';

export type AdminReference = { table: string; column: string };
export type AdminTableConfig = {
  name: string;
  label?: string;
  primaryKey?: string[];
  references?: Record<string, AdminReference>;
};

export type AdminColumnMeta = {
  name: string;
  dataType: string;
  columnType: string;
  nullable: boolean;
  defaultValue: unknown;
  isPrimaryKey: boolean;
  autoIncrement: boolean;
  references?: AdminReference;
};

const adminTableConfigs: AdminTableConfig[] = [
  { name: 'client_custom_price', references: { room_id: { table: 'client_rooms', column: 'id' } } },
  { name: 'client_additional_price', references: { room_id: { table: 'client_rooms', column: 'id' } } },
  { name: 'client_detail', references: { client_id: { table: 'client_header', column: 'id' } } },
  { name: 'client_header' },
  {
    name: 'client_rooms',
    references: {
      client_id: { table: 'client_header', column: 'id' },
      building_id: { table: 'etc_buildings', column: 'id' },
      price_set_id: { table: 'client_price_set_detail', column: 'id' },
      images_set_id: { table: 'work_images_set_header', column: 'id' },
      checklist_set_id: { table: 'work_checklist_set_header', column: 'id' }
    }
  },
  { name: 'etc_baseCode' },
  {
    name: 'etc_buildings',
    references: { basecode_sector: { table: 'etc_baseCode', column: 'code' }, basecode_code: { table: 'etc_baseCode', column: 'value' } }
  },
  { name: 'etc_errorLogs' },
  { name: 'etc_notice' },
  { name: 'work_apply' },
  { name: 'work_apply_rules' },
  { name: 'work_assignment', references: { work_id: { table: 'work_header', column: 'id' }, worker_id: { table: 'worker_header', column: 'id' } } },
  { name: 'work_fore_accuracy' },
  { name: 'work_fore_d1', references: { room_id: { table: 'client_rooms', column: 'id' } } },
  { name: 'work_fore_d7', references: { room_id: { table: 'client_rooms', column: 'id' } } },
  { name: 'work_fore_tuning' },
  { name: 'work_fore_variable' },
  {
    name: 'work_header',
    references: {
      butler_id: { table: 'worker_header', column: 'id' },
      cleaner_id: { table: 'worker_header', column: 'id' },
      room_id: { table: 'client_rooms', column: 'id' }
    }
  },
  { name: 'work_reports', references: { work_id: { table: 'work_header', column: 'id' } } },
  { name: 'worker_detail', references: { worker_id: { table: 'worker_header', column: 'id' } } },
  { name: 'worker_evaluateHistory', references: { worker_id: { table: 'worker_header', column: 'id' }, work_id: { table: 'work_header', column: 'id' } } },
  { name: 'worker_header' },
  { name: 'worker_penaltyHistory', references: { worker_id: { table: 'worker_header', column: 'id' } } },
  { name: 'worker_schedule_exception', references: { worker_id: { table: 'worker_header', column: 'id' } } },
  { name: 'worker_tier_rules' },
  { name: 'worker_weekly_pattern', references: { worker_id: { table: 'worker_header', column: 'id' } } },
  { name: 'client_price_set_detail', references: { price_set_id: { table: 'client_price_set_header', column: 'id' }, price_id: { table: 'client_price_list', column: 'id' } } },
  { name: 'work_images_set_detail', references: { images_set_id: { table: 'work_images_set_header', column: 'id' }, images_list_id: { table: 'work_images_list', column: 'id' } } },
  {
    name: 'work_checklist_set_detail',
    references: { checklist_header_id: { table: 'work_checklist_set_header', column: 'id' }, checklist_list_id: { table: 'work_checklist_list', column: 'id' } }
  },
  { name: 'work_images_set_header' },
  { name: 'work_images_list' },
  { name: 'work_checklist_set_header' },
  { name: 'work_checklist_list' }
];

const allowedTables = new Set(adminTableConfigs.map((table) => table.name));

export function listAdminTables() {
  return adminTableConfigs.map(({ name, label, references }) => ({ name, label: label ?? name, references: references ?? {} }));
}

export function getTableConfig(table: string): AdminTableConfig | null {
  return adminTableConfigs.find((entry) => entry.name === table) ?? null;
}

async function fetchColumnMetadata(table: string): Promise<AdminColumnMeta[]> {
  if (!allowedTables.has(table)) {
    throw new Error(`허용되지 않은 테이블: ${table}`);
  }

  const pool = getPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT COLUMN_NAME, DATA_TYPE, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, COLUMN_KEY, EXTRA
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
     ORDER BY ORDINAL_POSITION`,
    [table]
  );

  const config = getTableConfig(table);
  return rows.map((row) => ({
    name: String(row.COLUMN_NAME),
    dataType: String(row.DATA_TYPE),
    columnType: String(row.COLUMN_TYPE),
    nullable: row.IS_NULLABLE === 'YES',
    defaultValue: row.COLUMN_DEFAULT,
    isPrimaryKey: row.COLUMN_KEY === 'PRI',
    autoIncrement: typeof row.EXTRA === 'string' && row.EXTRA.includes('auto_increment'),
    references: config?.references?.[String(row.COLUMN_NAME)]
  }));
}

export type TableSnapshot = {
  table: string;
  columns: AdminColumnMeta[];
  primaryKey: string[];
  rows: RowDataPacket[];
  limit: number;
  offset: number;
};

export async function fetchTableSnapshot(table: string, offset = 0, limit = 20): Promise<TableSnapshot> {
  const columns = await fetchColumnMetadata(table);
  const primaryKey = columns.filter((column) => column.isPrimaryKey).map((column) => column.name);
  const orderColumn = primaryKey[0] ?? columns[0]?.name;
  const pool = getPool();

  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT * FROM ?? ORDER BY ?? DESC LIMIT ? OFFSET ?',
    [table, orderColumn ?? 'id', limit, offset]
  );

  return { table, columns, primaryKey, rows, limit, offset };
}

function buildInsertParts(data: Record<string, unknown>, columns: AdminColumnMeta[]) {
  const candidates = Object.entries(data).filter(([key]) => !columns.find((column) => column.name === key)?.autoIncrement);
  const names: string[] = [];
  const values: unknown[] = [];
  for (const [key, value] of candidates) {
    if (!columns.some((column) => column.name === key)) {
      continue;
    }
    names.push(key);
    values.push(value ?? null);
  }
  return { names, values };
}

export async function insertRow(table: string, data: Record<string, unknown>) {
  const columns = await fetchColumnMetadata(table);
  const { names, values } = buildInsertParts(data, columns);

  if (names.length === 0) {
    throw new Error('입력할 컬럼이 없습니다.');
  }

  const placeholders = names.map(() => '?').join(', ');
  const identifierPlaceholders = names.map(() => '??').join(', ');
  const sql = `INSERT INTO ?? (${identifierPlaceholders}) VALUES (${placeholders})`;
  const pool = getPool();

  await pool.query(sql, [table, ...names, ...values]);
}

export async function updateRow(table: string, key: Record<string, unknown>, data: Record<string, unknown>) {
  const columns = await fetchColumnMetadata(table);
  const primaryKey = columns.filter((column) => column.isPrimaryKey).map((column) => column.name);

  if (primaryKey.length === 0) {
    throw new Error('기본키가 정의되지 않은 테이블입니다.');
  }

  const { names, values } = buildInsertParts(data, columns);

  if (names.length === 0) {
    throw new Error('수정할 컬럼이 없습니다.');
  }

  const setClause = names.map(() => '?? = ?').join(', ');
  const whereClause = primaryKey.map(() => '?? = ?').join(' AND ');
  const sql = `UPDATE ?? SET ${setClause} WHERE ${whereClause}`;
  const pkValues = primaryKey.map((column) => key[column]);

  if (pkValues.some((value) => value === undefined)) {
    throw new Error('기본키 값이 누락되었습니다.');
  }

  const pool = getPool();
  await pool.query(sql, [table, ...names.flatMap((name, index) => [name, values[index]]), ...primaryKey.flatMap((name, index) => [name, pkValues[index]])]);
}

export async function deleteRow(table: string, key: Record<string, unknown>) {
  const columns = await fetchColumnMetadata(table);
  const primaryKey = columns.filter((column) => column.isPrimaryKey).map((column) => column.name);

  if (primaryKey.length === 0) {
    throw new Error('기본키가 정의되지 않은 테이블입니다.');
  }

  const whereClause = primaryKey.map(() => '?? = ?').join(' AND ');
  const sql = `DELETE FROM ?? WHERE ${whereClause}`;
  const pkValues = primaryKey.map((column) => key[column]);

  if (pkValues.some((value) => value === undefined)) {
    throw new Error('기본키 값이 누락되었습니다.');
  }

  const pool = getPool();
  await pool.query(sql, [table, ...primaryKey.flatMap((name, index) => [name, pkValues[index]])]);
}

export async function handleAdminError(error: unknown) {
  await logServerError({
    appName: 'admin-crud',
    errorCode: 'ADMIN_CRUD',
    message: '관리자 CRUD 작업 실패',
    error
  });
}

