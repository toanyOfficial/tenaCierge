'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';

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
  title?: string;
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
const GLOBAL_HIDDEN_COLUMNS = new Set(['created_at', 'updated_at', 'created_by', 'updated_by']);
const PROTECTED_TABLES = new Set(['worker_header', 'client_header', 'client_rooms', 'client_additional_price']);
const NO_SEARCH_REFERENCE_COLUMNS = new Set(['images_set_id', 'checklist_set_id']);
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
  },
  worker_weekly_pattern: {
    worker_id: '(worker_id)name'
  },
  worker_schedule_exception: {
    worker_id: '(worker_id)name'
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
const NUMERIC_ONLY_FIELDS = new Set(['phone', 'reg_no', 'account_no']);
const WEEKDAY_OPTIONS = [
  { value: '0', label: '0:일요일' },
  { value: '1', label: '1:월요일' },
  { value: '2', label: '2:화요일' },
  { value: '3', label: '3:수요일' },
  { value: '4', label: '4:목요일' },
  { value: '5', label: '5:금요일' },
  { value: '6', label: '6:토요일' }
];

const DEFAULT_EXCEPTION_STATE = {
  loading: false,
  isWorkingDay: null as boolean | null,
  message: '근무자와 날짜를 선택하면 안내가 표시됩니다.',
  checked: false
};

export default function AdminCrudClient({ tables, profile, initialTable, title }: Props) {
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
  const [feedback, setFeedback] = useState<
    | {
        message: string;
        variant: 'success' | 'error';
      }
    | null
  >(null);
  const [loading, setLoading] = useState(false);
  const [referenceOptions, setReferenceOptions] = useState<Record<string, AdminReferenceOption[]>>({});
  const [referenceSearch, setReferenceSearch] = useState<Record<string, string>>({});
  const [referenceLoading, setReferenceLoading] = useState<Record<string, boolean>>({});
  const lastReferenceQueries = useRef<Record<string, string>>({});
  const lastReferenceLabels = useRef<Record<string, string>>({});
  const [referenceLabels, setReferenceLabels] = useState<Record<string, Record<string, Record<string, string>>>>({});
  const [additionalPriceOptions, setAdditionalPriceOptions] = useState<AdminReferenceOption[]>([]);
  const [additionalPriceLoading, setAdditionalPriceLoading] = useState(false);
  const [useCustomAdditionalTitle, setUseCustomAdditionalTitle] = useState(false);
  const [helperSnapshot, setHelperSnapshot] = useState<Snapshot | null>(null);
  const [helperLoading, setHelperLoading] = useState(false);
  const [helperFeedback, setHelperFeedback] = useState<string | null>(null);
  const [pendingClientEdit, setPendingClientEdit] = useState<Record<string, unknown> | null>(null);
  const [exceptionContext, setExceptionContext] = useState(DEFAULT_EXCEPTION_STATE);
  const formRef = useRef<HTMLFormElement | null>(null);

  const isClientAdditionalPrice = selectedTable === 'client_additional_price';
  const isClientHeader = selectedTable === 'client_header';
  const isClientRooms = selectedTable === 'client_rooms';
  const isWorkerTable = selectedTable === 'worker_header';
  const isScheduleException = selectedTable === 'worker_schedule_exception';
  const isProtectedTable = PROTECTED_TABLES.has(selectedTable);
  const usingSharedGrid = !isProtectedTable;
  const tableLabels: Record<string, string> = TABLE_LABEL_OVERRIDES[selectedTable] ?? {};
  const basecodeColumns = snapshot?.columns?.filter((column) => column.name.startsWith('basecode_')) ?? [];
  const hasBasecodePair =
    !isProtectedTable && basecodeColumns.some((column) => column.name === 'basecode_code') && basecodeColumns.length > 1;
  const basecodePrimaryColumn = hasBasecodePair
    ? basecodeColumns.find((column) => column.name !== 'basecode_code')?.name ?? null
    : null;
  const isHiddenColumn = (columnName: string) => {
    const hiddenColumns = TABLE_HIDDEN_COLUMNS[selectedTable];
    if (hiddenColumns?.has(columnName)) return true;
    if (GLOBAL_HIDDEN_COLUMNS.has(columnName)) return true;
    if (hasBasecodePair && columnName === 'basecode_code') return true;
    if (isWorkerTable && columnName === 'basecode_code') return true;
    return false;
  };
  const visibleColumns = (snapshot?.columns ?? []).filter((column) => !isHiddenColumn(column.name));
  const formColumns = (snapshot?.columns ?? []).filter(
    (column) =>
      (!isHiddenColumn(column.name) || (hasBasecodePair && column.name === 'basecode_code')) &&
      !(isScheduleException && column.name === 'cancel_work_yn')
  );

  function normalizeDefault(column: AdminColumnMeta) {
    const raw = column.defaultValue;

    if (raw === null || raw === undefined) return undefined;
    if (typeof raw === 'number') return String(raw);
    if (typeof raw === 'boolean') return raw ? '1' : '0';
    if (typeof raw === 'string') {
      const trimmed = raw.trim();
      if (!trimmed) return '';
      if (column.name.endsWith('_yn')) {
        const lowered = trimmed.toLowerCase();
        if (['y', 'yes', 'true', '1'].includes(lowered)) return '1';
        if (['n', 'no', 'false', '0'].includes(lowered)) return '0';
      }
      return trimmed;
    }

    return String(raw);
  }

  function buildDefaultValues(columns: AdminColumnMeta[], rows: Record<string, unknown>[] = snapshot?.rows ?? []) {
    const defaults: Record<string, string> = {};

    columns.forEach((column) => {
      if (isHiddenColumn(column.name) && !(hasBasecodePair && column.name === 'basecode_code')) return;
      if (column.autoIncrement) return;

      const normalized = normalizeDefault(column);

      if (normalized !== undefined) {
        defaults[column.name] = normalized;
      } else if (!column.nullable && column.name.endsWith('_yn')) {
        defaults[column.name] = '0';
      } else {
        defaults[column.name] = '';
      }
    });

    if (isClientAdditionalPrice) {
      defaults.minus_yn = defaults.minus_yn ?? '0';
      defaults.ratio_yn = defaults.ratio_yn ?? '0';
    }

    if (REGISTER_TABLES.has(selectedTable)) {
      defaults.register_no = generateUniqueRegister(selectedTable, rows);
    }

    return defaults;
  }

  useEffect(() => {
    if (selectedTable) {
      fetchSnapshot(selectedTable, 0);
    }
  }, [selectedTable]);

  useEffect(() => {
    if (isProtectedTable) {
      void fetchHelperSnapshot();
    } else {
      setHelperSnapshot(snapshot);
      setHelperFeedback(null);
    }
  }, [isProtectedTable, selectedTable]);

  useEffect(() => {
    if (!isProtectedTable && snapshot) {
      setHelperSnapshot(snapshot);
    }
  }, [isProtectedTable, snapshot]);

  useEffect(() => {
    const pendingTable = (pendingClientEdit as { __table?: string } | null)?.__table;
    if (pendingClientEdit && pendingTable && selectedTable === pendingTable && snapshot?.table === selectedTable) {
      startEdit(pendingClientEdit);
      setPendingClientEdit(null);
    }
  }, [pendingClientEdit, selectedTable, snapshot]);

  const columns = snapshot?.columns ?? [];
  const helperRows = usingSharedGrid ? snapshot?.rows ?? [] : helperSnapshot?.rows ?? [];
  const helperTableName = usingSharedGrid ? snapshot?.table ?? selectedTable : helperSnapshot?.table ?? selectedTable;
  const helperColumnsRaw = useMemo(
    () => (usingSharedGrid ? snapshot?.columns ?? [] : helperSnapshot?.columns ?? []),
    [helperSnapshot?.columns, snapshot?.columns, usingSharedGrid]
  );
  const helperBasecodeColumns = useMemo(
    () => helperColumnsRaw.filter((column) => column.name.startsWith('basecode_')),
    [helperColumnsRaw]
  );
  const helperHasBasecodePair = helperBasecodeColumns.some((column) => column.name === 'basecode_code');
  const helperHiddenColumns = useMemo(() => {
    if (usingSharedGrid) {
      return new Set<string>([...GLOBAL_HIDDEN_COLUMNS, ...(hasBasecodePair ? ['basecode_code'] : [])]);
    }

    const tableHidden = TABLE_HIDDEN_COLUMNS[helperTableName ?? ''];
    if (tableHidden) return new Set([...tableHidden]);

    return new Set<string>([...GLOBAL_HIDDEN_COLUMNS, ...(helperHasBasecodePair ? ['basecode_code'] : [])]);
  }, [hasBasecodePair, helperHasBasecodePair, helperTableName, usingSharedGrid]);
  const helperLabelOverrides = usingSharedGrid ? tableLabels : TABLE_LABEL_OVERRIDES[helperTableName ?? ''] ?? {};
  const helperColumns = useMemo(
    () =>
      usingSharedGrid
        ? visibleColumns
        : (helperSnapshot?.columns ?? []).filter((column) => !helperHiddenColumns.has(column.name)),
    [helperHiddenColumns, helperSnapshot?.columns, usingSharedGrid, visibleColumns]
  );
  const helperColumnLabels = helperColumns.map((column) => ({
    key: column.name,
    label: helperLabelOverrides[column.name] ?? column.name
  }));
  const helperTitle = `${helperTableName ?? '데이터'} 목록`;
  const helperSubtitle = usingSharedGrid
    ? '행을 클릭하면 위 수정 양식으로 불러옵니다.'
    : helperTableName === 'client_rooms'
      ? '객실을 클릭하면 위 수정 양식으로 불러옵니다.'
      : helperTableName === 'client_additional_price'
        ? '추가비용을 클릭하면 위 수정 양식으로 불러옵니다.'
        : '고객을 클릭하면 위 수정 양식으로 불러옵니다.';

  useEffect(() => {
    setReferenceOptions({});
    setReferenceSearch({});
    setReferenceLoading({});
    lastReferenceQueries.current = {};
    lastReferenceLabels.current = {};
    if (selectedTable === 'worker_header') {
      void loadReferenceOptions('basecode_bank', '');
      void loadReferenceOptions('tier', '');
    }
  }, [selectedTable]);

  useEffect(() => {
    const tableName = helperTableName;
    if (!tableName) return undefined;

    const targetRows = helperRows;
    if (!targetRows.length) return undefined;

    const tableReferences = tables.find((table) => table.name === tableName)?.references ?? {};
    const targetColumns = helperColumns.filter(
      (column) => column.name.endsWith('_id') && tableReferences[column.name]
    );

    if (!targetColumns.length) return undefined;

    const controller = new AbortController();

    (async () => {
      const entries: Array<[string, Record<string, string>]> = [];

      for (const column of targetColumns) {
        const uniqueValues = Array.from(
          new Set(
            targetRows
              .map((row) => row[column.name])
              .filter((value) => value !== null && value !== undefined && value !== '')
              .map((value) => String(value))
          )
        );

        if (!uniqueValues.length) continue;

        const cacheKey = `${tableName}:${column.name}`;
        const signature = `${cacheKey}:${uniqueValues.sort().join(',')}`;
        if (lastReferenceLabels.current[cacheKey] === signature) continue;

        const url = `/api/admin/crud/reference?table=${encodeURIComponent(tableName)}&column=${encodeURIComponent(column.name)}&values=${uniqueValues
          .map((value) => encodeURIComponent(value))
          .join(',')}`;

        try {
          const response = await fetch(url, { cache: 'no-cache', signal: controller.signal });
          if (!response.ok) continue;
          const payload = (await response.json()) as { labels?: Record<string, string> };
          entries.push([column.name, payload.labels ?? {}]);
          lastReferenceLabels.current[cacheKey] = signature;
        } catch (error) {
          if (controller.signal.aborted) return;
          console.error(error);
        }
      }

      if (entries.length) {
        setReferenceLabels((prev) => ({
          ...prev,
          [tableName]: {
            ...(prev[tableName] ?? {}),
            ...Object.fromEntries(entries)
          }
        }));
      }
    })();

    return () => controller.abort();
  }, [helperColumns, helperRows, helperTableName, tables]);

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
      const keyword = referenceSearch[column.name] ?? '';
      const queryKey = `${selectedTable}:${column.name}:${keyword}`;
      if (lastReferenceQueries.current[column.name] === queryKey && referenceOptions[column.name]?.length) return;
      lastReferenceQueries.current[column.name] = queryKey;
      void loadReferenceOptions(column.name, keyword);
    });
  }, [columns, referenceOptions, referenceSearch, selectedTable]);

  useEffect(() => {
    if (!isScheduleException) {
      setExceptionContext(DEFAULT_EXCEPTION_STATE);
      return;
    }

    const workerId = formValues.worker_id;
    const excptDate = formValues.excpt_date;

    if (!workerId || !excptDate) {
      setExceptionContext(DEFAULT_EXCEPTION_STATE);
      setFormValues((prev) => {
        const next = { ...prev };
        next.add_work_yn = next.add_work_yn ?? '0';
        next.cancel_work_yn = next.cancel_work_yn ?? '0';
        if (next.add_work_yn === prev.add_work_yn && next.cancel_work_yn === prev.cancel_work_yn) {
          return prev;
        }
        return next;
      });
      return;
    }

    const controller = new AbortController();
    const params = new URLSearchParams({ workerId: String(workerId), date: String(excptDate) });

    const loadContext = async () => {
      setExceptionContext((prev) => ({ ...prev, loading: true, message: prev.message }));
      try {
        const response = await fetch(`/api/admin/schedule/exception-context?${params.toString()}`, {
          cache: 'no-cache',
          signal: controller.signal
        });

        if (!response.ok) {
          throw new Error('예외 일정을 불러오지 못했습니다.');
        }

        const payload = (await response.json()) as { isWorkingDay: boolean };
        const isWorkingDay = Boolean(payload.isWorkingDay);
        const nextChecked = isWorkingDay ? formValues.cancel_work_yn === '1' : formValues.add_work_yn === '1';
        setExceptionContext({
          loading: false,
          isWorkingDay,
          checked: nextChecked,
          message: isWorkingDay
            ? '원래 출근하는 날짜입니다. 휴가로 설정하시겠습니까?'
            : '원래 휴가 날짜입니다. 출근날짜로 설정하시겠습니까?'
        });

        setFormValues((prev) => {
          const next = { ...prev };
          const addValue = isWorkingDay ? '0' : nextChecked ? '1' : '0';
          const cancelValue = isWorkingDay ? (nextChecked ? '1' : '0') : '0';

          next.add_work_yn = addValue;
          next.cancel_work_yn = cancelValue;

          if (next.add_work_yn === prev.add_work_yn && next.cancel_work_yn === prev.cancel_work_yn) {
            return prev;
          }

          return next;
        });
      } catch (error) {
        if (controller.signal.aborted) return;
        setExceptionContext({ ...DEFAULT_EXCEPTION_STATE, message: '일정을 불러오지 못했습니다.' });
      }
    };

    void loadContext();

    return () => controller.abort();
  }, [isScheduleException, formValues.worker_id, formValues.excpt_date, mode]);

  async function fetchSnapshot(table: string, offset: number) {
    setLoading(true);
    setFeedback(null);
    try {
      const response = await fetch(`/api/admin/crud?table=${table}&limit=${DEFAULT_LIMIT}&offset=${offset}`, { cache: 'no-cache' });
      if (!response.ok) {
        throw new Error('테이블을 불러오지 못했습니다.');
      }
      const payload = (await response.json()) as Snapshot;
      const tableDefaults = buildDefaultValues(payload.columns, payload.rows);
      setSnapshot({ ...payload, table });
      setMode('create');
      setEditingKey({});
      setFormValues(tableDefaults);
      setReferenceOptions({});
      setReferenceSearch({});
      setReferenceLoading({});
    } catch (error) {
      console.error(error);
      setFeedback({
        message: error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.',
        variant: 'error'
      });
    } finally {
      setLoading(false);
    }
  }

  async function fetchHelperSnapshot() {
    if (!isProtectedTable) {
      setHelperSnapshot(snapshot);
      return;
    }

    setHelperLoading(true);
    setHelperFeedback(null);
    try {
      const table = selectedTable;
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

  function parseFlagComment(comment?: string) {
    if (!comment) return [] as { value: string; label: string }[];

    return comment
      .split(/[,;]/)
      .map((part) => part.split(/[:=]/))
      .filter((tokens) => tokens[0])
      .map((tokens) => ({ value: tokens[0]?.trim() ?? '', label: (tokens[1] ?? tokens[0] ?? '').trim() }))
      .filter((option) => option.value);
  }

  function handleInputChange(column: AdminColumnMeta, value: string | boolean) {
    if (NUMERIC_ONLY_FIELDS.has(column.name)) {
      const sanitized = typeof value === 'string' ? value.replace(/[^0-9]/g, '') : String(value).replace(/[^0-9]/g, '');
      setFormValues((prev) => ({ ...prev, [column.name]: sanitized }));
      return;
    }

    if (isClientAdditionalPrice && mode === 'create' && (column.name === 'room_id' || column.name === 'date')) {
      const nextValues = { ...formValues, [column.name]: String(value) };
      setFormValues(nextValues);
      void refreshAdditionalPriceSeq(nextValues);
      return;
    }

    if (column.dataType === 'tinyint' && column.columnType === 'tinyint(1)') {
      const asString = typeof value === 'string' ? value : value ? '1' : '0';
      const truthy = ['1', 'true', 'Y', 'y'].includes(asString);
      setFormValues((prev) => ({ ...prev, [column.name]: truthy ? '1' : '0' }));
      return;
    }
    setFormValues((prev) => ({ ...prev, [column.name]: String(value) }));
  }

  function handleScheduleExceptionToggle(checked: boolean) {
    const isWorkingDay = exceptionContext.isWorkingDay;
    setExceptionContext((prev) => ({ ...prev, checked }));

    if (isWorkingDay === null) return;

    setFormValues((prev) => {
      const next = { ...prev };
      const addValue = isWorkingDay ? '0' : checked ? '1' : '0';
      const cancelValue = isWorkingDay ? (checked ? '1' : '0') : '0';

      next.add_work_yn = addValue;
      next.cancel_work_yn = cancelValue;

      if (next.add_work_yn === prev.add_work_yn && next.cancel_work_yn === prev.cancel_work_yn) {
        return prev;
      }

      return next;
    });
  }

  function handleWorkerBankChange(optionValue: string) {
    const options = referenceOptions.basecode_bank ?? [];
    const selectedOption = options.find((option) => String(option.value) === optionValue);
    setFormValues((prev) => ({
      ...prev,
      basecode_bank: optionValue,
      basecode_code: String(selectedOption?.meta?.code ?? optionValue)
    }));
  }

  function handleBasecodeChange(optionValue: string, primaryColumn: string) {
    const options = referenceOptions.basecode_code ?? referenceOptions[primaryColumn] ?? [];
    const selectedOption = options.find((option) => String(option.value) === optionValue);
    setFormValues((prev) => ({
      ...prev,
      [primaryColumn]: String(selectedOption?.meta?.codeGroup ?? prev[primaryColumn] ?? ''),
      basecode_code: selectedOption?.meta?.code ? String(selectedOption.meta.code) : optionValue
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
      setFeedback({
        message: error instanceof Error ? error.message : '순번 조회 중 오류가 발생했습니다.',
        variant: 'error'
      });
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

  function toDateString(value: unknown) {
    const raw = String(value);
    const match = raw.match(/\d{4}-\d{2}-\d{2}/);
    return match ? match[0] : raw;
  }

  function toDateTimeLocal(value: unknown) {
    const raw = String(value).replace(' ', 'T');
    const match = raw.match(/(\d{4}-\d{2}-\d{2})[T\s](\d{2}:\d{2})/);
    if (match) return `${match[1]}T${match[2]}`;

    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? raw : parsed.toISOString().slice(0, 16);
  }

  function toTimeString(value: unknown) {
    const raw = String(value);
    const match = raw.match(/\d{2}:\d{2}/);
    return match ? match[0] : raw;
  }

  function formatValueForForm(column: AdminColumnMeta, value: unknown) {
    if (value === null || value === undefined) return undefined;
    if (NUMERIC_ONLY_FIELDS.has(column.name)) return String(value).replace(/[^0-9]/g, '');
    if (column.dataType === 'date') return toDateString(value);
    if (column.dataType === 'datetime' || column.dataType === 'timestamp') return toDateTimeLocal(value);
    if (column.dataType === 'time') return toTimeString(value);
    if (column.dataType === 'tinyint' && column.columnType === 'tinyint(1)') {
      const asString = String(value).toLowerCase();
      const truthy = ['1', 'true', 'y', 'yes'].includes(asString);
      return truthy ? '1' : '0';
    }
    if (column.dataType === 'json') return JSON.stringify(value, null, 2);
    return String(value);
  }

  function startEdit(row: Record<string, unknown>) {
    setMode('edit');
    setFeedback(null);
    const defaults: Record<string, string> = {};
    formColumns.forEach((column) => {
      const value = row[column.name];
      const formatted = formatValueForForm(column, value);
      if (formatted === undefined) return;
      defaults[column.name] = formatted;
    });

    Object.entries(row).forEach(([key, value]) => {
      if (key in defaults) return;
      if (isHiddenColumn(key) && !(hasBasecodePair && key === 'basecode_code')) return;
      if (value === null || value === undefined) return;
      defaults[key] = String(value);
    });

    const key: Record<string, unknown> = {};
    (snapshot?.primaryKey ?? []).forEach((pk) => {
      key[pk] = row[pk];
    });

    if (isClientAdditionalPrice) {
      if (!('minus_yn' in defaults)) defaults.minus_yn = '0';
      if (!('ratio_yn' in defaults)) defaults.ratio_yn = '0';
    }

    (snapshot?.columns ?? []).forEach((column) => {
      if (!column.references) return;
      const rawValue = row[column.name];
      if (rawValue === null || rawValue === undefined || rawValue === '') return;

      setReferenceOptions((prev) => {
        const options = prev[column.name] ?? [];
        const exists = options.some((option) => String(option.value) === String(rawValue));
        if (exists) return prev;

        const fallbackLabel = typeof row[column.references?.column ?? ''] === 'string'
          ? String(row[column.references?.column ?? ''])
          : String(rawValue);

        return {
          ...prev,
          [column.name]: [...options, { value: rawValue, label: fallbackLabel }]
        };
      });
    });

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
    const defaults = snapshot ? buildDefaultValues(snapshot.columns) : {};
    setFormValues(defaults);
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
      const basecodeGroupParam = columnName.startsWith('basecode_')
        ? columnName === 'basecode_code'
          ? basecodePrimaryColumn
            ? formValues[basecodePrimaryColumn] ?? ''
            : ''
          : formValues[columnName] ?? ''
        : '';
      const response = await fetch(
        `/api/admin/crud/reference?table=${encodeURIComponent(selectedTable)}&column=${encodeURIComponent(columnName)}&q=${encodeURIComponent(keyword)}${
          basecodeGroupParam ? `&basecodeGroup=${encodeURIComponent(String(basecodeGroupParam))}` : ''
        }`,
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
      setFeedback({
        message: error instanceof Error ? error.message : '연관 데이터 조회 중 오류가 발생했습니다.',
        variant: 'error'
      });
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
      setFeedback({
        message: error instanceof Error ? error.message : '추가비용 항목 조회 중 오류가 발생했습니다.',
        variant: 'error'
      });
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
      if (isHiddenColumn(column.name) && !(hasBasecodePair && column.name === 'basecode_code')) return;
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

      let errorMessage: string | null = null;
      if (!response.ok) {
        try {
          const payload = (await response.json()) as { error?: string; message?: string };
          errorMessage = payload.error ?? payload.message ?? null;
        } catch (parseError) {
          console.error(parseError);
        }
        throw new Error(errorMessage ?? '저장 시 오류가 발생했습니다.');
      }

      const payload = (await response.json()) as Snapshot;
      setSnapshot(payload);

      if (!usingSharedGrid) {
        await fetchHelperSnapshot();
      }
      startCreate();
      setFeedback({ message: '저장되었습니다.', variant: 'success' });
    } catch (error) {
      console.error(error);
      const message = error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.';
      setFeedback({ message, variant: 'error' });
    } finally {
      setLoading(false);
    }
  }

  function renderInput(column: AdminColumnMeta) {
    const type = toInputType(column);
    const value = formValues[column.name] ?? '';
    const isCheckbox = type === 'checkbox';

    if (hasBasecodePair && basecodePrimaryColumn && column.name === basecodePrimaryColumn) {
      const options = referenceOptions.basecode_code ?? [];
      const refLoading = referenceLoading.basecode_code ?? false;
      const selectValue = formValues.basecode_code ?? value;

      return (
        <select
          id={column.name}
          value={selectValue}
          onChange={(event) => handleBasecodeChange(event.target.value, column.name)}
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

    if (selectedTable === 'worker_weekly_pattern' && column.name === 'weekday') {
      return (
        <select
          id={column.name}
          value={value}
          onChange={(event) => handleInputChange(column, event.target.value)}
          disabled={loading}
        >
          <option value="">선택하세요</option>
          {WEEKDAY_OPTIONS.map((option) => (
            <option key={`${column.name}-${option.value}`} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
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

    if (isScheduleException && (column.name === 'add_work_yn' || column.name === 'cancel_work_yn')) {
      if (column.name === 'cancel_work_yn') {
        return null;
      }

      const checkboxLabel =
        exceptionContext.isWorkingDay === true
          ? '휴가로 설정합니다.'
          : exceptionContext.isWorkingDay === false
            ? '출근날짜로 설정합니다.'
            : '근무자와 날짜를 먼저 선택해 주세요.';

      return (
        <div className={styles.scheduleExceptionField}>
          <p className={styles.scheduleExceptionMessage}>
            {exceptionContext.message ?? DEFAULT_EXCEPTION_STATE.message}
          </p>
          <label className={styles.scheduleExceptionCheckbox}>
            <input
              type="checkbox"
              checked={exceptionContext.checked}
              onChange={(event) => handleScheduleExceptionToggle(event.target.checked)}
              disabled={loading || exceptionContext.loading || exceptionContext.isWorkingDay === null}
            />
            <span>{checkboxLabel}</span>
          </label>
          <input type="hidden" id="add_work_yn" value={formValues.add_work_yn ?? ''} readOnly />
          <input type="hidden" id="cancel_work_yn" value={formValues.cancel_work_yn ?? ''} readOnly />
        </div>
      );
    }

    if (!isProtectedTable && column.name.endsWith('_yn')) {
      return (
        <select
          id={column.name}
          value={value}
          onChange={(event) => handleInputChange(column, event.target.value)}
          disabled={loading}
        >
          <option value="1">예</option>
          <option value="0">아니오</option>
        </select>
      );
    }

    if (!isProtectedTable && column.name.endsWith('_flag')) {
      const flagOptions = parseFlagComment(column.comment);
      const options = flagOptions.length ? flagOptions : [];

      return (
        <select
          id={column.name}
          value={value}
          onChange={(event) => handleInputChange(column, event.target.value)}
          disabled={loading}
        >
          {(options.length ? options : [{ value: '1', label: '예' }, { value: '0', label: '아니오' }]).map((option) => (
            <option key={`${column.name}-${option.value}`} value={String(option.value)}>
              {option.label}
            </option>
          ))}
        </select>
      );
    }

    const isRoleOrTypeColumn = !isProtectedTable && (column.name.includes('role') || column.name.includes('type'));

    if (isRoleOrTypeColumn) {
      const options = parseFlagComment(column.comment);

      if (options.length) {
        return (
          <select
            id={column.name}
            value={value}
            onChange={(event) => handleInputChange(column, event.target.value)}
            disabled={loading}
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
      const showSearch = !NO_SEARCH_REFERENCE_COLUMNS.has(column.name);

      return (
        <div className={styles.referenceInput}>
          {showSearch ? (
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
          ) : null}

          <select
            id={column.name}
            value={value}
            onChange={(event) => handleInputChange(column, event.target.value)}
            disabled={loading || refLoading}
          >
            <option value="">선택하세요</option>
            {options.map((option) => {
              const optionValue = option.value == null ? '' : String(option.value);
              return (
                <option key={`${column.name}-${optionValue}`} value={optionValue}>
                  {option.label}
                </option>
              );
            })}
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

  function renderCellValue(row: Record<string, unknown>, key: string) {
    let rawValue = getClientField(row, key, '');

    if (helperTableName === 'worker_weekly_pattern' || helperTableName === 'worker_schedule_exception') {
      if (key === 'worker_id') {
        const workerId = row.worker_id;
        const workerName = typeof row.worker_name === 'string' ? row.worker_name : '';
        const formattedId = workerId === null || workerId === undefined ? '' : `(${workerId})`;
        const combined = `${formattedId}${workerName}`.trim();
        rawValue = combined || rawValue;
      }

      if (helperTableName === 'worker_weekly_pattern' && key === 'weekday') {
        const matched = WEEKDAY_OPTIONS.find((option) => option.value === String(row.weekday ?? rawValue));
        if (matched) {
          rawValue = matched.label;
        }
      }

      if (helperTableName === 'worker_schedule_exception' && (key === 'add_work_yn' || key === 'cancel_work_yn')) {
        rawValue = rawValue === '1' ? '예' : '아니오';
      }
    }

    const labelMatch = referenceLabels[helperTableName ?? '']?.[key]?.[String(rawValue)];
    if (labelMatch) {
      rawValue = labelMatch;
    }
    if (!rawValue) {
      return <span className={styles.cellText}>-</span>;
    }

    const display = rawValue.length > 20 ? `${rawValue.slice(0, 20)}...` : rawValue;

    return (
      <span className={styles.cellText} title={rawValue}>
        {display}
      </span>
    );
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

  function handleRowSelect(row: Record<string, unknown>) {
    if (usingSharedGrid) {
      startEdit(row);
      return;
    }
    handleClientRowSelect(row);
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

      <header className={styles.header}>{title ?? '전체 테이블 CRUD'}</header>

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

        {feedback ? (
          <p
            className={`${styles.feedback} ${
              feedback.variant === 'error' ? styles.feedbackError : styles.feedbackSuccess
            }`}
          >
            {feedback.message}
          </p>
        ) : null}

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
            <p className={styles.workerTitle}>{helperTitle}</p>
            <p className={styles.workerSubtitle}>{helperSubtitle}</p>
          </div>
          <button
            type="button"
            onClick={() => (usingSharedGrid ? fetchSnapshot(selectedTable, snapshot?.offset ?? 0) : fetchHelperSnapshot())}
            disabled={helperLoading || loading}
          >
            목록 새로고침
          </button>
        </header>

        {helperFeedback ? (
          <p className={`${styles.feedback} ${styles.feedbackError}`}>{helperFeedback}</p>
        ) : null}

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
                  <tr key={index} className={styles.workerRow} onClick={() => handleRowSelect(row)}>
                    {helperColumnLabels.map((column) => (
                      <td key={`${index}-${column.key}`}>{renderCellValue(row, column.key)}</td>
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

