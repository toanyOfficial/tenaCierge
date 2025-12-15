## 2025-12-15 스키마 변경 요약
- 기존 스키마와의 차이가 없습니다.
- 테이블 수: 45개, 컬럼 수: 517개

## 2025-12-13 스키마 변경 요약
- 추가된 컬럼: client_additional_price.created_by, client_additional_price.updated_by, client_detail.created_by, client_detail.updated_by, client_header.created_by 외 85건
- 변경된 컬럼: work_reservation.work_id: bigint -> bigint
- 테이블 수: 45개, 컬럼 수: 517개

## 2025-12-12 스키마 변경 요약
- 추가된 컬럼: work_reservation.reflect_yn
- 테이블 수: 45개, 컬럼 수: 427개

## 2025-12-12 스키마 변경 요약
- 변경된 컬럼: work_global_detail.work_global_id: date -> tinyint, work_global_header.id: bigint unsigned -> tinyint unsigned, work_reservation.work_id: date -> bigint
- 테이블 수: 45개, 컬럼 수: 426개

## 2025-12-12 스키마 변경 요약
- 추가된 컬럼: work_checklist_list.ordering, work_global_detail.id, work_global_detail.work_global_id, work_global_detail.room_id, work_global_detail.created_at 외 25건
- 테이블 수: 45개, 컬럼 수: 426개

## 2025-12-07 스키마 변경 요약
- 추가된 컬럼: work_checklist_list.score
- 제거된 컬럼: etc_batchLogs.id, etc_batchLogs.app_name, etc_batchLogs.start_dttm, etc_batchLogs.end_dttm, etc_batchLogs.end_flag 외 2건
- 변경된 컬럼: client_supplements.dscpt: varchar(2083) -> varchar(2083), etc_errorLogs_batch.level: tinyint unsigned -> tinyint unsigned, etc_errorLogs_batch.message: varchar(500) -> varchar(500), work_checklist_set_detail.score: tinyint -> tinyint, work_images_list.role: tinyint -> tinyint 외 1건
- 테이블 수: 42개, 컬럼 수: 396개

## 2025-12-03 스키마 변경 요약
- 추가된 컬럼: kakao_channel_subscribers.id, kakao_channel_subscribers.user_type, kakao_channel_subscribers.user_id, kakao_channel_subscribers.phone, kakao_channel_subscribers.kakao_user_uuid 외 46건
- 테이블 수: 43개, 컬럼 수: 402개

## 2025-12-03 스키마 변경 요약
- 추가된 컬럼: worker_salary_history.start_time, worker_salary_history.end_time
- 제거된 컬럼: worker_salary_history.start_dttm, worker_salary_history.end_dttm
- 테이블 수: 39개, 컬럼 수: 351개

## 2025-12-03 스키마 변경 요약
- 추가된 컬럼: worker_salary_history.id, worker_salary_history.worker_id, worker_salary_history.work_date, worker_salary_history.start_dttm, worker_salary_history.end_dttm 외 4건
- 테이블 수: 39개, 컬럼 수: 351개

## 2025-12-02 스키마 변경 요약
- 추가된 컬럼: etc_batchLogs.id, etc_batchLogs.app_name, etc_batchLogs.start_dttm, etc_batchLogs.end_dttm, etc_batchLogs.end_flag 외 2건
- 변경된 컬럼: client_supplements.next_date: date -> date
- 테이블 수: 38개, 컬럼 수: 342개

## 2025-12-02 스키마 변경 요약
- 추가된 컬럼: etc_errorLogs_batch.id, etc_errorLogs_batch.level, etc_errorLogs_batch.app_name, etc_errorLogs_batch.error_code, etc_errorLogs_batch.message 외 9건
- 테이블 수: 37개, 컬럼 수: 335개

## 2025-12-02 스키마 변경 요약
- 추가된 컬럼: client_supplements.id, client_supplements.room_id, client_supplements.date, client_supplements.next_date, client_supplements.title 외 4건
- 제거된 컬럼: client_suppliements.id, client_suppliements.room_id, client_suppliements.date, client_suppliements.next_date, client_suppliements.title 외 4건
- 테이블 수: 36개, 컬럼 수: 321개

## 2025-12-02 스키마 변경 요약
- 추가된 컬럼: client_suppliements.id, client_suppliements.room_id, client_suppliements.date, client_suppliements.next_date, client_suppliements.title 외 4건
- 테이블 수: 36개, 컬럼 수: 321개

## 2025-11-30 스키마 변경 요약
- 추가된 컬럼: client_price_list.per_bed_yn, client_price_list.per_room_yn
- 테이블 수: 35개, 컬럼 수: 312개

## 2025-12-01 스키마 변경 요약
- 추가된 컬럼: work_header.checkout_time
- 제거된 컬럼: work_header.ceckout_time
- 테이블 수: 35개, 컬럼 수: 310개

## 2025-12-01 스키마 변경 요약
- 추가된 컬럼: model_variable.name, model_variable.value, model_variable.description, model_variable.updated_at, work_header.condition_check_yn
- 제거된 컬럼: work_header.conditionCheckYn
- 테이블 수: 35개, 컬럼 수: 310개

## 2025-12-01 스키마 변경 요약
- 추가된 컬럼: client_additional_price.qty, client_additional_price.minus_yn, client_additional_price.ratio_yn, client_additional_price.amount, client_price_list.selected_by 외 13건
- 제거된 컬럼: client_additional_price.price, client_rooms.settle_flag
- 변경된 컬럼: client_additional_price.id: int unsigned -> int unsigned, client_detail.id: int unsigned -> int unsigned, client_detail.client_id: mediumint unsigned -> mediumint unsigned, client_header.id: mediumint unsigned -> mediumint unsigned, client_header.register_no: varchar(6) -> varchar(6) 외 103건
- 테이블 수: 34개, 컬럼 수: 306개

## 2025-11-28 스키마 변경 요약
- 추가된 컬럼: client_additional_price.minus_yn, client_additional_price.ratio_yn, client_additional_price.amount, client_price_list.selected_by, client_price_list.minus_yn 외 12건
- 제거된 컬럼: client_additional_price.price, client_rooms.settle_flag
- 변경된 컬럼: client_additional_price.id: int unsigned -> int unsigned, client_detail.id: int unsigned -> int unsigned, client_detail.client_id: mediumint unsigned -> mediumint unsigned, client_header.id: mediumint unsigned -> mediumint unsigned, client_header.register_no: varchar(6) -> varchar(6) 외 101건
- 테이블 수: 34개, 컬럼 수: 305개
