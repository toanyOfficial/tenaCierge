import { and, asc, desc, eq, gte, inArray, lte, or, sql } from 'drizzle-orm';

import { db } from '@/src/db/client';
import {
  clientAdditionalPrice,
  clientCustomPrice,
  clientHeader,
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
  amount: Money;
  quantity: number;
  total: Money;
  category: 'cleaning' | 'facility' | 'monthly' | 'misc';
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
  };
};

export type SettlementSnapshot = {
  month: string;
  summary: (SettlementStatement['totals'] & { hostId: number; hostName: string })[];
  statements: SettlementStatement[];
  hostOptions: { id: number; name: string }[];
  appliedHostId: number | null;
};

type RateBundle = {
  cleaningRate: Money;
  amenityRate: Money;
  monthlyRate: Money;
  bedRentalRate: Money;
  latePerMinute: Money;
  earlyPerMinute: Money;
};

function normalizeRegisterNo(value: string | undefined | null) {
  if (!value) return '';
  return value.replace(/[^0-9]/g, '').slice(0, 6);
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

function pickRateBundle(prices: { title: string; pricePerCleaning: number; pricePerMonth: number }[]): RateBundle {
  const result: RateBundle = {
    cleaningRate: 0,
    amenityRate: 0,
    monthlyRate: 0,
    bedRentalRate: 0,
    latePerMinute: 0,
    earlyPerMinute: 0
  };

  for (const row of prices) {
    const title = row.title.toLowerCase();
    const cleaningCandidate = row.pricePerCleaning ?? 0;
    const monthlyCandidate = row.pricePerMonth ?? 0;

    if (title.includes('체크아웃')) {
      result.latePerMinute = cleaningCandidate || monthlyCandidate || result.latePerMinute;
    }

    if (title.includes('체크인')) {
      result.earlyPerMinute = cleaningCandidate || monthlyCandidate || result.earlyPerMinute;
    }

    if (title.includes('어메니티')) {
      result.amenityRate = cleaningCandidate || monthlyCandidate || result.amenityRate;
    }

    if (title.includes('침구') || title.includes('매트리스')) {
      result.bedRentalRate = monthlyCandidate || cleaningCandidate || result.bedRentalRate;
    }

    if (title.includes('청소')) {
      result.cleaningRate = cleaningCandidate || result.cleaningRate;
    }

    if (!result.monthlyRate && monthlyCandidate) {
      result.monthlyRate = monthlyCandidate;
    }

    if (!result.cleaningRate && cleaningCandidate) {
      result.cleaningRate = cleaningCandidate;
    }
  }

  return result;
}

async function resolveAdditionalPriceColumn(month: string, hostId?: number | null) {
  try {
    const raw = await db.execute<{ column_name?: string; COLUMN_NAME?: string }>(
      sql`SELECT column_name FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'client_additional_price'`
    );

    const rows = Array.isArray(raw)
      ? (Array.isArray(raw[0]) ? (raw[0] as typeof raw) : raw)
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

function toMinutes(time: string | null | undefined) {
  if (!time) return 0;
  const [h, m, s] = time.split(':').map((v) => Number(v));
  return (h || 0) * 60 + (m || 0) + (s || 0) / 60;
}

function addLine(
  lines: SettlementLine[],
  line: Omit<SettlementLine, 'id' | 'total'> & { id?: string }
) {
  const total = line.amount * line.quantity;
  lines.push({ ...line, total, id: line.id ?? `${line.date}-${line.item}-${lines.length}` });
}

async function loadCustomPrices(
  roomIds: number[],
  start: Date,
  end: Date,
  month: string,
  hostId?: number
) {
  try {
    return await db
      .select({
        roomId: clientCustomPrice.roomId,
        title: clientCustomPrice.title,
        pricePerCleaning: sql`CAST(${clientCustomPrice.pricePerCleaning} AS DECIMAL(20,4))`,
        pricePerMonth: sql`CAST(${clientCustomPrice.pricePerMonth} AS DECIMAL(20,4))`,
        start: clientCustomPrice.startDate,
        end: clientCustomPrice.endDate
      })
      .from(clientCustomPrice)
      .where(
        and(
          inArray(clientCustomPrice.roomId, roomIds),
          lte(clientCustomPrice.startDate, end),
          gte(clientCustomPrice.endDate, start)
        )
      );
  } catch (error) {
    const message = error instanceof Error ? error.message : '알 수 없는 오류';
    const isMissingTable = message.includes("doesn't exist") || message.includes('does not exist');

    if (isMissingTable) {
      await logEtcError({
        message: `client_custom_price 누락으로 커스텀 요금을 생략합니다: ${message}`,
        stacktrace: error instanceof Error ? error.stack ?? null : null,
        context: { month, hostId: hostId ?? null, table: 'client_custom_price' }
      });
      return [];
    }

    throw error;
  }
}

export async function getSettlementSnapshot(
  profile: ProfileSummary,
  monthParam?: string | null,
  hostIdParam?: string | null
): Promise<SettlementSnapshot> {
  const month = ensureMonth(monthParam);
  try {
    const { start, end } = getMonthBoundary(month);
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
        expectedCheckout: clientRooms.checkoutTime,
        expectedCheckin: clientRooms.checkinTime
      })
      .from(clientRooms)
      .innerJoin(etcBuildings, eq(clientRooms.buildingId, etcBuildings.id))
      .where(inArray(clientRooms.clientId, hostIds));

    const roomIds = roomRows.map((row) => row.roomId);

    const priceRows = roomIds.length
      ? await loadCustomPrices(roomIds, start, end, month, hostFilterId ?? undefined)
      : [];

    if (roomIds.length && priceRows.length < roomIds.length) {
      const pricedRoomIds = new Set(priceRows.map((row) => row.roomId));
      const missingRoomIds = roomIds.filter((id) => !pricedRoomIds.has(id));

      if (missingRoomIds.length) {
        const fallbackRows = await db
          .select({
            roomId: clientCustomPrice.roomId,
            title: clientCustomPrice.title,
            pricePerCleaning: sql`CAST(${clientCustomPrice.pricePerCleaning} AS DECIMAL(20,4))`,
            pricePerMonth: sql`CAST(${clientCustomPrice.pricePerMonth} AS DECIMAL(20,4))`,
            start: clientCustomPrice.startDate,
            end: clientCustomPrice.endDate
          })
          .from(clientCustomPrice)
          .where(inArray(clientCustomPrice.roomId, missingRoomIds))
          .orderBy(desc(clientCustomPrice.endDate));

        const seen = new Set<number>();

        for (const row of fallbackRows) {
          if (seen.has(row.roomId)) continue;
          priceRows.push(row);
          seen.add(row.roomId);
        }

        const stillMissing = roomIds.filter((id) => !priceRows.some((row) => row.roomId === id));

        if (stillMissing.length) {
          await logEtcError({
            message: '정산용 요금이 설정되지 않은 객실이 있습니다.',
            stacktrace: null,
            context: { month, hostId: hostFilterId ?? null, roomIds: stillMissing }
          });
        }
      }
    }

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
    roomRows.map((row) => [
      row.roomId,
      {
        hostId: row.hostId,
        bedCount: row.bedCount,
        label: `${row.buildingShort}${row.roomNo}`,
        expectedCheckout: row.expectedCheckout,
        expectedCheckin: row.expectedCheckin
      }
    ])
  );

  const priceMap = new Map<number, RateBundle>();

  for (const roomId of roomIds) {
    const prices = priceRows
      .filter((row) => row.roomId === roomId)
      .sort((a, b) => {
        const aTime = a.start ? new Date(a.start).getTime() : 0;
        const bTime = b.start ? new Date(b.start).getTime() : 0;
        return bTime - aTime;
      });

    const rateBundle = pickRateBundle(
      prices.map((row) => ({
        title: row.title,
        pricePerCleaning: Number(row.pricePerCleaning ?? 0),
        pricePerMonth: Number(row.pricePerMonth ?? 0)
      }))
    );

    priceMap.set(roomId, rateBundle);
  }

  const statements: SettlementStatement[] = hostRows.map((host) => ({
    hostId: host.id,
    hostName: host.name,
    lines: [],
    totals: { cleaning: 0, facility: 0, monthly: 0, misc: 0, total: 0 }
  }));

  const statementMap = new Map(statements.map((st) => [st.hostId, st]));

  // Per-work items
  for (const work of workRows) {
    const room = roomMap.get(work.roomId);
    const rate = priceMap.get(work.roomId) ?? {
      cleaningRate: 0,
      amenityRate: 0,
      monthlyRate: 0,
      bedRentalRate: 0,
      latePerMinute: 0,
      earlyPerMinute: 0
    };

    const hostStatement = room ? statementMap.get(room.hostId) : undefined;
    if (!room || !hostStatement) continue;

    const date = work.workDate instanceof Date ? work.workDate.toISOString().slice(0, 10) : String(work.workDate);

    if (rate.cleaningRate) {
      addLine(hostStatement.lines, {
        date,
        item: `${room.label} 청소비`,
        amount: rate.cleaningRate,
        quantity: 1,
        category: 'cleaning'
      });
      hostStatement.totals.cleaning += rate.cleaningRate;
    }

    if (rate.amenityRate) {
      const qty = room.bedCount ?? 1;
      const total = rate.amenityRate * qty;
      addLine(hostStatement.lines, {
        date,
        item: `${room.label} 기본 어메니티`,
        amount: rate.amenityRate,
        quantity: qty,
        category: 'facility'
      });
      hostStatement.totals.facility += total;
    }

    const expectedOut = toMinutes(room.expectedCheckout);
    const actualOut = toMinutes(work.actualCheckout);
    const lateMinutes = Math.max(0, actualOut - expectedOut);

    if (rate.latePerMinute && lateMinutes > 0) {
      const total = rate.latePerMinute * lateMinutes;
      addLine(hostStatement.lines, {
        date,
        item: `${room.label} 레이트체크아웃`,
        amount: rate.latePerMinute,
        quantity: lateMinutes,
        category: 'facility'
      });
      hostStatement.totals.facility += total;
    }

    const expectedIn = toMinutes(room.expectedCheckin);
    const actualIn = toMinutes(work.actualCheckin);
    const earlyMinutes = Math.max(0, expectedIn - actualIn);

    if (rate.earlyPerMinute && earlyMinutes > 0) {
      const total = rate.earlyPerMinute * earlyMinutes;
      addLine(hostStatement.lines, {
        date,
        item: `${room.label} 얼리체크인`,
        amount: rate.earlyPerMinute,
        quantity: earlyMinutes,
        category: 'facility'
      });
      hostStatement.totals.facility += total;
    }

    // Blanket rental by month later via monthly block
  }

  // Monthly items per room
  for (const room of roomRows) {
    const roomInfo = roomMap.get(room.roomId);
    const hostStatement = roomInfo ? statementMap.get(roomInfo.hostId) : undefined;
    const rate = priceMap.get(room.roomId);

    if (!hostStatement || !rate || !roomInfo) continue;

    const monthDate = `${month}-01`;

    if (rate.monthlyRate) {
      addLine(hostStatement.lines, {
        date: monthDate,
        item: `${roomInfo.label} 월정액`,
        amount: rate.monthlyRate,
        quantity: 1,
        category: 'monthly'
      });
      hostStatement.totals.monthly += rate.monthlyRate;
    }

    if (rate.bedRentalRate) {
      const qty = roomInfo.bedCount ?? 1;
      const total = rate.bedRentalRate * qty;
      addLine(hostStatement.lines, {
        date: monthDate,
        item: `${roomInfo.label} 침구/매트리스 렌탈`,
        amount: rate.bedRentalRate,
        quantity: qty,
        category: 'monthly'
      });
      hostStatement.totals.monthly += total;
    }
  }

  // Additional prices
  for (const extra of additionalRows) {
    const hostStatement = statementMap.get(extra.hostId);
    const room = roomMap.get(extra.roomId);
    if (!hostStatement || !room) continue;
    const date = extra.date.toISOString().slice(0, 10);
    const price = Number(extra.price ?? 0);

    addLine(hostStatement.lines, {
      date,
      item: `${room.label} ${extra.title}`,
      amount: price,
      quantity: 1,
      category: 'misc'
    });
    hostStatement.totals.misc += price;
  }

  for (const statement of statements) {
    statement.totals.total =
      statement.totals.cleaning + statement.totals.facility + statement.totals.monthly + statement.totals.misc;

    statement.lines.sort((a, b) => a.date.localeCompare(b.date));
  }

    const summary = statements.map((st) => ({
      hostId: st.hostId,
      hostName: st.hostName,
      cleaning: st.totals.cleaning,
      facility: st.totals.facility,
      monthly: st.totals.monthly,
      misc: st.totals.misc,
      total: st.totals.total
    }));

    const hostOptions = hostRows.map((row) => ({ id: row.id, name: row.name }));

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
