# 웹 푸시 시나리오 큐잉 헬퍼 사용법

`src/server/push/scenarios.ts`에 6개 시나리오별 outbox enqueue 함수가 추가되었습니다. 모든 함수는 **notify_jobs**에 dedup_key 기반으로 작업을 저장하며, 발송 워커(`runWebPushWorker`)가 픽업할 수 있는 READY 상태로 기록됩니다.

## 공통 규칙
- dedup_key는 스펙의 포맷을 그대로 사용합니다(`CLEAN_SCHEDULE`, `WORK_ASSIGNED` 등).
- payload는 템플릿 id(1~6) + 메시지 본문을 포함하며, 템플릿 필드는 DB에 미리 시드되어 있다는 가정입니다.
- `createdBy` 옵션으로 소스 배치를 표시할 수 있습니다(없어도 동작).

## 함수별 요약

### 1) 청소 일정 푸시
```ts
queueCleanSchedulePush({ runDate, offsetDays?, createdBy? })
```
- `runDate + offsetDays` 날짜의 work_header를 조회하여 client별 건수 집계 후 enqueue.
- dedup: `CLEAN_SCHEDULE:{client_id}:{yyyy-MM-dd}`.

### 2) 청소 배정 푸시
```ts
queueWorkAssignedPush({ workId, workerId, createdBy? })
```
- work_id로 호실(building_short_name + room_no)을 조회 후 해당 worker에게 enqueue.
- dedup: `WORK_ASSIGNED:{work_id}:{worker_id}`.

### 3) 배정 해제 푸시
```ts
queueWorkUnassignedPush({ workId, workerId, createdBy? })
```
- work_id 기준 동일하게 호실 정보를 로드하여 해제된 worker에게 enqueue.
- dedup: `WORK_UNASSIGNED:{work_id}:{worker_id}`.

### 4) 청소 완료(마무리 단계) 푸시
```ts
queueWorkFinishingPush({ workId, butlerIds, createdBy? })
```
- 호출 측에서 확보한 butler id 배열을 그대로 사용해 enqueue.
- dedup: `WORK_FINISHING:{work_id}:{butler_id}`.

### 5) 소모품 안내 푸시
```ts
queueSupplementsPendingPush({ today?, createdBy? })
```
- `client_supplements.buy_yn = 0` 전체를 집계하여 client별 누적 미구매 건수를 본문에 포함.
- dedup: `SUPPLEMENTS_PENDING:{client_id}:{yyyy-MM-dd}` (1일 1회 제한 용도).

### 6) 업무 신청 푸시
```ts
queueWorkApplyOpenPush({ today?, horizonDays?, createdBy? })
```
- today ~ today + horizonDays 사이 `work_apply.worker_id IS NULL`인 건수 합계를 계산.
- tier != 1인 worker 전원에게 동일한 openCount를 알리고, tier 규칙의 `apply_start_time`으로 신청 가능 시각 문구를 구성.
- dedup: `WORK_APPLY_OPEN:{worker_id}:{yyyy-MM-dd}`.

## 사용 예시
- 배치 스크립트: `await queueCleanSchedulePush({ runDate: new Date(), offsetDays: 1, createdBy: 'db_forecasting' });`
- 이벤트 핸들러: 업무 배정 완료 시 `queueWorkAssignedPush({ workId, workerId, createdBy: 'assign_event' });`
- 워커 실행: 기존 `runWebPushWorker` 또는 `runDueJobs(createWebPushDeliver())` 사용.

## 한계/추가 고려사항
- 청소 완료 푸시는 호출자가 butler id를 결정해야 합니다(현재 스키마 상 basecode 매칭 로직은 호출 측 책임으로 둠).
- 재시도/만료 처리, 구독 만료 시 enabled_yn false 처리 등은 기존 `jobs.ts`/`webPush.ts` 단계의 TODO와 동일하게 남아 있습니다.
