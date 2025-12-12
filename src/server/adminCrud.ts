import type { RowDataPacket } from 'mysql2';

import { getPool } from '@/src/db/client';
import { logServerError } from '@/src/server/errorLogger';
import { getSchemaTable, getSchemaTables, type SchemaTable } from '@/src/server/schemaRegistry';
import { resolveWebActor } from '@/src/server/audit';

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
  comment?: string;
};

export type AdminReferenceOption = { value: unknown; label: string; codeValue?: string; meta?: Record<string, unknown> };

const referenceMap: Record<string, Record<string, AdminReference>> = {
  client_additional_price: { room_id: { table: 'client_rooms', column: 'id' } },
  client_custom_price: { room_id: { table: 'client_rooms', column: 'id' } },
  client_detail: { client_id: { table: 'client_header', column: 'id' } },
  client_rooms: {
    client_id: { table: 'client_header', column: 'id' },
    building_id: { table: 'etc_buildings', column: 'id' },
    price_set_id: { table: 'client_price_set_header', column: 'id' },
    checklist_set_id: { table: 'work_checklist_set_header', column: 'id' },
    images_set_id: { table: 'work_images_set_header', column: 'id' }
  },
  etc_buildings: {
    basecode_sector: { table: 'etc_baseCode', column: 'code' },
    basecode_code: { table: 'etc_baseCode', column: 'value' }
  },
  work_apply: {
    basecode_sector: { table: 'etc_baseCode', column: 'code' },
    basecode_code: { table: 'etc_baseCode', column: 'value' },
    worker_id: { table: 'worker_header', column: 'id' }
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
  worker_header: {
    basecode_bank: { table: 'etc_baseCode', column: 'code' },
    basecode_code: { table: 'etc_baseCode', column: 'value' },
    tier: { table: 'worker_tier_rules', column: 'tier' }
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
  const commentByColumn = new Map(schemaTable.columns.map((column) => [column.name, column.comment]));
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
      references: referenceMap[table]?.[column.name],
      comment: commentByColumn.get(column.name)
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

  if (table === 'worker_weekly_pattern') {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT wwp.*, wh.name AS worker_name
       FROM worker_weekly_pattern wwp
       JOIN worker_header wh ON wwp.worker_id = wh.id
       WHERE wh.tier = 99
       ORDER BY ?? DESC LIMIT ? OFFSET ?`,
      [orderColumn ?? 'id', limit, offset]
    );

    return { table, columns, primaryKey, rows, limit, offset };
  }

  if (table === 'worker_schedule_exception') {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT wse.*, wh.name AS worker_name
       FROM worker_schedule_exception wse
       JOIN worker_header wh ON wse.worker_id = wh.id
       WHERE wh.tier = 99
       ORDER BY ?? DESC LIMIT ? OFFSET ?`,
      [orderColumn ?? 'id', limit, offset]
    );

    return { table, columns, primaryKey, rows, limit, offset };
  }

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
  limit = 20,
  basecodeGroup?: string
): Promise<AdminReferenceOption[]> {
  const sourceConfig = getTableConfig(table);
  if (table === 'worker_header' && (column === 'basecode_bank' || column === 'basecode_code')) {
    const pool = getPool();
    const whereClauses = ["code_group = 'bank'"];
    const params: unknown[] = [];

    if (keyword) {
      whereClauses.push('(code LIKE ? OR value LIKE ?)');
      const like = `%${keyword}%`;
      params.push(like, like);
    }

    const sql = `SELECT code_group, code, value, CONCAT(code, ' - ', value) AS label FROM etc_baseCode WHERE ${whereClauses.join(
      ' AND '
    )} ORDER BY value ASC LIMIT ?`;
    params.push(limit);

    const [rows] = await pool.query<RowDataPacket[]>(sql, params);
    return rows.map((row) => ({
      value: row.code,
      label: row.label ?? String(row.value ?? row.code ?? ''),
      codeValue: String(row.code ?? ''),
      meta: { codeGroup: row.code_group ?? 'bank', code: row.code, displayValue: row.value }
    }));
  }

  if (table === 'etc_buildings' && (column === 'basecode_sector' || column === 'basecode_code')) {
    const pool = getPool();
    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT code_group, code, value, CONCAT(value, ' - ', code) AS label FROM etc_baseCode WHERE code_group = 'SECTOR' ORDER BY value ASC LIMIT ?",
      [limit]
    );

    return rows.map((row) => ({
      value: row.code,
      label: row.label ?? String(row.value ?? row.code ?? ''),
      codeValue: String(row.code ?? ''),
      meta: { codeGroup: row.code_group ?? 'SECTOR', code: row.code, displayValue: row.value }
    }));
  }

  if (column.startsWith('basecode_')) {
    const pool = getPool();
    const whereClauses: string[] = [];
    const params: unknown[] = [];

    if (basecodeGroup) {
      whereClauses.push('code_group = ?');
      params.push(basecodeGroup);
    }

    if (keyword) {
      whereClauses.push('(code LIKE ? OR value LIKE ?)');
      const like = `%${keyword}%`;
      params.push(like, like);
    }

    if (whereClauses.length === 0) {
      return [];
    }

    const whereSql = `WHERE ${whereClauses.join(' AND ')}`;
    params.push(limit);

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT code_group, code, value, CONCAT(code, ' - ', value) AS label FROM etc_baseCode ${whereSql} ORDER BY value ASC LIMIT ?`,
      params
    );

    return rows.map((row) => ({
      value: row.code,
      label: row.label ?? String(row.value ?? row.code ?? ''),
      codeValue: String(row.code ?? ''),
      meta: { codeGroup: row.code_group ?? '', code: row.code, displayValue: row.value }
    }));
  }

  if (table === 'worker_header' && column === 'tier') {
    const pool = getPool();
    const whereClause = keyword ? 'WHERE tier LIKE ? OR comment LIKE ?' : '';
    const params: unknown[] = [];

    if (keyword) {
      const like = `%${keyword}%`;
      params.push(like, like);
    }

    params.push(limit);

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT tier AS value, CONCAT('티어 ', tier, ' - ', COALESCE(comment, '')) AS label FROM worker_tier_rules ${whereClause} ORDER BY id ASC LIMIT ?`,
      params
    );

    return rows.map((row) => ({ value: row.value, label: row.label ?? String(row.value) }));
  }

  if ((table === 'worker_weekly_pattern' || table === 'worker_schedule_exception') && column === 'worker_id') {
    const pool = getPool();
    const whereClauses = ['tier = 99'];
    const params: unknown[] = [];

    if (keyword) {
      whereClauses.push('(name LIKE ? OR register_no LIKE ? OR phone LIKE ?)');
      const like = `%${keyword}%`;
      params.push(like, like, like);
    }

    params.push(limit);

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id AS value, CONCAT('(', id, ')', COALESCE(name, '')) AS label
       FROM worker_header
       WHERE ${whereClauses.join(' AND ')}
       ORDER BY id DESC
       LIMIT ?`,
      params
    );

    return rows.map((row) => ({ value: row.value, label: row.label ?? String(row.value) }));
  }

  if (table === 'client_rooms' && column === 'price_set_id') {
    const pool = getPool();
    const whereClauses = keyword ? ['(id LIKE ? OR title LIKE ? OR dscpt LIKE ?)'] : [];
    const params: unknown[] = [];

    if (keyword) {
      const like = `%${keyword}%`;
      params.push(like, like, like);
    }

    params.push(limit);

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id AS value, CONCAT(id, ' - ', COALESCE(title, '')) AS label FROM client_price_set_header ${whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : ''} ORDER BY id ASC LIMIT ?`,
      params
    );

    return rows.map((row) => ({ value: row.value, label: row.label ?? String(row.value) }));
  }

  const reference = sourceConfig?.references?.[column];

  if (!reference) {
    return [];
  }

  if (reference.table === 'client_rooms') {
    const pool = getPool();
    const searchTokens = keyword
      .split(/\s+/)
      .map((token) => token.trim())
      .filter(Boolean);

    const labelExpr =
      "CONCAT_WS(' - ', COALESCE(c.name, c.person, ''), r.id, b.building_short_name, r.room_no, CASE WHEN r.open_yn = 1 THEN 'Y' ELSE 'N' END)";
    const whereClause = searchTokens.length
      ? `WHERE ${searchTokens.map(() => `(b.building_short_name LIKE ? OR r.room_no LIKE ?)`).join(' AND ')}`
      : '';

    const sql = `
      SELECT r.id AS value, ${labelExpr} AS label
      FROM client_rooms r
      LEFT JOIN etc_buildings b ON r.building_id = b.id
      LEFT JOIN client_header c ON r.client_id = c.id
      ${whereClause}
      ORDER BY COALESCE(c.name, c.person, ''), b.building_short_name, r.room_no DESC
      LIMIT ?
    `;

    const params: unknown[] = [];

    searchTokens.forEach((token) => {
      const like = `%${token}%`;
      params.push(like, like);
    });

    params.push(limit);
    const [rows] = await pool.query<RowDataPacket[]>(sql, params);

    return rows.map((row) => ({ value: row.value, label: row.label ?? String(row.value) }));
  }

  if (table === 'client_additional_price' && column === 'title') {
    const pool = getPool();
    const whereClauses = ["selected_by = 3"];
    const params: unknown[] = [];

    if (keyword) {
      whereClauses.push('title LIKE ?');
      params.push(`%${keyword}%`);
    }

    params.push(limit);

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id AS value, title AS label, title, minus_yn, ratio_yn, amount FROM client_price_list WHERE ${whereClauses.join(' AND ')} ORDER BY title ASC LIMIT ?`,
      params
    );

    return rows.map((row) => ({
      value: row.value,
      label: row.label ?? String(row.value),
      meta: {
        title: row.title,
        minus_yn: row.minus_yn,
        ratio_yn: row.ratio_yn,
        amount: row.amount
      }
    }));
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

export async function fetchReferenceLabels(
  table: string,
  column: string,
  values: (string | number)[],
  basecodeGroup?: string
): Promise<Record<string, string>> {
  if (!values.length) return {};

  const sourceConfig = getTableConfig(table);
  const reference = sourceConfig.references[column];

  if (column.startsWith('basecode_')) {
    const pool = getPool();
    const whereClauses: string[] = [];
    const params: unknown[] = [];

    if (basecodeGroup) {
      whereClauses.push('code_group = ?');
      params.push(basecodeGroup);
    }

    if (values.length) {
      whereClauses.push(`code IN (${values.map(() => '?').join(', ')})`);
      params.push(...values);
    }

    if (!whereClauses.length) return {};

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT code AS value, CONCAT(code, ' - ', value) AS label FROM etc_baseCode WHERE ${whereClauses.join(' AND ')}`,
      params
    );

    return rows.reduce<Record<string, string>>((acc, row) => {
      acc[String(row.value)] = String(row.label ?? row.value ?? '');
      return acc;
    }, {});
  }

  if (!reference) return {};

  const refColumns = await fetchColumnMetadata(reference.table);
  const labelColumns = pickLabelColumns(refColumns);
  const displayColumns = [reference.column, ...labelColumns.filter((columnName) => columnName !== reference.column)].slice(0, 4);
  const concatExpr = `CONCAT_WS(' | ', ${displayColumns.map(() => '??').join(', ')})`;
  const placeholders = values.map(() => '?').join(', ');
  const sql = `SELECT ?? AS value, ${concatExpr} AS label FROM ?? WHERE ?? IN (${placeholders})`;

  const params: unknown[] = [reference.column, ...displayColumns, reference.table, reference.column, ...values];
  const pool = getPool();
  const [rows] = await pool.query<RowDataPacket[]>(sql, params);

  return rows.reduce<Record<string, string>>((acc, row) => {
    acc[String(row.value)] = String(row.label ?? row.value ?? '');
    return acc;
  }, {});
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

