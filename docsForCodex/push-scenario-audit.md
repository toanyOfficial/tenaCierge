# 모바일 웹 푸시 시나리오 점검 리포트 (2025-02-XX 실행 시나리오 기준)

## 개요
사용자 요청에 따라 청소/소모품/업무 신청 관련 모바일 웹 푸시 시나리오(총 6종)의 구현 상태를 전수 검토했습니다. 배치 스크립트(`batchs/db_forecasting.py`, `batchs/update_cleaner_ranking.py`)와 웹 API/서버 로직(`app/api/push/scenario/route.ts`, `app/api/workflow/[workId]/route.ts`, `src/server/push/scenarios.ts`)을 추적하여 **트리거 연결**, **타겟/쿼리 조건**, **템플릿 및 메시지 포맷**, **잠재적 오류 지점**을 평가했습니다. 아래는 시나리오별 상세 분석입니다.

## 1. 청소 일정 푸시 (CLEAN_SCHEDULE)
- **트리거**: `batchs/db_forecasting.py`가 실행될 때 `--refresh-dn` 인자가 **존재**하면 `CLEAN_SCHEDULE` 시나리오를 enqueue 합니다.【F:batchs/db_forecasting.py†L1413-L1453】
- **대상 데이터 및 쿼리**: `src/server/push/scenarios.ts`에서 `runDate + offsetDays`를 `formatDateKey`로 변환한 값을 기준으로 `work_header.date` = 대상일인 건을 집계합니다.【F:src/server/push/scenarios.ts†L63-L122】
- **타겟 선정**: `push_subscriptions` 중 `userType='CLIENT'`, `enabledYn=true`, `user_id IS NOT NULL`을 가진 **모든 고객**을 대상으로, 고객별 `work_header` 건수를 그룹화한 뒤 메시지를 발송합니다.【F:src/server/push/scenarios.ts†L86-L122】
- **메시지**: 템플릿 ID 1, 제목 `'청소 일정 안내'`, 본문 `yyyy-MM-dd 청소일정 : n건` (집계 건수 없을 경우 0건)으로 구성됩니다.【F:src/server/push/scenarios.ts†L109-L113】
- **시나리오 요구사항 대비**
  - 오프셋 처리/집계 로직은 요구사항과 일치합니다.
  - **템플릿 제목**은 요구서의 `청소일정푸시`가 아니라 `'청소 일정 안내'`로 정의되어 있습니다(동작에는 영향 없으나 명칭 차이 존재).
- **리스크/개선 포인트**
  - `push_subscriptions`에 등록된 전체 고객에게 보내되, 당일 건수가 0건인 고객도 메시지를 받습니다. “대상이 없는 고객은 스킵”이 필요하다면 `workCountByClient`에 없는 ID는 건너뛰도록 수정 필요.

## 2. 청소 배정 푸시 (WORK_ASSIGNED)
- **트리거**: `app/api/workflow/[workId]/route.ts`에서 작업 업데이트 시 **배정된 클리너가 변경**되면 enqueue 합니다.【F:app/api/workflow/[workId]/route.ts†L265-L300】
- **타겟 선정**: `queueWorkAssignedPush`는 `workerId`(새 클리너 ID)를 대상으로 `push_subscriptions.userType='WORKER'` 구독에 발송합니다.【F:src/server/push/scenarios.ts†L124-L148】
- **메시지**: 템플릿 ID 2, 제목 `'청소 배정 안내'`, 본문 `"{건물약칭} {호수}호실에 클리닝이 배정되었습니다."` (호실 정보는 `work_header.room_id` → `client_rooms` → `etc_buildings` 조인)【F:src/server/push/scenarios.ts†L124-L148】
- **시나리오 요구사항 대비**
  - 요구사항의 타겟 조건(`push_subscriptions.user_id = work_header.id`)과 달리 **클리너 ID**를 사용합니다. 실제 의도대로 “배정된 클리너에게 알림”이라면 구현이 맞지만, 문서의 `work_header.id` 기준과 불일치.
- **리스크/개선 포인트**
  - `push_subscriptions`에 해당 클리너의 구독이 없으면 silently skip(큐는 쌓이지만 `processLockedJob` 단계에서 발송 0으로 처리). 운영 모니터링 필요.

## 3. 배정 해제 푸시 (WORK_UNASSIGNED)
- **트리거**: 동일 엔드포인트에서 **기존 클리너가 다른 사람으로 교체될 때** 이전 클리너 ID로 enqueue 합니다.【F:app/api/workflow/[workId]/route.ts†L265-L300】
- **타겟/메시지**: `queueWorkUnassignedPush`가 클리너 ID를 대상으로 템플릿 ID 3, 제목 `'배정 해제 안내'`, 본문 `"{건물약칭} {호수}호실에 클리닝 배정이 해제되었습니다."`를 발송합니다.【F:src/server/push/scenarios.ts†L150-L174】
- **시나리오 요구사항 대비**
  - 요구서의 `push_subscriptions.user_id = work_header.id`와 달리 **클리너 ID** 기준.
- **리스크/개선 포인트**
  - 클리너 구독 누락 시 발송되지 않음(동일하게 모니터링 필요).

