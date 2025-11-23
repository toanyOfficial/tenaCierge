🔔 배치 프로그램 개요

01. ICS 분석(매일 14:50)
- 모든 객실의 ICS 파일을 내려받아 보관 폴더(D0~D3)를 순환 정리한다.
- D1·D7 체크아웃 예측을 학습/튜닝하고 성능을 기록한다.
- D1 예측 결과를 기반으로 다음날 `work_header` 데이터를 생성한다.
- D1~D7 체크아웃 예측을 sector 가중치 규칙에 매핑해 `work_apply` 데이터를 생성한다.

02. 랭크 재조정(매일 17:00)
- 최근 20일간 `worker_evaluateHistory` 총점을 합산한다.
- `worker_tier_rules` 테이블에서 정의한 구간(min < percentile ≤ max)을 읽어 점수 퍼센타일에
  맞춰 tier를 재산정한다.

03. 당일 헤더 보강(매일 09:00)
- 기준일(run_date) = target_date(D0)로 두고, **해당 날짜의 checkout/checkin 여부만** 확인한다.
- checkout이 있는 방은 cleaning_yn=1, 없는 대신 checkin만 있는 방은 conditionCheckYn=1,
  cleaning_yn=0으로 `work_header`에 추가한다.
- apply/정확도/튜닝 계산은 수행하지 않으며, 기존 행이 있으면 건너뛴다.

실행 전 준비
- DB 접속 정보는 환경 변수 `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`으로
  전달해야 한다. 예) `set -a && source /srv/tenaCierge/.env.batch && set +a`
- `DB_PASSWORD`가 비어 있으면 스크립트는 즉시 종료하므로 비밀번호를 반드시 지정한다.

0. 밑작업
ics파일은 D0 D1 D2 D3 폴더를 만들어두고 3일간 보관한다. 배치 돌릴 때 마다
- D3폴더에 있는 모든 컨텐츠를 삭제한다.
- D2폴더에 있는 모든 컨텐츠를 D3폴더로 옮긴고 D2폴더의 모든 컨텐츠를 삭제한다.
- D1폴더에 있는 모든 컨텐츠를 D2폴더로 옮기고 D1폴더의 모든 컨텐츠를 삭제한다.
- D0폴더에 있는 모든 컨텐츠를 D1폴더로 옮기고 D0폴더의 모든 컨텐츠를 삭제한다.



🆕 README 최신 업데이트 요약

- 12번 섹션에 `train_model.py` 기반 **AI 학습 배치**를 정식 문서화했습니다. DB에 쌓인
  `work_fore_d1/d7` 데이터를 로지스틱 회귀로 재학습하고, Shadow/Active 모드 전환 절차,
  CLI 옵션(`--days`, `--horizon`, `--min-samples`, `--target-precision`, `--apply`)을
  README에서 바로 확인할 수 있습니다.
- 문서 말미의 "📦 추가 안내"에서는 `db_forecasting.py`, `schema.sql`,
  `BATCH_REGISTRATION.md`까지 한 번에 찾아볼 수 있도록 경로/역할을 정리했습니다.
- 배포/운영팀은 새 systemd 등록 절차(`BATCH_REGISTRATION.md` 6장)를 참고해 웹 서버에
  학습 배치를 안전하게 등록할 수 있습니다.
- work_header 저장 규칙(15:00 배치)과 클리너 랭킹 업데이트 배치(16:30)가 추가되어,
  `db_forecasting.py`와 `update_cleaner_ranking.py`에서 각각 어떻게 데이터를 적재/재정렬하는지
  바로 확인할 수 있습니다.
- 15:00 배치가 sector별 가중치(`client_rooms.weight`)와 규칙 테이블(`work_apply_rules`)을
  읽어 `work_apply` 데이터를 미리 생성하고, 정직원 근무 패턴(`worker_weekly_pattern`/
  `worker_schedule_exception`)을 기반으로 버틀러 슬롯을 우선 배정하도록 보강했습니다.



🧩 1. 기본 개념

본 프로그램은 database의 client_rooms 테이블을 기반으로 각 객실의 ICS 캘린더를 다운로드하고,
지정된 날짜들의 예약 상태를 분석하여 확정 퇴실(out) 과 예측 퇴실(potential) 을 계산한다.

ICS의 DTEND 값을 기준으로 실제 퇴실을 판정하고,
모델 파라미터(alpha, beta, high)를 이용해 각 객실의 퇴실 확률 p_out을 예측한다.

horizon(예측 거리)에 따라

D−1 → 내일 퇴실 예측 (실무용, 컷오프 중심)
D−7 → 일주일 후 퇴실 예측 (패턴 학습 중심)
D−2~D−6은 선형 보간, 7일 이상은 D−7 변수 사용.

매일 15:00, database의 work_fore_d1, work_fore_d7, work_fore_accuracy, work_fore_tuning 테이블을 자동 갱신하고 work_header 테이블에 다음날의 업무리스트를 저장한다.

업무리스트 저장 rule
- 매일 15:00 배치가 돌기 때문에 D+1 날짜의 입퇴실을 기준으로 하며 이 D+1날짜를 '당일'이라 칭한다.
- 당일 퇴실이 있다면 무조건 클리닝 대상(cleaning yn==1)
- 당일 퇴실은 없고 입실만 있다면 상태확인 대상(condition check yn==1 cleaning yn==0)
- blanket_qty, amaenities_qty는 room 정보의 bed qty와 동일
- checin, checkout time은 room 정보에서 가져온다
- 나머지 값들은 추후 입력 값이기 때문에 null

🧾 7-2. work_apply 생성 Rule (매일 15:00)
- D1~D7 ICS에서 추출한 "확정 퇴실(out)" 객실만 대상으로, `client_rooms.weight`를
  sector별로 합산한다.
