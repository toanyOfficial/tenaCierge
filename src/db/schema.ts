import {
  bigint,
  boolean,
  char,
  date,
  datetime,
  decimal,
  int,
  json,
  mediumint,
  mysqlTable,
  primaryKey,
  text,
  time,
  timestamp,
  tinyint,
  varchar
} from 'drizzle-orm/mysql-core';

export const clientAdditionalPrice = mysqlTable('client_additional_price', {
  id: int('id', { unsigned: true }).autoincrement().notNull(),
  roomId: int('room_id').notNull(),
  date: date('date').notNull(),
  seq: tinyint('seq').notNull(),
  title: varchar('title', { length: 15 }).notNull(),
  price: decimal('price', { precision: 9, scale: 2 }).notNull(),
  comment: varchar('comment', { length: 255 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull()
});

export const clientCustomPrice = mysqlTable('client_custom_price', {
  id: int('id', { unsigned: true }).autoincrement().notNull(),
  roomId: int('room_id').notNull(),
  title: varchar('title', { length: 15 }).notNull(),
  pricePerCleaning: decimal('price_per_cleaning', { precision: 9, scale: 2 }).notNull(),
  pricePerMonth: decimal('price_per_month', { precision: 11, scale: 2 }).notNull(),
  startDate: date('start_date').notNull(),
  endDate: date('end_date').notNull(),
  comment: varchar('comment', { length: 255 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull()
});

export const clientDetail = mysqlTable('client_detail', {
  id: int('id', { unsigned: true }).autoincrement().notNull(),
  clientId: mediumint('client_id', { unsigned: true }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull()
});

export const clientHeader = mysqlTable('client_header', {
  id: mediumint('id', { unsigned: true }).autoincrement().notNull(),
  registerCode: varchar('register_no', { length: 6 }).notNull(),
  name: varchar('name', { length: 10 }).notNull(),
  person: varchar('person', { length: 5 }).notNull(),
  phone: varchar('phone', { length: 11 }).notNull(),
  rcptFlag: tinyint('rcpt_flag').default(1).notNull(),
  rcptNo: varchar('rcpt_no', { length: 13 }),
  rcptName: varchar('rcpt_name', { length: 20 }),
  rcptMail: varchar('rcpt_mail', { length: 255 }),
  settleFlag: tinyint('settle_flag').default(1).notNull(),
  deskYn: boolean('desk_yn').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull()
});

export const clientRooms = mysqlTable('client_rooms', {
  id: int('id', { unsigned: true }).autoincrement().notNull(),
  clientId: mediumint('client_id', { unsigned: true }).notNull(),
  buildingId: tinyint('building_id').notNull(),
  roomNo: char('room_no', { length: 5 }).notNull(),
  centralPassword: varchar('central_password', { length: 20 }),
  doorPassword: varchar('door_password', { length: 15 }).notNull(),
  startDate: date('start_date').notNull(),
  endDate: date('end_date'),
  roomCount: tinyint('room_count').default(1).notNull(),
  bedCount: tinyint('bed_count').default(1).notNull(),
  checkoutTime: time('checkout_time').notNull(),
  checkinTime: time('checkin_time').notNull(),
  facilityYn: boolean('facility_yn').default(true).notNull(),
  icalUrl1: varchar('ical_url_1', { length: 2083 }),
  icalUrl2: varchar('ical_url_2', { length: 2083 }),
  settleFlag: tinyint('settle_flag').default(1).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull()
});

export const etcBaseCode = mysqlTable(
  'etc_baseCode',
  {
    codeGroup: varchar('code_group', { length: 20 }).notNull(),
    code: varchar('code', { length: 10 }).notNull(),
    value: varchar('value', { length: 255 }).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull()
  },
  (table) => ({
    pk: primaryKey({ columns: [table.codeGroup, table.code] })
  })
);

export const etcBuildings = mysqlTable('etc_buildings', {
  id: tinyint('id', { unsigned: true }).autoincrement().notNull(),
  sectorCode: varchar('basecode_sector', { length: 10 }).notNull(),
  sectorLabel: varchar('basecode_code', { length: 255 }).notNull(),
  buildingName: varchar('building_name', { length: 20 }).notNull(),
  shortName: varchar('building_short_name', { length: 10 }).notNull(),
  addressOld: varchar('building_address_old', { length: 255 }).notNull(),
  addressNew: varchar('building_address_new', { length: 255 }).notNull(),
  buildingPassword: varchar('building_password', { length: 10 }),
  buildingRecycle: varchar('building_recycle', { length: 20 }),
  buildingGeneral: varchar('building_general', { length: 20 }),
  buildingFood: varchar('building_food', { length: 20 }),
  wayImageBasePath: varchar('building_way_img_basePath', { length: 255 }),
  wayImageRelativePath: varchar('building_way_img_relativePath', { length: 255 }),
  deleteYn: boolean('delete_yn').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull()
});

export const etcErrorLogs = mysqlTable('etc_errorLogs', {
  id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().notNull(),
  level: tinyint('level', { unsigned: true }).notNull(),
  appName: varchar('app_name', { length: 50 }).notNull(),
  errorCode: varchar('error_code', { length: 50 }),
  message: varchar('message', { length: 500 }).notNull(),
  stacktrace: text('stacktrace'),
  requestId: varchar('request_id', { length: 100 }),
  userId: bigint('user_id', { mode: 'number', unsigned: true }),
  contextJson: json('context_json'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull()
});

export const etcNotice = mysqlTable('etc_notice', {
  id: int('id', { unsigned: true }).autoincrement().notNull(),
  noticeDate: date('notice_date').notNull(),
  notice: varchar('notice', { length: 255 }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull()
});

export const workApply = mysqlTable('work_apply', {
  id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().notNull(),
  workDate: date('work_date').notNull(),
  sectorCode: varchar('basecode_sector', { length: 10 }).notNull(),
  sectorValue: varchar('basecode_code', { length: 255 }).notNull(),
  seq: tinyint('seq').notNull(),
  position: tinyint('position').notNull(),
  workerId: int('worker_id', { unsigned: true }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull()
});

export const workCheckList = mysqlTable('work_checkList', {
  id: int('id', { unsigned: true }).autoincrement().notNull(),
  type: tinyint('type').notNull(),
  generalYn: boolean('general_yn').notNull(),
  buildingId: tinyint('building_id'),
  seq: tinyint('seq').notNull(),
  title: varchar('title', { length: 20 }).notNull(),
  score: tinyint('score').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull()
});

export const workForeAccuracy = mysqlTable('work_fore_accuracy', {
  id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().notNull(),
  date: date('date').notNull(),
  horizon: char('horizon', { length: 3 }).notNull(),
  acc: decimal('acc', { precision: 5, scale: 4 }).notNull(),
  prec: decimal('prec', { precision: 5, scale: 4 }).notNull(),
  rec: decimal('rec', { precision: 5, scale: 4 }).notNull(),
  f1: decimal('f1', { precision: 5, scale: 4 }).notNull(),
  n: tinyint('n').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull()
});

export const workForeD1 = mysqlTable('work_fore_d1', {
  id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().notNull(),
  runDate: date('run_dttm').notNull(),
  targetDate: date('target_date').notNull(),
  roomId: int('room_id').notNull(),
  pOut: decimal('p_out', { precision: 4, scale: 3 }).notNull(),
  actualOut: boolean('actual_out').notNull(),
  correct: boolean('correct').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull()
});

export const workForeD7 = mysqlTable('work_fore_d7', {
  id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().notNull(),
  runDate: date('run_dttm').notNull(),
  targetDate: date('target_date').notNull(),
  roomId: int('room_id').notNull(),
  pOut: decimal('p_out', { precision: 4, scale: 3 }).notNull(),
  actualOut: boolean('actual_out').notNull(),
  correct: boolean('correct').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull()
});

export const workForeTuning = mysqlTable('work_fore_tuning', {
  id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().notNull(),
  date: date('date').notNull(),
  horizon: char('horizon', { length: 3 }).notNull(),
  variable: varchar('variable', { length: 15 }).notNull(),
  before: decimal('before', { precision: 5, scale: 4 }).notNull(),
  after: decimal('after', { precision: 5, scale: 4 }).notNull(),
  delta: decimal('delta', { precision: 10, scale: 6 }).notNull(),
  explanation: varchar('explanation', { length: 50 }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull()
});

export const workForeVariable = mysqlTable('work_fore_variable', {
  id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().notNull(),
  name: varchar('name', { length: 15 }).notNull(),
  value: decimal('value', { precision: 5, scale: 4 }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull()
});

export const workHeader = mysqlTable('work_header', {
  id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().notNull(),
  date: date('date').notNull(),
  roomId: int('room_id').notNull(),
  cleanerId: int('cleaner_id'),
  butlerId: int('butler_id'),
  amenitiesQty: tinyint('amenities_qty').notNull(),
  blanketQty: tinyint('blanket_qty').notNull(),
  conditionCheckYn: boolean('conditionCheckYn').default(false).notNull(),
  cleaningYn: boolean('cleaning_yn').default(true).notNull(),
  checkinTime: time('checkin_time').notNull(),
  checkoutTime: time('ceckout_time').notNull(),
  supplyYn: boolean('supply_yn').default(true).notNull(),
  cancelYn: boolean('cancel_yn').default(false).notNull(),
  requirements: varchar('requirements', { length: 255 }),
  cleaningFlag: tinyint('clening_flag').default(1).notNull(),
  cleaningEndTime: time('cleaning_end_time'),
  supervisingEndTime: time('supervising_end_time'),
  requirements: varchar('requirements', { length: 30 }),
  cancelYn: boolean('cancel_yn').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull()
});

export const workReports = mysqlTable('work_reports', {
  id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().notNull(),
  workId: bigint('work_id', { mode: 'number' }).notNull(),
  type: tinyint('type').notNull(),
  contents1: json('contents1').notNull(),
  contents2: json('contents2'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull()
});

export const workerDetail = mysqlTable('worker_detail', {
  id: int('id', { unsigned: true }).autoincrement().notNull(),
  workerId: bigint('worker_id', { mode: 'number', unsigned: true }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull()
});

export const workerEvaluateHistory = mysqlTable('worker_evaluateHistory', {
  id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().notNull(),
  workerId: int('worker_id', { unsigned: true }).notNull(),
  evaluatedAt: datetime('evaluate_dttm').notNull(),
  workId: bigint('work_id', { mode: 'number' }).notNull(),
  checklistTitleArray: json('checklist_title_array').notNull(),
  checklistPointSum: tinyint('checklist_point_sum').notNull(),
  comment: varchar('comment', { length: 255 }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull()
});

export const workerHeader = mysqlTable('worker_header', {
  id: int('id', { unsigned: true }).autoincrement().notNull(),
  registerCode: varchar('register_no', { length: 6 }).notNull(),
  name: varchar('name', { length: 20 }).notNull(),
  phone: varchar('phone', { length: 11 }),
  registrationNo: char('reg_no', { length: 13 }),
  bankCode: varchar('basecode_bank', { length: 10 }),
  bankValue: varchar('basecode_code', { length: 255 }),
  accountNo: varchar('account_no', { length: 50 }),
  tier: tinyint('tier').notNull(),
  comments: varchar('comments', { length: 255 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull()
});

export const workerPenaltyHistory = mysqlTable('worker_penaltyHistory', {
  id: int('id', { unsigned: true }).autoincrement().notNull(),
  workerId: int('worker_id', { unsigned: true }).notNull(),
  startDate: date('start_date').notNull(),
  interval: tinyint('interval').notNull(),
  comment: varchar('comment', { length: 255 }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull()
});
