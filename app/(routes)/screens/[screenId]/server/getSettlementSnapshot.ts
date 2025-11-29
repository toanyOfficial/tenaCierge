import { and, asc, eq, gte, inArray, lte, or, sql } from 'drizzle-orm';

import { db } from '@/src/db/client';
import {
  clientAdditionalPrice,
  clientHeader,
  clientPriceList,
  clientPriceSetDetail,
  clientRooms,
  etcBuildings,
  workHeader
} from '@/src/db/schema';
import type { ProfileSummary } from '@/src/utils/profile';
import { logEtcError } from '@/src/server/errorLogger';

type Money = number;

type SettlementLine = {
  id: string;
  date: string;
  item: string;
  priceTitle?: string;
  amount: Money;
  quantity: number;
  total: Money;
  rawTotal: Money;
  preDiscountBase?: Money;
  category: 'cleaning' | 'facility' | 'monthly' | 'misc';
  roomId: number;
  roomLabel: string;
  minusYn?: boolean;
  ratioYn?: boolean;
  ratioValue?: number;
};

export type SettlementStatement = {
  hostId: number;
  hostName: string;
  lines: SettlementLine[];
  totals: {
    cleaning: Money;
    facility: Money;
    monthly: Money;
    misc: Money;
    total: Money;
    vat: Money;
    grandTotal: Money;
  };
};

export type SettlementSnapshot = {
  month: string;
  summary: (SettlementStatement['totals'] & { hostId: number; hostName: string })[];
  statements: SettlementStatement[];
  hostOptions: { id: number; name: string }[];
  appliedHostId: number | null;
};

type PriceItem = {
  roomId: number;
  type: number;
  amount: Money;
  title: string;
  minusYn?: boolean;
  ratioYn?: boolean;
  ratioValue?: number;
};

function normalizeRegisterNo(value: string | undefined | null) {
  if (!value) return '';
  return value.replace(/[^0-9]/g, '').slice(0, 6);
}

function normalizeDateOnly(value: Date | string | null | undefined) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

function ensureMonth(input?: string | null) {
  if (input && /^\d{4}-\d{2}$/.test(input)) {
    return input;
  }

  const now = new Date();
  const month = `${now.getMonth() + 1}`.padStart(2, '0');
  return `${now.getFullYear()}-${month}`;
}

function getMonthBoundary(month: string) {
  const [yearStr, monthStr] = month.split('-');
  const year = Number(yearStr);
  const monthIndex = Number(monthStr) - 1;

  const start = new Date(Date.UTC(year, monthIndex, 1));
  const end = new Date(Date.UTC(year, monthIndex + 1, 0, 23, 59, 59));

  return { start, end };
}

async function resolveAdditionalPriceColumn(month: string, hostId?: number | null) {
  try {
    const raw = await db.execute<{ column_name?: string; COLUMN_NAME?: string }>(
      sql`SELECT column_name FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'client_additional_price'`
    );

    const rows = Array.isArray(raw)
      ? ((Array.isArray(raw[0]) ? (raw[0] as unknown) : (raw as unknown)) as {
          column_name?: string;
          COLUMN_NAME?: string;
        }[])
      : Array.isArray((raw as any)?.rows)
        ? ((raw as any).rows as { column_name?: string; COLUMN_NAME?: string }[])
        : [];

    const columns = rows
      .map((row) => (row?.column_name ?? (row as any)?.COLUMN_NAME ?? '').toString().toLowerCase())
      .filter(Boolean);

    if (!columns.length) {
      await logEtcError({
        message: 'client_additional_price 컬럼 조회 결과가 비어 있습니다.',
        stacktrace: null,
        context: { month, hostId: hostId ?? null, table: 'client_additional_price' }
      });

      return null;
    }

    if (columns.includes('price')) return 'price';
    if (columns.includes('amount')) return 'amount';
    if (columns.includes('value')) return 'value';

    await logEtcError({
      message: 'client_additional_price의 금액 컬럼(price/amount/value)을 찾을 수 없습니다.',
      stacktrace: null,
      context: { month, hostId: hostId ?? null, table: 'client_additional_price', columns }
    });

    return null;
  } catch (error) {
    await logEtcError({
      message: `client_additional_price 컬럼 조회 실패: ${error instanceof Error ? error.message : '알 수 없는 오류'}`,
      stacktrace: error instanceof Error ? error.stack ?? null : null,
      context: { month, hostId: hostId ?? null, table: 'client_additional_price' }
    });
    throw error;
  }
}

