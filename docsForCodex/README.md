# DB 참조 자료

본 폴더는 프론트엔드/배치 코드가 의존하는 MySQL 스키마 정의를 텍스트 형태로 정리했습니다. `database-schema.sql` 파일을 최신 운영 DB와 동기화하여 Drizzle 모델 및 API 계약의 기준으로 사용하세요.

## 스키마 자동 생성 스크립트

- `schema_create.py` 실행 시점의 실 DB에 접속해 `schema.csv`를 재생성하고, 이전 파일과의 차이를 `schema_summary.md` 상단에 쌓아두는 스택형 요약을 만듭니다.
- 접속 정보는 메인 웹 프로젝트와 동일하게 루트 경로의 `.env`, `.env.local`(존재 시)을 순서대로 읽어 `DATABASE_URL` 또는 `DB_HOST/DB_USER/DB_PASSWORD/DB_NAME[/DB_PORT]`를 불러옵니다. 별도의 export 없이 Next.js 설정을 그대로 따릅니다.
- 변경 요약은 파일 상단에 날짜별로 누적되며 과거 기록은 지우지 않습니다.
