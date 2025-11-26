import type { RowDataPacket } from 'mysql2';

import { getPool } from '@/src/db/client';
import { logServerError } from '@/src/server/errorLogger';
import { getSchemaTable, getSchemaTables, type SchemaTable } from '@/src/server/schemaRegistry';

export type AdminReference = { table: string; column: string };

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

export type AdminReferenceOption = { value: unknown; label: string };

const referenceMap: Record<string, Record<string, AdminReference>> = {
  client_additional_price: { room_id: { table: 'client_rooms', column: 'id' } },
  client_custom_price: { room_id: { table: 'client_rooms', column: 'id' } },
  client_detail: { client_id: { table: 'client_header', column: 'id' } },
  client_rooms: {
    client_id: { table: 'client_header', column: 'id' },
    building_id: { table: 'etc_buildings', column: 'id' },
    checklist_set_id: { table: 'work_checklist_set_header', column: 'id' },
    images_set_id: { table: 'work_images_set_header', column: 'id' }
  },
  etc_buildings: {
    basecode_sector: { table: 'etc_baseCode', column: 'code' },
    basecode_code: { table: 'etc_baseCode', column: 'value' }
  },
  work_assignment: {
    work_id: { table: 'work_header', column: 'id' },
    worker_id: { table: 'worker_header', column: 'id' }
  },
  work_fore_d1: { room_id: { table: 'client_rooms', column: 'id' } },
  work_fore_d7: { room_id: { table: 'client_rooms', column: 'id' } },
  work_header: {
    butler_id: { table: 'worker_header', column: 'id' },
    cleaner_id: { table: 'worker_header', column: 'id' },
    room_id: { table: 'client_rooms', column: 'id' }
  },
  work_reports: { work_id: { table: 'work_header', column: 'id' } },
  worker_detail: { worker_id: { table: 'worker_header', column: 'id' } },
  worker_evaluateHistory: {
    worker_id: { table: 'worker_header', column: 'id' },
    work_id: { table: 'work_header', column: 'id' }
  },
  worker_penaltyHistory: { worker_id: { table: 'worker_header', column: 'id' } },
  worker_schedule_exception: { worker_id: { table: 'worker_header', column: 'id' } },
  worker_weekly_pattern: { worker_id: { table: 'worker_header', column: 'id' } },
  work_checklist_set_detail: {
    checklist_header_id: { table: 'work_checklist_set_header', column: 'id' },
    checklist_list_id: { table: 'work_checklist_list', column: 'id' }
  },
  work_images_set_detail: {
    images_set_id: { table: 'work_images_set_header', column: 'id' },
    images_list_id: { table: 'work_images_list', column: 'id' }
  }
};

const LABEL_PRIORITIES = [
  'title',
  'name',
  'label',
  'room_no',
  'room_name',
  'register_no',
  'phone',
  'code',
  'value',
  'description'
];

function guessReferenceTable(columnName: string): string | null {
  if (!columnName.endsWith('_id')) return null;
  const base = columnName.replace(/_id$/, '');
  const candidates = [
    base,
    `${base}s`,
    `${base}_header`,
    `${base}_list`,
    `${base}_detail`,
    `${base}_set_header`,
    `${base}_set`,
    `client_${base}`,
    `work_${base}`,
    `worker_${base}`
  ];

  const available = new Set(getSchemaTables().map((table) => table.name));
  return candidates.find((candidate) => available.has(candidate)) ?? null;
}

function buildReferenceHints(table: string): Record<string, AdminReference> {
  const schemaTable = getSchemaTableOrThrow(table);
  const base = referenceMap[table] ? { ...referenceMap[table] } : {};

  schemaTable.columns.forEach((column) => {
    if (base[column.name]) return;
    const guessedTable = guessReferenceTable(column.name);
    if (guessedTable) {
      base[column.name] = { table: guessedTable, column: 'id' };
    }
  });

  return base;
}

function getTableConfig(table: string) {
  return {
    references: buildReferenceHints(table)
  };
}

function getSchemaTableOrThrow(table: string): SchemaTable {
  const schemaTable = getSchemaTable(table);
  if (!schemaTable) {
    throw new Error(`허용되지 않은 테이블: ${table}`);
  }
  return schemaTable;
}