async function resolvePriceListFlags(month: string, hostId?: number | null) {
  const result = { hasMinus: false, hasRatio: false };

  try {
    const raw = await db.execute<{ column_name?: string; COLUMN_NAME?: string }>(
      sql`SELECT column_name FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'client_price_list'`
    );

    const rows = Array.isArray(raw)
      ? ((Array.isArray(raw[0]) ? (raw[0] as unknown) : (raw as unknown)) as {
          column_name?: string;
          COLUMN_NAME?: string;
        }[])
      : Array.isArray((raw as any)?.rows)
        ? ((raw as any).rows as { column_name?: string; COLUMN_NAME?: string }[])
        : [];

    const columns = rows
      .map((row) => (row?.column_name ?? (row as any)?.COLUMN_NAME ?? '').toString().toLowerCase())
      .filter(Boolean);

    result.hasMinus = columns.includes('minus_yn');
    result.hasRatio = columns.includes('ratio_yn');
  } catch (error) {
    await logEtcError({
      message: `client_price_list 플래그 컬럼 조회 실패: ${error instanceof Error ? error.message : '알 수 없는 오류'}`,
      stacktrace: error instanceof Error ? error.stack ?? null : null,
      context: { month, hostId: hostId ?? null, table: 'client_price_list' }
    });
  }

  return result;
}

function toMinutes(time: string | null | undefined) {
  if (!time) return 0;
  const [h, m, s] = time.split(':').map((v) => Number(v));
  return (h || 0) * 60 + (m || 0) + (s || 0) / 60;
}

function addLine(
  lines: SettlementLine[],
  room: { roomId: number; roomLabel: string },
  line: Omit<
    SettlementLine,
    'id' | 'total' | 'rawTotal' | 'roomId' | 'roomLabel'
  > & { id?: string }
) {
  const rawTotal = line.ratioYn ? 0 : line.amount * line.quantity;
  const total = line.minusYn ? -rawTotal : rawTotal;

  lines.push({
    ...line,
    total,
    rawTotal,
    roomId: room.roomId,
    roomLabel: room.roomLabel,
    minusYn: !!line.minusYn,
    ratioYn: !!line.ratioYn,
    ratioValue: line.ratioValue,
    preDiscountBase: line.preDiscountBase,
    id: line.id ?? `${room.roomLabel}-${line.date}-${line.item}-${lines.length}`
  });
}

async function loadPriceItems(roomIds: number[], month: string, hostId?: number | null) {
  if (!roomIds.length) return new Map<number, PriceItem[]>();

  const priceFlags = await resolvePriceListFlags(month, hostId ?? null);

  const roomPriceSets = await db
    .select({ roomId: clientRooms.id, priceSetId: clientRooms.priceSetId })
    .from(clientRooms)
    .where(inArray(clientRooms.id, roomIds));

  const missingPriceSetRooms = roomPriceSets.filter((row) => row.priceSetId == null).map((row) => row.roomId);
  if (missingPriceSetRooms.length) {
    await logEtcError({
      message: '정산용 price_set_id가 지정되지 않은 객실이 있습니다.',
      stacktrace: null,
      context: { month, hostId: hostId ?? null, roomIds: missingPriceSetRooms }
    });
  }

  const priceSetIds = Array.from(
    new Set(
      roomPriceSets
        .map((row) => row.priceSetId)
        .filter((value): value is number => typeof value === 'number')
    )
  );

  const priceRows = priceSetIds.length
    ? await db
        .select({
          priceSetId: clientPriceSetDetail.priceSetId,
          priceId: clientPriceSetDetail.priceId,
          priceType: clientPriceList.type,
          amount: sql`CAST(${clientPriceList.amount} AS DECIMAL(20,4))`,
          title: clientPriceList.title,
          minusYn: priceFlags.hasMinus
            ? sql`COALESCE(${sql.raw('client_price_list.minus_yn')}, 0)`
            : sql`CAST(0 AS SIGNED)` ,
          ratioYn: priceFlags.hasRatio
            ? sql`COALESCE(${sql.raw('client_price_list.ratio_yn')}, 0)`
            : sql`CAST(0 AS SIGNED)`
        })
        .from(clientPriceSetDetail)
        .innerJoin(clientPriceList, eq(clientPriceSetDetail.priceId, clientPriceList.id))
        .where(inArray(clientPriceSetDetail.priceSetId, priceSetIds))
    : [];

  const priceMap = new Map<number, PriceItem[]>();

  const priceSetMap = new Map<number, PriceItem[]>();
  for (const row of priceRows) {
    if (!row.priceId || row.priceType == null || row.amount == null) continue;
    const list = priceSetMap.get(row.priceSetId) ?? [];
    list.push({
      roomId: 0,
      type: Number(row.priceType),
      amount: Number(row.amount),
      title: row.title ?? '요금',
      minusYn: !!Number((row as any).minusYn ?? 0),
      ratioYn: !!Number((row as any).ratioYn ?? 0),
      ratioValue: !!Number((row as any).ratioYn ?? 0) ? Number(row.amount) : undefined
    });
    priceSetMap.set(row.priceSetId, list);
  }

  for (const { roomId, priceSetId } of roomPriceSets) {
    const list = priceSetId ? priceSetMap.get(priceSetId) ?? [] : [];
    if (list.length) {
      priceMap.set(
        roomId,
        list.map((item) => ({ ...item, roomId }))
      );
    }
  }

  const missingRooms = roomIds.filter((id) => !(priceMap.get(id)?.length));
  if (missingRooms.length) {
    await logEtcError({
      message: '정산용 요금 세트가 지정되지 않은 객실이 있습니다.',
      stacktrace: null,
      context: { month, hostId: hostId ?? null, roomIds: missingRooms }
    });
  }

  return priceMap;
}

