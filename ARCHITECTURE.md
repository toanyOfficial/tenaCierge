# 내부 운영 대시보드 아키텍처 정의서

동일한 서버에서 기존 대시보드와 동일한 기술 스택(Next.js 13 App Router + Bun + Drizzle ORM + MySQL + Puppeteer)을 사용하는 신규 웹 프로젝트를 구축하기 위한 기준 문서입니다. 개발·배포 파이프라인, 데이터 연동, UI/UX 가이드를 사전에 명시해 두어 두 대시보드가 공존하더라도 일관된 품질을 유지하는 것을 목표로 합니다.

## 1. 시스템 목표
- **업무 연속성**: 체크아웃 일정확인 -> 인원배정 -> 클리닝 -> 수퍼바이징 -> 보고 -> 월정산에 이르는 업무 프로세스

## 2. 기술 스택
| 계층 | 선택 기술 | 비고 |
| --- | --- | --- |
| 런타임 | Bun 1.x | 빠른 cold start, `bun run dev --port 3200` |
| 프레임워크 | Next.js 13 App Router | `/app` 디렉터리 구조 + 서버/클라이언트 컴포넌트 혼합 |
| 스타일 | CSS Modules + 인라인 스타일 + Tailwind (선택) | 기존 규칙과 동일하게 `globals.css` 최소화 |
| 데이터 | Drizzle ORM + mysql2/promise | `src/db/schema.ts` 재사용, 새 repo에는 필요한 테이블만 subset 가능 |
| 인증 | 쿠키 기반 세션(`auth` JSON) | 역할(role) + 전화번호(phone) 구조 유지 |
| PDF | Puppeteer 22+ | `PUPPETEER_EXECUTABLE_PATH` 옵션 동일 |
| 테스트 | Playwright(선택) + ESLint | 동일 lint 규칙, `bun run lint`|

## 3. 애플리케이션 계층 구조
1. **App Router**
2. **API Routes** (`/app/api/*`)
3. **DB Layer**
   - `src/db/client.ts`: 싱글톤 커넥션, `globalThis.mysqlPool` 패턴 유지.
   - `src/db/schema.ts`: 테이블 스키마는 공용 repo에서 export 받아 의존하거나 Git 서브모듈로 공유.
4. **유틸리티**
   - `src/lib/time.ts`: 한국시간 포맷터.
   - `src/lib/pdf.ts`: Puppeteer PDF 템플릿/스타일 공통화.


## 4. 데이터 및 권한 정책
- **역할(role)**: `admin`, `cleaner`, `butler`, `host`.  쿠키 기반의 역할관리.
- **감사 로그**: `/logs/{env}/audit.log` 파일에 API 호출 요약을 append (선택 사항).

## 5. UI/UX & 디자인 가이드
### 공통 원칙
1. **반응형 우선**: 최소 해상도 360px 기준. breakpoints: 480, 768, 1024.
2. **폰트**: Pretendard 또는 Noto Sans KR. 기본 14px, 헤더 16px.
3. **색상 팔레트**
   - Primary: `#111827` (문자), Secondary: `#2563EB`, Accent: `#10B981`.
   - 상태 색: 대기 `#DC2626`, 제조 `#FB923C`, 완료 `#1D4ED8`.
4. **Spacing**: 8px 그리드. 카드 padding 12px, 모달 padding 20px.
5. **버튼**: radius 6px, hover 시 5% 밝기 상승.

## 6. 배포 및 운영
1. **빌드**: `bun run build` (환경변수 `DATABASE_URL`, `PUPPETEER_EXECUTABLE_PATH` 필요).
2. **런타임**: `bun run start --port 3200 --hostname 0.0.0.0`.
3. **프로세스 매니저**: `pm2 start bun --name ops-v2 -- run start --port 3200`.
4. **로깅**: Bun stdout/stderr를 `~/logs/ops-v2.log`로 리다이렉트.
5. **모니터링**: `pm2 monit` 또는 Grafana + Loki (선택).

## 7. 보안 고려 사항
- HTTPS 종단, Secure + HttpOnly 쿠키.
- Puppeteer 실행 시 `--no-sandbox` 옵션 유지, 실행 파일 권한 확인.
- 민감 정보는 `.env.v2`와 `systemd EnvironmentFile` 병행 관리.
- DB 접근 계정은 최소 권한(`SELECT, INSERT, UPDATE`)만 허용.

## 8. 향후 확장 로드맵
1. **컴포넌트 라이브러리화**: 공통 검색/그리드/카드 컴포넌트를 `packages/ui`로 추출.
2. **멀티 리전 DB**: 읽기 부하가 늘면 MySQL read replica 도입.
3. **Observability**: OpenTelemetry SDK를 Next API에 도입해 trace 공유.
4. **CI/CD**: GitHub Actions로 lint → test → Bun build → rsync 배포 자동화.

---
이 정의서를 바탕으로 신규 프로젝트를 시작하면, 기존 대시보드와 동일한 사용자 경험과 운영 편의성을 유지하면서도 추가 요구사항을 안전하게 구현할 수 있습니다.
