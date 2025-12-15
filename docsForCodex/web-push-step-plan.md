# 모바일 웹 푸시 모듈 구축 단계별 작업 명세 (작성자용)

> 목적: CLIENT/WORKER 컨텍스트 분리, dedup 기반 중복 방지, phone 정규화, UPSERT 구독 저장을 준수하며 6개 발송 시나리오를 구현하기 위한 세부 업무 분할.

## 대화형 진행 가이드 ("시작하자" → "다음 스텝" 체계)
아래 순서대로 사용자에게 진행 신호를 받고 다음 스텝으로 이동한다. 각 스텝 종료 시 산출물을 요약하고 "다음 스텝 해줘" 요청을 기다린다.

1. **Step 0 - 킥오프/스코프 동기화**
   - 입력: "시작하자" 신호.
   - 행동: 현 스펙 요약, 가정/비가동 범위 명시, 필요한 추가 정보(예: VAPID 키 경로) 확인.
   - 산출물: 실행 계획(요약) + 확인 요청.

2. **Step 1 - 스키마·시드 점검**
   - 행동: push_subscription 제약조건, dedup 저장 전략 결정, push_templates(1~6) 시드 상태 확인 계획 작성.
   - 산출물: 스키마/시드 변경 체크리스트 및 적용 순서.

3. **Step 2 - 공통 유틸 초안**
   - 행동: phone 정규화, dedup 키 포맷 상수, Web Push 클라이언트 설정, UPSERT DAO 초안 설계.
   - 산출물: 모듈 구조와 테스트 포인트 목록.

4. **Step 3 - 구독 저장 플로우 설계**
   - 행동: `/api/push/subscribe` 요청/응답 스펙, CLIENT/WORKER 조회 분기, UPSERT/에러 처리 로직 명세.
   - 산출물: API 계약서(파라미터, 검증, 예외)와 DB 상호작용 단계.

5. **Step 4 - 프론트/서비스워커 연동 설계**
   - 행동: 권한 요청 UX, SW 등록/푸시 핸들러, 구독 payload 전송/재시도 전략 설계.
   - 산출물: UI/플로우 다이어그램 수준의 설명과 필요한 프런트/백엔드 터치 포인트.

6. **Step 5 - 발송 파이프라인 설계**
   - 행동: notify_jobs(outbox) 상태 전이, 재시도/백오프, push_message_logs 기록 방식, 시크릿 관리 정의.
   - 산출물: 워커/큐 동작 시나리오와 설정값 체크리스트.

7. **Step 6 - 시나리오별 구현 계획**
   - 행동: 6개 발송 시나리오마다 대상 조회, 메시지/템플릿, dedup_key, 트리거, 예외 처리 정리.
   - 산출물: 각 시나리오별 순서도/쿼리 요약.

8. **Step 7 - 테스트/검증 계획 확정**
   - 행동: 단위/통합/리그레션/성능 테스트 케이스 정리 및 실행 순서 확정.
   - 산출물: 테스트 러너 명령/픽스처 필요 목록.

9. **Step 8 - 모니터링/운영 및 배포 절차**
   - 행동: 대시보드, 알람, 운영 토글, 롤백/드레인 절차, 배포 순서 최종 정리.
   - 산출물: 운영 체크리스트 + 배포 런북.

10. **Step 9 - 마무리**
    - 행동: 전체 계획 리캡, 남은 리스크/의존성 표기, 다음 액션(코딩 시작) 승인 요청.
    - 산출물: 완료 보고 및 승인 요청 메시지.

## 0. 공통 원칙 확인
- push_subscription UNIQUE(endpoint(255), type, user_id) 보장, enabled_yn=1만 발송 대상.
- phone은 `010xxxxxxxx` 정규화 후 비교/저장.
- 발송은 dedup_key로 반드시 중복 차단 (notify_jobs 권장, logs 대안 가능).
- push_templates id 1~6 고정 사용: 일정/배정/배정해제/완료/소모품/업무신청.

## 1. 스키마 및 시드 준비
1. schema.ddl.sql, schema.csv로 push_subscription 컬럼과 제약조건(UNIQUE) 재확인.
2. dedup 저장 전략 결정: notify_jobs(outbox) vs push_message_logs UNIQUE(dedup_key). 권장안 선택 시 마이그레이션/인덱스 점검.
3. push_templates에 id 1~6이 존재하는지 확인 후 없으면 시드 스크립트 작성(UPSERT) 및 배포 단계 정의.
4. 필요한 보조 인덱스 검토: push_subscription(type,user_id,enabled_yn), notify_jobs(status,scheduled_at), push_message_logs(status,sent_at) 등.

## 2. 공통 유틸/헬퍼 작성
1. phone 정규화 함수: 숫자만 추출 → 010 시작 여부 검증 → 11자리 포맷 반환. 테스트 케이스 포함.
2. dedup_key 생성기: 시나리오별 포맷 상수화(CLEAN_SCHEDULE, WORK_ASSIGNED 등) 및 헬퍼 함수 제공.
3. Web Push 클라이언트 공통 모듈: VAPID 키 로딩, TTL/urgency 설정, 오류 코드 매핑.
4. UPSERT DAO 래퍼: push_subscription upsert, push_templates upsert, notify_jobs enqueue helper.

