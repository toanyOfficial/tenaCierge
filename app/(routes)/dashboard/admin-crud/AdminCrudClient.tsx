'use client';

import { useEffect, useState, type FormEvent } from 'react';

import CommonHeader from '@/app/(routes)/dashboard/CommonHeader';

import styles from './adminCrud.module.css';

import type { AdminColumnMeta, AdminReference } from '@/src/server/adminCrud';
import type { ProfileSummary } from '@/src/utils/profile';

type TableOption = {
  name: string;
  label: string;
  references: Record<string, AdminReference>;
};

type Props = {
  tables: TableOption[];
  profile: ProfileSummary;
  initialTable?: string | null;
};

type Snapshot = {
  table: string;
  columns: AdminColumnMeta[];
  primaryKey: string[];
  rows: Record<string, unknown>[];
  limit: number;
  offset: number;
};

const DEFAULT_LIMIT = 20;
const CLIENT_ADDITIONAL_PRICE_CONFIG = {
  hiddenColumns: new Set(['created_at', 'updated_at']),
  booleanColumns: new Set(['minus_yn', 'ratio_yn']),
  koreanLabels: {
    id: '아이디',
    room_id: '객실',
    date: '날짜',
    seq: '순번',
    qty: '수량',
    minus_yn: '차감 여부',
    ratio_yn: '비율 여부',
    title: '항목명',
    amount: '금액',
    comment: '비고'
  }
} as const;

