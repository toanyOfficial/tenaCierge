import { and, asc, eq } from 'drizzle-orm';

import { db } from '@/src/db/client';
import { clientHeader, clientRooms, clientSupplements, etcBuildings } from '@/src/db/schema';
import type { ClientSummary } from '@/src/server/clients';
import { findClientByProfile } from '@/src/server/clients';
import type { ProfileSummary } from '@/src/utils/profile';
import { formatDateKey } from '@/src/utils/workWindow';

export type SupplyItem = {
  id: number;
  dateLabel: string;
  nextDateLabel: string | null;
  title: string;
  description: string | null;
  buyYn: boolean;
  buildingShortName: string;
  roomNo: string;
};

export type SupplyRoom = {
  roomNo: string;
  buildingShortName: string;
  items: SupplyItem[];
};

export type SupplyBuilding = {
  shortName: string;
  rooms: SupplyRoom[];
};

export type SupplyHostGroup = {
  hostId: number;
  hostName: string;
  buildings: SupplyBuilding[];
};

export type SuppliesSnapshot = {
  groups: SupplyHostGroup[];
};

function normalizeDateLabel(value: Date | string | null): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(`${value}T00:00:00.000Z`);
  return formatDateKey(date);
}

function groupRows(rows: Array<ReturnType<typeof mapRow>>): SupplyHostGroup[] {
  const hostMap = new Map<number, SupplyHostGroup>();

  rows.forEach((row) => {
    const hostGroup = hostMap.get(row.hostId) ?? {
      hostId: row.hostId,
      hostName: row.hostName,
      buildings: [] as SupplyBuilding[]
    };

    if (!hostMap.has(row.hostId)) {
      hostMap.set(row.hostId, hostGroup);
    }

    const buildingKey = `${row.hostId}-${row.buildingShortName}`;
    let building = hostGroup.buildings.find((b) => `${row.hostId}-${b.shortName}` === buildingKey);
    if (!building) {
      building = { shortName: row.buildingShortName, rooms: [] };
      hostGroup.buildings.push(building);
    }

    const roomKey = `${buildingKey}-${row.roomNo}`;
    let room = building.rooms.find((r) => `${row.hostId}-${building?.shortName}-${r.roomNo}` === roomKey);
    if (!room) {
      room = { roomNo: row.roomNo, buildingShortName: row.buildingShortName, items: [] };
      building.rooms.push(room);
    }

    room.items.push({
      id: row.id,
      dateLabel: row.dateLabel,
      nextDateLabel: row.nextDateLabel,
      title: row.title,
      description: row.description,
      buyYn: row.buyYn,
      buildingShortName: row.buildingShortName,
      roomNo: row.roomNo
    });
  });

  return Array.from(hostMap.values());
}

type SupplyRow = {
  id: number;
  hostId: number;
  hostName: string;
  buildingShortName: string;
  roomNo: string;
  date: Date | string;
  nextDate: Date | string | null;
  title: string;
  description: string | null;
  buyYn: boolean | number | null;
};

function mapRow(row: SupplyRow) {
  return {
    id: Number(row.id),
    hostId: Number(row.hostId),
    hostName: row.hostName,
    buildingShortName: row.buildingShortName,
    roomNo: row.roomNo,
    dateLabel: normalizeDateLabel(row.date) ?? '',
    nextDateLabel: normalizeDateLabel(row.nextDate),
    title: row.title,
    description: row.description,
    buyYn: row.buyYn === true || row.buyYn === 1
  } as const;
}

export async function getSuppliesSnapshot(profile: ProfileSummary): Promise<SuppliesSnapshot> {
  const isAdmin = profile.roles.includes('admin');
  const isHost = profile.roles.includes('host');

  let client: ClientSummary | null = null;

  if (!isAdmin && isHost) {
    client = await findClientByProfile(profile);

    if (!client) {
      return { groups: [] };
    }
  }

  const conditions = [eq(clientSupplements.bunYn, false)];

  if (client) {
    conditions.push(eq(clientHeader.id, client.id));
  }

  const whereClause = conditions.length === 1 ? conditions[0] : and(...conditions);

  const rows = await db
    .select({
      id: clientSupplements.id,
      hostId: clientHeader.id,
      hostName: clientHeader.name,
      buildingShortName: etcBuildings.shortName,
      roomNo: clientRooms.roomNo,
      date: clientSupplements.date,
      nextDate: clientSupplements.nextDate,
      title: clientSupplements.title,
      description: clientSupplements.dscpt,
      buyYn: clientSupplements.buyYn
    })
    .from(clientSupplements)
    .innerJoin(clientRooms, eq(clientRooms.id, clientSupplements.roomId))
    .innerJoin(clientHeader, eq(clientHeader.id, clientSupplements.clientId))
    .innerJoin(etcBuildings, eq(etcBuildings.id, clientRooms.buildingId))
    .where(whereClause)
    .orderBy(
      asc(clientHeader.name),
      asc(etcBuildings.shortName),
      asc(clientRooms.roomNo),
      asc(clientSupplements.date)
    );

  const mapped = rows.map(mapRow);

  return { groups: groupRows(mapped) };
}
