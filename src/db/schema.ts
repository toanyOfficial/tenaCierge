import { mysqlTable, int, mediumint, varchar, timestamp, tinyint, boolean, time, date, bigint } from 'drizzle-orm/mysql-core';

export const clientHeader = mysqlTable('client_header', {
  id: mediumint('id').unsigned().autoincrement().notNull(),
  key: varchar('key', { length: 6 }).notNull(),
  name: varchar('name', { length: 10 }).notNull(),
  person: varchar('person', { length: 5 }).notNull(),
  phone: varchar('phone', { length: 11 }).notNull(),
  rcptFlag: tinyint('rcpt_flag').default(1).notNull(),
  rcptNo: varchar('rcpt_no', { length: 13 }).notNull(),
  rcptName: varchar('rcpt_name', { length: 20 }).notNull(),
  rcptMail: varchar('rcpt_mail', { length: 255 }).notNull(),
  settleFlag: tinyint('settle_flag').default(1).notNull(),
  deskYn: boolean('desk_yn').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull()
});

export const clientRooms = mysqlTable('client_rooms', {
  id: int('id').unsigned().autoincrement().notNull(),
  clientId: mediumint('client_id').unsigned().notNull(),
  buildingId: tinyint('building_id').notNull(),
  roomNo: varchar('room_no', { length: 4 }).notNull(),
  centralPassword: varchar('central_password', { length: 20 }),
  doorPassword: varchar('door_password', { length: 10 }).notNull(),
  startDate: date('start_date').notNull(),
  endDate: date('end_date'),
  roomCount: tinyint('room_count').default(1).notNull(),
  bedCount: tinyint('bed_count').default(1).notNull(),
  checkoutTime: time('checkout_time').notNull(),
  checkinTime: time('checkin_time').notNull(),
  facilityYn: boolean('facility_yn').default(true).notNull(),
  settleFlag: tinyint('settle_flag').default(1).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull()
});

export const workHeader = mysqlTable('work_header', {
  id: bigint('id', { mode: 'number' }).autoincrement().notNull(),
  date: date('date').notNull(),
  room: int('room').notNull(),
  cleanerId: int('cleaner_id'),
  butlerId: int('butler_id'),
  amenitiesQty: tinyint('amenities_qty').notNull(),
  blanketQty: tinyint('blanket_qty').notNull(),
  conditionCheckYn: boolean('conditionCheckYn').default(false).notNull(),
  cleaningYn: boolean('cleaning_yn').default(true).notNull(),
  checkinTime: time('checkin_time').notNull(),
  checkoutTime: time('ceckout_time').notNull(),
  supplyYn: boolean('supply_yn').default(true).notNull(),
  cleaningFlag: tinyint('clening_flag').default(1).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull()
});
