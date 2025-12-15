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

## 실제 웹푸시 송신기 (src/server/push/webPush.ts)
- `createWebPushDeliver` : VAPID 설정을 로드/주입한 뒤 `web-push` 모듈을 동적 로딩하여 위 계약을 충족하는 deliver 함수를 반환.
- `runWebPushWorker` : `runDueJobs`에 Web Push deliver를 결합해 워커 1회 실행(락→발송→로그→상태 업데이트) 흐름을 제공.
- send payload 구조: `{ templateId, title, body, iconUrl, clickUrl, data, dedupKey }` 를 JSON 직렬화하여 `web-push.sendNotification`에 전달하며 TTL/urgency 옵션을 매핑.
- 오류 처리: HTTP 404/410은 `EXPIRED`, 그 외는 `FAILED` 상태로 변환하여 로그에 적재.
- 의존성: `web-push` 패키지가 필요하며 실행 전 `npm install web-push`로 설치되어야 한다(현재 코드에서는 미설치 시 친절한 예외 메시지 출력).

## 상태 전이 규칙
1. READY → LOCKED (`lockJobs`)
2. LOCKED → DONE: 모든 구독 발송 성공 또는 대상 구독 없음
3. LOCKED → FAILED: 하나라도 실패하면 FAILED로 기록하고 `last_error`에 실패 요약 저장

## 시나리오 적용 예시
1. 배치/이벤트 코드에서 dedup_key 생성 후 `enqueueNotifyJob(...)` 호출
2. 워커(크론/큐 컨슈머)에서 주기적으로 `runDueJobs(deliver)` 호출
3. 모니터링은 `push_message_logs` 상태/HTTP 코드, `notify_jobs.last_error` 기반으로 구성

## 남은 TODO
- 재시도/백오프 정책 세분화, 실패 코드별 enabled_yn 업데이트 정책 정의
- 구독 만료(410 등) 발생 시 enabled_yn off 처리 및 클린업 배치 정의
- 크론/큐 러너에 `runWebPushWorker` 연결 및 알람/메트릭 수집 배선
