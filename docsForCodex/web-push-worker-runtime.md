# 웹 푸시 워커 실행 경로 (outbox/worker 패턴 적용)

## 실행 방식 요약
- **패턴**: `notify_jobs` 아웃박스 → `runWebPushWorker`가 READY 작업을 LOCKED→DONE/FAILED로 소비.
- **실행 경로**: Next API `/api/push/worker`를 크론/시스템 타이머가 주기적으로 호출해 워커 1사이클을 실행합니다.
- **보안**: `PUSH_WORKER_TOKEN` 설정 시 `x-worker-token` 헤더로 인증하지 않으면 401.

## 기본 실행 설정
- **주기**: 30~60초 권장. (예시) `* * * * *` 크론 또는 systemd timer로 1분마다 호출.
- **배치 크기**: `PUSH_WORKER_BATCH_SIZE`(기본 50) — 1사이클에서 LOCK 시도할 작업 수.
- **locked_by**: `PUSH_WORKER_ID`(기본 `webpush-cron`) — 락 오너 표시.
- **엔드포인트**: `POST {BASE_URL}/api/push/worker` with JSON `{ limit, lockedBy }`.

## 배포 후 실제 실행 예시
1. `.env` (Next 서버):
   ```
   PUSH_WORKER_TOKEN=change-me
   PUSH_WORKER_BATCH_SIZE=50
   PUSH_WORKER_ID=webpush-cron
   ```
2. 크론(1분 주기) 설정:
   ```cron
   * * * * * PUSH_WORKER_BASE_URL="https://api.example.com" PUSH_WORKER_TOKEN="change-me" /srv/app/scripts/push-worker-cron.sh >> /var/log/webpush-worker.log 2>&1
   ```
3. systemd timer로 운영하려면 `push-worker-cron.sh`를 `ExecStart`로 등록하고 `Persistent=true`, `OnUnitActiveSec=30s` 설정.

## 재시작/내결함성 전략
- **크론/타이머 재시작**: 타이머 실패 시 다음 주기 자동 재시작. (장애 시에도 이후 호출이 계속 재시도)
- **락 타임아웃**: `notify_jobs`의 LOCKED 레코드는 기존 `lockJobs` 재호출 시 다시 READY로 풀리는 방식(중복 실행 방지). 별도 프로세스 재기동 불필요.
- **보안 실패**: 잘못된 토큰/인증 오류는 로그만 남고 다음 사이클에서 복구.

## 커맨드/파일
- 워커 엔드포인트: `app/api/push/worker/route.ts` — limit/lockedBy/now 옵션 처리 및 실행 로그 출력.
- 크론 호출 스크립트: `scripts/push-worker-cron.sh` — BASE_URL/토큰/배치 크기 환경변수 기반 `curl` 호출.

## 운영 모니터링 팁
- API 로그에서 `[web-push] worker run complete` (발송됨) 또는 `worker idle`(처리 없음) 메시지 확인.
- 실패 시 `[web-push] worker run failed` 로그 및 `notify_jobs.last_error`, `push_message_logs.status` 확인.
