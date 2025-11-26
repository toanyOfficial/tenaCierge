# 크론탭 배치 등록 가이드

다음 예시는 `/srv/tenaCierge`에 배치 코드를 배포했고 `.venv`와 `.env.batch`를 이미 준비한 상태를 전제로 합니다. 각 작업은 표준 출력/에러를 `logs/` 폴더에 남기도록 구성했습니다. 필요에 따라 경로와 시간대를 조정하세요.

## 환경 변수와 가상환경 활성화 공통 블록
```bash
cd /srv/tenaCierge
source .venv/bin/activate
set -a && source .env.batch && set +a
```

## 크론탭 예시
`crontab -e`에 아래 블록을 추가합니다. (모두 Asia/Seoul 기준)

```
# 1) 매일 14:50 D+1~D+7 예측 및 D+1 work_header/work_apply 생성
50 14 * * * cd /srv/tenaCierge && \
  source .venv/bin/activate && set -a && source .env.batch && set +a && \
  python batchs/db_forecasting.py --start-offset 1 --end-offset 7 >> logs/forecasting.log 2>&1

# 2) 매일 09:00 당일(D0) 헤더 보강 전용
0 9 * * * cd /srv/tenaCierge && \
  source .venv/bin/activate && set -a && source .env.batch && set +a && \
  python batchs/db_forecasting.py --today-only >> logs/forecast_today.log 2>&1

# 3) 매주 월요일 02:00 예측 모델 재학습(Shadow/Active 선택)
0 2 * * 1 cd /srv/tenaCierge && \
  source .venv/bin/activate && set -a && source .env.batch && set +a && \
  python batchs/train_model.py --days 60 --horizon both --apply >> logs/train_model.log 2>&1

# 4) 매일 16:20 클리너 랭킹/코멘트 갱신
20 16 * * * cd /srv/tenaCierge && \
  source .venv/bin/activate && set -a && source .env.batch && set +a && \
  python batchs/update_cleaner_ranking.py --target-date "$(date +\%F)" >> logs/cleaner_ranking.log 2>&1
```

### 옵션 설명
- `db_forecasting.py --start-offset 1 --end-offset 7`: 오늘(D0)을 기준으로 D+1~D+7 구간을 생성하는 기본 모드입니다. 필요 시 horizon을 변경합니다.
- `db_forecasting.py --today-only`: 당일(D0) 헤더만 보강하는 모드로, work_apply나 정확도 갱신은 수행하지 않습니다.
- `train_model.py --days 60 --horizon both --apply`: 최근 60일 D1/D7 데이터를 모두 학습해 모델 파라미터를 갱신합니다. 초기 안정화 단계에서는 `--apply`를 제거해 Shadow 모드로 운용할 수 있습니다.
- `update_cleaner_ranking.py --target-date $(date +%F)`: 당일 평가 이력을 기준으로 랭킹을 재계산합니다. 필요하면 실행 시간을 조정하십시오.

### 운영 팁
- `.env.batch`에 DB 접속 정보가 없으면 스크립트가 즉시 종료되므로 배포 시 반드시 채워 넣으세요.
- 로그가 누적되므로 주기적 로테이션을 권장합니다(`logrotate` 등).
- 서버의 기본 타임존이 Asia/Seoul이 아니라면 crontab에 `TZ=Asia/Seoul`을 명시하거나 시간대를 보정하세요.