function withManualFlag(table: string, data: Record<string, unknown>) {
  if (table === 'work_header') {
    return { ...data, manual_upt_yn: 1 };
  }
  return data;
}

export async function insertRow(table: string, data: Record<string, unknown>, actor = resolveWebActor()) {
  const columns = await fetchColumnMetadata(table);
  const columnNames = new Set(columns.map((column) => column.name));

  if (table === 'client_additional_price') {
    const hasSeq = data.seq !== undefined && data.seq !== null && data.seq !== '';
    const roomId = Number(data.room_id ?? 0);
    const date = typeof data.date === 'string' ? data.date : null;

    if (!hasSeq && roomId > 0 && date) {
      const pool = getPool();
      const [rows] = await pool.query<RowDataPacket[]>(
        'SELECT COALESCE(MAX(seq), 0) + 1 AS nextSeq FROM client_additional_price WHERE room_id = ? AND date = ?',
        [roomId, date]
      );
      const nextSeq = Number(rows?.[0]?.nextSeq ?? 1);
      // eslint-disable-next-line no-param-reassign
      data.seq = Number.isFinite(nextSeq) ? nextSeq : 1;
    }
  }

  const normalized = withManualFlag(table, data);
  const payload = { ...normalized };

  if ('created_by' in payload) {
    delete payload.created_by;
  }

  if ('updated_by' in payload) {
    delete payload.updated_by;
  }

  if (columnNames.has('created_by')) {
    payload.created_by = actor;
  }

  if (columnNames.has('updated_by')) {
    payload.updated_by = actor;
  }

  const { names, values } = buildInsertParts(payload, columns);

  if (names.length === 0) {
    throw new Error('입력할 컬럼이 없습니다.');
  }

  const placeholders = names.map(() => '?').join(', ');
  const identifierPlaceholders = names.map(() => '??').join(', ');
  const sql = `INSERT INTO ?? (${identifierPlaceholders}) VALUES (${placeholders})`;
  const pool = getPool();

  await pool.query(sql, [table, ...names, ...values]);
}

export async function updateRow(
  table: string,
  key: Record<string, unknown>,
  data: Record<string, unknown>,
  actor = resolveWebActor()
) {
  const columns = await fetchColumnMetadata(table);
  const primaryKey = columns.filter((column) => column.isPrimaryKey).map((column) => column.name);

  const columnNames = new Set(columns.map((column) => column.name));
  const normalized = withManualFlag(table, data);
  const payload = { ...normalized };

  if ('created_by' in payload) {
    delete payload.created_by;
  }

  if (columnNames.has('updated_by')) {
    payload.updated_by = actor;
  }

  if (primaryKey.length === 0) {
    throw new Error('기본키가 정의되지 않은 테이블입니다.');
  }

  const { names, values } = buildInsertParts(payload, columns);

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

export async function handleAdminError(error: unknown, context?: Record<string, unknown>) {
  await logServerError({
    appName: 'admin-crud',
    errorCode: 'ADMIN_CRUD',
    message: '관리자 CRUD 작업 실패',
    error,
    context
  });
}

