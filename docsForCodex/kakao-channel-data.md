# Kakao 채널 메시지 전송 시 필요한 DB 데이터 점검

## 현재 DB에 있는 정보로 가능한 범위
- **고객 식별/연락처**: `client_header`에 `name`, `phone`이 있고 기본 과금/정산용 정보가 존재합니다. 전화번호 기반으로 친구추가 알림톡(카카오 비즈메시지)의 수신 대상 매칭 정도까지 가능합니다. `rcpt_*` 컬럼은 세금계산서/영수증용 정보라 채널 메시징에는 직접 쓰이지 않습니다.
- **클리너 식별/연락처**: `worker_header`에 `name`, `phone`, `reg_no`, `basecode_bank`/`account_no` 등 금융 정보가 있으며, 전화번호 기반 알림톡 발송 대상 매칭에 활용 가능합니다.
- **기타 도메인 컨텍스트**: 객실(`client_rooms`), 작업(`work_header`) 등에서 고객/작업 식별자를 참조하므로, 메시지 컨텐츠 생성에 필요한 예약/방 정보 조회는 가능합니다.

## 현 DB만으로 부족한 부분
- **채널 친구 여부/수신 동의 상태**: Kakao 채널 1:1 메시지는 수신자가 채널을 추가하고 개인정보/광고 수신에 동의해야 합니다. 현재 스키마에는 친구 여부, 동의 시각, 동의 범주(광고/정보성), 동의 채널(웹/앱) 같은 필드가 없습니다.
- **사용자별 Kakao 고유 식별자**: 채널 메시지 API는 `user_uuid`(카카오 로그인 + 채널 추가) 또는 비즈메시지용 수신전화번호+템플릿을 요구합니다. 전화번호만으로는 채널 1:1(서버 발신) 메시지를 보낼 수 없고, `user_uuid` 또는 비즈메시지(알림톡/친구톡)용 템플릿 정보가 필요합니다.
- **템플릿/채널 메타데이터**: 발신 채널의 `channel_id`(채널 추가용), 비즈앱 `rest_api_key`, `client_secret`, 발신 프로필 키, 발송 템플릿 ID, 메시지 카테고리(알림톡/친구톡), 광고 표기 여부, 발신번호 인증 정보 등이 DB/환경 변수에 정의되어 있어야 하나, 현재 스키마에는 관련 테이블이 없습니다.
- **수신 거부/해지 기록**: 광고성 메시지 발송 시 필수로 관리해야 하는 수신 거부 상태, 거부 시각, 거부 경로, 재동의 시각 등이 저장되지 않습니다. 법적 분쟁 대비 로그/이력 테이블이 필요합니다.

## 추가로 확보/저장해야 할 데이터 제안
1. **사용자 채널 식별자/동의 이력 테이블 (예: `kakao_channel_subscribers`)**
   - `user_type`(client/worker), `user_id`, `kakao_user_uuid`, `friend_status`, `ad_opt_in_yn`, `opt_in_scope`(광고/정보), `opt_in_dttm`, `opt_out_dttm`, `consent_version`, `source`(앱/웹/QR), `last_sync_dttm`.
2. **발송 메타/템플릿 테이블 (예: `kakao_templates`)**
   - `template_code`, `category`(알림톡/친구톡), `title`, `body`, `button_json`, `ad_yn`, `channel_id`, `sender_key`(비즈메시지), `use_yn`, `updated_at`.
3. **발송 로그/추적 테이블 (예: `kakao_message_logs`)**
   - `message_id`, `user_type`, `user_id`, `kakao_user_uuid`(또는 수신전화번호), `template_code`, `payload_json`, `status`(queued/sent/delivered/failed), `error_code`, `provider_message_id`, `sent_at`, `delivered_at`, `failed_at`, `price`.
4. **법적 필수 정보**
   - 광고성 발송 시 `ad_flag`, `ad_sender_name`, `unsubscribe_text`, `unsubscribe_link` 등을 템플릿/로그에 함께 저장하여 감사 및 분쟁 대응.

## 정리
- **현재 데이터로 가능한 것**: 전화번호 기반 알림톡(비즈메시지) 발송 대상 매칭까지는 가능하지만, 채널 1:1 메시지 발송에 필요한 `user_uuid`와 동의 이력이 없어 바로 구현할 수 없습니다.
- **추가 필요**: 채널 친구/동의 상태, Kakao 사용자 UUID, 템플릿/채널 메타 정보, 수신 거부/해지 이력을 저장할 테이블과 필드가 필요합니다.