- 합산한 가중치를 `work_apply_rules`의 구간에 대입해 필요한 클리너·버틀러 슬롯 수를
  계산한다. 비교식은 항상 `min_weight < 합계 ≤ max_weight`(하한 초과, 상한 포함)를 사용한다.
- 해당 날짜의 기존 `work_apply` 데이터를 삭제하지 않고, 부족한 슬롯만 seq를 이어서 추가한다.
  이때 `worker_id`는 NULL로 비워두며, 실제 신청/배정 시점에 업데이트한다.
- 규칙을 찾지 못하거나 가중치 합이 0인 sector는 건너뛰고, 이미 만들어진 슬롯은 유지한다.

📅 2. 날짜 입력 및 실행 모드
실행한날짜를 D0라고 했을때 다음날인 D1부터  다음주 같은요일까지의 D7 일정을 체크한다. 서버에 배치프로그램으로 등록한다.

- `--run-date`를 생략하면 **서울 시간(KST) 기준 오늘 날짜**를 자동으로 사용하므로 서버 TZ가 달라도
  항상 오늘(D0) → D1~D7 범위를 생성한다. 실수로 과거/미래 날짜를 넘기면 기본적으로 서울 오늘
  날짜로 강제되며, 정말로 백필을 원할 때만 `--run-date YYYY-MM-DD --allow-backfill`을 함께 준다.
- 매일 09:00에 운영하는 당일 전용 배치는 `--today-only`를 켜면 된다. 이 경우 run_date=target_date로
  간주하고 work_header만 생성하며 work_apply/정확도/튜닝 갱신은 건너뛴다.

- `--run-date`를 생략하면 **서울 시간(KST) 기준 오늘 날짜**를 자동으로 사용하므로 서버 TZ가 달라도
  항상 오늘(D0) → D1~D7 범위를 생성한다. 실수로 과거/미래 날짜를 넘기면 기본적으로 서울 오늘
  날짜로 강제되며, 정말로 백필을 원할 때만 `--run-date YYYY-MM-DD --allow-backfill`을 함께 준다.
- 매일 09:00에 운영하는 당일 전용 배치는 `--today-only`를 켜면 된다. 이 경우 run_date=target_date로
  간주하고 work_header만 생성하며 work_apply/정확도/튜닝 갱신은 건너뛴다.

- `--run-date`를 생략하면 **서울 시간(KST) 기준 오늘 날짜**를 자동으로 사용하므로 서버 TZ가 달라도
  항상 오늘(D0) → D1~D7 범위를 생성한다. 실수로 과거/미래 날짜를 넘기면 기본적으로 서울 오늘
  날짜로 강제되며, 정말로 백필을 원할 때만 `--run-date YYYY-MM-DD --allow-backfill`을 함께 준다.
- 매일 09:00에 운영하는 당일 전용 배치는 `--today-only`를 켜면 된다. 이 경우 run_date=target_date로
  간주하고 work_header만 생성하며 work_apply/정확도/튜닝 갱신은 건너뛴다.

- `--run-date`를 생략하면 **서울 시간(KST) 기준 오늘 날짜**를 자동으로 사용하므로 서버 TZ가 달라도
  항상 오늘(D0) → D1~D7 범위를 생성한다. 실수로 과거/미래 날짜를 넘기면 기본적으로 서울 오늘
  날짜로 강제되며, 정말로 백필을 원할 때만 `--run-date YYYY-MM-DD --allow-backfill`을 함께 준다.
- 매일 09:00에 운영하는 당일 전용 배치는 `--today-only`를 켜면 된다. 이 경우 run_date=target_date로
  간주하고 work_header만 생성하며 work_apply/정확도/튜닝 갱신은 건너뛴다.

- `--run-date`를 생략하면 **서울 시간(KST) 기준 오늘 날짜**를 자동으로 사용하므로 서버 TZ가 달라도
  항상 오늘(D0) → D1~D7 범위를 생성한다. 실수로 과거/미래 날짜를 넘기면 기본적으로 서울 오늘
  날짜로 강제되며, 정말로 백필을 원할 때만 `--run-date YYYY-MM-DD --allow-backfill`을 함께 준다.
- 매일 09:00에 운영하는 당일 전용 배치는 `--today-only`를 켜면 된다. 이 경우 run_date=target_date로
  간주하고 work_header만 생성하며 work_apply/정확도/튜닝 갱신은 건너뛴다.

- `--run-date`를 생략하면 **서울 시간(KST) 기준 오늘 날짜**를 자동으로 사용하므로 서버 TZ가 달라도
  항상 오늘(D0) → D1~D7 범위를 생성한다. 실수로 과거/미래 날짜를 넘기면 기본적으로 서울 오늘
  날짜로 강제되며, 정말로 백필을 원할 때만 `--run-date YYYY-MM-DD --allow-backfill`을 함께 준다.
- 매일 09:00에 운영하는 당일 전용 배치는 `--today-only`를 켜면 된다. 이 경우 run_date=target_date로
  간주하고 work_header만 생성하며 work_apply/정확도/튜닝 갱신은 건너뛴다.

- `--run-date`를 생략하면 **서울 시간(KST) 기준 오늘 날짜**를 자동으로 사용하므로 서버 TZ가 달라도
  항상 오늘(D0) → D1~D7 범위를 생성한다. 실수로 과거/미래 날짜를 넘기면 기본적으로 서울 오늘
  날짜로 강제되며, 정말로 백필을 원할 때만 `--run-date YYYY-MM-DD --allow-backfill`을 함께 준다.
