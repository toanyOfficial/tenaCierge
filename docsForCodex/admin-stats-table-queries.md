# Admin 통계표 대시보드 Raw Query 모음

아래 SQL들은 1920×1080 통계표 대시보드가 사용하는 네 가지 그래프용 데이터를 그대로 집계하는 예시입니다. 날짜 범위는 요구사항에 맞춰 고정되어 있으며, 필요 시 조건만 변경하면 됩니다.

## 1) 월별 평균 시계열 (건별제=막대, 정액제=꺾은선)
```sql
WITH month_range AS (
  SELECT generate_series(date '2024-12-01', date '2025-12-01', interval '1 month')::date AS month_start
),
work AS (
  SELECT
    date_trunc('month', wh.date)::date AS month_start,
    COALESCE(eb.short_name, '미지정') AS building,
    COALESCE(ch.settle_flag, 0) AS settle_flag,
    COUNT(*) AS total
  FROM work_header wh
  JOIN client_rooms cr ON cr.id = wh.room_id
  JOIN etc_buildings eb ON eb.id = cr.building_id
  JOIN client_header ch ON ch.id = cr.client_id
  WHERE wh.date >= date '2024-12-01'
    AND wh.date < date '2026-01-01'
  GROUP BY 1, 2, 3
),
combo AS (
  -- 월이 비어 있어도 등장한 건물·요금제 조합별로 13개월을 모두 생성
  SELECT DISTINCT building, settle_flag FROM work
)
SELECT
  to_char(m.month_start, 'YYYY-MM') AS month_key,
  c.building,
  c.settle_flag,
  CASE c.settle_flag WHEN 1 THEN '건별제' WHEN 2 THEN '정액제' ELSE '미지정' END AS plan_label,
  COALESCE(w.total, 0) AS total_count,
  COALESCE(w.total, 0)::numeric /
    EXTRACT(day FROM (m.month_start + INTERVAL '1 month - 1 day')) AS avg_per_day
FROM month_range m
CROSS JOIN combo c
LEFT JOIN work w
  ON w.month_start = m.month_start
 AND w.building = c.building
 AND w.settle_flag = c.settle_flag
ORDER BY month_key, c.building, c.settle_flag;
```

## 2) 월별 통계값 (호실 평균 / 건물 평균 / 총량)
```sql
WITH month_range AS (
  SELECT generate_series(date '2024-12-01', date '2025-12-01', interval '1 month')::date AS month_start
),
work AS (
  SELECT
    date_trunc('month', wh.date)::date AS month_start,
    wh.room_id,
    COALESCE(eb.short_name, '미지정') AS building
  FROM work_header wh
  JOIN client_rooms cr ON cr.id = wh.room_id
  JOIN etc_buildings eb ON eb.id = cr.building_id
  WHERE wh.date >= date '2024-12-01'
    AND wh.date < date '2026-01-01'
)
SELECT
  to_char(m.month_start, 'YYYY-MM') AS month_key,
  COALESCE(SUM(CASE WHEN w.room_id IS NOT NULL THEN 1 END), 0) AS total_count,
  CASE WHEN COUNT(DISTINCT w.room_id) > 0
       THEN SUM(1)::numeric / COUNT(DISTINCT w.room_id)
       ELSE 0 END AS room_avg,
  CASE WHEN COUNT(DISTINCT w.building) > 0
       THEN SUM(1)::numeric / COUNT(DISTINCT w.building)
       ELSE 0 END AS building_avg
FROM month_range m
LEFT JOIN work w ON w.month_start = m.month_start
GROUP BY m.month_start
ORDER BY month_key;
```

## 3) 요일별 평균 (건물별/전체)
```sql
WITH day_range AS (
  SELECT generate_series(date '2024-12-17', date '2025-12-17', interval '1 day')::date AS day
),
work AS (
  SELECT
    wh.date::date AS work_day,
    COALESCE(eb.short_name, '미지정') AS building
  FROM work_header wh
  JOIN client_rooms cr ON cr.id = wh.room_id
  JOIN etc_buildings eb ON eb.id = cr.building_id
  WHERE wh.date >= date '2024-12-17'
    AND wh.date <= date '2025-12-17'
),
weekday_denoms AS (
  SELECT EXTRACT(dow FROM day)::int AS dow, COUNT(*) AS denom
  FROM day_range
  GROUP BY 1
)
SELECT
  dow,
  CASE dow WHEN 0 THEN '일' WHEN 1 THEN '월' WHEN 2 THEN '화' WHEN 3 THEN '수' WHEN 4 THEN '목' WHEN 5 THEN '금' ELSE '토' END AS weekday,
  COALESCE(SUM(wa.total), 0) / NULLIF(MAX(wd.denom), 0) AS avg_total,
  JSON_AGG(
    JSON_BUILD_OBJECT(
      'building', building,
      'average', total / NULLIF(MAX(wd.denom), 0)
    ) ORDER BY total DESC
  ) FILTER (WHERE building IS NOT NULL) AS building_breakdown
FROM (
  SELECT EXTRACT(dow FROM work_day)::int AS dow, building, COUNT(*) AS total
  FROM work
  GROUP BY 1, 2
) wa
RIGHT JOIN weekday_denoms wd ON wd.dow = wa.dow
GROUP BY dow
ORDER BY dow;
```

> `settle_flag` 1 = 건별제(막대), 2 = 정액제(꺾은선). 값이 없는 경우 0/미지정을 반환합니다.
