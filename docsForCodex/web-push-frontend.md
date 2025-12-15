# 웹 푸시 프론트/서비스워커 연동 메모

## 서비스워커 (public/push-sw.js)
- 경로: `/push-sw.js` (Next.js `public/`에서 서빙)
- 기능: `push` 이벤트에서 서버 payload(JSON) 를 파싱해 알림을 표시하고, `notificationclick` 시 `clickUrl`을 새 창/기존 창으로 이동.
- 기대 payload: `title`, `body`, `iconUrl`, `clickUrl`, `data`, `dedupKey` (서버 `webPush` 송신기 payload와 일치)

## 클라이언트 구독 유틸 (src/client/push/register.ts)
- `registerWebPush(contexts)`
  - VAPID 공개키(`NEXT_PUBLIC_VAPID_PUBLIC_KEY`) 존재 여부 검사 후, `Notification` 권한을 요청하고 SW 등록 → PushManager 구독 생성/재사용.
  - `contexts`별 `/api/push/subscribe` POST 호출: CLIENT는 phone+register 모두 필요, WORKER는 둘 중 하나 이상 필요.
  - 결과: `{ status: 'success' | 'skipped' | 'unsupported' | 'denied' | 'error', message, successes, failures, skipped }`
- 메타데이터: userAgent, platform(userAgentData.platform 우선), browser 브랜드, deviceMemory(있을 경우), locale을 함께 전송.

## 대시보드 배너 (app/(routes)/dashboard/WebPushEnrollment.tsx)
- 로그인 직후 알림 권한/구독 동기화를 요청하는 배너.
- 대상 컨텍스트 구성: host → CLIENT, cleaner/butler → WORKER (phone은 `normalizePhone`, registerNo는 trim/upper).
- 권한이 이미 `granted`면 자동으로 `registerWebPush`를 호출해 서버와 구독을 동기화하고, 실패 시 메시지/재시도 버튼 노출.
- CSS: `dashboard.module.css`에 `.pushBanner*` 스타일 추가.

## 환경 변수
- 브라우저: `NEXT_PUBLIC_VAPID_PUBLIC_KEY`
- 서버: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (이미 안내한 네이밍 사용)

## 호출 시나리오
1. 사용자가 로그인 후 대시보드 로드 → 배너가 렌더링.
2. 권한 상태에 따라 메시지 표시:
   - `granted`: 기존 구독 자동 동기화 → 성공/오류 안내.
   - `default/denied`: "푸시 허용하기" 버튼으로 권한 요청 및 구독/UPSERT 수행.
3. 서버는 `/api/push/subscribe`에서 context/phone/registerNo로 push_subscription UPSERT.

## 유의사항
- HOST/WORKER 동시 역할이면 두 컨텍스트 모두 전송(UNIQUE 제약이 context별로 분리되어 있음).
- VAPID 키가 없으면 `registerWebPush`가 `error` 반환 → 배너에 노출되므로 배포 전 `.env` 필수 설정.
- 서비스워커는 origin 루트 스코프로 등록하므로 별도 Next 설정 없이 배포 가능.
