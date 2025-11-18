# DB Forecasting 배치 등록 가이드

이 문서는 `batchs/db_forecasting.py`를 운영 서버(Next.js/Bun 런타임이 설치된 웹 서버)에
등록하고 자동 실행하는 방법을 단계별로 설명합니다.

## 1. 사전 준비

1. **Python 런타임**: 서버에 Python 3.10+ 설치
2. **가상환경 생성**
   ```bash
   cd /srv/tenaCierge
   python3 -m venv .venv
   source .venv/bin/activate
   pip install -r batchs/requirements.txt
   ```
3. **환경변수 파일(.env.batch)**
   ```bash
   cat <<'EOF' > /srv/tenaCierge/.env.batch
   DB_HOST=127.0.0.1
   DB_PORT=3306
   DB_USER=tena
   DB_PASSWORD=********
   DB_NAME=tenaCierge
   EOF
   ```

## 2. 수동 실행 방법

```bash
source /srv/tenaCierge/.venv/bin/activate
set -a && source /srv/tenaCierge/.env.batch && set +a
python batchs/db_forecasting.py --run-date 2024-03-01 --start-offset 1 --end-offset 7
```

- 기본값: 오늘 기준 D+1~D+7, ics 보관 3일
- `--start-offset`, `--end-offset` 로 horizon 조정 가능

## 3. 시스템 배치 등록(systemd)

1. **실행 스크립트 작성** `/srv/tenaCierge/scripts/run_forecast.sh`
   ```bash
   #!/usr/bin/env bash
   set -euo pipefail
   cd /srv/tenaCierge
   source .venv/bin/activate
   set -a && source .env.batch && set +a
   python batchs/db_forecasting.py --start-offset 1 --end-offset 7 >> logs/forecasting.log 2>&1
   ```
   ```bash
   chmod +x /srv/tenaCierge/scripts/run_forecast.sh
   ```

2. **systemd 서비스/타이머 등록**

   `/etc/systemd/system/tena-forecasting.service`
   ```ini
   [Unit]
   Description=Tena Forecasting Batch
   After=network.target mysql.service

   [Service]
   Type=oneshot
   User=deploy
   WorkingDirectory=/srv/tenaCierge
   ExecStart=/srv/tenaCierge/scripts/run_forecast.sh
   ```

   `/etc/systemd/system/tena-forecasting.timer`
   ```ini
   [Unit]
   Description=Run Tena Forecasting every day 15:00

   [Timer]
   OnCalendar=*-*-* 15:00:00 Asia/Seoul
   Persistent=true

   [Install]
   WantedBy=timers.target
   ```

   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable --now tena-forecasting.timer
   sudo systemctl list-timers | grep forecasting
   ```

## 4. 웹 서버(Next.js)에서 배치 관리 API 등록 예시

App Router 프로젝트라면 `/app/api/batch/register/route.ts` 형태로 관리자 전용 API를 만들어
systemd 상태 또는 최근 실행 로그를 대시보드에 노출할 수 있습니다. 예시는 다음과 같습니다.

```ts
// app/api/batch/register/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";

const schema = z.object({
  jobId: z.string(),
  schedule: z.string(),
  lastRunAt: z.string().datetime(),
  status: z.enum(["ready", "running", "failed"]),
});

export async function POST(req: Request) {
  const body = schema.parse(await req.json());
  // DB (예: etc_baseCode) 에 등록하거나 Slack으로 전송 등
  console.log("batch register", body);
  return NextResponse.json({ ok: true });
}
```

서버에서 systemd 상태를 HTTP로 업데이트하려면 배치 완료 직후 다음과 같이 호출합니다.

```bash
curl -X POST https://ops.tenacierge.com/api/batch/register \
  -H 'Content-Type: application/json' \
  -d '{
        "jobId": "forecasting",
        "schedule": "daily 15:00",
        "lastRunAt": "'"$(date -Iseconds)'"",
        "status": "ready"
      }'
```

이를 통해 웹 서버 대시보드에서 배치 현황을 확인하고 재실행 버튼을 노출할 수 있습니다.

## 5. 장애 대응 체크리스트

- `logs/forecasting.log`에서 `requests`/`mysql.connector` 예외 확인
- `work_fore_*` 테이블에 run_dttm=오늘 데이터가 없으면 systemd timer 동작 여부 확인
- `model_variable` 테이블이 비어 있으면 기본값이 자동 채워지지만, DBA가 수동 조정 가능
- ics 다운로드 실패 시 `batchs/ics`에 timestamp 폴더가 생성되었는지 확인

위 과정을 적용하면 파일 기반 배치를 DB 기반으로 전환하면서도 웹 서버/대시보드와의 연결이 가능합니다.
