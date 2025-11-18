# TenaCierge Ops Web

Next.js 13 App Router 기반의 내부 운영 대시보드 초기 베이스라인입니다. 전체 설계 원칙은 `ARCHITECTURE.md`를 참고하세요.

## 개발 스크립트
- `bun install`
- `bun run dev` – http://localhost:3200
- `bun run build`
- `bun run start`
- `bun run lint`

## 디렉터리 구조
```
app/              # App Router 엔트리, API Route 포함
src/db/           # Drizzle DB 싱글톤 및 스키마 일부 매핑
src/lib/          # 공용 유틸 (시간, PDF 템플릿 등)
docsForCodex/     # 운영 DB 스키마 참고용 SQL
batchs/           # 기존 배치 스크립트(참고용)
```

## 화면 현황
| ID   | 경로     | 설명 |
| ---- | -------- | ---- |
| 000  | `/login` | 사내 계정/OTP 기반 인증 UI. 휴대전화·비밀번호 검증, 2차 인증 필드, "30일 유지" 옵션 및 정책 링크를 제공하며 추후 API 연동 시 그대로 사용할 수 있습니다. |

## 환경 변수
- `DATABASE_URL` – mysql2 커넥션 문자열
- `PUPPETEER_EXECUTABLE_PATH` – PDF 출력 시 사용(향후 기능)