## 4. 청소 완료 푸시 (WORK_FINISHING)
- **트리거**: 워크플로우 업데이트 시 `cleaningFlag`가 **3으로 전환**되고 `butlerId`가 있을 때만 enqueue 합니다.【F:app/api/workflow/[workId]/route.ts†L289-L297】
- **타겟 선정**: `queueWorkFinishingPush`는 전달된 `butlerIds` 배열을 그대로 사용하며, 현재 구현에서는 **작업의 `butlerId` 단일 값**만 전달됩니다.【F:src/server/push/scenarios.ts†L176-L209】
- **메시지**: 템플릿 ID 4, 제목 `'청소 완료 안내'`, 본문 `"{건물약칭} {호수}호실이 마무리 단계입니다."`【F:src/server/push/scenarios.ts†L176-L209】
- **시나리오 요구사항 대비**
  - 요구사항은 `work_apply` 기준 **동일 섹터·동일 일자 근무 버틀러 전체**를 찾아서 대상 지정하나, 구현은 `work_header.butlerId` 단일값만 사용합니다. 실제 근무자 조회/다중 대상 발송이 누락되어 요구사항과 큰 차이.
  - `cleaning_flag=3` 조건은 일치하나, `work_apply` 조회 로직 부재로 **타겟 축소** 위험.
- **리스크/개선 포인트**
  - 현재 버틀러 지정이 없거나 잘못 설정된 작업은 푸시가 누락됩니다.
  - 요구사항 충족을 위해 `work_apply` 조인/필터(`date`, `position=2`, `basecode_code` 일치)로 butler list 생성 후 전달하도록 확장 필요.

## 5. 소모품 안내 푸시 (SUPPLEMENTS_PENDING)
- **트리거**: `batchs/update_cleaner_ranking.py` 실행 시 `client_supplements` 적재 완료 후 항상 `SUPPLEMENTS_PENDING` 시나리오 enqueue.【F:batchs/update_cleaner_ranking.py†L1560-L1585】
- **대상/집계**: `buyYn=false`인 `client_supplements`를 `client_header` 단위로 그룹핑하여 미구매 건수를 계산. `push_subscriptions`의 `CLIENT` 구독이 **있고 활성화된** 고객만 대상으로 필터 후 발송합니다.【F:src/server/push/scenarios.ts†L211-L296】
- **메시지**: 템플릿 ID 5, 제목 `'소모품 안내'`, 본문 `총 n개의 소모품을 구매 해야 합니다. 빠른 구매 부탁드립니다`【F:src/server/push/scenarios.ts†L263-L267】
- **시나리오 요구사항 대비**
  - 요구사항과 거의 동일. 단, 미구매 건수가 0이어도 배치에서는 `pendingRows`가 없으면 스킵되어 불필요 발송 없음.
- **리스크/개선 포인트**
  - `clientRooms.clientId`가 NULL인 기록은 스킵되므로 해당 데이터 정합성 주의.

## 6. 업무 신청 푸시 (WORK_APPLY_OPEN)
- **트리거**: `db_forecasting.py`에서 `--refresh-dn`이 **없을 때** `WORK_APPLY_OPEN` 시나리오 enqueue.【F:batchs/db_forecasting.py†L1435-L1453】
- **대상/집계**: `work_apply.worker_id IS NULL`인 건을 `today`부터 `horizonDays(기본 7일)` 범위로 카운트. `worker_tier_rule`를 조회해 티어별 신청 가능 시각을 계산하고, `push_subscriptions`가 활성화된 **tier != 1 워커** 전원에게 발송합니다.【F:src/server/push/scenarios.ts†L298-L358】
- **메시지**: 템플릿 ID 6, 제목 `'업무 신청 안내'`, 본문 `현재 n건의 업무가 남아있습니다 hh:mm부터 신청 가능합니다.` (티어 규칙이 없으면 `--:--`)【F:src/server/push/scenarios.ts†L346-L350】
- **시나리오 요구사항 대비**
  - 요구사항은 `work_apply` **전체 테이블**에서 미배정 건수를 집계한다고 명시했으나, 구현은 7일 기본 범위를 적용합니다.
  - 티어별 시작 시각을 템플릿에 반영하는 부분은 요구사항과 일치.
- **리스크/개선 포인트**
  - 기본 7일 horizon으로 인해 장기 미배정 건수가 누락될 수 있음. 필요 시 `horizonDays` 조정 또는 전체 집계 옵션 추가 권장.

## 공통 관찰 사항
- **디듀프 키**: `src/server/push/dedup.ts` 기반으로 시나리오/타겟/날짜 조합으로 중복 삽입 방지 처리되어 있음. 동일 대상에 반복 enqueue 시 `enqueueNotifyJob`에서 DB 유니크 키 충돌 시 false 반환으로 스킵됨.
- **실제 발송 여부**: `enqueueNotifyJob`이 `notify_jobs`에만 적재하므로, 후속 워커(`processLockedJob`) 실행/구독 존재 여부에 따라 실발송이 결정됩니다. 구독이 없으면 자동 `skipped` 처리되어 로그 외 별도 에러는 없음.
- **메시지 템플릿 이름/문구**: 일부 제목이 요구서 명칭과 다르지만 템플릿 ID 매핑은 요구사항 순서(1~6)와 일치. 운영/UX 측면에서 명칭 통일 필요 여부 검토 권장.

## 총평
- **2, 3, 5번 시나리오**는 요구사항과 비교적 근접하게 동작하며, 구독 누락 시 스킵 외 별도 오류는 없습니다.
- **1번**은 정상 동작하나 “건수 0인 고객도 발송”과 제목 명칭 차이가 존재합니다.
- **4번**은 요구사항 대비 타겟 선정 로직이 크게 단순화되어 있어, 섹터 기준 버틀러 조회가 누락된 상태입니다.
- **6번**은 미배정 카운트의 기간 제한(기본 7일)이 문서와 다르므로 장기 미배정 건이 집계되지 않을 수 있습니다.

위 차이를 고려해 요구사항과 실제 동작 간 갭을 확인하시고, 필요 시 후속 수정/테스트를 진행하시길 권장드립니다.
