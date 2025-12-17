# TenaCierge Ops Web

Next.js 13 App Router 기반의 내부 운영 대시보드 초기 베이스라인입니다. 전체 설계 원칙은 `ARCHITECTURE.md`를 참고하세요.

## 개발 스크립트
- `bun install`
- `bun run dev` – http://localhost:3200
- `bun run build`
- `bun run start`
- `bun run lint`

## 운영 실행/재시작 가이드
- **웹서버 기동은 반드시 `/srv/tenaCierge/scripts/start-web.sh`로 실행**합니다. 이 스크립트가 `.env`를 export 후 `bun run start -H 0.0.0.0`를 `nohup`으로 띄우고 로그를 `/srv/tenaCierge/logs/webserver.log`에 남깁니다.
  - 실행 예시: `sudo -u appuser -H bash -lc '/srv/tenaCierge/scripts/start-web.sh'`
- **환경 변수 확인**은 `/srv/tenaCierge/scripts/check-env.sh`를 사용합니다. `.env`를 로드한 뒤 `DB_HOST/DB_USER/DB_NAME/VAPID_PUBLIC_KEY/NEXT_PUBLIC_VAPID_PUBLIC_KEY`만 출력합니다.
- (선택) 기존 `bun run start` 프로세스가 떠 있다면 중복 기동을 피하기 위해 종료 후 실행하세요.
  - 확인: `ps -fu appuser | grep 'bun run start' | grep -v grep`
  - 종료: `sudo -u appuser -H pkill -f 'bun run start'`

## 디렉터리 구조
```
app/              # App Router 엔트리, API Route 포함
src/db/           # Drizzle DB 싱글톤 및 스키마 일부 매핑
src/lib/          # 공용 유틸 (시간, PDF 템플릿 등)
docsForCodex/     # 운영 DB 스키마 참고용 SQL
batchs/           # 기존 배치 스크립트(참고용)
```

## 화면 현황
| ID   | 경로        | 설명 |
| ---- | ----------- | ---- |
| 000  | `/login`    | 사내 계정/OTP 기반 인증 UI. 휴대전화·비밀번호 검증, 2차 인증 필드, "30일 유지" 옵션 및 정책 링크를 제공하며 추후 API 연동 시 그대로 사용할 수 있습니다. |
| 001  | `/dashboard` | D+1 work_header를 카드·테이블로 시각화한 운영 홈 화면. 당일 퇴실/상태확인 건수, 인원 배치, 특이사항 리스트를 mock 데이터로 제공해 레이아웃/스타일을 미리 검증할 수 있습니다. |

## 로컬 실행 (DB 없이 화면만 확인)
1. **의존성 설치** – `bun install`
2. **개발 서버 기동** – `bun run dev --port 3200`
3. **브라우저 접속** – `http://localhost:3200/login`(ID 000) 또는 `http://localhost:3200/dashboard`(ID 001)

> 현재 화면들은 모두 mock 데이터를 사용하므로 `.env`나 실제 DB 연결 없이도 바로 렌더링됩니다. 이후 API/DB 연동 시에는 `DATABASE_URL`을 `.env.local` 등에 추가하면 됩니다.

## 차트 라이브러리 안내
- `/dashboard/admin-stats` 화면의 혼합형 차트는 **Recharts**를 CDN(unpkg)으로 로드합니다.
- 현재 레지스트리 접근이 제한되어 있어 `package.json` dependencies로 설치하지 않습니다. 레지스트리 이슈가 해소되면 `recharts@^2.12.7`을 dependencies에 추가한 뒤 `npm/bun install`로 실제 패키지를 반영할 수 있습니다.

## 환경 변수
- `DATABASE_URL` – mysql2 커넥션 문자열
- `PUPPETEER_EXECUTABLE_PATH` – PDF 출력 시 사용(향후 기능)
