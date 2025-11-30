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
