-- 008 정산관리 화면: 최종 data set을 한 번에 로드하기 위한 단일 SQL 예시
-- 접속 계정의 client_header.id와 조회 일자(YYYY-MM 기준)만 바꿔서 실행하세요.
-- 아래 예시는 client_header.id = 19, 조회 월 = 2025-12, 현재 KST = 2025-12-01 상황입니다.

WITH params AS (
  SELECT
    19::BIGINT         AS host_id,             -- 접속한 호스트의 client_header.id
    DATE('2025-12-01') AS month_start,
    DATE('2025-12-31') AS month_end,
    DATE('2025-12-01') AS work_end             -- min(오늘 KST, month_end); 예시에서는 오늘이 12/01
),
-- 호스트가 운영 중인 객실 목록(정산 대상 객실)
eligible_rooms AS (
  SELECT
    cr.id           AS room_id,
    cr.client_id    AS host_id,
    cr.price_set_id AS price_set_id,
    cr.room_no      AS room_no,
    eb.short_name   AS building_short,
    cr.bed_count    AS bed_count,
    cr.room_count   AS room_count,
    cr.start_date,
    cr.end_date,
    cr.open_yn,
    cr.checkout_time,
    cr.checkin_time
  FROM client_rooms cr
  JOIN etc_buildings eb ON eb.id = cr.building_id
  JOIN params p ON TRUE
  WHERE cr.client_id = p.host_id
    -- 월과 객실 운영 기간이 겹치는지 확인 (열린 객실은 월과 겹치면 포함,
    -- 닫힌 객실은 시작/종료 중 하나라도 월 안에 위치해야 포함)
    AND COALESCE(cr.end_date, p.month_end) >= p.month_start
    AND COALESCE(cr.start_date, p.month_start) <= p.month_end
    AND (
      cr.open_yn = 1
      OR (
        (cr.start_date BETWEEN p.month_start AND p.month_end)
        OR (cr.end_date   BETWEEN p.month_start AND p.month_end)
      )
    )
),
-- 객실별 가격 세트 상세
price_items AS (
  SELECT
    er.room_id,
    cpsd.price_set_id,
    cpsd.price_id,
    COALESCE(cpsd.type,  cpl.type)                    AS price_type,
    CAST(COALESCE(cpsd.amount, cpl.amount) AS DECIMAL(20,4)) AS amount,
    COALESCE(cpsd.title, cpl.title)                   AS title,
    COALESCE(cpsd.minus_yn, cpl.minus_yn, 0)          AS minus_yn,
    COALESCE(cpsd.ratio_yn, cpl.ratio_yn, 0)          AS ratio_yn,
    COALESCE(cpl.per_bed_yn,  0)                      AS per_bed_yn,
    COALESCE(cpl.per_room_yn, 0)                      AS per_room_yn,
    CASE
      WHEN COALESCE(cpl.per_bed_yn, 0) = 1  THEN er.bed_count
      WHEN COALESCE(cpl.per_room_yn, 0) = 1 THEN er.room_count
      ELSE 1
    END AS quantity
  FROM eligible_rooms er
  JOIN client_price_set_detail cpsd ON cpsd.price_set_id = er.price_set_id
  JOIN client_price_list cpl        ON cpl.id = cpsd.price_id
),
-- 추가 비용 (client_additional_price): 금액 컬럼은 price/amount/value 중 존재하는 것 사용, qty 없으면 1
additional_prices AS (
  SELECT
    cr.client_id AS host_id,
    cap.room_id,
    cap.date,
    cap.title,
    COALESCE(cap.qty, 1) AS qty,
    CAST(COALESCE(cap.price, cap.amount, cap.value) AS DECIMAL(20,4)) AS price
  FROM client_additional_price cap
  JOIN client_rooms cr ON cr.id = cap.room_id
  JOIN params p ON TRUE
  WHERE cap.room_id IN (SELECT room_id FROM eligible_rooms)
    AND DATE(cap.date) BETWEEN p.month_start AND p.work_end
),
-- 작업 내역 (work_header): 취소되지 않은 건만 포함, checkout_time 없으면 객실 기본값 사용
work_rows AS (
  SELECT
    cr.client_id AS host_id,
    cr.id        AS room_id,
    wh.id        AS work_id,
    wh.date,
    wh.amenities_qty,
    wh.blanket_qty,
    wh.cleaning_yn,
    wh.checkin_time  AS actual_checkin,
    COALESCE(wh.checkout_time, cr.checkout_time) AS actual_checkout
  FROM work_header wh
  JOIN client_rooms cr ON cr.id = wh.room_id
  JOIN params p ON TRUE
  WHERE wh.room_id IN (SELECT room_id FROM eligible_rooms)
    AND DATE(wh.date) BETWEEN p.month_start AND p.work_end
    AND wh.cancel_yn = FALSE
)
-- 최종 data set: 가격 세트 상세, 추가 비용, 작업 내역을 한 번에 조회
SELECT
  fd.row_type,                -- price_item | additional_price | work
  fd.host_id,
  fd.room_id,
  fd.building_short,
  fd.room_no,
  fd.bed_count,
  fd.room_count,
  fd.price_set_id,
  fd.price_id,
  fd.price_type,
  fd.amount,
  fd.price_title,
  fd.minus_yn,
  fd.ratio_yn,
  fd.per_bed_yn,
  fd.per_room_yn,
  fd.quantity,
  fd.amount * COALESCE(fd.quantity, 1) AS extended_amount,
  fd.work_id,
  fd.work_date,
  fd.amenities_qty,
  fd.blanket_qty,
  fd.cleaning_yn,
  fd.actual_checkin,
  fd.actual_checkout,
  fd.additional_title,
  fd.additional_qty,
  fd.additional_price
