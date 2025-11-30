-- 002 오더관리 화면(WorkListSnapshot)에서 사용하는 기본 쿼리 예시입니다.
-- :target_date 자리에 조회하려는 날짜(예: 2024-11-26)를 YYYY-MM-DD로 지정하세요.
-- 시스템에서는 KST 자정 시각을 가진 DATE 객체로 비교합니다.

SELECT
  wh.id,
  wh.date,
  wh.cleaner_id,
  wh.cleaning_yn,
  wh.clening_flag,
  wh.ceckout_time,
  wh.checkin_time,
  wh.blanket_qty,
  wh.amenities_qty,
  wh.requirements,
  wh.cancel_yn,
  cr.id              AS room_id,
  cr.room_no,
  cr.bed_count,
  cr.checklist_set_id,
  cr.images_set_id,
  cr.client_id,
  cr.checkout_time   AS default_checkout,
  cr.checkin_time    AS default_checkin,
  b.id               AS building_id,
  b.basecode_sector,
  b.basecode_code,
  b.building_short_name,
  b.building_name,
  bc.value           AS sector_value_label
FROM work_header AS wh
LEFT JOIN client_rooms AS cr
  ON wh.room_id = cr.id
LEFT JOIN etc_buildings AS b
  ON cr.building_id = b.id
LEFT JOIN etc_baseCode AS bc
  ON bc.code_group = b.basecode_sector AND bc.code = b.basecode_code
WHERE wh.date = TIMESTAMP(CONCAT(:target_date, 'T00:00:00Z'))
ORDER BY wh.id ASC;
