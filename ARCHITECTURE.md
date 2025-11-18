# 내부 운영 대시보드 아키텍처 정의서

동일한 서버에서 기존 대시보드와 동일한 기술 스택(Next.js 13 App Router + Bun + Drizzle ORM + MySQL + Puppeteer)을 사용하는 신규 웹 프로젝트를 구축하기 위한 기준 문서입니다. 개발·배포 파이프라인, 데이터 연동, UI/UX 가이드를 사전에 명시해 두어 두 대시보드가 공존하더라도 일관된 품질을 유지하는 것을 목표로 합니다.

## 1. 시스템 목표
- **업무 연속성**: 주문/배송 운영팀이 두 대시보드를 상황에 따라 전환 사용해도 인증과 데이터 정책이 동일하게 동작.
- **재사용성 극대화**: 기존 컴포넌트, 데이터 접근 계층, 인프라 구성을 재활용해 유지보수 비용 절감.
- **확장성**: 동일 서버에서 서비스하되 리소스 격리를 위해 라우팅 프리픽스와 환경 변수를 명확히 분리.

## 2. 전체 아키텍처 개요
```
[브라우저]
    ↓ HTTPS
[Next.js App Router (Bun Runtime)]
    ↙︎                      ↘︎
클라이언트 컴포넌트        API Route (Server Component)
                              ↓
                        Drizzle ORM
                              ↓
                         MySQL 8.x
                              ↓
                        Puppeteer
```
- **호스팅**: 동일 서버 내 `pm2` 또는 `systemd` 서비스 2개로 각 대시보드를 독립 실행.
- **포트**: 기존 서비스와 충돌하지 않도록 `PORT=3100` 등 별도 포트를 지정하고, 리버스 프록시(Nginx)의 서브패스 예: `/ops-v2`로 라우팅.
- **환경 분리**: `.env.v2`처럼 별도 dotenv 파일을 만들어 `DATABASE_URL`만 공유하고 `APP_BASE_PATH=/ops-v2` 등 고유 변수를 둡니다.

## 3. 기술 스택
| 계층 | 선택 기술 | 비고 |
| --- | --- | --- |
| 런타임 | Bun 1.x | 빠른 cold start, `bun run dev --port 3100` |
| 프레임워크 | Next.js 13 App Router | `/app` 디렉터리 구조 + 서버/클라이언트 컴포넌트 혼합 |
| 스타일 | CSS Modules + 인라인 스타일 + Tailwind (선택) | 기존 규칙과 동일하게 `globals.css` 최소화 |
| 데이터 | Drizzle ORM + mysql2/promise | `src/db/schema.ts` 재사용, 새 repo에는 필요한 테이블만 subset 가능 |
| 인증 | 쿠키 기반 세션(`auth` JSON) | 역할(role) + 전화번호(phone) 구조 유지 |
| PDF | Puppeteer 22+ | `PUPPETEER_EXECUTABLE_PATH` 옵션 동일 |
| 테스트 | Playwright(선택) + ESLint | 동일 lint 규칙, `bun run lint`|

## 4. 애플리케이션 계층 구조
1. **App Router**
   - `/app/page.tsx`: 기본 대시보드. 필요한 경우 `/app/(routes)/admin/page.tsx`처럼 분리.
   - 클라이언트 상태: `zustand` or React state. 인증 정보는 `useAuthBootstrap` 훅으로 공통화.
2. **API Routes** (`/app/api/*`)
   - `/api/login`, `/api/auth-info` 재사용.
   - 신규 서비스에 맞는 도메인 API(`orders`, `order-detail`, `summary`, `invoice`). 공통 미들웨어(`readAuthCookie`)는 `src/lib/server-auth.ts`로 추출.
3. **DB Layer**
   - `src/db/client.ts`: 싱글톤 커넥션, `globalThis.mysqlPool` 패턴 유지.
   - `src/db/schema.ts`: 테이블 스키마는 공용 repo에서 export 받아 의존하거나 Git 서브모듈로 공유.
4. **유틸리티**
   - `src/lib/time.ts`: 한국시간 포맷터.
   - `src/lib/pdf.ts`: Puppeteer PDF 템플릿/스타일 공통화.