- 매일 09:00에 운영하는 당일 전용 배치는 `--today-only`를 켜면 된다. 이 경우 run_date=target_date로
  간주하고 work_header만 생성하며 work_apply/정확도/튜닝 갱신은 건너뛴다.

- `--run-date`를 생략하면 **서울 시간(KST) 기준 오늘 날짜**를 자동으로 사용하므로 서버 TZ가 달라도
  항상 오늘(D0) → D1~D7 범위를 생성한다. 실수로 과거/미래 날짜를 넘기면 기본적으로 서울 오늘
  날짜로 강제되며, 정말로 백필을 원할 때만 `--run-date YYYY-MM-DD --allow-backfill`을 함께 준다.
- 매일 09:00에 운영하는 당일 전용 배치는 `--today-only`를 켜면 된다. 이 경우 run_date=target_date로
  간주하고 work_header만 생성하며 work_apply/정확도/튜닝 갱신은 건너뛴다.

- `--run-date`를 생략하면 **서울 시간(KST) 기준 오늘 날짜**를 자동으로 사용하므로 서버 TZ가 달라도
  항상 오늘(D0) → D1~D7 범위를 생성한다. 실수로 과거/미래 날짜를 넘기면 기본적으로 서울 오늘
  날짜로 강제되며, 정말로 백필을 원할 때만 `--run-date YYYY-MM-DD --allow-backfill`을 함께 준다.
- 매일 09:00에 운영하는 당일 전용 배치는 `--today-only`를 켜면 된다. 이 경우 run_date=target_date로
  간주하고 work_header만 생성하며 work_apply/정확도/튜닝 갱신은 건너뛴다.

- `--run-date`를 생략하면 **서울 시간(KST) 기준 오늘 날짜**를 자동으로 사용하므로 서버 TZ가 달라도
  항상 오늘(D0) → D1~D7 범위를 생성한다. 실수로 과거/미래 날짜를 넘기면 기본적으로 서울 오늘
  날짜로 강제되며, 정말로 백필을 원할 때만 `--run-date YYYY-MM-DD --allow-backfill`을 함께 준다.
- 매일 09:00에 운영하는 당일 전용 배치는 `--today-only`를 켜면 된다. 이 경우 run_date=target_date로
  간주하고 work_header만 생성하며 work_apply/정확도/튜닝 갱신은 건너뛴다.

- `--run-date`를 생략하면 **서울 시간(KST) 기준 오늘 날짜**를 자동으로 사용하므로 서버 TZ가 달라도
  항상 오늘(D0) → D1~D7 범위를 생성한다. 실수로 과거/미래 날짜를 넘기면 기본적으로 서울 오늘
  날짜로 강제되며, 정말로 백필을 원할 때만 `--run-date YYYY-MM-DD --allow-backfill`을 함께 준다.
- 매일 09:00에 운영하는 당일 전용 배치는 `--today-only`를 켜면 된다. 이 경우 run_date=target_date로
  간주하고 work_header만 생성하며 work_apply/정확도/튜닝 갱신은 건너뛴다.

- `--run-date`를 생략하면 **서울 시간(KST) 기준 오늘 날짜**를 자동으로 사용하므로 서버 TZ가 달라도
  항상 오늘(D0) → D1~D7 범위를 생성한다. 실수로 과거/미래 날짜를 넘기면 기본적으로 서울 오늘
  날짜로 강제되며, 정말로 백필을 원할 때만 `--run-date YYYY-MM-DD --allow-backfill`을 함께 준다.
- 매일 09:00에 운영하는 당일 전용 배치는 `--today-only`를 켜면 된다. 이 경우 run_date=target_date로
  간주하고 work_header만 생성하며 work_apply/정확도/튜닝 갱신은 건너뛴다.

- `--run-date`를 생략하면 **서울 시간(KST) 기준 오늘 날짜**를 자동으로 사용하므로 서버 TZ가 달라도
  항상 오늘(D0) → D1~D7 범위를 생성한다. 실수로 과거/미래 날짜를 넘기면 기본적으로 서울 오늘
  날짜로 강제되며, 정말로 백필을 원할 때만 `--run-date YYYY-MM-DD --allow-backfill`을 함께 준다.
- 매일 09:00에 운영하는 당일 전용 배치는 `--today-only`를 켜면 된다. 이 경우 run_date=target_date로
  간주하고 work_header만 생성하며 work_apply/정확도/튜닝 갱신은 건너뛴다.

- `--run-date`를 생략하면 **서울 시간(KST) 기준 오늘 날짜**를 자동으로 사용하므로 서버 TZ가 달라도
  항상 오늘(D0) → D1~D7 범위를 생성한다. 실수로 과거/미래 날짜를 넘기면 기본적으로 서울 오늘
  날짜로 강제되며, 정말로 백필을 원할 때만 `--run-date YYYY-MM-DD --allow-backfill`을 함께 준다.
- 매일 09:00에 운영하는 당일 전용 배치는 `--today-only`를 켜면 된다. 이 경우 run_date=target_date로
  간주하고 work_header만 생성하며 work_apply/정확도/튜닝 갱신은 건너뛴다.

- `--run-date`를 생략하면 **서울 시간(KST) 기준 오늘 날짜**를 자동으로 사용하므로 서버 TZ가 달라도
  항상 오늘(D0) → D1~D7 범위를 생성한다. 실수로 과거/미래 날짜를 넘기면 기본적으로 서울 오늘
  날짜로 강제되며, 정말로 백필을 원할 때만 `--run-date YYYY-MM-DD --allow-backfill`을 함께 준다.
- 매일 09:00에 운영하는 당일 전용 배치는 `--today-only`를 켜면 된다. 이 경우 run_date=target_date로
  간주하고 work_header만 생성하며 work_apply/정확도/튜닝 갱신은 건너뛴다.

