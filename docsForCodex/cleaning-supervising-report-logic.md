# 005 청소완료보고 & 006 수퍼바이징 완료보고 체크리스트/이미지 로직

## 목적
work_checklist, work_images 조회 기준과 work_reports, worker_evaluate 적재 규칙을 한 곳에 정리해 화면별 경계 조건을 명확히 이해한다.
- 화면 005/006은 소모품(work_reports.type=2) 입력을 공유하며, 두 화면 중 어느 곳에서든 최신 기록이 반영된다.【F:app/(routes)/screens/[screenId]/server/getCleaningReportSnapshot.ts†L138-L216】【F:app/(routes)/screens/[screenId]/server/getSupervisingReportSnapshot.ts†L148-L236】

## 용어/분류 요약
- **work_checklist_list.type**: `1` 청소, `2` 수퍼바이징, `3` 소모품.【F:docsForCodex/schema.csv†L221-L229】
- **work_images_list.role**: `1` 클리너(청소보고), `2` 버틀러(수퍼바이징), `3` 상태확인.【F:docsForCodex/schema.csv†L306-L317】
- **work_reports.type**: `1` 청소 체크리스트, `2` 소모품 체크/메모, `3` 청소 사진, `4` 수퍼바이징 발견사항/완료 여부, `5` 수퍼바이징 사진, `6` 업무 시작/종료 시각, `7` 상태확인 사진.【F:docsForCodex/schema.csv†L327-L330】
- **Override 규칙**
  - 체크리스트: set detail(title/description/score) 값이 있으면 사용, 없으면 list 값 fallback.【F:app/(routes)/screens/[screenId]/server/getCleaningReportSnapshot.ts†L70-L109】【F:app/(routes)/screens/[screenId]/server/getSupervisingReportSnapshot.ts†L72-L120】
  - 이미지: set detail(title/comment/required) 우선, 없으면 list 값 fallback. required는 detail.required ?? list.required 로 계산.【F:app/(routes)/screens/[screenId]/server/getCleaningReportSnapshot.ts†L112-L136】【F:app/(routes)/screens/[screenId]/server/getSupervisingReportSnapshot.ts†L122-L146】
  - 정렬: checklist/image 모두 detail.ordering asc → list.ordering asc 순으로 정렬하며, ordering은 detail 값이 있으면 이를 사용한다.【F:app/(routes)/screens/[screenId]/server/getCleaningReportSnapshot.ts†L70-L136】【F:app/(routes)/screens/[screenId]/server/getSupervisingReportSnapshot.ts†L72-L146】

## 005. 청소완료보고 화면
### 조회 단계
1. **체크리스트 로드**: 업무의 `checklist_set_id`로 `work_checklist_set_detail`을 조회 후 type=1(청소)만 사용, detail.ordering asc → list.ordering asc 순으로 정렬.【F:app/(routes)/screens/[screenId]/server/getCleaningReportSnapshot.ts†L70-L109】
2. **소모품 목록 로드**: `work_checklist_list`에서 type=3을 ordering asc로 조회 후 description이 있는 항목을 앞에 배치.【F:app/(routes)/screens/[screenId]/server/getCleaningReportSnapshot.ts†L102-L110】
3. **사진 슬롯 로드**: 업무의 `images_set_id`가 있을 때, `work_images_set_detail`을 role=1(클리너) 기준으로 detail→list fallback을 적용해 제목/필수 여부/코멘트 결정.【F:app/(routes)/screens/[screenId]/server/getCleaningReportSnapshot.ts†L112-L136】
4. **기존 입력 불러오기**: `work_reports`에서 최신 type별 레코드를 읽어 청소 체크(1), 소모품 체크/메모(2), 청소 사진(3) 값을 역직렬화한다.【F:app/(routes)/screens/[screenId]/server/getCleaningReportSnapshot.ts†L138-L216】

### 출력 단계
- 청소 체크리스트: detail.title/description이 없을 때 list 값을 화면에 표시하며 점수는 set.detail.score를 사용.【F:app/(routes)/screens/[screenId]/server/getCleaningReportSnapshot.ts†L90-L109】
- 소모품 체크리스트: type=3 기본 리스트를 그대로 표시, 점수는 항상 0으로 노출.【F:app/(routes)/screens/[screenId]/server/getCleaningReportSnapshot.ts†L102-L110】
- 사진 슬롯: 필수 여부(required)와 코멘트(comment)까지 노출, savedImages는 slotId→url 매핑으로 채워진다.【F:app/(routes)/screens/[screenId]/server/getCleaningReportSnapshot.ts†L112-L216】