export function listAdminTables() {
  return getSchemaTables().map(({ name }) => ({ name, label: name, references: buildReferenceHints(name) }));
}

async function fetchColumnMetadata(table: string): Promise<AdminColumnMeta[]> {
  const schemaTable = getSchemaTableOrThrow(table);
  const pool = getPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT COLUMN_NAME, COLUMN_KEY, EXTRA, COLUMN_DEFAULT
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
     ORDER BY ORDINAL_POSITION`,
    [table]
  );

  const metaFromDb = new Map(
    rows.map((row) => [String(row.COLUMN_NAME), { key: String(row.COLUMN_KEY), extra: String(row.EXTRA ?? ''), defaultValue: row.COLUMN_DEFAULT }])
  );

  return schemaTable.columns.map((column) => {
    const dbMeta = metaFromDb.get(column.name);
    return {
      name: column.name,
      dataType: normalizeDataType(column.dataType),
      columnType: column.dataType,
      nullable: column.nullable,
      defaultValue: dbMeta?.defaultValue ?? null,
      isPrimaryKey: dbMeta?.key === 'PRI',
      autoIncrement: typeof dbMeta?.extra === 'string' && dbMeta.extra.includes('auto_increment'),
      references: referenceMap[table]?.[column.name]
    } satisfies AdminColumnMeta;
  });
}

function normalizeDataType(raw: string) {
  const lowered = raw.toLowerCase();
  const match = lowered.match(/^[a-z]+/);
  return match ? match[0] : lowered;
}

export type TableSnapshot = {
  table: string;
  columns: AdminColumnMeta[];
  primaryKey: string[];
  rows: RowDataPacket[];
  limit: number;
  offset: number;
};

function pickLabelColumns(columns: AdminColumnMeta[]) {
  const textualTypes = new Set(['varchar', 'text', 'char', 'mediumtext', 'longtext', 'tinytext']);
  const byPriority = columns
    .filter((column) => textualTypes.has(column.dataType))
    .sort((a, b) => {
      const aIndex = LABEL_PRIORITIES.indexOf(a.name);
      const bIndex = LABEL_PRIORITIES.indexOf(b.name);
      if (aIndex === -1 && bIndex === -1) return 0;
      if (aIndex === -1) return 1;
      if (bIndex === -1) return -1;
      return aIndex - bIndex;
    })
    .map((column) => column.name);

  const fallback = columns.filter((column) => textualTypes.has(column.dataType)).map((column) => column.name);

  return (byPriority.length ? byPriority : fallback).slice(0, 3);
}

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

export async function fetchReferenceOptions(
  table: string,
  column: string,
  keyword: string,
  limit = 20
): Promise<AdminReferenceOption[]> {
  const sourceConfig = getTableConfig(table);
  const reference = sourceConfig?.references?.[column];

  if (!reference) {
    throw new Error('레퍼런스 정보가 없습니다.');
  }

  const refColumns = await fetchColumnMetadata(reference.table);
  const labelColumns = pickLabelColumns(refColumns);
  const displayColumns = [reference.column, ...labelColumns.filter((columnName) => columnName !== reference.column)].slice(0, 4);
  const searchColumns = labelColumns.length ? labelColumns : displayColumns;

  const concatExpr = `CONCAT_WS(' | ', ${displayColumns.map(() => '??').join(', ')})`;
  const whereClause = keyword ? searchColumns.map(() => '?? LIKE ?').join(' OR ') : '';
  const sql = `SELECT ?? AS value, ${concatExpr} AS label FROM ?? ${whereClause ? `WHERE ${whereClause}` : ''} ORDER BY ?? DESC LIMIT ?`;

  const params: unknown[] = [reference.column, ...displayColumns, reference.table];

  if (keyword) {
    searchColumns.forEach((columnName) => {
      params.push(columnName, `%${keyword}%`);
    });
  }

  params.push(reference.column, limit);

  const pool = getPool();
  const [rows] = await pool.query<RowDataPacket[]>(sql, params);

  return rows.map((row) => ({ value: row.value, label: row.label ?? String(row.value) }));
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