- `--run-date`를 생략하면 **서울 시간(KST) 기준 오늘 날짜**를 자동으로 사용하므로 서버 TZ가 달라도
  항상 오늘(D0) → D1~D7 범위를 생성한다. 실수로 과거/미래 날짜를 넘기면 기본적으로 서울 오늘
  날짜로 강제되며, 정말로 백필을 원할 때만 `--run-date YYYY-MM-DD --allow-backfill`을 함께 준다.
- 매일 09:00에 운영하는 당일 전용 배치는 `--today-only`를 켜면 된다. 이 경우 run_date=target_date로
  간주하고 work_header만 생성하며 work_apply/정확도/튜닝 갱신은 건너뛴다.

- `--run-date`를 생략하면 **서울 시간(KST) 기준 오늘 날짜**를 자동으로 사용하므로 서버 TZ가 달라도
  항상 오늘(D0) → D1~D7 범위를 생성한다. 실수로 과거/미래 날짜를 넘기면 기본적으로 서울 오늘
  날짜로 강제되며, 정말로 백필을 원할 때만 `--run-date YYYY-MM-DD --allow-backfill`을 함께 준다.
- 매일 09:00에 운영하는 당일 전용 배치는 `--today-only`를 켜면 된다. 이 경우 run_date=target_date로
  간주하고 work_header만 생성하며 work_apply/정확도/튜닝 갱신은 건너뛴다.

- `--run-date`를 생략하면 **서울 시간(KST) 기준 오늘 날짜**를 자동으로 사용하므로 서버 TZ가 달라도
  항상 오늘(D0) → D1~D7 범위를 생성한다. 실수로 과거/미래 날짜를 넘기면 기본적으로 서울 오늘
  날짜로 강제되며, 정말로 백필을 원할 때만 `--run-date YYYY-MM-DD --allow-backfill`을 함께 준다.
- 매일 09:00에 운영하는 당일 전용 배치는 `--today-only`를 켜면 된다. 이 경우 run_date=target_date로
  간주하고 work_header만 생성하며 work_apply/정확도/튜닝 갱신은 건너뛴다.

- `--run-date`를 생략하면 **서울 시간(KST) 기준 오늘 날짜**를 자동으로 사용하므로 서버 TZ가 달라도
  항상 오늘(D0) → D1~D7 범위를 생성한다. 실수로 과거/미래 날짜를 넘기면 기본적으로 서울 오늘
  날짜로 강제되며, 정말로 백필을 원할 때만 `--run-date YYYY-MM-DD --allow-backfill`을 함께 준다.
- 매일 09:00에 운영하는 당일 전용 배치는 `--today-only`를 켜면 된다. 이 경우 run_date=target_date로
  간주하고 work_header만 생성하며 work_apply/정확도/튜닝 갱신은 건너뛴다.

- `--run-date`를 생략하면 **서울 시간(KST) 기준 오늘 날짜**를 자동으로 사용하므로 서버 TZ가 달라도
  항상 오늘(D0) → D1~D7 범위를 생성한다. 실수로 과거/미래 날짜를 넘기면 기본적으로 서울 오늘
  날짜로 강제되며, 정말로 백필을 원할 때만 `--run-date YYYY-MM-DD --allow-backfill`을 함께 준다.
- 매일 09:00에 운영하는 당일 전용 배치는 `--today-only`를 켜면 된다. 이 경우 run_date=target_date로
  간주하고 work_header만 생성하며 work_apply/정확도/튜닝 갱신은 건너뛴다.

- `--run-date`를 생략하면 **서울 시간(KST) 기준 오늘 날짜**를 자동으로 사용하므로 서버 TZ가 달라도
  항상 오늘(D0) → D1~D7 범위를 생성한다. 실수로 과거/미래 날짜를 넘기면 기본적으로 서울 오늘
  날짜로 강제되며, 정말로 백필을 원할 때만 `--run-date YYYY-MM-DD --allow-backfill`을 함께 준다.
- 매일 09:00에 운영하는 당일 전용 배치는 `--today-only`를 켜면 된다. 이 경우 run_date=target_date로
  간주하고 work_header만 생성하며 work_apply/정확도/튜닝 갱신은 건너뛴다.

- `--run-date`를 생략하면 **서울 시간(KST) 기준 오늘 날짜**를 자동으로 사용하므로 서버 TZ가 달라도
  항상 오늘(D0) → D1~D7 범위를 생성한다. 실수로 과거/미래 날짜를 넘기면 기본적으로 서울 오늘
  날짜로 강제되며, 정말로 백필을 원할 때만 `--run-date YYYY-MM-DD --allow-backfill`을 함께 준다.
- 매일 09:00에 운영하는 당일 전용 배치는 `--today-only`를 켜면 된다. 이 경우 run_date=target_date로
  간주하고 work_header만 생성하며 work_apply/정확도/튜닝 갱신은 건너뛴다.

- `--run-date`를 생략하면 **서울 시간(KST) 기준 오늘 날짜**를 자동으로 사용하므로 서버 TZ가 달라도
  항상 오늘(D0) → D1~D7 범위를 생성한다. 실수로 과거/미래 날짜를 넘기면 기본적으로 서울 오늘
  날짜로 강제되며, 정말로 백필을 원할 때만 `--run-date YYYY-MM-DD --allow-backfill`을 함께 준다.
- 매일 09:00에 운영하는 당일 전용 배치는 `--today-only`를 켜면 된다. 이 경우 run_date=target_date로
  간주하고 work_header만 생성하며 work_apply/정확도/튜닝 갱신은 건너뛴다.

