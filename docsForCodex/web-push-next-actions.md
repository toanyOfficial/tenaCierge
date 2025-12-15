# 웹 푸시 남은 작업 체크리스트

> 질문: "이제 어떤 작업이 남았지?"에 대한 내부용 답변.

아래 항목은 Step9 문서 이후 실제 배포/운영 전까지 마무리해야 할 실행 과제다.

## 1) 필수 의존성/환경 세팅
- `web-push` 패키지 설치 및 lockfile 반영.
- `.env`/배포 시크릿에 `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY` 주입.
- 서비스 워커(`public/push-sw.js`)와 배포 도메인 일치 여부 확인(스코프/경로).

## 2) DB/시드 확정
- `push_templates` 1~6번 시드 존재 확인 및 없으면 UPSERT 실행.
- `notify_jobs`, `push_message_logs`, `push_subscription` 인덱스 적용 여부 점검 (UNIQUE/상태/시간 필터).

## 3) 시나리오 트리거 연결
- 배치/이벤트 소스(`db_forecasting.py`, `update_cleaner_ranking.py`, 업무 배정/해제 이벤트)에서 `webPushScenarios.*` 헬퍼 호출로 enqueue 연동.
- dedup_key 충돌 시 스킵 로그 남기도록 호출부 예외 처리 추가.

## 4) 워커 실행 경로 확정
- `runWebPushWorker`를 크론/큐 컨슈머에 연결하고 실행 주기 설정.
- 장애 시 재시작 전략과 락 타임아웃(LOCKED → READY) 설정 검증.

## 5) QA/검증
- Step7 테스트 플랜 따라 단위/통합/시나리오 수동 테스트 수행, 실제 푸시 수신까지 검증.
- 모바일 브라우저(안드로이드/크롬)에서 권한/동의/재구독 UX 점검.

## 6) 모니터링/운영 설정
- Step8 런북 기반으로 대시보드·알람 연동(실패율, VAPID 오류, dedup 충돌) 구성.
- 운영 토글(발송 on/off) 경로 마련 및 배포 롤백 절차 리허설.

## 7) 문서/커뮤니케이션
- 팀에 최종 Go/No-Go 체크리스트 공유 및 활성화 일정 확정.
- 서비스 공지/FAQ에 웹 푸시 허용 안내 문구 반영.
