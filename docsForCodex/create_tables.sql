-- Table: client_additional_price
CREATE TABLE `client_additional_price` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'PK',
  `room_id` INT NOT NULL,
  `date` DATE NOT NULL,
  `seq` TINYINT NOT NULL,
  `title` VARCHAR(15) NOT NULL,
  `price` DECIMAL(9,2) NOT NULL,
  `comment` VARCHAR(255) NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Table: client_custom_price
CREATE TABLE `client_custom_price` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'PK',
  `room_id` INT NOT NULL,
  `title` VARCHAR(15) NOT NULL,
  `price_per_cleaning` DECIMAL(9,2) NOT NULL,
  `price_per_month` DECIMAL(11,2) NOT NULL,
  `start_date` DATE NOT NULL,
  `end_date` DATE NOT NULL,
  `comment` VARCHAR(255) NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Table: client_detail
CREATE TABLE `client_detail` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'PK',
  `client_id` MEDIUMINT UNSIGNED NOT NULL COMMENT 'client_header 참조',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Table: client_header
CREATE TABLE `client_header` (
  `id` MEDIUMINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'PK',
  `register_no` VARCHAR(6) NOT NULL COMMENT '영대문자,숫자섞어서 랜덤생성/중복불가',
  `name` VARCHAR(10) NOT NULL,
  `person` VARCHAR(5) NOT NULL,
  `phone` VARCHAR(11) NOT NULL COMMENT '휴대전화만 가능',
  `rcpt_flag` TINYINT NOT NULL DEFAULT 1 COMMENT '1:세금계산서/2:현금영수증',
  `rcpt_no` VARCHAR(13) NULL COMMENT '사업자번호,주민번호/숫자만',
  `rcpt_name` VARCHAR(20) NULL COMMENT '영수증발행 대상의 이름',
  `rcpt_mail` VARCHAR(255) NULL COMMENT '영수증 발행 받을 메일주소',
  `settle_flag` TINYINT NOT NULL DEFAULT 1 COMMENT '1:건별제/2:정액제/3:커스텀/4:기타',
  `desk_yn` BOOLEAN NOT NULL DEFAULT 0 COMMENT '0:사용안함/1:사용함',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Table: client_rooms
CREATE TABLE `client_rooms` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'PK',
  `client_id` MEDIUMINT UNSIGNED NOT NULL COMMENT 'client_header 참조',
  `building_id` TINYINT NOT NULL,
  `room_no` CHAR(5) NOT NULL,
  `central_password` VARCHAR(20) NULL,
  `door_password` VARCHAR(15) NOT NULL,
  `start_date` DATE NOT NULL,
  `end_date` DATE NULL,
  `room_count` TINYINT NOT NULL DEFAULT 1,
  `bed_count` TINYINT NOT NULL DEFAULT 1,
  `checkout_time` TIME NOT NULL,
  `checkin_time` TIME NOT NULL,
  `facility_yn` BOOLEAN NOT NULL DEFAULT 1 COMMENT '0:사용안함/1:사용함',
  `ical_url_1` VARCHAR(2083) NULL,
  `ical_url_2` VARCHAR(2083) NULL,
  `settle_flag` TINYINT NOT NULL DEFAULT 1 COMMENT '1:기본계약요건/2:커스텀계약요건',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Table: etc_baseCode
CREATE TABLE `etc_baseCode` (
  `code_group` VARCHAR(20) NOT NULL COMMENT '코드그룹명',
  `code` VARCHAR(10) NOT NULL COMMENT '코드',
  `value` VARCHAR(255) NOT NULL COMMENT '값',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`code_group`, `code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Table: etc_buildings
CREATE TABLE `etc_buildings` (
  `id` TINYINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'PK',
  `basecode_sector` VARCHAR(10) NOT NULL COMMENT '지역코드',
  `basecode_code` VARCHAR(255) NOT NULL COMMENT '지역값',
  `building_name` VARCHAR(20) NOT NULL,
  `building_short_name` VARCHAR(10) NOT NULL,
  `building_address_old` VARCHAR(255) NOT NULL,
  `building_address_new` VARCHAR(255) NOT NULL,
  `building_password` VARCHAR(10) NULL,
  `building_recycle` VARCHAR(20) NULL,
  `building_general` VARCHAR(20) NULL,
  `building_food` VARCHAR(20) NULL,
  `building_way_img_basePath` VARCHAR(255) NULL,
  `building_way_img_relativePath` VARCHAR(255) NULL,
  `delete_yn` BOOLEAN NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Table: etc_errorLogs
CREATE TABLE `etc_errorLogs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'PK',
  `level` TINYINT UNSIGNED NOT NULL COMMENT '1:FATAL/2:ERROR/3:WARN/4:INFO/5:DEBUG',
  `app_name` VARCHAR(50) NOT NULL COMMENT '서비스 또는 모듈명',
  `error_code` VARCHAR(50) NULL COMMENT '비즈니스 에러코드',
  `message` VARCHAR(500) NOT NULL COMMENT '요약 에러 메시지',
  `stacktrace` TEXT NULL COMMENT '전체 스택 트레이스',
  `request_id` VARCHAR(100) NULL COMMENT '트랜잭션/요청 추적용 ID',
  `user_id` BIGINT UNSIGNED NULL COMMENT '에러 발생 유저 PK',
  `context_json` JSON NULL COMMENT '추가 상태/파라미터 JSON',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Table: etc_notice
CREATE TABLE `etc_notice` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'PK',
  `notice_date` DATE NOT NULL,
  `notice` VARCHAR(255) NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `work_apply` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'PK',
  `worker_id` INT UNSIGNED NULL,
  `work_date` DATE NOT NULL,
  `basecode_sector` VARCHAR(10) NOT NULL COMMENT '지역코드',
  `basecode_code` VARCHAR(255) NOT NULL COMMENT '지역값',
  `butler_yn` BOOLEAN NOT NULL COMMENT '0:클리닝/1:버틀러',
  `cancel_yn` BOOLEAN NOT NULL COMMENT '0:취소안함/1:취소',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Table: work_checkList
CREATE TABLE `work_checkList` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'PK',
  `type` TINYINT NOT NULL COMMENT '1:cleaning/2:supervising/3:supplies/4:scoring',
  `general_yn` BOOLEAN NOT NULL COMMENT '0:notGeneral/1:General',
  `building_id` TINYINT NULL,
  `seq` TINYINT NOT NULL,
  `title` VARCHAR(20) NOT NULL,
  `score` TINYINT NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Table: work_fore_accuracy
CREATE TABLE `work_fore_accuracy` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'PK',
  `date` DATE NOT NULL,
  `horizon` CHAR(3) NOT NULL,
  `acc` DECIMAL(5,4) NOT NULL,
  `prec` DECIMAL(5,4) NOT NULL,
  `rec` DECIMAL(5,4) NOT NULL,
  `f1` DECIMAL(5,4) NOT NULL,
  `n` TINYINT NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Table: work_fore_d1
CREATE TABLE `work_fore_d1` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'PK',
  `run_dttm` DATE NOT NULL,
  `target_date` DATE NOT NULL,
  `room_id` INT NOT NULL,
  `p_out` DECIMAL(4,3) NOT NULL,
  `actual_out` BOOLEAN NOT NULL,
  `correct` BOOLEAN NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Table: work_fore_d7
CREATE TABLE `work_fore_d7` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'PK',
  `run_dttm` DATE NOT NULL,
  `target_date` DATE NOT NULL,
  `room_id` INT NOT NULL,
  `p_out` DECIMAL(4,3) NOT NULL,
  `actual_out` BOOLEAN NOT NULL,
  `correct` BOOLEAN NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Table: work_fore_tuning
CREATE TABLE `work_fore_tuning` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'PK',
  `date` DATE NOT NULL,
  `horizon` CHAR(3) NOT NULL,
  `variable` VARCHAR(15) NOT NULL,
  `before` DECIMAL(5,4) NOT NULL,
  `after` DECIMAL(5,4) NOT NULL,
  `delta` DECIMAL(10,6) NOT NULL,
  `explanation` VARCHAR(50) NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Table: work_fore_variable
CREATE TABLE `work_fore_variable` (
  `tinyint` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'PK',
  `name` VARCHAR(15) NOT NULL,
  `value` DECIMAL(5,4) NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`tinyint`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Table: work_header
CREATE TABLE `work_header` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'PK',
  `date` DATE NOT NULL,
  `room_id` INT NOT NULL,
  `cleaner_id` INT NULL,
  `butler_id` INT NULL,
  `amenities_qty` TINYINT NOT NULL,
  `blanket_qty` TINYINT NOT NULL,
  `conditionCheckYn` BOOLEAN NOT NULL DEFAULT 0 COMMENT '0:대상아님/1:대상',
  `cleaning_yn` BOOLEAN NOT NULL DEFAULT 1 COMMENT '0:대상아님/1:대상',
  `checkin_time` TIME NOT NULL,
  `ceckout_time` TIME NOT NULL,
  `supply_yn` BOOLEAN NOT NULL DEFAULT 1 COMMENT '0:미배급/1:배급',
  `clening_flag` TINYINT NOT NULL DEFAULT 1 COMMENT '1:대기/2:시작/3:완료5분전/4:완료',
  `cleaning_end_time` TIME NULL,
  `supervising_end_time` TIME NULL,
  `requirements` VARCHAR(30) NULL,
  `cancel_yn` BOOLEAN NOT NULL DEFAULT 0 COMMENT '0:정상/1:취소',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Table: work_reports
CREATE TABLE `work_reports` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'PK',
  `work_id` BIGINT NOT NULL,
  `type` TINYINT NOT NULL COMMENT '1:scoring/2:supplies/3:images',
  `contents1` JSON NOT NULL,
  `contents2` JSON NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Table: worker_detail
CREATE TABLE `worker_detail` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'PK',
  `worker_id` BIGINT UNSIGNED NOT NULL COMMENT 'client_header 참조',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Table: worker_evaluateHistory
CREATE TABLE `worker_evaluateHistory` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'PK',
  `worker_id` INT UNSIGNED NOT NULL COMMENT 'client_header 참조',
  `evaluate_dttm` DATETIME NOT NULL,
  `work_id` BIGINT NOT NULL,
  `checklist_title_array` JSON NOT NULL,
  `checklist_point_sum` TINYINT NOT NULL,
  `comment` VARCHAR(255) NOT NULL COMMENT '당일의 마지막 청소 건에만 입력',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Table: worker_header
CREATE TABLE `worker_header` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'PK',
  `register_no` VARCHAR(6) NOT NULL COMMENT '영대문자,숫자섞어서 랜덤생성/중복불가',
  `name` VARCHAR(20) NOT NULL,
  `phone` VARCHAR(11) NULL COMMENT '휴대전화만 가능',
  `reg_no` CHAR(13) NULL,
  `basecode_bank` VARCHAR(10) NULL COMMENT '지역코드',
  `basecode_code` VARCHAR(255) NULL COMMENT '지역값',
  `account_no` VARCHAR(50) NULL,
  `tier` TINYINT NOT NULL,
  `comments` VARCHAR(255) NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Table: worker_penaltyHistory
CREATE TABLE `worker_penaltyHistory` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'PK',
  `worker_id` INT UNSIGNED NOT NULL COMMENT 'client_header 참조',
  `start_date` DATE NOT NULL,
  `interval` TINYINT NOT NULL,
  `comment` VARCHAR(255) NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

