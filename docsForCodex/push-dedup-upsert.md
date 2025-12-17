# 웹푸시 디듀프 & 업서트 동작 개요

## notify_jobs (enqueue 단계)
- **디듀프 키**: `src/server/push/dedup.ts`의 `buildDedupKey`로 시나리오별 prefix + 식별자를 합쳐 생성합니다. `notify_jobs.dedup_key`에는 `uq_notify_jobs_dedup` 유니크 인덱스가 걸려 있어 동일 키가 이미 있으면 `ER_DUP_ENTRY`가 발생합니다. `enqueueNotifyJob`은 이 에러를 잡아 `{ created: false }`를 반환하므로, 동일 디듀프 키는 한 번만 생성됩니다.
- **주요 키 조합** (예시)
  - CLEAN_SCHEDULE: `CLEAN_SCHEDULE:<clientId>:<targetDate>`
  - WORK_ASSIGNED: `WORK_ASSIGNED:<workId>:<workerId>`
  - WORK_UNASSIGNED: `WORK_UNASSIGNED:<workId>:<workerId>`
  - WORK_FINISHING: `WORK_FINISHING:<workId>:<butlerId>`
  - SUPPLEMENTS_PENDING: `SUPPLEMENTS_PENDING:<clientId>:<today>`
  - WORK_APPLY_OPEN: `WORK_APPLY_OPEN:<workerId>:<today>`
- **업서트 아님**: 중복이면 INSERT를 스킵하고 예외를 다시 던지지 않습니다. 새 payload로 덮어쓰지 않으니, 디듀프 키 설계가 실제 전송 단위와 일치하는지 확인해야 합니다.

## push_subscriptions (등록 단계)
- 유니크 인덱스: `(user_type, endpoint, user_id)` 조합이 `uq_webpush_endpoint`로 묶여 있습니다. 동일 사용자·동일 엔드포인트 중복 등록만 막고, **서로 다른 디바이스/브라우저**는 엔드포인트가 다르므로 모두 저장됩니다.
- 활성화 필터: 발송 시 `enabled_yn = true`이고 `user_id`가 일치하는 구독만 조회합니다.

## 다중 디바이스 발송 여부
- 워커/클라이언트별 job 1건에 대해, 해당 `user_id`의 **활성 구독 전부를 조회**해 루프를 돌며 각각 전송합니다. 구독이 여러 개면 job 1건으로 여러 디바이스에 발송됩니다.
- 각 구독별 성공/실패는 `push_message_logs`에 기록됩니다. 일부 디바이스가 만료되어 실패해도 다른 구독은 계속 시도합니다.

## 점검 포인트
- 특정 디바이스로만 안 간다면: `push_subscriptions`에 해당 endpoint가 `enabled_yn=true`인지, user_type/user_id가 맞는지 확인합니다.
- 반복 발송이 안 된다면: 의도한 주기보다 디듀프 키 범위가 넓은지(`workId`나 `날짜` 포함 여부) 점검합니다.
