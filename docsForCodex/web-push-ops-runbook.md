# Step8: 웹 푸시 모니터링 · 운영 · 배포 런북

> 목적: 웹 푸시 파이프라인(구독 → notify_jobs → web push 발송 → push_message_logs)에 대한 모니터링, 알람, 토글, 배포·롤백 절차를 한눈에 수행하기 위한 내부 운영 가이드.

## 0. 적용 범위
- API: `/api/push/subscribe` (UPSERT), notify job enqueue helpers, web push worker(발송) 전 구간.
- DB: `push_subscription`, `push_templates`, `notify_rules`, `notify_jobs`, `push_message_logs`.
- 프런트: 대시보드 푸시 배너 + `public/push-sw.js` 서비스워커.
- 비밀키: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY`.

## 1. 모니터링 대시보드 체크리스트
- **발송량/성공률 추이**: `push_message_logs.sent_at` 기준 최근 24h/7d 성공률(상태=DELIVERED 비율) 시계열.
- **상태별 큐 적체**: `notify_jobs` status 별 카운트 및 `scheduled_at` + `updated_at` 기반 지연 시간(LOCKED >5분 등) 히스토그램.
- **에러 상위 리스트**: `push_message_logs.http_status`, `error_code`, `error_message` 상위 10개·최근 발생 시간.
- **구독 활성 현황**: `push_subscription.enabled_yn=1` 건수, type 별(CLIENT/WORKER) 분포, 최근 24h 신규/비활성화 추이.
- **템플릿 사용 현황**: `push_message_logs` join `push_templates`로 id 별 발송량/성공률.
- **Dedup 충돌 감지**: `notify_jobs`(UNIQUE dedup_key), `push_message_logs.dedup_key` 위반 시 에러 로깅/알람.
- **서비스워커 동의율**: 프런트 이벤트 로그로 permission 상태(denied/default/granted) 비율.

## 2. 알람 기준 (초안)
- **연속 실패율**: 최근 15분 DELIVERED 비율 < 90% → 경고, < 80% → 심각.
- **HTTP 상태 코드**: 401/403(VAPID, 인증) 즉시 알람, 404/410(구독 만료) 누적 > N건/10분일 때 경고.
- **큐 적체**: READY 상태 `scheduled_at < now()`가 N건 이상 5분 지속 → 알람(워커 중단 의심).
- **Dedup 충돌**: UNIQUE violation 로그가 10분 내 3건 이상 → 시나리오 중복 실행 의심.
- **구독 급감**: enabled_yn=1 카운트가 1시간 내 5% 이상 급감 → 프런트/서비스워커 배포 이슈 점검.

## 3. 운영 토글 & 안전장치
- **전역 발송 차단**: 환경 변수 플래그(예: `WEB_PUSH_ENABLED=0`) 또는 워커 프로세스 중단 → 큐 적재만 허용.
- **템플릿 단위 토글**: `notify_rules.enabled_yn`/`push_templates` 활성 플래그로 특정 시나리오만 차단.
- **구독 비활성화**: 관리자 툴/SQL로 `push_subscription.enabled_yn=0` 업데이트(중복/오류 구독 정리 시).
- **재시도 컨트롤**: 워커 백오프/최대 재시도 횟수 환경 변수화(예: `WEB_PUSH_MAX_RETRY`, `WEB_PUSH_RETRY_DELAY_MS`).

## 4. 장애 대응 런북
1) **VAPID 인증 오류(401/403)**
   - 환경 변수 `VAPID_*` 노출/오타 확인 → 프로세스 재시작.
   - 동일 키로 curl/web-push 테스트 발송 후 정상 동작 확인.

2) **구독 만료(404/410) 급증**
   - 로그에서 endpoint 추출 → 해당 `push_subscription` 비활성화( enabled_yn=0 ).
   - 프런트에서 재구독 안내 배너 강제 노출(denied/default 상태 사용자 분리).

3) **큐 적체**
   - 워커 상태 확인(프로세스/로그), DB 락 확인.
   - 문제 시 `notify_jobs` LOCKED 오래된 건 unlock/retry 또는 상태 초기화.

4) **중복 발송 감지(dedup 실패)**
   - dedup_key 생성 소스 이벤트 중복 여부 확인.
   - 필요 시 `notify_jobs` enqueue 호출부에 멱등 키 보완, 일시적으로 해당 시나리오 토글 OFF.

5) **프런트 알림 미도착**
   - 브라우저 개발자 도구 Application 탭에서 서비스워커 등록·푸시 구독 상태 확인.
   - `NEXT_PUBLIC_VAPID_PUBLIC_KEY`와 서버 `VAPID_PUBLIC_KEY` 일치 여부 검증.

## 5. 배포/롤백 순서
1. **사전 점검**: VAPID 키/.env 확인, DB 마이그레이션/시드 완료 확인, lint/test 실행.
2. **서버 배포**: 구독 API/워커 코드 배포 → 워커 OFF 상태로 롤아웃 → 헬스체크.
3. **프런트 배포**: `NEXT_PUBLIC_VAPID_PUBLIC_KEY` 포함 빌드·배포, 서비스워커 캐시 무효화(파일명 변경 또는 cache bust).
4. **워커 ON**: `WEB_PUSH_ENABLED=1` 설정 후 워커 시작 → 소량 샘플 발송으로 연기/오류 확인.
5. **모니터링 강화 구간**: 첫 24h 대시보드 집중 관찰, 알람 민감도 상향.
6. **롤백**: 문제 시 워커 STOP → 서버 롤백 → 프런트 롤백(필요시) 순. 이미 적재된 `notify_jobs`는 무력화/삭제 여부 판단.

## 6. 운영 점검 주기 제안
- **일간**: 실패율/HTTP status/구독 활성 추이, dedup 충돌 여부 리포트.
- **주간**: 템플릿별 성능(오픈/클릭 데이터와 결합 가능 시) 리뷰, 알람 임계값 재조정.
- **배포 후**: 24h 내 집중 모니터링 + 회고 기록.

## 7. 사전 준비/체크리스트
- [ ] `.env`(서버)와 `.env.local`(클라이언트) 모두 `VAPID_*` 키 설정 완료.
- [ ] `push_templates` id 1~6 시드 확인.
- [ ] `notify_jobs`/`push_message_logs` 인덱스/UNIQUE 정상 동작 확인.
- [ ] 워커 실행 환경에서 포트/네트워크 아웃바운드 허용(web push 전송 가능) 확인.
- [ ] 모니터링 대시보드/알람 룰 생성 및 on-call 채널 연결.
- [ ] 롤백/드레인 스크립트 준비(`notify_jobs` 비우기, 워커 중단).

## 8. 참고
- 테스트/검증 케이스는 `docsForCodex/web-push-test-plan.md` 참고(이전 Step7).
- 전체 단계별 작업 맵은 `docsForCodex/web-push-step-plan.md` 참고.