- `--run-date`를 생략하면 **서울 시간(KST) 기준 오늘 날짜**를 자동으로 사용하므로 서버 TZ가 달라도
  항상 오늘(D0) → D1~D7 범위를 생성한다. 실수로 과거/미래 날짜를 넘기면 기본적으로 서울 오늘
  날짜로 강제되며, 정말로 백필을 원할 때만 `--run-date YYYY-MM-DD --allow-backfill`을 함께 준다.
- 매일 09:00에 운영하는 당일 전용 배치는 `--today-only`를 켜면 된다. 이 경우 run_date=target_date로
  간주하고 work_header만 생성하며 work_apply/정확도/튜닝 갱신은 건너뛴다.

- `--run-date`를 생략하면 **서울 시간(KST) 기준 오늘 날짜**를 자동으로 사용하므로 서버 TZ가 달라도
  항상 오늘(D0) → D1~D7 범위를 생성한다. 실수로 과거/미래 날짜를 넘기면 기본적으로 서울 오늘
  날짜로 강제되며, 정말로 백필을 원할 때만 `--run-date YYYY-MM-DD --allow-backfill`을 함께 준다.
- 매일 09:00에 운영하는 당일 전용 배치는 `--today-only`를 켜면 된다. 이 경우 run_date=target_date로
  간주하고 work_header만 생성하며 work_apply/정확도/튜닝 갱신은 건너뛴다.

- `--run-date`를 생략하면 **서울 시간(KST) 기준 오늘 날짜**를 자동으로 사용하므로 서버 TZ가 달라도
  항상 오늘(D0) → D1~D7 범위를 생성한다. 실수로 과거/미래 날짜를 넘기면 기본적으로 서울 오늘
  날짜로 강제되며, 정말로 백필을 원할 때만 `--run-date YYYY-MM-DD --allow-backfill`을 함께 준다.
- 매일 09:00에 운영하는 당일 전용 배치는 `--today-only`를 켜면 된다. 이 경우 run_date=target_date로
  간주하고 work_header만 생성하며 work_apply/정확도/튜닝 갱신은 건너뛴다.

- `--run-date`를 생략하면 **서울 시간(KST) 기준 오늘 날짜**를 자동으로 사용하므로 서버 TZ가 달라도
  항상 오늘(D0) → D1~D7 범위를 생성한다. 실수로 과거/미래 날짜를 넘기면 기본적으로 서울 오늘
  날짜로 강제되며, 정말로 백필을 원할 때만 `--run-date YYYY-MM-DD --allow-backfill`을 함께 준다.
- 매일 09:00에 운영하는 당일 전용 배치는 `--today-only`를 켜면 된다. 이 경우 run_date=target_date로
  간주하고 work_header만 생성하며 work_apply/정확도/튜닝 갱신은 건너뛴다.

- `--run-date`를 생략하면 **서울 시간(KST) 기준 오늘 날짜**를 자동으로 사용하므로 서버 TZ가 달라도
  항상 오늘(D0) → D1~D7 범위를 생성한다. 실수로 과거/미래 날짜를 넘기면 기본적으로 서울 오늘
  날짜로 강제되며, 정말로 백필을 원할 때만 `--run-date YYYY-MM-DD --allow-backfill`을 함께 준다.
- 매일 09:00에 운영하는 당일 전용 배치는 `--today-only`를 켜면 된다. 이 경우 run_date=target_date로
  간주하고 work_header만 생성하며 work_apply/정확도/튜닝 갱신은 건너뛴다.

- `--run-date`를 생략하면 **서울 시간(KST) 기준 오늘 날짜**를 자동으로 사용하므로 서버 TZ가 달라도
  항상 오늘(D0) → D1~D7 범위를 생성한다. 실수로 과거/미래 날짜를 넘기면 기본적으로 서울 오늘
  날짜로 강제되며, 정말로 백필을 원할 때만 `--run-date YYYY-MM-DD --allow-backfill`을 함께 준다.
- 매일 09:00에 운영하는 당일 전용 배치는 `--today-only`를 켜면 된다. 이 경우 run_date=target_date로
  간주하고 work_header만 생성하며 work_apply/정확도/튜닝 갱신은 건너뛴다.

- `--run-date`를 생략하면 **서울 시간(KST) 기준 오늘 날짜**를 자동으로 사용하므로 서버 TZ가 달라도
  항상 오늘(D0) → D1~D7 범위를 생성한다. 실수로 과거/미래 날짜를 넘기면 기본적으로 서울 오늘
  날짜로 강제되며, 정말로 백필을 원할 때만 `--run-date YYYY-MM-DD --allow-backfill`을 함께 준다.
- 매일 09:00에 운영하는 당일 전용 배치는 `--today-only`를 켜면 된다. 이 경우 run_date=target_date로
  간주하고 work_header만 생성하며 work_apply/정확도/튜닝 갱신은 건너뛴다.

- `--run-date`를 생략하면 **서울 시간(KST) 기준 오늘 날짜**를 자동으로 사용하므로 서버 TZ가 달라도
  항상 오늘(D0) → D1~D7 범위를 생성한다. 실수로 과거/미래 날짜를 넘기면 기본적으로 서울 오늘
  날짜로 강제되며, 정말로 백필을 원할 때만 `--run-date YYYY-MM-DD --allow-backfill`을 함께 준다.
- 매일 09:00에 운영하는 당일 전용 배치는 `--today-only`를 켜면 된다. 이 경우 run_date=target_date로
  간주하고 work_header만 생성하며 work_apply/정확도/튜닝 갱신은 건너뛴다.

