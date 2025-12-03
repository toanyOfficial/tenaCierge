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
