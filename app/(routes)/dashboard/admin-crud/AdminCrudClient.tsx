'use client';

import { useEffect, useState, type FormEvent } from 'react';

import styles from './adminCrud.module.css';

import type { AdminColumnMeta, AdminReference } from '@/src/server/adminCrud';

type TableOption = {
  name: string;
  label: string;
  references: Record<string, AdminReference>;
};

type Props = {
  tables: TableOption[];
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

export default function AdminCrudClient({ tables }: Props) {
  const [selectedTable, setSelectedTable] = useState<string>(tables[0]?.name ?? '');
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [mode, setMode] = useState<'create' | 'edit'>('create');
  const [editingKey, setEditingKey] = useState<Record<string, unknown>>({});
  const [feedback, setFeedback] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (selectedTable) {
      fetchSnapshot(selectedTable, 0);
    }
  }, [selectedTable]);

  const columns = snapshot?.columns ?? [];

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
    } catch (error) {
      console.error(error);
      setFeedback(error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  }

  function toInputType(column: AdminColumnMeta) {
    if (column.dataType.includes('int') || column.dataType === 'decimal') return 'number';
    if (column.dataType === 'date') return 'date';
    if (column.dataType === 'datetime' || column.dataType === 'timestamp') return 'datetime-local';
    if (column.dataType === 'time') return 'time';
    if (column.dataType === 'json') return 'textarea';
    if (column.dataType === 'tinyint' && column.columnType === 'tinyint(1)') return 'checkbox';
    return 'text';
  }

  function parseValue(column: AdminColumnMeta, raw: string) {
    if (raw === '') {
      return null;
    }
    if (column.dataType.includes('int') || column.dataType === 'decimal') {
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
    if (column.dataType === 'tinyint' && column.columnType === 'tinyint(1)') {
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

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!selectedTable) return;

    const payloadData: Record<string, unknown> = {};
    columns.forEach((column) => {
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
      return (
        <input
          id={column.name}
          type="checkbox"
          checked={value === '1' || value === true || value === 'true'}
          onChange={(event) => handleInputChange(column, event.target.checked)}
        />
      );
    }

    return (
      <input
        id={column.name}
        type={type}
        value={value}
        onChange={(event) => handleInputChange(column, event.target.value)}
        placeholder={column.references ? `${column.references.table}.${column.references.column}` : column.columnType}
        disabled={column.autoIncrement && mode === 'create'}
      />
    );
  }

  return (
    <main className={styles.container}>
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

        <div className={styles.grid}>
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
              {columns.map((column) => (
                <label key={column.name} className={styles.formField}>
                  <span>
                    {column.name}
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
                    {columns.map((column) => (
                      <th key={column.name}>{column.name}</th>
                    ))}
                    <th>액션</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot?.rows?.length ? (
                    snapshot.rows.map((row, index) => (
                      <tr key={index}>
                        {columns.map((column) => (
                          <td key={column.name}>
                            {formatCellValue(row[column.name], column)}
                          </td>
                        ))}
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
                      <td colSpan={columns.length + 1} className={styles.empty}>
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
    </main>
  );
}

function formatCellValue(value: unknown, column: AdminColumnMeta) {
  if (value === null || value === undefined) return '';
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
