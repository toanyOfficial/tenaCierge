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
const CLIENT_ROOMS_HIDDEN_COLUMNS = new Set(['created_at', 'updated_at']);
const TABLE_LABEL_OVERRIDES: Record<string, Record<string, string>> = {
  client_additional_price: CLIENT_ADDITIONAL_PRICE_CONFIG.koreanLabels,
  client_header: {
    person: 'person(대표자)',
    rcpt_name: 'rcpt_name(상호명)',
    rcpt_no: 'rcpt_no(영수증식별번호)'
  },
  client_rooms: {
    price_set_id: 'price_set_id',
    facility_yn: 'facility_yn(시설관리여부)',
    realtime_overview_yn: 'realtime_overview_yn(실시간현황보기여부)',
    images_yn: 'images_yn(사진조회여부)',
    weight: 'weight'
  }
};
const TABLE_HIDDEN_COLUMNS: Record<string, Set<string>> = {
  client_additional_price: CLIENT_ADDITIONAL_PRICE_CONFIG.hiddenColumns,
  client_header: CLIENT_HEADER_HIDDEN_COLUMNS,
  client_rooms: CLIENT_ROOMS_HIDDEN_COLUMNS,
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
  const [additionalPriceOptions, setAdditionalPriceOptions] = useState<AdminReferenceOption[]>([]);
  const [additionalPriceLoading, setAdditionalPriceLoading] = useState(false);
  const [useCustomAdditionalTitle, setUseCustomAdditionalTitle] = useState(false);
  const [helperSnapshot, setHelperSnapshot] = useState<Snapshot | null>(null);
  const [helperLoading, setHelperLoading] = useState(false);
  const [helperFeedback, setHelperFeedback] = useState<string | null>(null);
  const [pendingClientEdit, setPendingClientEdit] = useState<Record<string, unknown> | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);

  const isClientAdditionalPrice = selectedTable === 'client_additional_price';
  const isClientHeader = selectedTable === 'client_header';
  const isClientRooms = selectedTable === 'client_rooms';
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
    void fetchHelperSnapshot();
  }, [selectedTable]);

  useEffect(() => {
    const pendingTable = (pendingClientEdit as { __table?: string } | null)?.__table;
    if (pendingClientEdit && pendingTable && selectedTable === pendingTable && snapshot?.table === selectedTable) {
      startEdit(pendingClientEdit);
      setPendingClientEdit(null);
    }
  }, [pendingClientEdit, selectedTable, snapshot]);

  const columns = snapshot?.columns ?? [];
  const helperRows = helperSnapshot?.rows ?? [];
  const helperTableName =
    helperSnapshot?.table ??
    (selectedTable === 'client_additional_price'
      ? 'client_additional_price'
      : selectedTable === 'client_rooms'
        ? 'client_rooms'
        : 'client_header');
  const helperHiddenColumns =
    helperTableName === 'client_rooms'
      ? CLIENT_ROOMS_HIDDEN_COLUMNS
      : helperTableName === 'client_additional_price'
        ? CLIENT_ADDITIONAL_PRICE_CONFIG.hiddenColumns
        : CLIENT_HEADER_HIDDEN_COLUMNS;
  const helperLabelOverrides = TABLE_LABEL_OVERRIDES[helperTableName] ?? {};
  const helperColumns = (helperSnapshot?.columns ?? []).filter((column) => !helperHiddenColumns.has(column.name));
  const helperColumnLabels = helperColumns.map((column) => ({
    key: column.name,
    label: helperLabelOverrides[column.name] ?? column.name
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
    setAdditionalPriceOptions([]);
    setUseCustomAdditionalTitle(false);
    if (isClientAdditionalPrice) {
      void loadAdditionalPriceOptions();
    }
  }, [selectedTable, isClientAdditionalPrice]);

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
      const baseDefaults = REGISTER_TABLES.has(table)
        ? { register_no: generateUniqueRegister(table, payload.rows) }
        : {};
      const tableDefaults = table === 'client_additional_price'
        ? { ...baseDefaults, minus_yn: '0', ratio_yn: '0' }
        : baseDefaults;
      setSnapshot({ ...payload, table });
      setMode('create');
      setEditingKey({});
      setFormValues(tableDefaults);
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

  async function fetchHelperSnapshot() {
    setHelperLoading(true);
    setHelperFeedback(null);
    try {
      const table =
        selectedTable === 'client_additional_price'
          ? 'client_additional_price'
          : selectedTable === 'client_rooms'
            ? 'client_rooms'
            : 'client_header';
      const response = await fetch(`/api/admin/crud?table=${table}&limit=200&offset=0`, { cache: 'no-cache' });
      if (!response.ok) {
        throw new Error('목록을 불러오지 못했습니다.');
      }
      const payload = (await response.json()) as Snapshot;
      setHelperSnapshot({ ...payload, table });
    } catch (error) {
      console.error(error);
      setHelperFeedback(error instanceof Error ? error.message : '목록 조회 중 오류가 발생했습니다.');
    } finally {
      setHelperLoading(false);
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
    if (isClientAdditionalPrice && mode === 'create' && (column.name === 'room_id' || column.name === 'date')) {
      const nextValues = { ...formValues, [column.name]: String(value) };
      setFormValues(nextValues);
      void refreshAdditionalPriceSeq(nextValues);
      return;
    }

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

  async function refreshAdditionalPriceSeq(nextValues: Record<string, string>) {
    if (!isClientAdditionalPrice || mode === 'edit') return;

    const roomId = Number(nextValues.room_id ?? formValues.room_id);
    const date = nextValues.date ?? formValues.date;

    if (!roomId || !date) return;

    try {
      const response = await fetch(
        `/api/admin/crud/additional-price-seq?roomId=${encodeURIComponent(String(roomId))}&date=${encodeURIComponent(date)}`,
        { cache: 'no-cache' }
      );
      if (!response.ok) {
        throw new Error('순번을 불러오지 못했습니다.');
      }
      const payload = (await response.json()) as { nextSeq?: number };
      const nextSeq = payload?.nextSeq;
      if (nextSeq !== undefined) {
        setFormValues((prev) => ({ ...prev, seq: String(nextSeq) }));
      }
    } catch (error) {
      console.error(error);
      setFeedback(error instanceof Error ? error.message : '순번 조회 중 오류가 발생했습니다.');
    }
  }

  function getKnownRegisterNumbers(tableName: string, additionalRows: Record<string, unknown>[] = []) {
    const candidates: Record<string, unknown>[] = [];

    if (tableName === 'worker_header' && snapshot?.table === 'worker_header') {
      candidates.push(...snapshot.rows);
    }

    if (tableName === 'client_header') {
      if (helperSnapshot?.table === 'client_header') {
        candidates.push(...helperSnapshot.rows);
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

    if (isClientAdditionalPrice) {
      if (!('minus_yn' in defaults)) defaults.minus_yn = '0';
      if (!('ratio_yn' in defaults)) defaults.ratio_yn = '0';
    }

    setEditingKey(key);
    setFormValues(defaults);
    if (isClientAdditionalPrice) {
      setUseCustomAdditionalTitle(false);
    }
    focusForm();
  }

  function startCreate() {
    setMode('create');
    setEditingKey({});
    const baseDefaults = REGISTER_TABLES.has(selectedTable)
      ? { register_no: generateUniqueRegister(selectedTable) }
      : {};
    const tableDefaults = isClientAdditionalPrice ? { ...baseDefaults, minus_yn: '0', ratio_yn: '0' } : baseDefaults;
    setFormValues(tableDefaults);
    setFeedback(null);
    if (isClientAdditionalPrice) {
      setUseCustomAdditionalTitle(false);
    }
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

  async function loadAdditionalPriceOptions() {
    if (!isClientAdditionalPrice) return;
    setAdditionalPriceLoading(true);
    try {
      const response = await fetch(`/api/admin/crud/additional-price-items`, { cache: 'no-cache' });
      if (!response.ok) {
        throw new Error('추가비용 항목을 불러오지 못했습니다.');
      }
      const payload = (await response.json()) as AdminReferenceOption[];
      setAdditionalPriceOptions(payload);
    } catch (error) {
      console.error(error);
      setFeedback(error instanceof Error ? error.message : '추가비용 항목 조회 중 오류가 발생했습니다.');
    } finally {
      setAdditionalPriceLoading(false);
    }
  }

  function applyAdditionalPriceOption(optionValue: string) {
    if (optionValue === '__custom__') {
      setUseCustomAdditionalTitle(true);
      setFormValues((prev) => ({ ...prev, title: '' }));
      return;
    }

    const option = additionalPriceOptions.find((candidate) => String(candidate.value) === optionValue);
    if (!option) return;

    setUseCustomAdditionalTitle(false);
    setFormValues((prev) => ({
      ...prev,
      title: String(option.meta?.title ?? option.label ?? option.value ?? ''),
      minus_yn: option.meta?.minus_yn !== undefined ? String(option.meta.minus_yn) : prev.minus_yn ?? '0',
      ratio_yn: option.meta?.ratio_yn !== undefined ? String(option.meta.ratio_yn) : prev.ratio_yn ?? '0',
      amount: option.meta?.amount !== undefined ? String(option.meta.amount) : prev.amount ?? ''
    }));
  }

  useEffect(() => {
    if (!isClientAdditionalPrice || !formValues.title || additionalPriceOptions.length === 0) return;
    const currentTitle = formValues.title;
    const hasOption = additionalPriceOptions.some(
      (option) => option.meta?.title === currentTitle || option.label === currentTitle
    );
    setUseCustomAdditionalTitle(!hasOption);
  }, [additionalPriceOptions, formValues.title, isClientAdditionalPrice]);

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

    if (isClientAdditionalPrice && column.name === 'seq') {
      return <input id={column.name} type="number" value={value} readOnly disabled />;
    }

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

    if (isClientRooms && ['facility_yn', 'realtime_overview_yn', 'images_yn', 'open_yn'].includes(column.name)) {
      return (
        <select
          id={column.name}
          value={value}
          onChange={(event) => handleInputChange(column, event.target.value)}
          disabled={loading}
        >
          <option value="">선택하세요</option>
          {column.name === 'open_yn' ? (
            <>
              <option value="1">운영중</option>
              <option value="0">운영종료</option>
            </>
          ) : (
            <>
              <option value="1">사용</option>
              <option value="0">미사용</option>
            </>
          )}
        </select>
      );
    }

    if (isClientAdditionalPrice && CLIENT_ADDITIONAL_PRICE_CONFIG.booleanColumns.has(column.name)) {
      return (
        <select id={column.name} value={value} onChange={(event) => handleInputChange(column, event.target.value)} disabled={loading}>
          <option value="1">예</option>
          <option value="0">아니오</option>
        </select>
      );
    }

    if (isClientAdditionalPrice && column.name === 'comment') {
      return (
        <textarea
          id={column.name}
          value={value}
          onChange={(event) => handleInputChange(column, event.target.value)}
          disabled={loading}
          className={styles.commentTextarea}
          maxLength={255}
        />
      );
    }

    if (isClientAdditionalPrice && column.name === 'title') {
      const matchedAdditionalOption = additionalPriceOptions.find(
        (option) => option.meta?.title === value || option.label === value
      );
      const selectValue = useCustomAdditionalTitle
        ? '__custom__'
        : matchedAdditionalOption
          ? String(matchedAdditionalOption.value)
          : value;

      return (
        <div className={styles.referenceInput}>
          <select
            id={column.name}
            value={selectValue}
            onChange={(event) => applyAdditionalPriceOption(event.target.value)}
            disabled={loading || additionalPriceLoading}
          >
            {additionalPriceOptions.map((option) => (
              <option key={`${column.name}-${option.value}`} value={String(option.value)}>
                {option.label}
              </option>
            ))}
            <option value="__custom__">직접입력</option>
          </select>
          {useCustomAdditionalTitle ? (
            <input
              id={`${column.name}-custom`}
              type="text"
              value={value}
              onChange={(event) => handleInputChange(column, event.target.value)}
              disabled={loading}
            />
          ) : null}
        </div>
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

    if (isClientRooms && column.name === 'price_set_id') {
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
    const placeholder = isClientRooms && column.name === 'weight'
      ? '인피닛이9점입니다'
      : reference
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
    const table = helperSnapshot?.table ?? 'client_header';
    setPendingClientEdit({ ...row, __table: table });
    if (selectedTable !== table) {
      setSelectedTable(table);
      return;
    }
    if (snapshot?.table === table) {
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
            <p className={styles.workerTitle}>{helperTableName === 'client_rooms' ? '객실 목록' : '고객 목록'}</p>
            <p className={styles.workerSubtitle}>
              {helperTableName === 'client_rooms'
                ? '객실을 클릭하면 위 수정 양식으로 불러옵니다.'
                : '고객을 클릭하면 위 수정 양식으로 불러옵니다.'}
            </p>
          </div>
          <button type="button" onClick={fetchHelperSnapshot} disabled={helperLoading}>
            목록 새로고침
          </button>
        </header>

        {helperFeedback ? <p className={styles.feedback}>{helperFeedback}</p> : null}

        <div className={styles.workerTableWrapper}>
          {helperRows.length ? (
            <table className={styles.workerTable}>
              <thead>
                <tr>
                  {helperColumnLabels.map((column) => (
                    <th key={column.key}>{column.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {helperRows.map((row, index) => (
                  <tr key={index} className={styles.workerRow} onClick={() => handleClientRowSelect(row)}>
                    {helperColumnLabels.map((column) => (
                      <td key={`${index}-${column.key}`}>{getClientField(row, column.key)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className={styles.workerEmpty}>{helperLoading ? '목록을 불러오는 중입니다.' : '등록된 데이터가 없습니다.'}</div>
          )}
        </div>
      </section>
    </main>
  );
}