### 입력/저장 단계
1. **검증 기준**
   - 청소 체크리스트: 조회된 청소 checklist id가 모두 cleaningChecks에 포함되어야 한다.【F:app/api/work-reports/route.ts†L55-L149】
   - 사진: 업로드/기존 매핑 후 필수 슬롯이 모두 채워져야 한다( `required ?? listRequired`).【F:app/api/work-reports/route.ts†L95-L159】
2. **저장 대상**
   - work_reports.type=1 → 청소 체크 id 배열(contents1).【F:app/api/work-reports/route.ts†L138-L149】
   - work_reports.type=2 → 소모품 체크 id 배열(contents1) + 소모품 메모(contents2, 키=체크 항목 id).【F:app/api/work-reports/route.ts†L138-L151】
   - work_reports.type=3 → 이미지 slotId→url 목록을 contents1/contents2 모두에 저장(구버전 호환).【F:app/api/work-reports/route.ts†L153-L159】
   - work_reports.type=6 → contents2.end_dttm에 완료 시각을 upsert.【F:app/api/work-reports/route.ts†L238-L258】
3. **부가 처리**: work_header.cleaning_flag=4 및 cleaning_end_time 갱신 후 응답.【F:app/api/work-reports/route.ts†L161-L178】

## 006. 수퍼바이징 완료보고 화면
### 조회 단계
1. **체크리스트 로드**: 업무의 `checklist_set_id` 기준으로 type=2(수퍼바이징) detail을 detail.ordering asc → list.ordering asc 순으로 조회, set.score와 list.score를 모두 담는다.【F:app/(routes)/screens/[screenId]/server/getSupervisingReportSnapshot.ts†L72-L109】
2. **소모품 목록 로드**: type=3 리스트를 ordering asc로 조회, 점수(listScore)를 포함해 description이 있는 항목 우선 정렬.【F:app/(routes)/screens/[screenId]/server/getSupervisingReportSnapshot.ts†L111-L120】
3. **사진 슬롯 로드**: role=2(버틀러) detail을 사용해 제목/필수 여부/코멘트 결정.【F:app/(routes)/screens/[screenId]/server/getSupervisingReportSnapshot.ts†L122-L146】
4. **기존 입력 불러오기**: work_reports에서 수퍼바이징 체크(type=4 contents1=발견, contents2=완료), 소모품(type=2), 사진(type=5) 정보를 최신순으로 취득 후 파싱한다. (contents1=발견은 발견된 이슈/미비점 체크, contents2=완료는 해결 완료 여부 체크를 뜻한다.)【F:app/(routes)/screens/[screenId]/server/getSupervisingReportSnapshot.ts†L148-L236】

### 출력 단계
- 체크리스트: detail/list fallback으로 제목·설명·점수 노출, set.score(listScore)로 평가 점수를 병행 보유.【F:app/(routes)/screens/[screenId]/server/getSupervisingReportSnapshot.ts†L100-L120】
- 소모품 체크리스트: type=3 목록에 listScore를 그대로 적용해 표시.【F:app/(routes)/screens/[screenId]/server/getSupervisingReportSnapshot.ts†L111-L120】
- 사진 슬롯/기존 사진: role=2 필수 여부와 savedImages를 slotId→url 매핑으로 보여준다.【F:app/(routes)/screens/[screenId]/server/getSupervisingReportSnapshot.ts†L122-L236】

### 입력/저장 단계
1. **검증 기준**
   - 수퍼바이징 체크리스트: 조회된 id 목록을 기준으로 supervisingFindings/supervisingCompletion을 boolean map으로 받으며 필수 id 없음(매핑만 검증).【F:app/api/supervising-reports/route.ts†L57-L154】
   - 사진: role=2 슬롯 중 required??listRequired 가 true인 항목이 모두 채워져야 한다.【F:app/api/supervising-reports/route.ts†L89-L171】
2. **저장 대상**
   - work_reports.type=4 → contents1=발견 체크 map, contents2=완료 체크 map.【F:app/api/supervising-reports/route.ts†L140-L155】
   - work_reports.type=2 → 소모품 체크 id 배열(contents1) + 메모(contents2).【F:app/api/supervising-reports/route.ts†L156-L163】
   - work_reports.type=5 → 수퍼바이징 사진 slotId→url 목록을 contents1/contents2에 동일 저장.【F:app/api/supervising-reports/route.ts†L165-L171】
3. **평가 적재**: supervisingFindings 중 true인 checklist id 집합을 unique 집계 후 set.score 합산→worker_evaluate_history.checklist_point_sum/array에 기록(클리너가 있을 때만).【F:app/api/supervising-reports/route.ts†L173-L203】
4. **부가 처리**: work_header.supervising_yn=true, supervising_end_time 갱신 후 응답.【F:app/api/supervising-reports/route.ts†L173-L206】
