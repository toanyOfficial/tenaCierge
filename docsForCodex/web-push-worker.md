# 웹 푸시 워커/아웃박스 사용 가이드

아웃박스 `notify_jobs` + 로그 `push_message_logs` 중심으로 발송 워커를 구현할 때 참고할 개발자용 메모.

## 주요 헬퍼 (src/server/push/jobs.ts)
- `enqueueNotifyJob` : dedup_key로 중복 차단하며 READY 상태 작업을 생성. 중복일 경우 `{ created:false }` 반환.
- `fetchReadyJobs` : `scheduled_at <= now` 인 READY 작업을 가져옴.
- `lockJobs` : READY → LOCKED로 전환하며 `try_count` 증가, `locked_by/locked_at` 설정.
- `processLockedJob` : LOCKED 작업 1건을 전달 받은 `deliver` 함수로 발송 후 로그를 남기고 DONE/FAILED로 전환.
- `runDueJobs` : 현재 시각 기준 READY 작업을 락/발송까지 일괄 수행.

## deliver 함수 계약
```ts
const deliver: DeliverFn = async (subscription, payload, job) => {
  // subscription.endpoint / p256dh / auth 를 사용해 web push 발송
  // payload에는 templateId/title/body/iconUrl/clickUrl/data/ttlSeconds/urgency 가 포함됨
  // 성공 시 { status:'SENT', sentAt:new Date(), httpStatus?:201 } 반환
  // 만료/실패 시 { status:'EXPIRED'|'FAILED', errorMessage?, httpStatus? } 반환
};
```

## 상태 전이 규칙
1. READY → LOCKED (`lockJobs`)
2. LOCKED → DONE: 모든 구독 발송 성공 또는 대상 구독 없음
3. LOCKED → FAILED: 하나라도 실패하면 FAILED로 기록하고 `last_error`에 실패 요약 저장

## 시나리오 적용 예시
1. 배치/이벤트 코드에서 dedup_key 생성 후 `enqueueNotifyJob(...)` 호출
2. 워커(크론/큐 컨슈머)에서 주기적으로 `runDueJobs(deliver)` 호출
3. 모니터링은 `push_message_logs` 상태/HTTP 코드, `notify_jobs.last_error` 기반으로 구성

## 남은 TODO
- 실제 web push 발송 구현(web-push 라이브러리) 및 템플릿/아웃바운드 메시지 매핑
- 재시도/백오프 정책 세분화, 실패 코드별 enabled_yn 업데이트 정책 정의
