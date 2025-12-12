import {
  bigint,
  boolean,
  char,
  date,
  datetime,
  double,
  decimal,
  smallint,
  int,
  json,
  mediumint,
  mysqlTable,
  primaryKey,
  text,
  time,
  timestamp,
  tinyint,
  varchar,
  uniqueIndex
} from 'drizzle-orm/mysql-core';

const bigintNumber = (name: string, config?: { unsigned?: boolean }) =>
  bigint(name, { mode: 'number', ...(config ?? {}) });

export const clientAdditionalPrice = mysqlTable('client_additional_price', {
  id: int('id', { unsigned: true }).autoincrement().notNull(),
  roomId: int('room_id').notNull(),
  date: date('date').notNull(),
  seq: tinyint('seq').notNull(),
  title: varchar('title', { length: 15 }).notNull(),
  price: decimal('price', { precision: 9, scale: 2 }).notNull(),
  comment: varchar('comment', { length: 255 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull(),
  createdBy: varchar('created_by', { length: 50 }),
  updatedBy: varchar('updated_by', { length: 50 })
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
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull(),
  createdBy: varchar('created_by', { length: 50 }),
  updatedBy: varchar('updated_by', { length: 50 })
});

export const clientDetail = mysqlTable('client_detail', {
  id: int('id', { unsigned: true }).autoincrement().notNull(),
  clientId: mediumint('client_id', { unsigned: true }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull(),
  createdBy: varchar('created_by', { length: 50 }),
  updatedBy: varchar('updated_by', { length: 50 })
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
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull(),
  createdBy: varchar('created_by', { length: 50 }),
  updatedBy: varchar('updated_by', { length: 50 })
});

export const clientRooms = mysqlTable('client_rooms', {
  id: int('id', { unsigned: true }).autoincrement().notNull(),
  clientId: mediumint('client_id', { unsigned: true }).notNull(),
  buildingId: tinyint('building_id').notNull(),
  roomNo: char('room_no', { length: 5 }).notNull(),
  priceSetId: int('price_set_id'),
  centralPassword: varchar('central_password', { length: 20 }),
  doorPassword: varchar('door_password', { length: 15 }).notNull(),
  startDate: date('start_date').notNull(),
  endDate: date('end_date'),
  openYn: boolean('open_yn').default(false).notNull(),
  roomCount: tinyint('room_count').default(1).notNull(),
  bedCount: tinyint('bed_count').default(1).notNull(),
  checkoutTime: time('checkout_time').notNull(),
  checkinTime: time('checkin_time').notNull(),
  facilityYn: boolean('facility_yn').default(true).notNull(),
  icalUrl1: varchar('ical_url_1', { length: 2083 }),
  icalUrl2: varchar('ical_url_2', { length: 2083 }),
  checklistSetId: int('checklist_set_id'),
  imagesSetId: int('images_set_id').notNull(),
  realtimeOverviewYn: boolean('realtime_overview_yn').default(false).notNull(),
  imagesYn: boolean('images_yn').default(false).notNull(),
  settleFlag: tinyint('settle_flag').default(1).notNull(),
  weight: tinyint('weight').default(10).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull(),
  createdBy: varchar('created_by', { length: 50 }),
  updatedBy: varchar('updated_by', { length: 50 })
});

export const clientPriceSetHeader = mysqlTable('client_price_set_header', {
  id: int('id', { unsigned: true }).autoincrement().notNull(),
  title: varchar('title', { length: 30 }),
  description: varchar('dscpt', { length: 255 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull(),
  createdBy: varchar('created_by', { length: 50 }),
  updatedBy: varchar('updated_by', { length: 50 })
});

export const clientPriceList = mysqlTable('client_price_list', {
  id: int('id', { unsigned: true }).autoincrement().notNull(),
  title: varchar('title', { length: 30 }),
  amount: decimal('amount', { precision: 11, scale: 2 }).notNull(),
  type: tinyint('type').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull(),
  createdBy: varchar('created_by', { length: 50 }),
  updatedBy: varchar('updated_by', { length: 50 })
});

export const clientPriceSetDetail = mysqlTable('client_price_set_detail', {
  id: int('id', { unsigned: true }).autoincrement().notNull(),
  priceSetId: int('price_set_id').notNull(),
  priceId: int('price_id').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull(),
  createdBy: varchar('created_by', { length: 50 }),
  updatedBy: varchar('updated_by', { length: 50 })
});

export const clientSupplements = mysqlTable('client_supplements', {
  id: bigintNumber('id', { unsigned: true }).autoincrement().notNull(),
  roomId: int('room_id').notNull(),
  date: date('date').notNull(),
  nextDate: date('next_date'),
  title: varchar('title', { length: 255 }).notNull(),
  dscpt: varchar('dscpt', { length: 255 }),
  buyYn: boolean('buy_yn').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull(),
  createdBy: varchar('created_by', { length: 50 }),
  updatedBy: varchar('updated_by', { length: 50 })
});

export const etcBaseCode = mysqlTable(
  'etc_baseCode',
  {
    codeGroup: varchar('code_group', { length: 20 }).notNull(),
    code: varchar('code', { length: 10 }).notNull(),
    value: varchar('value', { length: 255 }).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull(),
    createdBy: varchar('created_by', { length: 50 }),
    updatedBy: varchar('updated_by', { length: 50 })
  },
  (table) => ({ pk: primaryKey({ columns: [table.codeGroup, table.code] }) })
);

export const etcBuildings = mysqlTable('etc_buildings', {
  id: tinyint('id', { unsigned: true }).autoincrement().notNull(),
  sectorCode: varchar('basecode_sector', { length: 10 }).notNull(),
  sectorValue: varchar('basecode_code', { length: 255 }).notNull(),
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
  deleteYn: boolean('delete_yn').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull(),
  createdBy: varchar('created_by', { length: 50 }),
  updatedBy: varchar('updated_by', { length: 50 })
});

export const etcErrorLogs = mysqlTable('etc_errorLogs', {
  id: bigintNumber('id', { unsigned: true }).autoincrement().notNull(),
  level: tinyint('level', { unsigned: true }).notNull(),
  appName: varchar('app_name', { length: 50 }).notNull(),
  errorCode: varchar('error_code', { length: 50 }),
  message: varchar('message', { length: 500 }).notNull(),
  stacktrace: text('stacktrace'),
  requestId: varchar('request_id', { length: 100 }),
  userId: bigintNumber('user_id', { unsigned: true }),
  contextJson: json('context_json'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull(),
  createdBy: varchar('created_by', { length: 50 }),
  updatedBy: varchar('updated_by', { length: 50 })
});

export const etcNotice = mysqlTable('etc_notice', {
  id: int('id', { unsigned: true }).autoincrement().notNull(),
  noticeDate: date('notice_date').notNull(),
  notice: varchar('notice', { length: 255 }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull(),
  createdBy: varchar('created_by', { length: 50 }),
  updatedBy: varchar('updated_by', { length: 50 })
});

export const workApply = mysqlTable(
  'work_apply',
  {
    id: bigintNumber('id', { unsigned: true }).autoincrement().notNull(),
    workDate: date('work_date').notNull(),
    sectorCode: varchar('basecode_sector', { length: 10 }).notNull(),
    sectorValue: varchar('basecode_code', { length: 255 }).notNull(),
    seq: tinyint('seq').notNull(),
    position: tinyint('position').notNull(),
    workerId: int('worker_id'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull(),
    createdBy: varchar('created_by', { length: 50 }),
    updatedBy: varchar('updated_by', { length: 50 })
  },
  (table) => ({ workApplyUniq: uniqueIndex('ux_work_apply').on(table.workDate, table.workerId) })
);

export const workApplyRules = mysqlTable('work_apply_rules', {
  id: bigintNumber('id', { unsigned: true }).autoincrement().notNull(),
  minWeight: smallint('min_weight').notNull(),
  maxWeight: smallint('max_weight'),
  cleanerCount: tinyint('cleaner_count').notNull(),
  butlerCount: tinyint('butler_count').notNull(),
  levelFlag: tinyint('level_flag').default(1).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull()
});

export const workerTierRules = mysqlTable('worker_tier_rules', {
  id: int('id', { unsigned: true }).autoincrement().notNull(),
  minPercentage: tinyint('min_percentage', { unsigned: true }).notNull(),
  maxPercentage: tinyint('max_percentage').notNull(),
  tier: tinyint('tier').notNull(),
  hourlyWage: smallint('hourly_wage'),
  applyStartTime: time('apply_start_time'),
  applyHorizon: tinyint('apply_horizon').default(0),
  comment: varchar('comment', { length: 100 }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull()
});

export const workChecklistList = mysqlTable('work_checklist_list', {
  id: tinyint('id', { unsigned: true }).autoincrement().notNull(),
  type: tinyint('type').notNull(),
  title: varchar('title', { length: 20 }).notNull(),
  ordering: tinyint('ordering'),
  score: tinyint('score').notNull(),
  description: varchar('dscpt', { length: 50 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull()
});

export const workChecklistSetDetail = mysqlTable('work_checklist_set_detail', {
  id: int('id', { unsigned: true }).autoincrement().notNull(),
  checklistListId: tinyint('checklist_list_id', { unsigned: true }).notNull(),
  checklistHeaderId: int('checklist_header_id', { unsigned: true }).notNull(),
  ordering: tinyint('ordering'),
  title: varchar('title', { length: 20 }),
  description: varchar('dscpt', { length: 50 }),
  score: tinyint('score').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull()
});

export const workChecklistSetHeader = mysqlTable('work_checklist_set_header', {
  id: int('id', { unsigned: true }).autoincrement().notNull(),
  title: varchar('title', { length: 15 }).notNull(),
  description: varchar('dscpt', { length: 50 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull()
});

export const workImagesList = mysqlTable('work_images_list', {
  id: tinyint('id', { unsigned: true }).autoincrement().notNull(),
  role: tinyint('role', { unsigned: true }).notNull(),
  title: varchar('title', { length: 15 }).notNull(),
  ordering: tinyint('ordering'),
  comment: varchar('comment', { length: 50 }),
  required: boolean('required').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull()
});

export const workImagesSetHeader = mysqlTable('work_images_set_header', {
  id: int('id', { unsigned: true }).autoincrement().notNull(),
  title: varchar('title', { length: 15 }).notNull(),
  description: varchar('dscpt', { length: 50 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull()
});

export const workImagesSetDetail = mysqlTable('work_images_set_detail', {
  id: int('id', { unsigned: true }).autoincrement().notNull(),
  imagesSetId: int('images_set_id', { unsigned: true }).notNull(),
  imagesListId: tinyint('images_list_id', { unsigned: true }).notNull(),
  ordering: tinyint('ordering'),
  required: boolean('required').notNull(),
  title: varchar('title', { length: 15 }),
  comment: varchar('comment', { length: 50 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull()
});

export const workForeAccuracy = mysqlTable('work_fore_accuracy', {
  id: bigintNumber('id', { unsigned: true }).autoincrement().notNull(),
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
  id: bigintNumber('id', { unsigned: true }).autoincrement().notNull(),
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
  id: bigintNumber('id', { unsigned: true }).autoincrement().notNull(),
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
  id: bigintNumber('id', { unsigned: true }).autoincrement().notNull(),
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
  id: bigintNumber('id', { unsigned: true }).autoincrement().notNull(),
  name: varchar('name', { length: 15 }).notNull(),
  value: decimal('value', { precision: 5, scale: 4 }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull()
});

export const workGlobalHeader = mysqlTable('work_global_header', {
  id: tinyint('id', { unsigned: true }).autoincrement().notNull(),
  emoji: varchar('emoji', { length: 10 }),
  title: varchar('title', { length: 20 }).notNull(),
  dscpt: varchar('dscpt', { length: 50 }).notNull(),
  startDate: date('start_date').notNull(),
  endDate: date('end_date'),
  remainQty: tinyint('remain_qty').notNull(),
  closedYn: boolean('closed_yn').default(false).notNull(),
  comment: varchar('comment', { length: 255 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull(),
  createdBy: varchar('created_by', { length: 50 }),
  updatedBy: varchar('updated_by', { length: 50 })
});

export const workGlobalDetail = mysqlTable('work_global_detail', {
  id: bigintNumber('id', { unsigned: true }).autoincrement().notNull(),
  workGlobalId: tinyint('work_global_id', { unsigned: true }).notNull(),
  roomId: int('room_id').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull(),
  createdBy: varchar('created_by', { length: 50 }),
  updatedBy: varchar('updated_by', { length: 50 })
});

export const workReservation = mysqlTable('work_reservation', {
  id: bigintNumber('id', { unsigned: true }).autoincrement().notNull(),
  workId: bigintNumber('work_id'),
  roomId: int('room_id').notNull(),
  amenitiesQty: tinyint('amenities_qty').notNull(),
  blanketQty: tinyint('blanket_qty').notNull(),
  checkinTime: time('checkin_time').notNull(),
  checkoutTime: time('checkout_time').notNull(),
  requirements: varchar('requirements', { length: 30 }),
  cancelYn: boolean('cancel_yn').default(false).notNull(),
  reflectYn: boolean('reflect_yn').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull(),
  createdBy: varchar('created_by', { length: 50 }),
  updatedBy: varchar('updated_by', { length: 50 })
});

export const workHeader = mysqlTable('work_header', {
  id: bigintNumber('id', { unsigned: true }).autoincrement().notNull(),
  date: date('date').notNull(),
  roomId: int('room_id').notNull(),
  cleanerId: int('cleaner_id'),
  butlerId: int('butler_id'),
  amenitiesQty: tinyint('amenities_qty').notNull(),
  blanketQty: tinyint('blanket_qty').notNull(),
  conditionCheckYn: boolean('condition_check_yn').default(false).notNull(),
  cleaningYn: boolean('cleaning_yn').default(true).notNull(),
  checkinTime: time('checkin_time').notNull(),
  checkoutTime: time('checkout_time').notNull(),
  supplyYn: boolean('supply_yn').default(true).notNull(),
  cleaningFlag: tinyint('clening_flag').default(1).notNull(),
  cleaningEndTime: time('cleaning_end_time'),
  supervisingEndTime: time('supervising_end_time'),
  requirements: varchar('requirements', { length: 30 }),
  cancelYn: boolean('cancel_yn').default(false).notNull(),
  manualUptYn: boolean('manual_upt_yn').default(false).notNull(),
  supervisingYn: boolean('supervising_yn').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull(),
  createdBy: varchar('created_by', { length: 50 }),
  updatedBy: varchar('updated_by', { length: 50 })
});

export const workReports = mysqlTable('work_reports', {
  id: bigintNumber('id', { unsigned: true }).autoincrement().notNull(),
  workId: bigintNumber('work_id').notNull(),
  type: tinyint('type').notNull(),
  contents1: json('contents1').notNull(),
  contents2: json('contents2'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull(),
  createdBy: varchar('created_by', { length: 50 }),
  updatedBy: varchar('updated_by', { length: 50 })
});

export const workAssignment = mysqlTable('work_assignment', {
  id: bigintNumber('id', { unsigned: true }).autoincrement().notNull(),
  workId: bigintNumber('work_id').notNull(),
  workerId: int('worker_id').notNull(),
  assignDate: date('assign_dttm').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull(),
  createdBy: varchar('created_by', { length: 50 }),
  updatedBy: varchar('updated_by', { length: 50 })
});

export const workerDetail = mysqlTable('worker_detail', {
  id: int('id', { unsigned: true }).autoincrement().notNull(),
  workerId: bigintNumber('worker_id', { unsigned: true }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull(),
  createdBy: varchar('created_by', { length: 50 }),
  updatedBy: varchar('updated_by', { length: 50 })
});

export const workerEvaluateHistory = mysqlTable('worker_evaluateHistory', {
  id: bigintNumber('id', { unsigned: true }).autoincrement().notNull(),
  workerId: int('worker_id', { unsigned: true }).notNull(),
  evaluatedAt: datetime('evaluate_dttm').notNull(),
  workId: bigintNumber('work_id').notNull(),
  checklistTitleArray: json('checklist_title_array').notNull(),
  checklistPointSum: tinyint('checklist_point_sum').notNull(),
  comment: varchar('comment', { length: 255 }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull(),
  createdBy: varchar('created_by', { length: 50 }),
  updatedBy: varchar('updated_by', { length: 50 })
});

export const workerHeader = mysqlTable('worker_header', {
  id: int('id', { unsigned: true }).autoincrement().notNull(),
  registerCode: varchar('register_no', { length: 6 }).notNull(),
  name: varchar('name', { length: 20 }).notNull(),
  phone: varchar('phone', { length: 11 }),
  regNo: char('reg_no', { length: 13 }),
  bankCode: varchar('basecode_bank', { length: 10 }),
  bankValue: varchar('basecode_code', { length: 255 }),
  accountNo: varchar('account_no', { length: 50 }),
  tier: tinyint('tier').notNull(),
  comments: varchar('comments', { length: 255 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull(),
  createdBy: varchar('created_by', { length: 50 }),
  updatedBy: varchar('updated_by', { length: 50 })
});

export const workerSalaryHistory = mysqlTable('worker_salary_history', {
  id: bigintNumber('id', { unsigned: true }).autoincrement().notNull(),
  workerId: int('worker_id', { unsigned: true }).notNull(),
  workDate: date('work_date').notNull(),
  startTime: time('start_time'),
  endTime: time('end_time'),
  tierTargetDate: tinyint('tier_target_date'),
  hourlyWageTargetDate: smallint('hourly_wage_target_date'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull(),
  createdBy: varchar('created_by', { length: 50 }),
  updatedBy: varchar('updated_by', { length: 50 })
});

export const workerPenaltyHistory = mysqlTable('worker_penaltyHistory', {
  id: int('id', { unsigned: true }).autoincrement().notNull(),
  workerId: int('worker_id', { unsigned: true }).notNull(),
  startDate: date('start_date').notNull(),
  interval: tinyint('interval').notNull(),
  comment: varchar('comment', { length: 255 }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull(),
  createdBy: varchar('created_by', { length: 50 }),
  updatedBy: varchar('updated_by', { length: 50 })
});

export const workerScheduleException = mysqlTable(
  'worker_schedule_exception',
  {
    id: int('id', { unsigned: true }).autoincrement().notNull(),
    workerId: int('worker_id', { unsigned: true }).notNull(),
    excptDate: date('excpt_date').notNull(),
    addWorkYn: boolean('add_work_yn').default(false).notNull(),
    cancelWorkYn: boolean('cancel_work_yn').default(false).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull(),
    createdBy: varchar('created_by', { length: 50 }),
    updatedBy: varchar('updated_by', { length: 50 })
  },
  (table) => ({
    workerScheduleExceptionUniq: uniqueIndex('ux_worker_schedule_exception').on(table.workerId, table.excptDate)
  })
);

export const workerWeeklyPattern = mysqlTable('worker_weekly_pattern', {
  id: int('id', { unsigned: true }).autoincrement().notNull(),
  workerId: int('worker_id', { unsigned: true }).notNull(),
  weekday: tinyint('weekday').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull(),
  createdBy: varchar('created_by', { length: 50 }),
  updatedBy: varchar('updated_by', { length: 50 })
});
