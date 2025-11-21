# guideline.go vs db_forecasting.py 비교 메모

## 전제
- `guideline.go`가 읽는 `data.toml`의 `date`는 `20251122`로 설정되어 있어 이 값을 기준일로 삼는다.【F:batchs/guideline.go†L179-L193】
- `db_forecasting.py`는 실행 인자로 `--run-date 2025-11-21`을 받았다고 가정한다. 기본 오프셋은 D+1~D+7이며 today-only 모드는 꺼져 있다.【F:batchs/db_forecasting.py†L169-L205】【F:batchs/db_forecasting.py†L606-L618】

## 기준일/타깃일 결정
- guideline: `ProcessData`가 반환한 `date`(20251122)를 오늘로 간주하고, 동일 날짜와 다음날에 걸친 체크인·체크아웃을 동시에 계산한다. 오늘/내일 두 세트를 한 번에 만든 뒤 `excel.Generate`에 넘긴다.【F:batchs/guideline.go†L179-L193】【F:batchs/guideline.go†L119-L149】
- python 배치: run_date를 오늘로 취급하지만 backfill 플래그가 꺼져 있으면 서울 오늘로 강제 덮어쓴다. 오프셋 리스트는 D+1부터 D+7까지라 run_date+1(2025-11-22)이 유일한 work_header 대상 D0이 된다.【F:batchs/db_forecasting.py†L933-L957】【F:batchs/db_forecasting.py†L606-L655】【F:batchs/db_forecasting.py†L773-L784】

## ICS 다운로드·이벤트 병합
- guideline: ICS 다운로드/파싱은 `parser.LoadData`/`ProcessData` 내부에 숨겨져 있으나, 결과 `processed` 리스트를 플랫폼별 중복 병합 규칙으로 정리한다. 같은 객실의 이벤트를 플랫폼별로 모은 뒤 겹치는 예약이 있으면 `IsOverBooking` 표시를 남기고 유지하며, 날짜 기준 필터링 이후에도 플랫폼 단위로 다시 병합한다.【F:batchs/guideline.go†L65-L103】【F:batchs/guideline.go†L105-L149】 파일명 규칙은 코드에 없고 `parser` 내부 로직에 의존한다.
- python 배치: 실행 시 타임스탬프 하위 폴더를 만들고(예: `batchs/ics/20251121043737`) 기존 폴더를 보존 일수 기준으로 청소한다.【F:batchs/db_forecasting.py†L606-L618】【F:batchs/db_forecasting.py†L47-L69】 모든 open_yn=1 객실을 조회한 뒤(ical_url 0~2개), URL당 파일명을 `building_short_name+room_no+platform`으로 생성하고 중복 시 숫자를 붙인다. URL별 이벤트를 한데 모아 시작 시각 기준으로 재정렬·겹침 병합해 단일 타임라인을 만든다. 기대/실제 다운로드 개수를 로그로 남겨 47건 수집 여부를 바로 확인한다.【F:batchs/db_forecasting.py†L348-L382】【F:batchs/db_forecasting.py†L490-L516】【F:batchs/db_forecasting.py†L663-L686】

## 체크인/체크아웃 판정
- guideline: 특정 날짜의 체크아웃은 plan의 `DtEnd == date`, 체크인은 `DtStart == date`로 판정한다. 익일 체크인/체크아웃은 `CheckNextDay`로 따로 구분해 오늘/내일 목록을 만든 뒤 중복되는 객실은 제거한다.【F:batchs/guideline.go†L119-L149】
- python 배치: 이벤트 시각을 무시하고 `event.end.date()==target_date`이면 checkout, `event.start.date()==target_date`이면 checkin으로 본다. URL을 구분하지 않고 병합된 이벤트 목록으로 판정해 `Prediction`을 만든다.【F:batchs/db_forecasting.py†L537-L552】【F:batchs/db_forecasting.py†L619-L647】

## work_header 생성 흐름
- guideline: 내일(D+1) 일정만 별도 시트로 만들며, 체크아웃 존재 시 `(conditionCheckYn=0, cleaning_yn=1)`, 체크인만 존재 시 `(1,0)`을 설정한다. 기존 행을 지우지 않고 생성 결과를 그대로 활용한다(Excel 출력 기준).【F:batchs/guideline.go†L119-L149】【F:batchs/guideline.go†L179-L193】
- python 배치: today-only가 아니면 `target_date = run_date + 1`만 바라보고 horizon=1 예측에서 checkout/checkin 여부를 합쳐 insert-only한다. 이미 같은 room_id가 있으면 건너뛰어 신규만 추가한다.【F:batchs/db_forecasting.py†L773-L845】

## 주요 차이 요약
1) 기준일: guideline은 data.toml의 날짜를 직접 기준으로 오늘/내일을 함께 산출하지만, python은 run_date+1만 work_header 대상으로 삼아 run_date 자체의 이벤트는 무시한다.
2) 이벤트 단위: guideline은 플랫폼별 병합 뒤 날짜 필터링을 하지만 URL 자체는 구분하지 않는다. python도 URL을 구분하지 않고 병합한 뒤 날짜만 비교한다.
3) 파일명/로그: guideline은 `application.log`로만 로깅하고 파일명 규칙이 외부(parser)에 있지만, python은 실행 시 ics 타임스탬프 폴더를 만들고 `건물단축명+호실+플랫폼` 파일명을 직접 만든다.