FROM (
  -- 가격 세트 상세
  SELECT
    'price_item' AS row_type,
    er.host_id,
    er.room_id,
    er.building_short,
    er.room_no,
    er.bed_count,
    er.room_count,
    pi.price_set_id,
    pi.price_id,
    pi.price_type,
    pi.amount,
    pi.title AS price_title,
    pi.minus_yn,
    pi.ratio_yn,
    pi.per_bed_yn,
    pi.per_room_yn,
    pi.quantity,
    NULL::BIGINT  AS work_id,
    NULL::DATE    AS work_date,
    NULL::INT     AS amenities_qty,
    NULL::INT     AS blanket_qty,
    NULL::BOOLEAN AS cleaning_yn,
    NULL::TIME    AS actual_checkin,
    NULL::TIME    AS actual_checkout,
    NULL::VARCHAR AS additional_title,
    NULL::INT     AS additional_qty,
    NULL::DECIMAL(20,4) AS additional_price
  FROM price_items pi
  JOIN eligible_rooms er ON er.room_id = pi.room_id

  UNION ALL
  -- 추가 비용
  SELECT
    'additional_price' AS row_type,
    ap.host_id,
    ap.room_id,
    er.building_short,
    er.room_no,
    er.bed_count,
    er.room_count,
    NULL, NULL, NULL,
    ap.price AS amount,
    NULL AS price_title,
    NULL AS minus_yn,
    NULL AS ratio_yn,
    NULL AS per_bed_yn,
    NULL AS per_room_yn,
    NULL AS quantity,
    NULL::BIGINT  AS work_id,
    DATE(ap.date) AS work_date,
    NULL::INT     AS amenities_qty,
    NULL::INT     AS blanket_qty,
    NULL::BOOLEAN AS cleaning_yn,
    NULL::TIME    AS actual_checkin,
    NULL::TIME    AS actual_checkout,
    ap.title      AS additional_title,
    ap.qty        AS additional_qty,
    ap.price      AS additional_price
  FROM additional_prices ap
  JOIN eligible_rooms er ON er.room_id = ap.room_id

  UNION ALL
  -- 작업 내역
  SELECT
    'work' AS row_type,
    wr.host_id,
    wr.room_id,
    er.building_short,
    er.room_no,
    er.bed_count,
    er.room_count,
    NULL, NULL, NULL,
    NULL,
    NULL AS price_title,
    NULL AS minus_yn,
    NULL AS ratio_yn,
    NULL AS per_bed_yn,
    NULL AS per_room_yn,
    NULL AS quantity,
    wr.work_id,
    DATE(wr.date) AS work_date,
    wr.amenities_qty,
    wr.blanket_qty,
    wr.cleaning_yn,
    wr.actual_checkin,
    wr.actual_checkout,
    NULL::VARCHAR AS additional_title,
    NULL::INT     AS additional_qty,
    NULL::DECIMAL(20,4) AS additional_price
  FROM work_rows wr
  JOIN eligible_rooms er ON er.room_id = wr.room_id
) AS fd
ORDER BY fd.host_id, fd.room_id, fd.row_type, fd.work_date NULLS LAST;