- `--run-date`를 생략하면 **서울 시간(KST) 기준 오늘 날짜**를 자동으로 사용하므로 서버 TZ가 달라도
  항상 오늘(D0) → D1~D7 범위를 생성한다. 실수로 과거/미래 날짜를 넘기면 기본적으로 서울 오늘
  날짜로 강제되며, 정말로 백필을 원할 때만 `--run-date YYYY-MM-DD --allow-backfill`을 함께 준다.
- 매일 09:00에 운영하는 당일 전용 배치는 `--today-only`를 켜면 된다. 이 경우 run_date=target_date로
  간주하고 work_header만 생성하며 work_apply/정확도/튜닝 갱신은 건너뛴다.

- `--run-date`를 생략하면 **서울 시간(KST) 기준 오늘 날짜**를 자동으로 사용하므로 서버 TZ가 달라도
  항상 오늘(D0) → D1~D7 범위를 생성한다. 실수로 과거/미래 날짜를 넘기면 기본적으로 서울 오늘
  날짜로 강제되며, 정말로 백필을 원할 때만 `--run-date YYYY-MM-DD --allow-backfill`을 함께 준다.
- 매일 09:00에 운영하는 당일 전용 배치는 `--today-only`를 켜면 된다. 이 경우 run_date=target_date로
  간주하고 work_header만 생성하며 work_apply/정확도/튜닝 갱신은 건너뛴다.

- `--run-date`를 생략하면 **서울 시간(KST) 기준 오늘 날짜**를 자동으로 사용하므로 서버 TZ가 달라도
  항상 오늘(D0) → D1~D7 범위를 생성한다. 실수로 과거/미래 날짜를 넘기면 기본적으로 서울 오늘
  날짜로 강제되며, 정말로 백필을 원할 때만 `--run-date YYYY-MM-DD --allow-backfill`을 함께 준다.
- 매일 09:00에 운영하는 당일 전용 배치는 `--today-only`를 켜면 된다. 이 경우 run_date=target_date로
  간주하고 work_header만 생성하며 work_apply/정확도/튜닝 갱신은 건너뛴다.

- `--run-date`를 생략하면 **서울 시간(KST) 기준 오늘 날짜**를 자동으로 사용하므로 서버 TZ가 달라도
  항상 오늘(D0) → D1~D7 범위를 생성한다. 실수로 과거/미래 날짜를 넘기면 기본적으로 서울 오늘
  날짜로 강제되며, 정말로 백필을 원할 때만 `--run-date YYYY-MM-DD --allow-backfill`을 함께 준다.
- 매일 09:00에 운영하는 당일 전용 배치는 `--today-only`를 켜면 된다. 이 경우 run_date=target_date로
  간주하고 work_header만 생성하며 work_apply/정확도/튜닝 갱신은 건너뛴다.

- `--run-date`를 생략하면 **서울 시간(KST) 기준 오늘 날짜**를 자동으로 사용하므로 서버 TZ가 달라도
  항상 오늘(D0) → D1~D7 범위를 생성한다. 실수로 과거/미래 날짜를 넘기면 기본적으로 서울 오늘
  날짜로 강제되며, 정말로 백필을 원할 때만 `--run-date YYYY-MM-DD --allow-backfill`을 함께 준다.
- 매일 09:00에 운영하는 당일 전용 배치는 `--today-only`를 켜면 된다. 이 경우 run_date=target_date로
  간주하고 work_header만 생성하며 work_apply/정확도/튜닝 갱신은 건너뛴다.

- `--run-date`를 생략하면 **서울 시간(KST) 기준 오늘 날짜**를 자동으로 사용하므로 서버 TZ가 달라도
  항상 오늘(D0) → D1~D7 범위를 생성한다. 실수로 과거/미래 날짜를 넘기면 기본적으로 서울 오늘
  날짜로 강제되며, 정말로 백필을 원할 때만 `--run-date YYYY-MM-DD --allow-backfill`을 함께 준다.
- 매일 09:00에 운영하는 당일 전용 배치는 `--today-only`를 켜면 된다. 이 경우 run_date=target_date로
  간주하고 work_header만 생성하며 work_apply/정확도/튜닝 갱신은 건너뛴다.

- `--run-date`를 생략하면 **서울 시간(KST) 기준 오늘 날짜**를 자동으로 사용하므로 서버 TZ가 달라도
  항상 오늘(D0) → D1~D7 범위를 생성한다. 실수로 과거/미래 날짜를 넘기면 기본적으로 서울 오늘
  날짜로 강제되며, 정말로 백필을 원할 때만 `--run-date YYYY-MM-DD --allow-backfill`을 함께 준다.
- 매일 09:00에 운영하는 당일 전용 배치는 `--today-only`를 켜면 된다. 이 경우 run_date=target_date로
  간주하고 work_header만 생성하며 work_apply/정확도/튜닝 갱신은 건너뛴다.

- `--run-date`를 생략하면 **서울 시간(KST) 기준 오늘 날짜**를 자동으로 사용하므로 서버 TZ가 달라도
  항상 오늘(D0) → D1~D7 범위를 생성한다. 실수로 과거/미래 날짜를 넘기면 기본적으로 서울 오늘
  날짜로 강제되며, 정말로 백필을 원할 때만 `--run-date YYYY-MM-DD --allow-backfill`을 함께 준다.
- 매일 09:00에 운영하는 당일 전용 배치는 `--today-only`를 켜면 된다. 이 경우 run_date=target_date로
  간주하고 work_header만 생성하며 work_apply/정확도/튜닝 갱신은 건너뛴다.

- `--run-date`를 생략하면 **서울 시간(KST) 기준 오늘 날짜**를 자동으로 사용하므로 서버 TZ가 달라도
  항상 오늘(D0) → D1~D7 범위를 생성한다. 실수로 과거/미래 날짜를 넘기면 기본적으로 서울 오늘
  날짜로 강제되며, 정말로 백필을 원할 때만 `--run-date YYYY-MM-DD --allow-backfill`을 함께 준다.
