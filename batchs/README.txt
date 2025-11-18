0. 밑작업
 ics파일은 D0 D1 D2 D3 폴더를 만들어두고 3일간 보관한다. 배치 돌릴 때 마다
- D3폴더에 있는 모든 컨텐츠를 삭제한다.
- D2폴더에 있는 모든 컨텐츠를 D3폴더로 옮긴고 D2폴더의 모든 컨텐츠를 삭제한다.
- D1폴더에 있는 모든 컨텐츠를 D2폴더로 옮기고 D1폴더의 모든 컨텐츠를 삭제한다.
- D0폴더에 있는 모든 컨텐츠를 D1폴더로 옮기고 D0폴더의 모든 컨텐츠를 삭제한다.



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

📅 2. 날짜 입력 및 실행 모드
실행한날짜를 D0라고 했을때 다음날인 D1부터  다음주 같은요일까지의 D7 일정을 체크한다. 서버에 배치프로그램으로 등록한다.

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




🚀 업데이트 예정 (v1.5 개발 계획)
🔹 1️⃣ 학습 기능 확장 (train_model.py)

report.xlsx의 D-1 / D-7 데이터를 활용해
Logistic Regression으로 α, β, high 재추정

Shadow Mode (제안만 기록, 자동 반영 없음)

D-7 → α, β 학습 / D-1 → high 학습

결과는 report.xlsx > Tuning 시트에 기록

향후 --apply 모드에서 model_state.toml 자동 갱신 예정

예시 로그
[LOG] d7_alpha: 0.150 → 0.163 (+0.013)
[LOG] d7_beta: 1.020 → 0.987 (−0.033)
[LOG] d1_high: 0.650 → 0.670 (+0.020)

🔹 2️⃣ report 파일 잠금 시 백업 저장

Excel에서 report.xlsx를 열어둔 상태로 실행 시 PermissionError 발생 방지

try/except로 백업 파일 자동 생성

try:
    wb.save(REPORT_XLSX)
except PermissionError:
    alt_name = f"report_backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx"
    print(f"[WARN] report.xlsx이 열려 있습니다. {alt_name}으로 임시 저장합니다.")
    wb.save(alt_name)


백업 파일명 예: report_backup_20251118_162350.xlsx

🔹 3️⃣ D1 α·β Shadow Learning (확장안)

D1 horizon에도 α, β 학습을 시도하되 실제 반영은 하지 않음

결과만 Tuning 시트에 기록 (Shadow Mode)

안정성 검증 후 Active 반영 고려

📘 Forecasting Specification v1.4 (Current Stage)

현재 시스템은 안정된 예측·튜닝 루프(D−1, D−7 기반)를 운영 중이며,
다음 단계(v1.5)에서는 학습 모델(train_model.py)과 백업 저장 로직이 추가되어
자가 학습형·복구 안전형 구조로 진화할 예정입니다.

📦 추가 안내 (DB 기반 배치)

- `db_forecasting.py`: 본 README 명세를 토대로 파일 기반 로직을 DB 테이블(work_fore_*, work_header 등)과 직접 연동하도록 재작성한 파이썬 스크립트입니다. `mysql-connector-python`으로 DB에 접속해 client_rooms/ics를 읽고 work_fore_d1/d7, work_header, work_fore_accuracy/tuning을 갱신합니다.
- `schema.sql`: 현행 운영 DB 스키마를 그대로 정리한 파일로, 마이그레이션 및 로컬 샌드박스 구축 시 사용합니다.
- `BATCH_REGISTRATION.md`: 운영 웹 서버(Next.js/Bun)에서 해당 배치를 systemd + API로 등록하는 절차를 상세히 설명합니다.