export async function getSettlementSnapshot(
  profile: ProfileSummary,
  monthParam?: string | null,
  hostIdParam?: string | null
): Promise<SettlementSnapshot> {
  const month = ensureMonth(monthParam);
  try {
    const { start, end } = getMonthBoundary(month);
    const daysInMonth = Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    const normalizedRegister = normalizeRegisterNo(profile.registerNo);

    const parsedHostId = hostIdParam ? Number(hostIdParam) : null;
    const hostFilterId = parsedHostId && !Number.isNaN(parsedHostId) ? parsedHostId : null;
    const isAdmin = profile.roles.includes('admin');
    const isHostOnly = profile.roles.includes('host') && !isAdmin;

  const hostWhere: any[] = [];

  if (isHostOnly && normalizedRegister) {
    hostWhere.push(eq(clientHeader.registerCode, normalizedRegister));
  }

  if (isAdmin && hostFilterId) {
    hostWhere.push(eq(clientHeader.id, hostFilterId));
  }

    const hostCondition = hostWhere.length ? (hostWhere.length === 1 ? hostWhere[0] : or(...hostWhere)) : null;

    const baseHostQuery = db
      .select({ id: clientHeader.id, name: clientHeader.name, registerNo: clientHeader.registerCode })
      .from(clientHeader);

    const hostQuery = hostCondition ? baseHostQuery.where(hostCondition) : baseHostQuery;

    const hostRows = await hostQuery.orderBy(asc(clientHeader.name));

    if (!hostRows.length) {
      return { month, summary: [], statements: [], hostOptions: [], appliedHostId: hostFilterId ?? null };
    }

    const hostIds = hostRows.map((row) => row.id);

    const roomRows = await db
      .select({
        roomId: clientRooms.id,
        hostId: clientRooms.clientId,
        bedCount: clientRooms.bedCount,
        roomNo: clientRooms.roomNo,
        buildingShort: etcBuildings.shortName,
        priceSetId: clientRooms.priceSetId,
        expectedCheckout: clientRooms.checkoutTime,
        expectedCheckin: clientRooms.checkinTime,
        startDate: clientRooms.startDate,
        endDate: clientRooms.endDate,
        openYn: clientRooms.openYn
      })
      .from(clientRooms)
      .innerJoin(etcBuildings, eq(clientRooms.buildingId, etcBuildings.id))
      .where(inArray(clientRooms.clientId, hostIds));

    const eligibleRooms = roomRows.filter((row) => {
      const startDate = normalizeDateOnly(row.startDate);
      const endDate = normalizeDateOnly(row.endDate) ?? end;
      const overlapsMonth = endDate.getTime() >= start.getTime() && (startDate ?? start).getTime() <= end.getTime();

      if (row.openYn) {
        return overlapsMonth;
      }

      const startInMonth = !!startDate && startDate.getTime() >= start.getTime() && startDate.getTime() <= end.getTime();
      const endInMonth = !!row.endDate && endDate.getTime() >= start.getTime() && endDate.getTime() <= end.getTime();

      return overlapsMonth && (startInMonth || endInMonth);
    });

    const roomIds = eligibleRooms.map((row) => row.roomId);

    const priceMap = await loadPriceItems(roomIds, month, hostFilterId ?? null);

    const additionalPriceColumn = roomIds.length
      ? await resolveAdditionalPriceColumn(month, hostFilterId ?? null)
      : null;

    const additionalRows = roomIds.length && additionalPriceColumn
      ? await db
          .select({
            hostId: clientRooms.clientId,
            roomId: clientAdditionalPrice.roomId,
            date: clientAdditionalPrice.date,
            title: clientAdditionalPrice.title,
            price:
              additionalPriceColumn === 'price'
                ? sql`CAST(${clientAdditionalPrice.price} AS DECIMAL(20,4))`
                : sql`CAST(${sql.raw(`client_additional_price.${additionalPriceColumn}`)} AS DECIMAL(20,4))`
          })
          .from(clientAdditionalPrice)
          .innerJoin(clientRooms, eq(clientAdditionalPrice.roomId, clientRooms.id))
          .where(
            and(
              inArray(clientAdditionalPrice.roomId, roomIds),
              gte(clientAdditionalPrice.date, start),
              lte(clientAdditionalPrice.date, end)
            )
          )
      : [];

    const workRows = roomIds.length
      ? await db
          .select({
            hostId: clientRooms.clientId,
            roomId: clientRooms.id,
            workId: workHeader.id,
            workDate: workHeader.date,
            amenitiesQty: workHeader.amenitiesQty,
            blanketQty: workHeader.blanketQty,
            cleaningYn: workHeader.cleaningYn,
            actualCheckin: workHeader.checkinTime,
            actualCheckout: workHeader.checkoutTime
          })
          .from(workHeader)
          .innerJoin(clientRooms, eq(workHeader.roomId, clientRooms.id))
          .where(
            and(
              inArray(workHeader.roomId, roomIds),
              gte(workHeader.date, start),
              lte(workHeader.date, end),
              eq(workHeader.cancelYn, false)
            )
          )
          .orderBy(asc(workHeader.date))
      : [];

    const roomMap = new Map(
      eligibleRooms.map((row) => {
        const startDate = normalizeDateOnly(row.startDate) ?? start;
        const endDate = normalizeDateOnly(row.endDate) ?? end;
        const activeStart = startDate.getTime() > start.getTime() ? startDate : start;
        const activeEnd = endDate.getTime() < end.getTime() ? endDate : end;
        const activeDays = activeEnd.getTime() >= activeStart.getTime()
          ? Math.floor((activeEnd.getTime() - activeStart.getTime()) / (1000 * 60 * 60 * 24)) + 1
          : 0;

        return [
          row.roomId,
          {
            roomId: row.roomId,
            hostId: row.hostId,
            bedCount: row.bedCount,
            label: `${row.buildingShort}${row.roomNo}`,
            expectedCheckout: row.expectedCheckout,
            expectedCheckin: row.expectedCheckin,
            openYn: row.openYn,
            activeDays,
            activeDaysRatio: row.openYn ? 1 : Math.max(0, Math.min(1, activeDays / daysInMonth))
          }
        ];
      })
    );

    const eligibleHostIds = new Set(eligibleRooms.map((room) => room.hostId));

    const filteredHosts = hostRows.filter((host) => eligibleHostIds.has(host.id));

    if (!filteredHosts.length) {
      return { month, summary: [], statements: [], hostOptions: [], appliedHostId: hostFilterId ?? null };
    }

    const statements: SettlementStatement[] = filteredHosts.map((host) => ({
      hostId: host.id,
      hostName: host.name,
      lines: [],
      totals: { cleaning: 0, facility: 0, monthly: 0, misc: 0, total: 0, vat: 0, grandTotal: 0 }
    }));

    const statementMap = new Map(statements.map((st) => [st.hostId, st]));

    // Per-work items
    for (const work of workRows) {
      const room = roomMap.get(work.roomId);
      const prices = priceMap.get(work.roomId) ?? [];

      const hostStatement = room ? statementMap.get(room.hostId) : undefined;
      if (!room || !hostStatement) continue;

      const date = work.workDate instanceof Date ? work.workDate.toISOString().slice(0, 10) : String(work.workDate);
      const isCleaningWork = work.cleaningYn === true;

      for (const price of prices) {
        switch (price.type) {
          case 1: {
            if (isCleaningWork) {
              addLine(hostStatement.lines, { roomId: work.roomId, roomLabel: room.label }, {
                date,
                item: `${room.label} ${price.title ?? '청소비'}`,
                priceTitle: price.title,
                amount: price.amount,
                quantity: 1,
                category: 'cleaning',
                minusYn: price.minusYn,
                ratioYn: price.ratioYn,
                ratioValue: price.ratioValue
              });
            }
            break;
          }
          case 3: {
            if (isCleaningWork) {
              const qty = room.bedCount ?? 1;
              addLine(hostStatement.lines, { roomId: work.roomId, roomLabel: room.label }, {
                date,
                item: `${room.label} ${price.title ?? '침구/베드 청소비'}`,
                priceTitle: price.title,
                amount: price.amount,
                quantity: qty,
                category: 'facility',
                minusYn: price.minusYn,
                ratioYn: price.ratioYn,
                ratioValue: price.ratioValue
              });
            }
            break;
          }
          case 5: {
            const expectedOut = toMinutes(room.expectedCheckout);
            const actualOut = toMinutes(work.actualCheckout);
            const expectedIn = toMinutes(room.expectedCheckin);
            const actualIn = toMinutes(work.actualCheckin);
            const varianceMinutes = Math.max(0, actualOut - expectedOut) + Math.max(0, expectedIn - actualIn);

            if (varianceMinutes > 0) {
              addLine(hostStatement.lines, { roomId: work.roomId, roomLabel: room.label }, {
                date,
                item: `${room.label} ${price.title ?? '체크인/아웃 변동'}`,
                priceTitle: price.title,
                amount: price.amount,
                quantity: varianceMinutes,
                category: 'facility',
                minusYn: price.minusYn,
                ratioYn: price.ratioYn,
                ratioValue: price.ratioValue
              });
            }
            break;
          }
          case 6: {
            const bedCount = room.bedCount ?? 0;
            const extraAmenities = Math.max(0, (work.amenitiesQty ?? 0) - bedCount);
            const extraBlankets = Math.max(0, (work.blanketQty ?? 0) - bedCount);
            const extras = extraAmenities + extraBlankets;

            if (extras > 0) {
              addLine(hostStatement.lines, { roomId: work.roomId, roomLabel: room.label }, {
                date,
                item: `${room.label} ${price.title ?? '추가 어메니티/침구'}`,
                priceTitle: price.title,
                amount: price.amount,
                quantity: extras,
                category: 'facility',
                minusYn: price.minusYn,
                ratioYn: price.ratioYn,
                ratioValue: price.ratioValue
              });
            }
            break;
          }
          default:
            break;
        }
      }
    }

  // Monthly items per room
    for (const room of eligibleRooms) {
      const roomInfo = roomMap.get(room.roomId);
      const hostStatement = roomInfo ? statementMap.get(roomInfo.hostId) : undefined;
      const prices = priceMap.get(room.roomId) ?? [];

      if (!hostStatement || !roomInfo) continue;

      const monthDate = `${month}-01`;
      const activeDays = roomInfo.activeDays ?? daysInMonth;

      for (const price of prices) {
        switch (price.type) {
          case 2: {
            const perDay = price.amount / daysInMonth;
              addLine(hostStatement.lines, { roomId: room.roomId, roomLabel: roomInfo.label }, {
                date: monthDate,
                item: `${roomInfo.label} ${price.title ?? '월정액'}`,
                priceTitle: price.title,
                amount: perDay,
                quantity: activeDays,
                category: 'monthly',
                minusYn: price.minusYn,
              ratioYn: price.ratioYn,
              ratioValue: price.ratioValue
            });
            break;
          }
          case 4: {
            const qty = roomInfo.bedCount ?? 1;
            const perDay = price.amount / daysInMonth;
            const totalQty = qty * activeDays;
              addLine(hostStatement.lines, { roomId: room.roomId, roomLabel: roomInfo.label }, {
                date: monthDate,
                item: `${roomInfo.label} ${price.title ?? '침구 월정액'} (x${qty})`,
                priceTitle: price.title,
                amount: perDay,
                quantity: totalQty,
                category: 'monthly',
                minusYn: price.minusYn,
              ratioYn: price.ratioYn,
              ratioValue: price.ratioValue
            });
            break;
          }
          case 7: {
              addLine(hostStatement.lines, { roomId: room.roomId, roomLabel: roomInfo.label }, {
                date: monthDate,
                item: `${roomInfo.label} ${price.title ?? '임시 항목'}`,
                priceTitle: price.title,
                amount: price.amount,
                quantity: 1,
                category: 'misc',
                minusYn: price.minusYn,
              ratioYn: price.ratioYn,
              ratioValue: price.ratioValue
            });
            break;
          }
          default:
            break;
        }
      }
    }

  // Additional prices
  for (const extra of additionalRows) {
    const hostStatement = statementMap.get(extra.hostId);
    const room = roomMap.get(extra.roomId);
    if (!hostStatement || !room) continue;
    const date = extra.date.toISOString().slice(0, 10);
    const price = Number(extra.price ?? 0);

    addLine(hostStatement.lines, { roomId: room.roomId, roomLabel: room.label }, {
      date,
      item: `${room.label} ${extra.title}`,
      amount: price,
      quantity: 1,
      category: 'misc'
    });
  }

  for (const statement of statements) {
    const baseByRoomCategory = new Map<string, number>();

    for (const line of statement.lines) {
      if (line.minusYn || line.ratioYn) continue;
      const key = `${line.roomId}-${line.category}`;
      const prev = baseByRoomCategory.get(key) ?? 0;
      baseByRoomCategory.set(key, prev + line.rawTotal);
    }

    for (const line of statement.lines) {
      if (!line.ratioYn) continue;
      const key = `${line.roomId}-${line.category}`;
      const base = baseByRoomCategory.get(key) ?? 0;
      const ratio = (line.ratioValue ?? line.amount) / 100;
      const computed = base * ratio;

      line.preDiscountBase = base;
      line.rawTotal = computed;
      line.total = line.minusYn ? -computed : computed;
    }

    const discountSum = statement.lines.filter((line) => line.minusYn).reduce((sum, line) => sum + line.total, 0);

    statement.totals.cleaning = statement.lines
      .filter((line) => line.category === 'cleaning' && !line.minusYn)
      .reduce((sum, line) => sum + line.total, 0);
    statement.totals.facility = statement.lines
      .filter((line) => line.category === 'facility' && !line.minusYn)
      .reduce((sum, line) => sum + line.total, 0);
    statement.totals.monthly = statement.lines
      .filter((line) => line.category === 'monthly' && !line.minusYn)
      .reduce((sum, line) => sum + line.total, 0);
    statement.totals.misc = statement.lines
      .filter((line) => line.category === 'misc' && !line.minusYn)
      .reduce((sum, line) => sum + line.total, 0);

    const baseTotal =
      statement.totals.cleaning + statement.totals.facility + statement.totals.monthly + statement.totals.misc;

    statement.totals.total = baseTotal + discountSum;
    statement.totals.vat = Math.round(statement.totals.total * 0.1);
    statement.totals.grandTotal = statement.totals.total + statement.totals.vat;

    statement.lines.sort((a, b) => a.date.localeCompare(b.date));
  }

    const summary = statements.map((st) => ({
      hostId: st.hostId,
      hostName: st.hostName,
      cleaning: st.totals.cleaning,
      facility: st.totals.facility,
      monthly: st.totals.monthly,
      misc: st.totals.misc,
      total: st.totals.total,
      vat: st.totals.vat,
      grandTotal: st.totals.grandTotal
    }));

    const hostOptions = filteredHosts.map((row) => ({ id: row.id, name: row.name }));

    return {
      month,
      summary,
      statements,
      hostOptions,
      appliedHostId: hostFilterId ?? null
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : '알 수 없는 오류';
    await logEtcError({
      message: `getSettlementSnapshot 실패: ${message}`,
      stacktrace: error instanceof Error ? error.stack ?? null : null,
      context: { month, hostIdParam, roles: profile.roles }
    });
    throw error;
  }
}
