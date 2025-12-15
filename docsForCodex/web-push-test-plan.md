# 웹 푸시 테스트·검증 계획 (Step7 산출물)

목표: CLIENT/WORKER 컨텍스트, phone 정규화, dedup_key 기반 중복 차단, UPSERT 구독 저장, 6개 발송 시나리오가 의도대로 동작함을 확인한다. 자동화 가능 지점은 테스트 러너로 묶고, 배치/이벤트 흐름은 수동 체크리스트로 검증한다.

## 1. 사전 준비
- `.env.local` / `.env`에 VAPID 키 설정: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY`.
- DB: push_subscription UNIQUE(endpoint(255), type, user_id) 및 push_templates 1~6 시드 확인.
- 서비스워커 파일 `public/push-sw.js` 빌드/배포 경로 확인.

## 2. 단위 테스트 체크포인트
실제 테스트 코드는 TBD이지만, 아래 케이스로 jest/ts-jest 등을 구성한다는 가정.
- phone 정규화(`src/utils/phone.ts`):
  - 입력 `010-1234-5678` → `01012345678`
  - 공백/특수문자 제거, 길이 11 미만/초과 및 010 미시작 시 예외.
- dedup 생성기(`src/server/push/dedup.ts`): 시나리오별 포맷을 받는 값이 누락될 때 에러 발생, 정상 포맷 비교 스냅샷.
- VAPID env 로더(`src/server/push/env.ts`): 필수 키 부재 시 throw, subject mailto/http 모두 허용.
- WebPush deliver (`src/server/push/webPush.ts`):
  - VAPID 설정 주입 여부 검사(mock web-push).
  - 구독 객체 누락 필드 시 예외.

## 3. API 통합 테스트 체크리스트
cURL/REST Client 또는 e2e 툴로 검증.
- `/api/push/subscribe`
  - CLIENT: phone+register_no 필수, phone 정규화 후 client_header 매칭 → UPSERT 생성/갱신, enabled_yn=1 유지.
  - WORKER: phone 또는 register_no로 worker_header 조회 → UPSERT.
  - 이미 존재하는 endpoint/type/user_id 조합 재호출 시 중복 row 없이 키(p256dh/auth) 갱신되는지 확인.
  - enabled_yn=0 상태였던 경우, 구독 성공 시 1로 재활성화 되는지 확인.
  - validation 실패 시 400/422, 대상 없으면 404, 서버 오류 시 500 계약 준수 여부.

## 4. 발송 파이프라인/워커 테스트
- notify_jobs enqueue & lock(`src/server/push/jobs.ts`):
  - 동일 dedup_key로 enqueue 2회 시 1건만 READY 상태인지 확인.
  - lockDueJobs가 scheduled_at <= now 항목만 LOCKED로 변경하는지, id asc 정렬 유지 확인.
- deliver 처리:
  - mock deliver 함수로 DONE/FAILED 전이, retries 증가/오류 메시지 기록 확인.
- push_message_logs 작성:
  - job_id + subscription_id 조합으로 상태 READY→SENT/FAILED 흐름 기록.

## 5. 시나리오별 리그레션(6종)
각 시나리오는 `src/server/push/scenarios.ts`의 헬퍼를 통해 enqueue 후 워커로 처리한다.
- 청소 일정 푸시: 동일 client_id·date로 재실행 시 dedup_key로 1회만 발송.
- 청소 배정/해제: 같은 work_id/worker_id 이벤트 재처리 시 중복 차단.
- 청소 완료(마무리): butler 다수일 때 각자 1건씩, 중복 실행 시 재발송 없음.
- 소모품 안내: 동일 client_id·date 하루 1회 제한 확인(배치 재실행 시 suppressed).
- 업무 신청: tier=1 제외, today~today+7 범위 외는 큐잉되지 않는지 확인.

## 6. 프런트/서비스워커 수동 시나리오
브라우저(크롬/엣지)에서 아래를 수동 검증.
- 로그인 직후 배너 노출, "푸시 허용" 클릭 시 Notification 권한 → PushManager.subscribe 흐름이 정상 수행.
- permission이 denied일 때도 배너가 재노출되어 재시도 가능한지 확인.
- 이미 permission granted 상태에서 페이지 진입 시, 기존 구독을 서버와 동기화(UPSERT) 하는지 확인.
- 서비스워커 push 이벤트 수신 시 알림 제목/본문/아이콘/클릭 링크가 템플릿과 일치.
- 로그아웃 후 재로그인 시 컨텍스트(type) 전환에도 endpoint 재사용되어 중복 row가 생기지 않는지 확인.

## 7. 성능/인덱스 확인
- push_subscription(type,user_id,enabled_yn) 필터 쿼리 실행 계획 확인.
- notify_jobs(status,scheduled_at) 인덱스 활용 여부 확인 (대기 건수 증가 시 배치 시간 측정).

## 8. 테스트 실행 명령 예시
- 린트: `npm run lint`
- (예정) 단위 테스트: `npm test -- web-push` 또는 `npm run test:push` (추가 예정)
- 수동 REST 검증: REST Client 파일 혹은 cURL 스크립트 작성 권장.

## 9. 완료 기준
- 단위/통합/수동 시나리오 체크리스트 항목 모두 통과.
- dedup 충돌 없이 중복 발송 방지 확인.
- permission denied/등록 실패 케이스에서 사용자에게 재시도 가능 안내가 유지.
- 테스트 결과를 운영 배포 체크리스트(모니터링/롤백 포함)와 함께 Step8에서 확정.