- 매일 09:00에 운영하는 당일 전용 배치는 `--today-only`를 켜면 된다. 이 경우 run_date=target_date로
  간주하고 work_header만 생성하며 work_apply/정확도/튜닝 갱신은 건너뛴다.

- `--run-date`를 생략하면 **서울 시간(KST) 기준 오늘 날짜**를 자동으로 사용하므로 서버 TZ가 달라도
  항상 오늘(D0) → D1~D7 범위를 생성한다. 실수로 과거/미래 날짜를 넘기면 기본적으로 서울 오늘
  날짜로 강제되며, 정말로 백필을 원할 때만 `--run-date YYYY-MM-DD --allow-backfill`을 함께 준다.

- `--run-date`를 생략하면 **서울 시간(KST) 기준 오늘 날짜**를 자동으로 사용하므로 서버 TZ가 달라도
  항상 오늘(D0) → D1~D7 범위를 생성한다. 실수로 과거/미래 날짜를 넘기면 기본적으로 서울 오늘
  날짜로 강제되며, 정말로 백필을 원할 때만 `--run-date YYYY-MM-DD --allow-backfill`을 함께 준다.

- `--run-date`를 생략하면 **서울 시간(KST) 기준 오늘 날짜**를 자동으로 사용하므로 서버 TZ가 달라도
  항상 오늘(D0) → D1~D7 범위를 생성한다. 실수로 과거/미래 날짜를 넘기면 기본적으로 서울 오늘
  날짜로 강제되며, 정말로 백필을 원할 때만 `--run-date YYYY-MM-DD --allow-backfill`을 함께 준다.

- `--run-date`를 생략하면 **서울 시간(KST) 기준 오늘 날짜**를 자동으로 사용하므로 서버 TZ가 달라도
  항상 오늘(D0) → D1~D7 범위를 생성한다. 실수로 과거/미래 날짜를 넘기면 기본적으로 서울 오늘
  날짜로 강제되며, 정말로 백필을 원할 때만 `--run-date YYYY-MM-DD --allow-backfill`을 함께 준다.

- `--run-date`를 생략하면 **서울 시간(KST) 기준 오늘 날짜**를 자동으로 사용하므로 서버 TZ가 달라도
  항상 오늘(D0) → D1~D7 범위를 생성한다. 실수로 과거/미래 날짜를 넘기면 기본적으로 서울 오늘
  날짜로 강제되며, 정말로 백필을 원할 때만 `--run-date YYYY-MM-DD --allow-backfill`을 함께 준다.

- `--run-date`를 생략하면 **서울 시간(KST) 기준 오늘 날짜**를 자동으로 사용하므로 서버 TZ가 달라도
  항상 오늘(D0) → D1~D7 범위를 생성한다. 과거 데이터를 재생성하려면 `--run-date YYYY-MM-DD`
  옵션을 명시적으로 지정한다.

🧾 3. 파일 및 폴더 구조
ics/YYYYMMDDhhmmss/          # ICS 다운로드 폴더


🌐 4. ICS 다운로드

 database의 client_rooms 테이블을 기반으로 각 객실의 .ics 캘린더 다운로드

저장 위치: ./ics/YYYYMMDDhhmmss/

파일명: [sector]_[building]_[room]_YYYYMMDDhhmmss_[platform].ics

URL 내 도메인으로 플랫폼 자동 식별(airbnb → air, booking → booking)

네트워크 오류, 404 발생 시 해당 항목만 스킵 후 계속 진행
에러로그는 database의 etc_errorLogs 테이블에 축적

🧱 5. 확정 퇴실(out) 계산 로직

ICS의 DTEND가 [날짜 00:00, 다음날 00:00) 범위에 속하면 out

back-to-back 예약 (end == next.start) 은 병합하지 않음 (당일 out 인정)

overlap 예약 (next.start < prev.end) 은 병합 (연속 투숙)

D1의 확정퇴실로 추출된 결과는 work_header에 insert.


📈 6. 예측 퇴실(potential) 계산 로직
① 기본식
p_out = sigmoid(alpha + beta × weekday_score)

② 보정 규칙
조건	보정식
D+1	p_out × 0.6
D+7 이상	p_out × 1.1
일반	p_out × weekday_factor
③ 구분 기준
조건	potential 표시
p_out ≥ high	○
borderline ≤ p_out < high	△
그 외	공백
④ 집계 규칙

potential = ‘○’만 카운트

total = out + potential(○)

📊 7. Header의 p50 / low / hi 계산식

μ = Σp

σ² = Σp(1−p)

p50 = round(μ)

low = max(out, μ − 1.28σ)

hi = μ + 1.28σ
→ low는 항상 out보다 작지 않도록 보정

🧾 7-1. work_header 저장 Rule (매일 15:00)

- 15:00 배치는 기준일 D0의 다음날(D+1)을 "당일"로 간주하고 work_header를 생성한다.
- 해당 날짜에 퇴실(out)이 있다면 무조건 청소 대상(cleaning_yn=1)로 등록한다.
- 퇴실은 없고 입실만 있다면 상태확인 대상(conditionCheckYn=1, cleaning_yn=0)으로 등록한다.
- blanket_qty, amenities_qty는 client_rooms의 bed_count와 동일하게 맞춘다.
- checkin_time, checkout_time도 client_rooms의 설정을 그대로 사용한다.
- 나머지 값(cleaner_id, butler_id, supply_yn, clening_flag, requirements 등)은 추후 입력을 위해 NULL로 비워 둔다.

