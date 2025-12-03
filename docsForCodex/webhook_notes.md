# Webhook Registration Notes

The Kakao account-status and channel webhooks are backend-only HTTP endpoints. Registering them in the Kakao console does not automatically expose any front-end screens; only the POST endpoints are required.

## 등록 방법 (한글 요약)
1. HTTPS 도메인 확보: 배포된 도메인 또는 ngrok 등 HTTPS 터널 주소가 필요합니다.
2. 엔드포인트 배포: 다음 두 개의 URL이 200 OK를 반환하도록 서버에 POST 엔드포인트를 준비합니다.
   - 계정 상태 변경 웹훅: `https://<your-domain>/api/kakao/account-status`
   - 카카오톡 채널 웹훅: `https://<your-domain>/api/kakao/channel-webhook`
3. 카카오 콘솔 등록: 카카오 개발자 콘솔에서 각 항목의 웹훅 URL 입력란에 위 링크를 그대로 등록하고 “사용함”으로 설정합니다.
4. 테스트: 콘솔의 테스트 전송 기능 또는 cURL/Postman으로 샘플 페이로드를 POST해 200 응답과 로그 적재 여부를 확인합니다.

> 위 URL은 예시이며, `<your-domain>` 자리에 실서비스 도메인이나 외부에서 접근 가능한 HTTPS 주소를 넣어 등록하면 됩니다.

## 각 웹훅의 트리거와 내부 처리 흐름 (예시)
### 1) 계정 상태 변경 웹훅 (`/api/kakao/account-status`)
- **트리거 액션**: 카카오가 제공하는 OAuth 이벤트가 발생할 때마다 HTTP POST로 호출됨.
  - User Linked: 앱 유저가 채널/앱과 계정을 연결했을 때
  - User Unlinked: 연결 해제
  - User Scope Consent/Withdraw: 동의 항목을 새로 승인하거나 철회했을 때
  - Tokens Revoked: 발급된 토큰이 모두 만료되었을 때
- **권장 리액션** (서버 로직 예시):
  - 이벤트 타입별로 분기하여 DB의 사용자 상태/동의 범위를 업데이트
  - Unlinked/Withdraw/Revoked 시 발송 대상 리스트에서 제외하고, `kakao_optout_logs` 등에 로그 적재
  - Linked/Consent 시 `kakao_channel_subscribers`에 friend 상태/동의 범위 기록 및 이후 발송 파이프라인에 반영
  - 서명/보안 검증 후 200 OK 응답을 반환해 카카오 재시도 방지

### 2) 카카오톡 채널 웹훅 (`/api/kakao/channel-webhook`)
- **트리거 액션**: 사용자가 채널을 **추가**하거나 **차단(삭제)**할 때 HTTP POST로 호출됨.
  - 채널 추가 시: 친구 상태 FRIEND로 전환, 사용자 식별자(user_uuid 등)와 함께 알림
  - 채널 차단 시: 친구 상태 BLOCKED/UNFRIENDED로 전환 알림
- **권장 리액션** (서버 로직 예시):
  - 친구 추가 시 `kakao_channel_subscribers`에 upsert하여 친구 상태/동의 범위를 최신화, 재발송을 허용
  - 차단 시 `kakao_channel_subscribers` 상태를 BLOCKED로 업데이트하고 `kakao_optout_logs`에 수신 거부 이력 기록
  - 발송 파이프라인에서 friend/blocked 상태와 opt-out 여부를 필터링해 향후 메시지 전송을 제어
  - 이벤트 처리 성공 시 200 OK 응답

## 현재 상황과 해야 할 일 (404 발생 케이스 기준)
- **상황 요약**: 카카오가 `Content-Type: application/secevent+jwt`로 서명된 JWT를 `/api/kakao/account-status`에 POST했으나 404가 응답되었음. 이는 해당 경로에 라우트 파일이 없거나 배포 환경에 반영되지 않았음을 의미함.
- **받은 요청 형태**
  - 헤더 예시: `{ "kid": "9f252dadd5f233f93d2fa528d12fea", "typ": "secevent+jwt", "alg": "RS256" }`
  - 페이로드 예시: `events` 안에 `user-linked` 이벤트가 포함된 JWT(`aud`, `iss`, `sub`, `iat`, `toe`, `jti` 등 표준 클레임과 `events` 객체가 포함)
  - 실제 POST 바디는 위 JWT를 직렬화한 문자열 하나가 전송됨.
- **지금 해야 하는 작업** (코드 작성 전 개요)
  1. `/api/kakao/account-status` 경로에 POST를 처리할 백엔드 라우트 파일을 추가(Next.js라면 `app/api/kakao/account-status/route.ts`).
  2. 수신한 JWT를 파싱·검증: `kid`로 공개키 조회 → `RS256` 서명 검증 → `aud`가 우리 앱의 REST API 키(또는 지정 aud)인지 확인 → `iss`가 `https://kauth.kakao.com`인지 확인 → 만료/재생 공격 방지(`toe`, `iat`, `jti` 검증 및 재사용 방지 저장소 고려).
  3. `events` 내 이벤트 타입별로 내부 오퍼레이션 분기: `user-linked`면 구독자 연결 처리, `user-unlinked`/`tokens-revoked` 등은 구독자 상태/토큰 폐기, opt-out 로그 기록 등.
  4. 처리 결과를 로깅·DB 반영 후 200 OK를 반환해 카카오 재시도를 막음. 오류 시 4xx/5xx와 함께 원인 로그 남김.
