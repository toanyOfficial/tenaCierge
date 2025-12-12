# Dashboard vs Task Sheet Raw Queries (KST 2025-12-13 07:18 AM 기준)

## 대시보드 주간 조회 (D0 포함)
```sql
SELECT
  work_header.id AS id,
  work_header.date AS workDate,
  work_header.supply_yn AS supplyYn,
  work_header.clening_flag AS cleaningFlag,
  work_header.supervising_yn AS supervisingYn,
  etc_buildings.id AS buildingId,
  etc_buildings.short_name AS buildingShortName,
  etc_buildings.sector_code AS sectorCode,
  etc_buildings.sector_value AS sectorValue,
  etc_baseCode.value AS sectorName,
  client_rooms.room_no AS roomNo,
  work_header.cleaner_id AS cleanerId,
  worker_header.name AS cleanerName,
  work_header.cleaning_end_time AS cleaningEndTime,
  work_header.supervising_end_time AS supervisingEndTime
FROM work_header
LEFT JOIN client_rooms ON client_rooms.id = work_header.room_id
LEFT JOIN etc_buildings ON client_rooms.building_id = etc_buildings.id
LEFT JOIN etc_baseCode
  ON etc_baseCode.code_group = etc_buildings.sector_code
  AND etc_baseCode.code = etc_buildings.sector_value
LEFT JOIN worker_header ON work_header.cleaner_id = worker_header.id
WHERE work_header.date >= CAST('2025-12-13' AS DATE)
  AND work_header.date <= CAST('2025-12-20' AS DATE)
  AND work_header.cancel_yn = FALSE;
```

## 004-과업지시서 D0 조회
```sql
SELECT
  work_header.id AS id,
  work_header.date AS date,
  work_header.room_id AS roomId,
  COALESCE(work_header.checkout_time, client_rooms.checkout_time) AS checkoutTime,
  work_header.checkin_time AS checkinTime,
  work_header.blanket_qty AS blanketQty,
  work_header.amenities_qty AS amenitiesQty,
  work_header.requirements AS requirements,
  client_rooms.images_set_id AS imagesSetId,
  work_header.supply_yn AS supplyYn,
  work_header.clening_flag AS cleaningFlag,
  work_header.cleaning_yn AS cleaningYn,
  work_header.condition_check_yn AS conditionCheckYn,
  work_header.supervising_yn AS supervisingYn,
  work_header.supervising_end_time AS supervisingEndTime,
  work_header.cleaner_id AS cleanerId,
  client_rooms.room_no AS roomNo,
  client_header.name AS clientName,
  client_rooms.central_password AS centralPassword,
  client_rooms.door_password AS doorPassword,
  client_rooms.building_id AS buildingId,
  etc_buildings.sector_code AS sectorCode,
  buildingSector.value AS sectorValue,
  etc_buildings.short_name AS buildingShortName,
  etc_buildings.address_new AS buildingAddressNew,
  etc_buildings.building_password AS buildingPassword,
  etc_buildings.building_general AS generalTrashInfo,
  etc_buildings.building_food AS foodTrashInfo,
  etc_buildings.building_recycle AS recycleTrashInfo,
  worker_header.name AS cleanerName,
  client_rooms.realtime_overview_yn AS realtimeOverviewYn,
  client_rooms.images_yn AS imagesYn,
  work_header.cancel_yn AS cancelYn
FROM work_header
LEFT JOIN client_rooms ON work_header.room_id = client_rooms.id
LEFT JOIN client_header ON client_rooms.client_id = client_header.id
LEFT JOIN etc_buildings ON client_rooms.building_id = etc_buildings.id
LEFT JOIN etc_baseCode AS buildingSector
  ON buildingSector.code_group = etc_buildings.sector_code
  AND buildingSector.code = etc_buildings.sector_value
LEFT JOIN worker_header ON work_header.cleaner_id = worker_header.id
WHERE work_header.date = CAST('2025-12-13' AS DATE)
  AND work_header.cancel_yn = FALSE;
```
