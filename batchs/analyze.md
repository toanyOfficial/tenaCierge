# work_apply 생성 절차 (step-by-step)

## 1) 실행 범위 설정
1. `run_date`는 기본적으로 서울(KST) 오늘 날짜이며, `--allow-backfill`을 쓰지 않는 한 과거 입력은 무시된다.【F:batchs/db_forecasting.py†L169-L205】
2. today-only가 아니면 오프셋 리스트를 `max(1, start_offset)`부터 `end_offset`까지 생성해 D+1~D+N 대상 날짜를 잡는다(기본 1~7일).【F:batchs/db_forecasting.py†L611-L640】
3. 각 오프셋마다 `target_date = run_date + offset`으로 계산하며, work_apply는 모든 타깃 날짜에 대해 반복 수행한다.【F:batchs/db_forecasting.py†L632-L667】

## 2) 예측 입력 준비
1. `client_rooms`에서 `open_yn=1`인 객실을 모두 불러오고, `weight`는 값이 없으면 10으로 세팅된다.【F:batchs/db_forecasting.py†L367-L392】
2. 각 객실의 ical URL(최대 2개)을 각각 다운로드하여 이벤트를 파싱한 뒤, 시작 시각 기준으로 정렬·겹침 병합(back-to-back 제외)해 하나의 이벤트 타임라인을 만든다.【F:batchs/db_forecasting.py†L641-L686】
3. 각 타깃 날짜/객실별로 `Prediction`을 만들 때 체크아웃/체크인 여부는 이벤트의 `end.date()==target_date` 혹은 `start.date()==target_date`로 판정한다. 체크아웃만 가중치 합산에 사용된다.【F:batchs/db_forecasting.py†L641-L655】【F:batchs/db_forecasting.py†L619-L647】

## 3) 섹터별 가중치 합산
1. 모든 `Prediction` 중 `target_date`가 일치하고 `has_checkout=True`인 건만 뽑는다.【F:batchs/db_forecasting.py†L414-L437】
2. 객실별 중복을 제거한 뒤, `(sector, sector_value)` 키로 `room.weight`를 누적해 섹터 가중치 리스트를 만든다.【F:batchs/db_forecasting.py†L414-L437】
3. 가중치가 없는 섹터는 이후 단계가 스킵된다.【F:batchs/db_forecasting.py†L749-L761】

## 4) 규칙 매칭
1. `work_apply_rules`를 `min_weight` 오름차순으로 로드한다.【F:batchs/db_forecasting.py†L396-L412】
2. 각 섹터 가중치에 대해 `min_weight < weight_sum ≤ max_weight`를 만족하는 첫 규칙을 찾는다(상한이 없으면 `max_weight`는 무시).【F:batchs/db_forecasting.py†L473-L481】
3. 규칙이 없으면 해당 섹터는 건너뛴다.【F:batchs/db_forecasting.py†L779-L787】

## 5) 기존 슬롯 현황 파악
1. 대상 `target_date`에 이미 존재하는 work_apply를 섹터/포지션별로 집계해 `cnt`(현재 슬롯 수)와 `max_seq`(해당 조합에서 가장 큰 seq)를 가져온다.【F:batchs/db_forecasting.py†L763-L777】

## 6) 필요 수량 계산 및 삽입
1. 규칙이 지정한 `butler_count`와 `cleaner_count`를 순서대로 처리한다 (position 2 → 1).【F:batchs/db_forecasting.py†L789-L806】
2. `required - current_count`가 양수인 경우에만 부족한 슬롯을 추가한다; 이미 충분하면 아무 작업도 하지 않는다.【F:batchs/db_forecasting.py†L789-L806】
3. 새 슬롯의 `seq`는 직전 `max_seq`부터 1씩 증가시켜 부여하며, `seq>127`이면 에러를 발생시켜 중단한다.【F:batchs/db_forecasting.py†L806-L815】
4. 삽입 시 필드는 `(work_date, basecode_sector, basecode_code, seq, position, worker_id=NULL)`이며, 기존 레코드는 삭제하거나 덮어쓰지 않는다(append-only).【F:batchs/db_forecasting.py†L806-L820】

## 7) 커밋 및 반복
1. 한 `target_date`에 대한 삽입이 끝나면 트랜잭션을 커밋한다.【F:batchs/db_forecasting.py†L807-L807】
2. 이후 다음 타깃 날짜로 이동해 3~6단계를 반복한다.【F:batchs/db_forecasting.py†L663-L667】

## 요약 포인트
- 가중치 합산은 “해당 날짜에 체크아웃이 있는 객실”만 반영한다.
- 규칙은 `min_weight < 합계 ≤ max_weight` 첫 매칭만 적용된다.
- 기존 work_apply는 유지되며, 부족한 수량만 `seq`를 이어 붙여 추가한다.
- 한 실행에서 D+1~D+N 모든 날짜를 처리한다.