🧠 9. 정확도 및 튜닝 로직 요약
구분	사용 변수	기준	보정 대상
D−7	α, β	Brier Score 최소화	확률 분포 학습
D−1	high	Precision 목표 (≈0.70)	컷오프 조정
⚙️ 컷오프 조정 규칙
상태	현상	조정
Precision↓, Recall↑	허수 많음 (공격적)	high ↑
Precision↑, Recall↓	놓침 많음 (보수적)	high ↓
Precision, Recall 균형	안정	유지
📘 8. tuning report 구조
table	주요 컬럼	설명
D-1	run_date, target_date, roomid, p_out, actual_out, correct	1일 전 예측 기록
D-7	동일 구조	7일 전 예측 기록
Accuracy	date, horizon, acc, prec, rec, f1, n	일자별 예측 성능 요약
Tuning	date, horizon, variable, before, after, delta, explanation	매일 변경된 변수 기록
📄 9. model_variable 구조
[threshold]
d1_high = 0.43
d7_high = 0.68
borderline = 0.4

[calibration]
d1_alpha = 0.12
d1_beta = 0.94
d7_alpha = 0.147
d7_beta = 1.0181



horizon=1 → D−1 세트

horizon=2~6 → 보간

horizon≥7 → D−7 세트

데이터 없을 경우 위값으로 자동 생성

🧱 11. Debug Points (유지 항목)
번호	항목	설명
01	URL 파싱	database 문자열 그대로 사용
02	ICS 오류	404·Timeout 시 스킵 후 진행
03	이벤트 병합	overlap만 병합
04	out 판정	end ∈ [D 00:00, D+1 00:00)
05	low 보정	low ≥ out
06	Precision 과도	컷오프 완화
07	Accuracy=1·Recall↓	보수적 예측 감지




🧠 12. AI 학습 배치 (train_model.py)

- `batchs/train_model.py`는 `work_fore_d1`, `work_fore_d7` 테이블의 과거 예측/실적을
  로지스틱 회귀(Logistic Regression)로 재학습하여 α/β/컷오프를 자동 산출한다.
- 기본 실행은 Shadow Mode이며, `--apply` 옵션을 주면 `model_variable`과
  `work_fore_tuning` 로그에 곧바로 반영한다.
- 주요 옵션
  - `--days`: 학습에 사용할 히스토리 일수(기본 45)
  - `--horizon {d1|d7|both}`: 학습 대상
  - `--min-samples`: 샘플 부족 시 안전하게 skip
  - `--target-precision`: D1 컷오프 탐색 목표치(기본 0.70)

실행 예시
```bash
python batchs/train_model.py --days 60 --horizon both              # Shadow Mode
python batchs/train_model.py --days 60 --horizon both --apply      # DB 즉시 반영
```

훈련 절차
1. `work_fore_d1` / `work_fore_d7`에서 run_dttm >= today-`days` 레코드 수집
2. 요일별 점수(WEEKDAY_BASE)와 실제 out 여부를 이용해 α, β를 Gradient Descent로 갱신
3. D1은 precision 목표를 만족하는 컷오프(`d1_high`)를 grid-search로 탐색
4. Shadow Mode에서는 로그만 출력, Active Mode에서는 `model_variable`을 업데이트하고
   `work_fore_tuning`에 horizon별 변경 이력을 남김

학습 스크립트는 기존 Forecasting 배치와 동일한 DB 스키마를 사용하므로, 추가적인
테이블 생성은 필요하지 않다.

🧹 13. 클리너 랭킹 업데이트 배치 (update_cleaner_ranking.py)

- 매일 16:30 `batchs/update_cleaner_ranking.py`를 실행해 **최근 20일간**의 평가 이력을
  기준으로 tier만 재조정한다. 점수 합계는 랭킹을 계산하는 동안에만 사용한다.
- worker_evaluateHistory에서 `target_date` 포함 20일 전까지의 checklist_point_sum 합계를
  worker별 가중치로 삼는다. 20일 안에 근무가 3회뿐이라면 3회만 합산하며,
  더 이전 기록을 끌어오지 않는다.
- tier 규칙
  1. 모집단: 현재 tier가 3·4·5·6·7인 모든 클리너(당일 근무 여부와 무관하게).
  2. 최근 20일 합계 점수를 기준으로 상위 5%→tier 7, 상위 10%→tier 6, 상위 30%→tier 5.
  3. 나머지는 최근 20일 점수 합이 50점 이상이면 tier 4, 미만이면 tier 3.
  4. tier 2는 해당 기간 점수가 발생하면 즉시 tier 3으로 승급시키고, tier 1은 시스템에서 변경하지 않는다.
- 배치 로그에 계산 기간/인원/컷오프를 출력하며, `BATCH_REGISTRATION.md` 7장에서 systemd 등록
  예시를 확인할 수 있다.

📦 추가 안내 (DB 기반 배치)

- `db_forecasting.py`: 본 README 명세를 토대로 파일 기반 로직을 DB 테이블(work_fore_*, work_header 등)과 직접 연동하도록 재작성한 파이썬 스크립트입니다. `mysql-connector-python`으로 DB에 접속해 client_rooms/ics를 읽고 work_fore_d1/d7, work_header, work_fore_accuracy/tuning을 갱신합니다.
- `schema.sql`: 현행 운영 DB 스키마를 그대로 정리한 파일로, 마이그레이션 및 로컬 샌드박스 구축 시 사용합니다.
- `update_cleaner_ranking.py`: worker_evaluateHistory/worker_header를 사용한 16:30 랭킹 배치.
- `BATCH_REGISTRATION.md`: 운영 웹 서버(Next.js/Bun)에서 Forecasting/AI 학습/랭킹 배치를 systemd + API로 등록하는 절차를 상세히 설명합니다.
