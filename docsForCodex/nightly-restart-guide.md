# 매일 02:00(KST) 자동 재시작 및 배포 가이드

다음 절차는 운영 서버에서 매일 한국시간 오전 2시에 서비스 프로세스를 중단하고 최신 코드를 가져와 빌드한 뒤 다시 구동하기 위한 표준입니다. 기존 운영 정의서(런타임: `bun run start --port 3200 --hostname 0.0.0.0`, 프로세스 매니저: pm2)를 전제로 합니다.

## 1. 사전 준비
- **타임존 확인**: 서버가 UTC라면 크론에 `CRON_TZ=Asia/Seoul`을 명시해 KST 기준으로 실행되도록 합니다.
- **프로세스 명칭**: pm2 프로세스 이름은 `ops-v2`를 사용합니다. 이름이 다른 경우 아래 스크립트에서 수정하세요.
- **권한**: `git pull`과 `bun run build`가 성공할 수 있도록 저장소 경로와 권한을 확인합니다.

## 2. 재시작 스크립트 작성
`/workspace/tenaCierge/scripts/nightly_restart.sh`(경로는 환경에 맞게 수정 가능)에 다음 내용을 저장하고 실행 권한을 부여합니다.

```bash
#!/usr/bin/env bash
set -euo pipefail
export TZ=Asia/Seoul
LOG_DIR="/var/log/ops"
mkdir -p "${LOG_DIR}"
LOG_FILE="${LOG_DIR}/nightly_restart_$(date +%Y%m%d).log"
{
  echo "[START] $(date '+%Y-%m-%d %H:%M:%S %Z')"
  cd /workspace/tenaCierge

  echo "Stopping pm2 process"
  pm2 stop ops-v2 || true

  echo "Pulling latest code"
  git pull --ff-only

  echo "Installing deps (if lockfile changed)"
  bun install --frozen-lockfile

  echo "Building"
  bun run build

  echo "Restarting pm2"
  pm2 start bun --name ops-v2 -- run start --port 3200 --hostname 0.0.0.0

  echo "[END] $(date '+%Y-%m-%d %H:%M:%S %Z')"
} >>"${LOG_FILE}" 2>&1
```

> `--ff-only`는 깔끔한 히스토리를 보장합니다. 충돌이 발생하면 스크립트가 실패하고 로그에 남습니다.

## 3. 크론 등록 (KST 02:00 실행)
크론 편집기에서 다음 항목을 추가합니다. 서버 타임존이 UTC라면 `CRON_TZ=Asia/Seoul`을 함께 선언하세요.

```cron
CRON_TZ=Asia/Seoul
0 2 * * * /bin/bash /workspace/tenaCierge/scripts/nightly_restart.sh
```

- 로그는 `/var/log/ops/nightly_restart_YYYYMMDD.log`에 일 단위로 쌓입니다.
- 스크립트는 실패 시 즉시 종료(`set -euo pipefail`)하며, 중단 시점까지의 로그가 남습니다.

## 4. 수동 점검 체크리스트
- `pm2 list`로 프로세스 상태 확인
- 로그 확인: `tail -n 100 /var/log/ops/nightly_restart_$(date +%Y%m%d).log`
- 빌드 실패 시 해당 날짜의 로그를 확인한 뒤 수동으로 문제를 해결하고, 필요하면 재시작 스크립트를 재실행합니다.