- **작업 후 기대 변화**
  - 카카오 콘솔에서 테스트/실제 이벤트를 보내면 200 OK가 반환되고, `kakao_channel_subscribers`·`kakao_optout_logs`·발송 토큰 상태 등이 즉시 최신화됨.
  - 서명 검증과 aud/iss 검증이 완료되므로 위조 요청을 차단할 수 있음.
  - 동일 토큰 재전송 시 재사용 검증 로직으로 중복 처리 방지 가능.

## 다음 단계 전에 준비/확인해야 할 것들 (요청 정보 포함)
- **배포/도메인**: HTTPS로 외부에서 접근 가능한 도메인(예: `https://<your-domain>`)이 실제로 열려 있는지, 프록시/로드밸런서 뒤라면 올바르게 라우팅되는지 확인.
- **엔드포인트 반영 여부**: `app/api/kakao/account-status/route.ts`와 `app/api/kakao/channel-webhook/route.ts`가 배포 대상 브랜치에 존재하고, 200 OK를 반환하도록 동작 중인지 체크(현재 404 발생 → 미배포 상태 추정).
- **Kakao OAuth 클라이언트 정보**: `aud` 검증용으로 REST API 키(또는 발급받은 클라이언트 ID)가 무엇인지 공유 필요. 또한 `iss`는 `https://kauth.kakao.com`이 맞는지 확인.
- **JWKS 공개키 조회 경로**: 헤더의 `kid`로 RS256 서명을 검증하려면 Kakao의 JWKS URL을 알고 있어야 함(공유 요청). 키 회전 시 캐시 정책/갱신 주기를 정의해야 함.
- **이벤트별 내부 매핑 규칙**:
  - `user-linked`: 어떤 사용자 테이블/식별자(`sub`, `user_uuid`, 전화번호 등)와 매핑할지, 기존 회원정보와 연결 규칙 정의.
  - `user-unlinked` / `tokens-revoked`: 어떤 토큰/세션/메시지 발송 자격을 폐기할지 결정.
  - `user scope consent/withdraw`: 어떤 동의 항목(opt_in_scope)을 업데이트하고, 광고/정보성 발송에 어떻게 반영할지 합의 필요.
  - 채널 웹훅(add/block): `kakao_channel_subscribers`의 상태 값을 어떻게 정의(FRIEND/BLOCKED 등)하고 opt-out 로그와 연계할지 확인.
- **중복 처리/재시도 정책**: `jti` 기반 재사용 방지 저장소가 필요한지, 카카오 재시도 대비 멱등 키를 어떻게 설계할지 결정.
- **로그/모니터링**: 어떤 로그 레벨로 남길지, 실패 시 알림 채널(Slack 등)이 필요한지, PII 마스킹 범위를 확정.
- **테스트 데이터**: 샘플 JWT(실제 `aud`를 가진 것)와 채널 웹훅 페이로드 예시를 제공해 주면 로컬/스테이징에서 검증 가능.

## 받은 Kakao 키를 어디에 등록할지 가이드
- **보안 원칙**: 네이티브/REST/JavaScript/어드민 키는 `.env` 또는 시크릿 매니저에만 넣고, Git에 커밋하지 않습니다. 로컬은 `.env.local`, 서버는 배포 환경 변수로 등록합니다.
- **추천 변수명 예시 (.env.local)**
  ```env
  KAKAO_NATIVE_APP_KEY=a6e9f09cbea4cade7631cf66885f7ad4
  KAKAO_REST_API_KEY=250098953bfe547175f9b3b0e45978ec
  KAKAO_JAVASCRIPT_KEY=e6415440cfbbe4cb808920ed9f500fdb
  KAKAO_ADMIN_KEY=1e60255b55409aa3fa0df2bd2991dfe3
  ```
  - 프론트에서 노출이 필요한 경우(예: Kakao JS SDK 초기화)는 `NEXT_PUBLIC_KAKAO_JAVASCRIPT_KEY`처럼 `NEXT_PUBLIC_` 접두사를 사용하고, 나머지 키는 서버 전용 변수로만 사용합니다.
- **웹훅 관련 사용처**
  - `KAKAO_REST_API_KEY`: 계정 상태 변경 웹훅 JWT의 `aud` 검증값으로 사용. API 요청 시 Bearer 토큰 발급에도 쓰입니다.
  - `KAKAO_ADMIN_KEY`: 서버-to-서버 카카오톡 채널/알림톡 발송, 템플릿 관리 등 어드민 API 호출 시 Authorization 헤더(`KakaoAK <ADMIN_KEY>`)에 사용.
  - `KAKAO_JAVASCRIPT_KEY`: 웹 프론트에서 Kakao SDK를 초기화할 때만 사용(웹훅 자체에는 불필요).
  - `KAKAO_NATIVE_APP_KEY`: 모바일 네이티브 앱 연동 시만 사용(웹훅에는 직접적 사용 없음).
- **등록 위치 요약**
  1) 로컬 개발: 프로젝트 루트에 `.env.local` 파일을 만들고 위 변수명을 추가한 뒤 서버 재시작.
  2) 스테이징/프로덕션: 배포 플랫폼의 환경 변수 설정 화면에 동일한 변수명을 등록. 키 노출을 막기 위해 `.env` 파일은 저장소에 커밋하지 않습니다.
  3) 콘솔 설정 연계: 계정 상태 변경 웹훅에서 `aud` 검증 시 `KAKAO_REST_API_KEY` 값을 사용하고, 채널/알림톡 발송 로직이 필요할 때 `KAKAO_ADMIN_KEY`를 인증 헤더로 주입하는 식으로 코드에서 읽어 사용하면 됩니다.