## 5. API 설계 (샘플)
| Endpoint | Method | 설명 |
| --- | --- | --- |
| `POST /api/login` | POST | 전화번호 + PIN 검증 후 `auth` 쿠키 발급 |
| `GET /api/auth-info` | GET | 쿠키 기반 세션 상태 확인 |
| `GET /api/orders` | GET | 날짜/전화번호 기반 주문 목록. 정렬 `idx, depart_time, order_date` |
| `GET /api/order-detail` | GET | 주문별 품목/주소. 모달과 PDF 모두 재사용 |
| `GET /api/admin-summary` | GET | 카테고리 정렬(2→3→5→1→6→보양대→보양특대→보양소→8→9→total)로 합계 제공 |
| `GET /api/invoice` | GET | Puppeteer로 거래명세서 PDF 반환 |

## 6. 데이터 및 권한 정책
- **역할(role)**: `admin`, `courier`(배달), `guest`. 라우팅/컴포넌트 토글은 role 기반.
- **전화번호 정규화**: 숫자만 저장, 11자리 미만일 경우 좌측 0 패딩 금지.
- **조회 범위**
  - Admin: 전체 조회, 단 `phone=00000000000` 유지 시 모든 주문 노출.
  - Courier: 쿠키 phone과 검색 phone이 일치해야 함.
- **감사 로그**: `/logs/{env}/audit.log` 파일에 API 호출 요약을 append (선택 사항).

## 7. UI/UX & 디자인 가이드
### 공통 원칙
1. **반응형 우선**: 최소 해상도 360px 기준. breakpoints: 480, 768, 1024.
2. **폰트**: Pretendard 또는 Noto Sans KR. 기본 14px, 헤더 16px.
3. **색상 팔레트**
   - Primary: `#111827` (문자), Secondary: `#2563EB`, Accent: `#10B981`.
   - 상태 색: 대기 `#DC2626`, 제조 `#FB923C`, 완료 `#1D4ED8`.
4. **Spacing**: 8px 그리드. 카드 padding 12px, 모달 padding 20px.
5. **버튼**: radius 6px, hover 시 5% 밝기 상승.

### 뷰별 가이드
- **검색 바**: 항상 한 줄 유지(토글 → 날짜 → 연락처 → 버튼). 좁은 화면에서는 두 줄, 단 첫 줄 토글+날짜, 둘째 줄 연락처+조회.
- **배달용 그리드**: thead 중앙 정렬, sender/order_time 중앙 정렬, 상태는 위 색상 규칙.
- **관리자 카드 뷰**: 카드 헤더 `[ 총수량 ] 상호명 (HH:mm)` 형태. body는 `[종류-메뉴-수량]` 반복.
- **합계표**: total 열은 검은 배경/흰색 글자, 나머지 카테고리는 기본 배경. 좁은 화면에서 2행씩 교차 출력.
- **모달**: `max-width: 720px`, 스크롤 내부 처리. 기본정보 섹션 → 품목 그리드 → 주소/비고 → PDF 버튼.

## 8. 배포 및 운영
1. **빌드**: `bun run build` (환경변수 `DATABASE_URL`, `PUPPETEER_EXECUTABLE_PATH` 필요).
2. **런타임**: `bun run start --port 3100 --hostname 0.0.0.0`.
3. **프로세스 매니저**: `pm2 start bun --name ops-v2 -- run start --port 3100`.
4. **로깅**: Bun stdout/stderr를 `~/logs/ops-v2.log`로 리다이렉트.
5. **모니터링**: `pm2 monit` 또는 Grafana + Loki (선택).

## 9. 보안 고려 사항
- HTTPS 종단, Secure + HttpOnly 쿠키.
- Puppeteer 실행 시 `--no-sandbox` 옵션 유지, 실행 파일 권한 확인.
- 민감 정보는 `.env.v2`와 `systemd EnvironmentFile` 병행 관리.
- DB 접근 계정은 최소 권한(`SELECT, INSERT, UPDATE`)만 허용.

## 10. 향후 확장 로드맵
1. **컴포넌트 라이브러리화**: 공통 검색/그리드/카드 컴포넌트를 `packages/ui`로 추출.
2. **멀티 리전 DB**: 읽기 부하가 늘면 MySQL read replica 도입.
3. **Observability**: OpenTelemetry SDK를 Next API에 도입해 trace 공유.
4. **CI/CD**: GitHub Actions로 lint → test → Bun build → rsync 배포 자동화.

---
이 정의서를 바탕으로 신규 프로젝트를 시작하면, 기존 대시보드와 동일한 사용자 경험과 운영 편의성을 유지하면서도 추가 요구사항을 안전하게 구현할 수 있습니다.
