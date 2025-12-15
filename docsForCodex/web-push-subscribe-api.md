# 웹 푸시 구독 API 스펙 (/api/push/subscribe)

> 목적: push_subscription을 UPSERT하여 CLIENT/WORKER 컨텍스트별 중복 없이 저장하고, phone 정규화 및 register_no 검증 규칙을 코드와 일치시킨다.

## 요청 본문
```json
{
  "context": "CLIENT" | "WORKER",
  "endpoint": "https://...",
  "p256dh": "<base64>",
  "auth": "<base64>",
  "phone": "010-1234-5678" | null,
  "registerNo": "AB1234" | null,
  "userAgent": "...",
  "platform": "ios|android|pc|...",
  "browser": "chrome|safari|...",
  "deviceId": "optional device fingerprint",
  "locale": "ko-KR" | "en-US" | ...
}
```

## 검증/매핑 규칙
- **context**: `CLIENT` 또는 `WORKER` 필수.
- **공통 필수**: `endpoint`, `p256dh`, `auth` 모두 공백 불가.
- **phone 정규화**: 숫자만 추출 → 앞 `82` 제거 → `010xxxxxxxx` 11자리만 허용. 실패 시 `null`.
- **registerNo 정규화**: trim 후 대문자 변환. 빈 문자열이면 미제공으로 간주.

### CLIENT 케이스
- 입력: `phone` **and** `registerNo` 둘 다 필수.
- 조회: `client_header.phone = normalizedPhone AND client_header.register_code = normalizedRegister`.
- 실패 시 404 응답.

### WORKER 케이스
- 입력: `phone` **or** `registerNo` 둘 중 하나만 있어도 됨.
- 조회: `worker_header.phone = normalizedPhone` (phone이 있으면) **else** `worker_header.register_code = normalizedRegister`.
- 실패 시 404 응답.

## 동작
1) 대상 client/worker를 찾고 user_id를 결정한다.
2) `push_subscriptions`에 다음 값으로 UPSERT:
   - user_type = context, user_id, endpoint, p256dh, auth, enabled_yn=1, last_seen_at=now
   - user_agent/platform/browser/device_id/locale는 선택 저장
   - 중복 키(`user_type`, `endpoint`, `user_id`) 충돌 시 p256dh/auth/메타데이터 갱신 + enabled_yn=1
3) 성공 응답: `{ message, userId }`

## 오류 응답 예시
- 400: 잘못된 context / endpoint·p256dh·auth 누락 / CLIENT 필수값 누락 / WORKER phone·registerNo 둘 다 없음
- 404: CLIENT/WORKER 매칭 실패
- 500: 기타 서버 오류

## 비고
- enabled_yn=1인 상태로 덮어써 재동의가 필요 없는 케이스를 대비한다.
- dedup_key는 발송 시점에서 적용되므로 구독 API에서는 단순 UPSERT만 수행한다.
