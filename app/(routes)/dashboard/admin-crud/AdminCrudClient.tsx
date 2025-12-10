'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';

import CommonHeader from '@/app/(routes)/dashboard/CommonHeader';

import styles from './adminCrud.module.css';

import type { AdminColumnMeta, AdminReference, AdminReferenceOption } from '@/src/server/adminCrud';
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
const CLIENT_HEADER_HIDDEN_COLUMNS = new Set(['created_at', 'updated_at']);
const WORKER_HIDDEN_COLUMNS = new Set(['created_at', 'updated_at']);
const TABLE_LABEL_OVERRIDES: Record<string, Record<string, string>> = {
  client_additional_price: CLIENT_ADDITIONAL_PRICE_CONFIG.koreanLabels,
  client_header: {
    person: 'person(대표자)',
    rcpt_name: 'rcpt_name(상호명)',
    rcpt_no: 'rcpt_no(영수증식별번호)'
  }
};
const TABLE_HIDDEN_COLUMNS: Record<string, Set<string>> = {
  client_additional_price: CLIENT_ADDITIONAL_PRICE_CONFIG.hiddenColumns,
  client_header: CLIENT_HEADER_HIDDEN_COLUMNS,
  worker_header: WORKER_HIDDEN_COLUMNS
};
const REGISTER_TABLES = new Set(['worker_header', 'client_header']);
const CLIENT_RECEIPT_OPTIONS = [
  { value: '1', label: '세금계산서' },
  { value: '2', label: '현금영수증' }
];
const CLIENT_SETTLE_OPTIONS = [
  { value: '1', label: '건별제' },
  { value: '2', label: '정액제' },
  { value: '3', label: '커스텀' },
  { value: '4', label: '기타' }
];

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
  const [referenceOptions, setReferenceOptions] = useState<Record<string, AdminReferenceOption[]>>({});
  const [referenceSearch, setReferenceSearch] = useState<Record<string, string>>({});
  const [referenceLoading, setReferenceLoading] = useState<Record<string, boolean>>({});
  const [clientSnapshot, setClientSnapshot] = useState<Snapshot | null>(null);
  const [clientLoading, setClientLoading] = useState(false);
  const [clientFeedback, setClientFeedback] = useState<string | null>(null);
  const [pendingClientEdit, setPendingClientEdit] = useState<Record<string, unknown> | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);

  const isClientAdditionalPrice = selectedTable === 'client_additional_price';
  const isClientHeader = selectedTable === 'client_header';
  const isWorkerTable = selectedTable === 'worker_header';
  const tableLabels: Record<string, string> = TABLE_LABEL_OVERRIDES[selectedTable] ?? {};
  const isHiddenColumn = (columnName: string) => {
    const hiddenColumns = TABLE_HIDDEN_COLUMNS[selectedTable];
    if (hiddenColumns?.has(columnName)) return true;
    return false;
  };
  const visibleColumns = (snapshot?.columns ?? []).filter(
    (column) => !isHiddenColumn(column.name) && !(isWorkerTable && column.name === 'basecode_code')
  );

  useEffect(() => {
    if (selectedTable) {
      fetchSnapshot(selectedTable, 0);
    }
  }, [selectedTable]);

  useEffect(() => {
    void fetchClientSnapshot();
  }, []);

  useEffect(() => {
    if (pendingClientEdit && selectedTable === 'client_header' && snapshot?.table === 'client_header') {
      startEdit(pendingClientEdit);
      setPendingClientEdit(null);
    }
  }, [pendingClientEdit, selectedTable, snapshot]);

  const columns = snapshot?.columns ?? [];
  const clientRows = clientSnapshot?.rows ?? [];
  const clientColumns = (clientSnapshot?.columns ?? []).filter((column) => !CLIENT_HEADER_HIDDEN_COLUMNS.has(column.name));
  const clientColumnLabels = clientColumns.map((column) => ({
    key: column.name,
    label: TABLE_LABEL_OVERRIDES.client_header?.[column.name] ?? column.name
  }));

  useEffect(() => {
    setReferenceOptions({});
    setReferenceSearch({});
    setReferenceLoading({});
    if (selectedTable === 'worker_header') {
      void loadReferenceOptions('basecode_bank', '');
      void loadReferenceOptions('tier', '');
    }
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
      setSnapshot({ ...payload, table });
      setMode('create');
      setEditingKey({});
      setFormValues(REGISTER_TABLES.has(table) ? { register_no: generateUniqueRegister(table, payload.rows) } : {});
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

  async function fetchClientSnapshot() {
    setClientLoading(true);
    setClientFeedback(null);
    try {
      const response = await fetch('/api/admin/crud?table=client_header&limit=200&offset=0', { cache: 'no-cache' });
      if (!response.ok) {
        throw new Error('고객 목록을 불러오지 못했습니다.');
      }
      const payload = (await response.json()) as Snapshot;
      setClientSnapshot({ ...payload, table: 'client_header' });
    } catch (error) {
      console.error(error);
      setClientFeedback(error instanceof Error ? error.message : '고객 목록 조회 중 오류가 발생했습니다.');
    } finally {
      setClientLoading(false);
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

  function handleWorkerBankChange(optionValue: string) {
    const options = referenceOptions.basecode_bank ?? [];
    const selectedOption = options.find((option) => String(option.value) === optionValue);
    setFormValues((prev) => ({
      ...prev,
      basecode_bank: optionValue,
      basecode_code: selectedOption?.codeValue ?? ''
    }));
  }

  function getKnownRegisterNumbers(tableName: string, additionalRows: Record<string, unknown>[] = []) {
    const candidates: Record<string, unknown>[] = [];

    if (tableName === 'worker_header' && snapshot?.table === 'worker_header') {
      candidates.push(...snapshot.rows);
    }

    if (tableName === 'client_header') {
      if (clientSnapshot?.table === 'client_header') {
        candidates.push(...clientSnapshot.rows);
      }
      if (snapshot?.table === 'client_header') {
        candidates.push(...snapshot.rows);
      }
    }

    candidates.push(...additionalRows);

    const registerNumbers = new Set<string>();
    candidates.forEach((row) => {
      const value = (row as Record<string, unknown>)?.register_no;
      if (typeof value === 'string' && value.trim()) {
        registerNumbers.add(value.trim());
      }
    });

    return registerNumbers;
  }

  function randomRegisterValue() {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 6; i += 1) {
      const index = Math.floor(Math.random() * alphabet.length);
      result += alphabet[index];
    }
    return result;
  }

  function generateUniqueRegister(tableName: string, additionalRows: Record<string, unknown>[] = []) {
    const existing = getKnownRegisterNumbers(tableName, additionalRows);
    for (let attempts = 0; attempts < 50; attempts += 1) {
      const candidate = randomRegisterValue();
      if (!existing.has(candidate)) return candidate;
    }
    return randomRegisterValue();
  }

  function handleRegisterRefresh() {
    if (!REGISTER_TABLES.has(selectedTable)) return;
    setFormValues((prev) => ({ ...prev, register_no: generateUniqueRegister(selectedTable) }));
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
    focusForm();
  }

  function startCreate() {
    setMode('create');
    setEditingKey({});
    setFormValues(REGISTER_TABLES.has(selectedTable) ? { register_no: generateUniqueRegister(selectedTable) } : {});
    setFeedback(null);
    focusForm();
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
      const payload = (await response.json()) as { options: AdminReferenceOption[] };
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

  function renderInput(column: AdminColumnMeta) {
    const type = toInputType(column);
    const value = formValues[column.name] ?? '';
    const isCheckbox = type === 'checkbox';

    if ((isWorkerTable || isClientHeader) && column.name === 'register_no') {
      return (
        <div className={styles.registerField}>
          <input id={column.name} type="text" value={value} readOnly disabled={loading || mode === 'edit'} />
          <button type="button" onClick={() => handleRegisterRefresh()} disabled={loading || mode === 'edit'}>
            리프레시
          </button>
        </div>
      );
    }

    if (isClientAdditionalPrice && CLIENT_ADDITIONAL_PRICE_CONFIG.booleanColumns.has(column.name)) {
      return (
        <select id={column.name} value={value} onChange={(event) => handleInputChange(column, event.target.value)} disabled={loading}>
          <option value="">선택하세요</option>
          <option value="1">예</option>
          <option value="0">아니오</option>
        </select>
      );
    }

    if (isClientHeader && column.name === 'rcpt_flag') {
      return (
        <select
          id={column.name}
          value={value}
          onChange={(event) => handleInputChange(column, event.target.value)}
          disabled={loading}
        >
          <option value="">선택하세요</option>
          {CLIENT_RECEIPT_OPTIONS.map((option) => (
            <option key={`${column.name}-${option.value}`} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      );
    }

    if (isClientHeader && column.name === 'settle_flag') {
      return (
        <select
          id={column.name}
          value={value}
          onChange={(event) => handleInputChange(column, event.target.value)}
          disabled={loading}
        >
          <option value="">선택하세요</option>
          {CLIENT_SETTLE_OPTIONS.map((option) => (
            <option key={`${column.name}-${option.value}`} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      );
    }

    if (isClientHeader && column.name === 'desk_yn') {
      return (
        <select
          id={column.name}
          value={value}
          onChange={(event) => handleInputChange(column, event.target.value)}
          disabled={loading}
        >
          <option value="">선택하세요</option>
          <option value="1">사용</option>
          <option value="0">미사용</option>
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

    if (isWorkerTable && column.name === 'basecode_bank') {
      const options = referenceOptions[column.name] ?? [];
      const refLoading = referenceLoading[column.name] ?? false;

      return (
        <select
          id={column.name}
          value={value}
          onChange={(event) => handleWorkerBankChange(event.target.value)}
          disabled={loading || refLoading}
        >
          <option value="">선택하세요</option>
          {options.map((option) => (
            <option key={`${column.name}-${option.value}`} value={String(option.value)}>
              {option.label}
            </option>
          ))}
        </select>
      );
    }

    if (isWorkerTable && column.name === 'tier') {
      const options = referenceOptions[column.name] ?? [];
      const refLoading = referenceLoading[column.name] ?? false;

      return (
        <select
          id={column.name}
          value={value}
          onChange={(event) => handleInputChange(column, event.target.value)}
          disabled={loading || refLoading}
        >
          <option value="">선택하세요</option>
          {options.map((option) => (
            <option key={`${column.name}-${option.value}`} value={String(option.value)}>
              {option.label}
            </option>
          ))}
        </select>
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

  function getClientField(row: Record<string, unknown>, key: string, fallback = '-') {
    const value = row[key];
    if (value === null || value === undefined) return fallback;
    if (typeof value === 'string' && value.trim() === '') return fallback;
    return String(value);
  }

  function handleClientRowSelect(row: Record<string, unknown>) {
    setPendingClientEdit(row);
    if (selectedTable !== 'client_header') {
      setSelectedTable('client_header');
      return;
    }
    if (snapshot?.table === 'client_header') {
      startEdit(row);
      setPendingClientEdit(null);
    }
  }

  function focusForm() {
    const formElement = formRef.current;
    if (!formElement) return;
    const firstField = formElement.querySelector<HTMLElement>('input, select, textarea, button');
    requestAnimationFrame(() => {
      firstField?.focus();
    });
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

        <section className={styles.formSection}>
          <header>
            <h2>{mode === 'create' ? '신규 추가' : '행 수정'}</h2>
            {mode === 'edit' ? (
              <button type="button" onClick={startCreate} disabled={loading}>
                새로 만들기
              </button>
            ) : null}
          </header>

          <form ref={formRef} onSubmit={handleSubmit} className={styles.formGrid}>
            {visibleColumns.map((column) => (
              <label key={column.name} className={styles.formField}>
                <span>
                  {tableLabels[column.name] ?? column.name}
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
      </section>

      <section className={styles.workerSection}>
        <header className={styles.workerHeader}>
          <div>
            <p className={styles.workerTitle}>고객 목록</p>
            <p className={styles.workerSubtitle}>고객을 클릭하면 위 수정 양식으로 불러옵니다.</p>
          </div>
          <button type="button" onClick={fetchClientSnapshot} disabled={clientLoading}>
            고객 목록 새로고침
          </button>
        </header>

        {clientFeedback ? <p className={styles.feedback}>{clientFeedback}</p> : null}

        <div className={styles.workerTableWrapper}>
          {clientRows.length ? (
            <table className={styles.workerTable}>
              <thead>
                <tr>
                  {clientColumnLabels.map((column) => (
                    <th key={column.key}>{column.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {clientRows.map((row, index) => (
                  <tr key={index} className={styles.workerRow} onClick={() => handleClientRowSelect(row)}>
                    {clientColumnLabels.map((column) => (
                      <td key={`${index}-${column.key}`}>{getClientField(row, column.key)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className={styles.workerEmpty}>{clientLoading ? '고객 목록을 불러오는 중입니다.' : '등록된 고객이 없습니다.'}</div>
          )}
        </div>
      </section>
    </main>
  );
}