export default function AdminCrudClient({ tables, profile, initialTable }: Props) {
  const [activeRole, setActiveRole] = useState<string | null>(profile.roles[0] ?? null);
  const [selectedTable, setSelectedTable] = useState<string>(() => {
    if (initialTable && tables.some((table) => table.name === initialTable)) {
      return initialTable;
    }

    return tables[0]?.name ?? '';
  });
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [mode, setMode] = useState<'create' | 'edit'>('create');
  const [editingKey, setEditingKey] = useState<Record<string, unknown>>({});
  const [feedback, setFeedback] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [referenceOptions, setReferenceOptions] = useState<Record<string, { value: string; label: string }[]>>({});
  const [referenceSearch, setReferenceSearch] = useState<Record<string, string>>({});
  const [referenceLoading, setReferenceLoading] = useState<Record<string, boolean>>({});
  const [workerSnapshot, setWorkerSnapshot] = useState<Snapshot | null>(null);
  const [workerLoading, setWorkerLoading] = useState(false);
  const [workerFeedback, setWorkerFeedback] = useState<string | null>(null);

  const isClientAdditionalPrice = selectedTable === 'client_additional_price';
  const tableLabels: Record<string, string> = isClientAdditionalPrice ? CLIENT_ADDITIONAL_PRICE_CONFIG.koreanLabels : {};
  const isHiddenColumn = (columnName: string) =>
    isClientAdditionalPrice && CLIENT_ADDITIONAL_PRICE_CONFIG.hiddenColumns.has(columnName);
  const visibleColumns = (snapshot?.columns ?? []).filter(
    (column) => !isHiddenColumn(column.name)
  );

  useEffect(() => {
    if (selectedTable) {
      fetchSnapshot(selectedTable, 0);
    }
  }, [selectedTable]);

  useEffect(() => {
    void fetchWorkerSnapshot();
  }, []);

  const columns = snapshot?.columns ?? [];

  useEffect(() => {
    setReferenceOptions({});
    setReferenceSearch({});
    setReferenceLoading({});
  }, [selectedTable]);

  useEffect(() => {
    columns.forEach((column) => {
      if (!column.references) return;
      if (referenceOptions[column.name]) return;
      void loadReferenceOptions(column.name, referenceSearch[column.name] ?? '');
    });
  }, [columns, referenceOptions, referenceSearch]);

  async function fetchSnapshot(table: string, offset: number) {
    setLoading(true);
    setFeedback(null);
    try {
      const response = await fetch(`/api/admin/crud?table=${table}&limit=${DEFAULT_LIMIT}&offset=${offset}`, { cache: 'no-cache' });
      if (!response.ok) {
        throw new Error('테이블을 불러오지 못했습니다.');
      }
      const payload = (await response.json()) as Snapshot;
      setSnapshot(payload);
      setMode('create');
      setEditingKey({});
      setFormValues({});
      setReferenceOptions({});
      setReferenceSearch({});
      setReferenceLoading({});
    } catch (error) {
      console.error(error);
      setFeedback(error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  }

  async function fetchWorkerSnapshot() {
    setWorkerLoading(true);
    setWorkerFeedback(null);
    try {
      const response = await fetch('/api/admin/crud?table=worker_header&limit=200&offset=0', { cache: 'no-cache' });
      if (!response.ok) {
        throw new Error('워커 목록을 불러오지 못했습니다.');
      }
      const payload = (await response.json()) as Snapshot;
      setWorkerSnapshot(payload);
    } catch (error) {
      console.error(error);
      setWorkerFeedback(error instanceof Error ? error.message : '워커 목록 조회 중 오류가 발생했습니다.');
    } finally {
      setWorkerLoading(false);
    }
  }

  function toInputType(column: AdminColumnMeta) {
    if (column.dataType.includes('int') || column.dataType.includes('decimal')) return 'number';
    if (column.dataType === 'date') return 'date';
    if (column.dataType === 'datetime' || column.dataType === 'timestamp') return 'datetime-local';
    if (column.dataType === 'time') return 'time';
    if (column.dataType === 'json') return 'textarea';
    if (column.dataType === 'boolean') return 'checkbox';
    if (column.dataType === 'tinyint' && column.columnType?.includes('(1)')) return 'checkbox';
    return 'text';
  }

  function parseValue(column: AdminColumnMeta, raw: string) {
    if (raw === '') {
      return null;
    }
    if (column.dataType.includes('int') || column.dataType.includes('decimal')) {
      const numeric = Number(raw);
      return Number.isFinite(numeric) ? numeric : null;
    }
    if (column.dataType === 'json') {
      try {
        return JSON.parse(raw);
      } catch (error) {
        return raw;
      }
    }
    if (column.dataType === 'boolean') {
      return raw === 'true' || raw === '1';
    }
    if (column.dataType === 'tinyint' && column.columnType?.includes('(1)')) {
      return raw === 'true' || raw === '1';
    }
    return raw;
  }

  function handleInputChange(column: AdminColumnMeta, value: string | boolean) {
    if (column.dataType === 'tinyint' && column.columnType === 'tinyint(1)') {
      setFormValues((prev) => ({ ...prev, [column.name]: value ? '1' : '0' }));
      return;
    }
    setFormValues((prev) => ({ ...prev, [column.name]: String(value) }));
  }

  function startEdit(row: Record<string, unknown>) {
    setMode('edit');
    setFeedback(null);
    const defaults: Record<string, string> = {};
    columns.forEach((column) => {
      if (isHiddenColumn(column.name)) return;
      const value = row[column.name];
      if (value === null || value === undefined) return;
      if (column.dataType === 'json') {
        defaults[column.name] = JSON.stringify(value, null, 2);
      } else if (column.dataType === 'tinyint' && column.columnType === 'tinyint(1)') {
        defaults[column.name] = value ? '1' : '0';
      } else {
        defaults[column.name] = String(value);
      }
    });

    const key: Record<string, unknown> = {};
    (snapshot?.primaryKey ?? []).forEach((pk) => {
      key[pk] = row[pk];
    });

    setEditingKey(key);
    setFormValues(defaults);
  }

  function startCreate() {
    setMode('create');
    setEditingKey({});
    setFormValues({});
    setFeedback(null);
  }

  async function loadReferenceOptions(columnName: string, keyword: string) {
    if (!selectedTable) return;
    setReferenceLoading((prev) => ({ ...prev, [columnName]: true }));
    try {
      const response = await fetch(
        `/api/admin/crud/reference?table=${encodeURIComponent(selectedTable)}&column=${encodeURIComponent(columnName)}&q=${encodeURIComponent(keyword)}`,
        { cache: 'no-cache' }
      );
      if (!response.ok) {
        const { message } = (await response.json().catch(() => ({}))) as { message?: string };
        throw new Error(message ?? '연관 데이터를 불러오지 못했습니다.');
      }
      const payload = (await response.json()) as { options: { value: string; label: string }[] };
      setReferenceOptions((prev) => ({ ...prev, [columnName]: payload.options ?? [] }));
    } catch (error) {
      console.error(error);
      setFeedback(error instanceof Error ? error.message : '연관 데이터 조회 중 오류가 발생했습니다.');
    } finally {
      setReferenceLoading((prev) => ({ ...prev, [columnName]: false }));
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!selectedTable) return;

    const payloadData: Record<string, unknown> = {};
    columns.forEach((column) => {
      if (isHiddenColumn(column.name)) return;
      if (column.autoIncrement && mode === 'create') return;
      if (!(column.name in formValues)) return;
      payloadData[column.name] = parseValue(column, formValues[column.name]);
    });

    setLoading(true);
    setFeedback(null);

    try {
      const response = await fetch('/api/admin/crud', {
        method: mode === 'create' ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ table: selectedTable, data: payloadData, key: editingKey })
      });

      if (!response.ok) {
        throw new Error('저장 중 오류가 발생했습니다.');
      }

      const payload = (await response.json()) as Snapshot;
      setSnapshot(payload);
      startCreate();
      setFeedback('저장되었습니다.');
    } catch (error) {
      console.error(error);
      setFeedback(error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(row: Record<string, unknown>) {
    if (!selectedTable || !snapshot) return;
    const key: Record<string, unknown> = {};
    snapshot.primaryKey.forEach((pk) => {
      key[pk] = row[pk];
    });

    if (Object.values(key).some((value) => value === undefined)) {
      setFeedback('기본키 값이 없어 삭제할 수 없습니다.');
      return;
    }

    setLoading(true);
    setFeedback(null);
    try {
      const response = await fetch('/api/admin/crud', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ table: selectedTable, key })
      });

      if (!response.ok) {
        throw new Error('삭제 중 오류가 발생했습니다.');
      }

      const payload = (await response.json()) as Snapshot;
      setSnapshot(payload);
      startCreate();
      setFeedback('삭제되었습니다.');
    } catch (error) {
      console.error(error);
      setFeedback(error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  }

  function renderInput(column: AdminColumnMeta) {
    const type = toInputType(column);
    const value = formValues[column.name] ?? '';
    const isCheckbox = type === 'checkbox';

    if (isClientAdditionalPrice && CLIENT_ADDITIONAL_PRICE_CONFIG.booleanColumns.has(column.name)) {
      return (
        <select id={column.name} value={value} onChange={(event) => handleInputChange(column, event.target.value)} disabled={loading}>
          <option value="">선택하세요</option>
          <option value="1">예</option>
          <option value="0">아니오</option>
        </select>
      );
    }

    if (selectedTable === 'work_apply' && column.name === 'position') {
      return (
        <select
          id={column.name}
          value={value}
          onChange={(event) => handleInputChange(column, event.target.value)}
          disabled={loading}
        >
          <option value="">선택하세요</option>
          <option value="1">클리너 (1)</option>
          <option value="2">버틀러 (2)</option>
        </select>
      );
    }

    if (type === 'textarea') {
      return (
        <textarea
          id={column.name}
          value={value}
          onChange={(event) => handleInputChange(column, event.target.value)}
          placeholder={column.references ? `${column.references.table}.${column.references.column}` : column.columnType}
        />
      );
    }

    if (isCheckbox) {
      const checked = value === '1' || value === 'true';
      return (
        <input
          id={column.name}
          type="checkbox"
          checked={checked}
          onChange={(event) => handleInputChange(column, event.target.checked)}
        />
      );
    }

    if (column.references) {
      const options = referenceOptions[column.name] ?? [];
      const searchTerm = referenceSearch[column.name] ?? '';
      const refLoading = referenceLoading[column.name] ?? false;

      return (
        <div className={styles.referenceInput}>
          <div className={styles.referenceSearchRow}>
            <input
              type="text"
              value={searchTerm}
              placeholder="검색어 입력"
              onChange={(event) => setReferenceSearch((prev) => ({ ...prev, [column.name]: event.target.value }))}
              disabled={loading}
            />
            <button
              type="button"
              onClick={() => loadReferenceOptions(column.name, searchTerm)}
              disabled={loading || refLoading}
            >
              검색
            </button>
            <button type="button" onClick={() => loadReferenceOptions(column.name, '')} disabled={loading || refLoading}>
              초기화
            </button>
          </div>

          <select
            id={column.name}
            value={value}
            onChange={(event) => handleInputChange(column, event.target.value)}
            disabled={loading || refLoading}
          >
            <option value="">선택하세요</option>
            {options.map((option) => (
              <option key={`${column.name}-${option.value}`} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      );
    }

    const reference = column.references as AdminReference | undefined;
    const placeholder = reference
      ? `${reference.table}.${reference.column}`
      : column.columnType;

    return (
      <input
        id={column.name}
        type={type}
        value={value}
        onChange={(event) => handleInputChange(column, event.target.value)}
        placeholder={placeholder}
        disabled={column.autoIncrement && mode === 'create'}
      />
    );
  }

  function getWorkerField(row: Record<string, unknown>, key: string, fallback = '-') {
    const value = row[key];
    if (value === null || value === undefined) return fallback;
    if (typeof value === 'string' && value.trim() === '') return fallback;
    return String(value);
  }

  return (
    <main className={styles.container}>
      <CommonHeader profile={profile} activeRole={activeRole} onRoleChange={setActiveRole} compact />

      <header className={styles.header}>전체 테이블 CRUD</header>

      <section className={styles.panel}>
        <div className={styles.toolbar}>
          <label htmlFor="table-select">테이블 선택</label>
          <select
            id="table-select"
            value={selectedTable}
            onChange={(event) => setSelectedTable(event.target.value)}
            disabled={loading}
          >
            {tables.map((table) => (
              <option key={table.name} value={table.name}>
                {table.label}
              </option>
            ))}
          </select>
          <button type="button" onClick={() => fetchSnapshot(selectedTable, 0)} disabled={loading || !selectedTable}>
            새로고침
          </button>
          <button type="button" onClick={() => fetchSnapshot(selectedTable, (snapshot?.offset ?? 0) + DEFAULT_LIMIT)} disabled={loading || !selectedTable}>
            다음 페이지
          </button>
        </div>

        {feedback ? <p className={styles.feedback}>{feedback}</p> : null}

        <div className={styles.columnsHint}>
          <p>
            기본키: {snapshot?.primaryKey?.length ? snapshot.primaryKey.join(', ') : '미정'} / 레퍼런스 힌트는 입력창 placeholder에서 확인할 수 있습니다.
          </p>
        </div>

        <div className={isClientAdditionalPrice ? styles.verticalGrid : styles.grid}>
          <section className={styles.formSection}>
            <header>
              <h2>{mode === 'create' ? '신규 추가' : '행 수정'}</h2>
              {mode === 'edit' ? (
                <button type="button" onClick={startCreate} disabled={loading}>
                  새로 만들기
                </button>
              ) : null}
            </header>

            <form onSubmit={handleSubmit} className={styles.formGrid}>
              {visibleColumns.map((column) => (
                <label key={column.name} className={styles.formField}>
                  <span>
                    {column.name}
                    {tableLabels[column.name] ? ` (${tableLabels[column.name]})` : ''}
                    {column.isPrimaryKey ? ' (PK)' : ''}
                    {column.references ? ` → ${column.references.table}.${column.references.column}` : ''}
                  </span>
                  {renderInput(column)}
                </label>
              ))}

              <div className={styles.formActions}>
                <button type="submit" disabled={loading || !selectedTable}>
                  {mode === 'create' ? '추가' : '수정 저장'}
                </button>
              </div>
            </form>
          </section>

          <section className={styles.tableSection}>
            <header>
              <h2>최근 데이터</h2>
              <span>
                {snapshot ? `${snapshot.offset + 1} ~ ${snapshot.offset + snapshot.rows.length} (limit ${snapshot.limit})` : '로딩 전'}
              </span>
            </header>

            <div className={styles.tableWrapper}>
              <table>
                <thead>
                  <tr>
                    {visibleColumns.map((column) => (
                      <th key={column.name}>
                        {column.name}
                        {tableLabels[column.name] ? ` (${tableLabels[column.name]})` : ''}
                      </th>
                    ))}
                    <th>액션</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot?.rows?.length ? (
                    snapshot.rows.map((row, index) => (
                      <tr key={index}>
                        {visibleColumns.map((column) => {
                          const displayValue = formatCellValue(row[column.name], column, selectedTable);
                          return (
                            <td key={column.name}>
                              <span className={styles.cellContent} title={displayValue}>
                                {displayValue}
                              </span>
                            </td>
                          );
                        })}
                        <td className={styles.actionCell}>
                          <button type="button" onClick={() => startEdit(row)} disabled={loading}>
                            수정
                          </button>
                          <button type="button" onClick={() => handleDelete(row)} disabled={loading}>
                            삭제
                          </button>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={visibleColumns.length + 1} className={styles.empty}>
                        데이터가 없습니다.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </section>

      <section className={styles.workerSection}>
        <header className={styles.workerHeader}>
          <div>
            <p className={styles.workerTitle}>워크용 사용자 목록</p>
            <p className={styles.workerSubtitle}>상단에서 신규 추가/수정 후 전체 워커 현황을 바로 확인하세요.</p>
          </div>
          <button type="button" onClick={fetchWorkerSnapshot} disabled={workerLoading}>
            워커 목록 새로고침
          </button>
        </header>

        {workerFeedback ? <p className={styles.feedback}>{workerFeedback}</p> : null}

        <div className={styles.workerGrid}>
          {workerSnapshot?.rows?.length ? (
            workerSnapshot.rows.map((row, index) => (
              <article key={index} className={styles.workerCard}>
                <header className={styles.workerCardHeader}>
                  <span className={styles.workerName}>{getWorkerField(row, 'name')}</span>
                  <span className={styles.workerTier}>Tier {getWorkerField(row, 'tier', '?')}</span>
                </header>
                <dl className={styles.workerMeta}>
                  <div>
                    <dt>등록번호</dt>
                    <dd>{getWorkerField(row, 'register_no')}</dd>
                  </div>
                  <div>
                    <dt>연락처</dt>
                    <dd>{getWorkerField(row, 'phone')}</dd>
                  </div>
                  <div>
                    <dt>계좌</dt>
                    <dd>
                      {getWorkerField(row, 'basecode_bank', '')}
                      {getWorkerField(row, 'basecode_code', '') ? ` / ${getWorkerField(row, 'basecode_code')}` : ''}
                    </dd>
                  </div>
                  <div>
                    <dt>메모</dt>
                    <dd>{getWorkerField(row, 'comments')}</dd>
                  </div>
                </dl>
              </article>
            ))
          ) : (
            <div className={styles.workerEmpty}>{workerLoading ? '워커 목록을 불러오는 중입니다.' : '등록된 워커가 없습니다.'}</div>
          )}
        </div>
      </section>
    </main>
  );
}

function formatCellValue(value: unknown, column: AdminColumnMeta, tableName?: string) {
  if (value === null || value === undefined) return '';
  if (tableName === 'client_additional_price' && CLIENT_ADDITIONAL_PRICE_CONFIG.booleanColumns.has(column.name)) {
    return value ? '예' : '아니오';
  }
  if (column.dataType === 'json') {
    try {
      return JSON.stringify(value);
    } catch (error) {
      return String(value);
    }
  }
  if (column.dataType === 'tinyint' && column.columnType === 'tinyint(1)') {
    return value ? 'Y' : 'N';
  }
  return String(value);
}