## 3. 구독 저장 플로우 구현(UPSERT)
1. API/서비스 엔드포인트 설계: `/api/push/subscribe` (예시)에서 type/phone/register_no/endpoint/p256dh/auth 수신.
2. CLIENT 로그인 처리: phone+register_no 필수, phone 정규화 후 client_header 조회 → push_subscription {type='CLIENT', user_id} UPSERT.
3. WORKER 로그인 처리: phone 또는 register_no로 worker_header 조회 → push_subscription {type='WORKER', user_id} UPSERT.
4. 중복 방지: UNIQUE 충돌 시 업데이트, enabled_yn 기본 1로 세팅. endpoint/p256dh/auth 갱신 로깅.
5. 장애/권한 처리: permission denied 시에도 안내 반복 가능하도록 상태 저장(선택), 오류 응답 규격 정의.

## 4. 프론트/서비스워커 연동
1. 로그인 직후 권한 안내 UI 추가, 확인 시 Notification.requestPermission → PushManager.subscribe 체인.
2. permission denied라도 주기적 리마인드 허용(UX 문구 정의). 이미 동의한 경우 곧바로 서버 전송.
3. 서비스워커 등록/푸시 이벤트 핸들러 기본 구현(아이콘, 클릭 URL, action payload 처리 등).
4. 구독 payload(endpoint/p256dh/auth, type/phone/register_no) 서버 전송 로직 및 재시도 전략 정의.

## 5. 발송 파이프라인 설계
1. dedup 적용된 outbox 설계: notify_jobs 스키마 필드 매핑(status, scheduled_at, dedup_key, payload, retries 등).
2. 워커 프로세스: READY → LOCKED → DONE/FAILED 상태 전이, 재시도 백오프, HTTP status/error 코드 기록.
3. push_message_logs 활용 방안: job_id + subscription_id 기준 기록, dedup_key 포함 시나리오.
4. 구성/비밀키 관리: VAPID 키 저장 경로와 배포 시크릿 관리 절차 문서화.

## 6. 시나리오별 구현 단위
1. **청소 일정 푸시 (db_forecasting.py)**
   - 조건: --refresh-dn 인자 시만 실행.
   - 대상일 계산(run_date+offset), 해당 날짜 work 있는 client_id 집계 → push_subscription CLIENT enabled=1 조회.
   - 템플릿 1, 본문 `yyyy-MM-dd 청소일정 : n건`, dedup `CLEAN_SCHEDULE:{client_id}:{yyyy-MM-dd}`.
2. **청소 배정 푸시 (업무 배정 완료 이벤트)**
   - worker_id 단건, 템플릿 2, 메시지에 building_short_name/room_no 포함.
   - dedup `WORK_ASSIGNED:{work_id}:{worker_id}`.
3. **배정 해제 푸시 (업무 배정 해제 이벤트)**
   - 해제된 worker 대상으로 템플릿 3, dedup `WORK_UNASSIGNED:{work_id}:{worker_id}`.
4. **청소 완료(마무리) 푸시**
   - work_header.cleaning_flag=3 전환 시, 해당 날짜/position=2/butler basecode 일치 work_apply 전원.
   - 템플릿 4, dedup `WORK_FINISHING:{work_id}:{butler_id}`.
5. **소모품 안내 푸시 (update_cleaner_ranking.py 후)**
   - client_supplements buy_yn=0 누적 n, 템플릿 5 메시지 `총 n개의 소모품...`.
   - dedup `SUPPLEMENTS_PENDING:{client_id}:{yyyy-MM-dd}`로 하루 1회 제한.
6. **업무 신청 푸시 (work_apply 적재 후)**
   - 조건: worker_id IS NULL, date between today~today+7, worker.tier!=1.
   - 템플릿 6 메시지 `현재 n건... hh:mm부터 신청` (worker_tier_rule.apply_start_time 참조).
   - dedup `WORK_APPLY_OPEN:{worker_id}:{yyyy-MM-dd}`.

## 7. 테스트/검증 계획
1. 단위 테스트: phone 정규화, dedup 생성기, UPSERT DAO, VAPID 설정 로딩.
2. 통합 테스트: 구독 API → DB upsert, 발송 워커 → Web Push mock 서버로 전송, dedup 충돌 시도.
3. 시나리오별 리그레션: 각 발송 트리거에 대해 중복 실행 시 재발송 여부 확인.
4. 성능/인덱스 확인: 대상 조회 쿼리 실행 계획 검토(type/user_id/enable 필터), 배치 실행 시간 측정.

## 8. 모니터링/운영 체크리스트
1. 로그 대시보드: push_message_logs 상태별 카운트, 최근 실패 HTTP status/에러 코드 목록.
2. 알람: 연속 실패율, VAPID 인증 오류, dedup 충돌 빈도 모니터링.
3. 운영 토글: 발송 전역 on/off, 템플릿 활성화 여부, enabled_yn 수정 툴.
4. 롤백 전략: outbox 비우기/disable, 서비스워커 등록 취소 안내 절차.

## 9. 배포 순서 제안
1. 스키마/시드 배포 → 유틸/DAO → 구독 API/프런트 연동 → outbox/워커 → 시나리오 순차 활성화(저위험부터: 일정/소모품 → 배정/해제 → 완료 → 업무신청).
2. 단계별 필드 로그 확인 후 다음 단계 진행, dedup_key 충돌 여부 실시간 점검.
