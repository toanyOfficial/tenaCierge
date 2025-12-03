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
