# Recharts prod Bar 미렌더 원인 확정/해결 계획서

## 1) 상황 요약 / 목표 / 비목표
- **상황 요약:** Next.js 기반 관리자 대시보드에서 Recharts Bar가 prod(`bun run build`→`bun run start`)에서만 `<rect>`가 생성되지 않는 치명 이슈 발생. 동일 코드가 dev(`bun run dev`)에서는 정상 렌더됨.
- **목표:** prod 환경에서 Bar `<rect>`가 생성되지 않는 원인을 **확정**하고, 디자인/레이아웃을 변경하지 않는 범위에서 **최소 수정**으로 해결한다. 모든 디버그/실험은 이후 일괄 정리 PR로 제거한다.
- **비목표:** UI/레이아웃/테마 변경, 차트 디자인 개선, 신규 기능 추가. 추정만으로 수정하지 않으며 원인 불명 상태에서의 임의 리팩터링 금지.

## 2) 재현 방법(dev/prod)과 검증 기준
- **dev 재현:**
  1. `bun install` (이미 설치된 경우 스킵)
  2. `bun run dev`
  3. 관리자화면 → 대시보드(통계표) 접속 후 차트 렌더링 확인
  4. 기대: 모든 Bar/Line 정상 렌더, 콘솔 로그 2회 출력(StrictMode 영향 가능)
- **prod 재현:**
  1. `rm -rf .next`
  2. `bun run build`
  3. `PORT=3200 bun run start -H 0.0.0.0`
  4. 동일 페이지 접속 후 차트 상태 및 DOM/SVG(`<rect>` 존재 여부) 확인
  5. 기대: 현재는 Bar `<rect>` 미생성 증상 재현
- **검증 기준:**
  - `<g class="recharts-bar-rectangle">` 내부에 `<rect>` 존재 여부
  - `chartWidth`, `xAxisBandwidth`, `dataLength` 등의 디버그 로그 값 비교(dev vs prod)
  - 실제 시각적 Bar 렌더 여부
  - 로그/DOM 관찰은 브라우저 devtools 기준으로 수행

## 3) 가설 트리(원인 후보)와 분기 조건
- **A. 빌드/SSR/호환성 문제**
  - 증상: prod 빌드에서만 `<rect>` 미생성, `xAxisBandwidth`가 N/A
  - 분기: 최소 재현 고정 차트도 prod에서 깨지면 이 경로 강화 → SSR/CSR 분기, 번들/React 중복 점검
- **B. 레이아웃/크기 확정 타이밍 문제**
  - 증상: 컨테이너 크기 확정 전에 계산되어 bandwidth가 N/A
  - 분기: 고정 width/height 차트는 정상인데 기존 차트만 문제면 이 경로
- **C. 데이터키 생성/정렬 문제**
  - 증상: prod에서 Bar 순서 반전, 일부 column 중간 사라짐
  - 분기: 키 생성 순서를 고정하면 해결되면 이 경로
- **D. YAxis domain/NaN 방어 문제**
  - 증상: 특정 값이 NaN/undefined로 처리되어 height 0이 되는 경우
  - 분기: 값/도메인 고정 시 정상화되면 이 경로
- **E. 기타 의존성 중복/버전 충돌**
  - 증상: React/Recharts 다중 버전 로드로 컨텍스트 불일치
  - 분기: `npm ls` 등에서 중복/버전 불일치 발견 시 이 경로

## 4) 작업 스케줄(=PR 계획)
- 상태 값: `예정 / 진행 / 실패 / 검증완료 / 보류`
- 각 PR은 atomic 목표 1개만 수행하며, 실행 시 문서 상태/로그를 업데이트한다.

1. **PR-001: 고정형 BarChart 최소 재현 카드 추가** — 상태: 검증완료
   - 관리자 대시보드 `StatsDashboard.tsx` 마지막 섹션에 조건 없이 항상 렌더되는 “고정형 BarChart 진단 (PR-001)” 카드 삽입.
   - ResponsiveContainer 없이 width/height 하드코딩, 데이터 2개, Y 도메인 하드코딩, 애니메이션 off.
   - prod 관찰: `barGroup=2`, `barPath=2`, `barRect=0`, `path.recharts-rectangle`가 2개 생성됨.
   - 로그:
     - `client-001` -> PR-001 FixedDebugBarChart render (client-only)
     - `client-002` -> PR-001 Bar mouse enter (선택)
     - `client-003` -> PR-001 debug card mounted
   - 목표: prod에서 `<rect>` 생성 여부를 확실히 확인하고, 카드가 항상 DOM에 포함되는지 검증. **관찰 완료** (path로 렌더되는 환경 확인).

2. **PR-002: SSR 차단 실험 + 의존성 수집** — 상태: 진행
   - PR-001 차트를 `dynamic(..., { ssr: false })`로 감싸 client-only 렌더 시 Bar path/rect 개수 변화를 관찰.
   - 새 컴포넌트 `PR001ClientOnlyChart`에서 `client-010~012` 로그 및 마운트 후 path/rect 카운트 로그(`client-011`).
   - 서버 로그 `server-001~003`: React/ReactDOM/Recharts 버전, `npm ls` 결과, `bun pm ls` 결과를 수집해 전문 기록.
   - 고정형 디버그 카드에 `ref`를 부여하고 `useRef`를 명시적으로 import하여 빌드 시 `useRef` 미정의 오류를 방지.
   - **빌드 복구(PR-002a-2):** `minimalBarShapeLog`를 `useRef<Set<string>>(new Set())`로 컴포넌트 스코프 상단에 선언해 TS 식별자
     누락 에러를 제거.
   - 목표: SSR/CSR 영향 여부와 React/Recharts 중복/버전 불일치를 확정.
   - 로그:
     - `client-001` -> PR-001 FixedDebugBarChart render (client-only)
     - `client-002` -> PR-001 Bar mouse enter (선택)
     - `client-003` -> PR-001 debug card mounted
     - `client-010` -> ssr:false chart render
     - `client-011` -> post-mount counts (barGroup/barRect/barPath/allPath/allRect)
     - `client-012` -> Bar mouse enter
     - `server-001` -> React/ReactDOM/Recharts version 확인
       - 전문:
         ```
         node -p "require('react/package.json').version"
         18.3.1
         node -p "require('react-dom/package.json').version"
         18.3.1
         node -p "require('recharts/package.json').version"
         2.12.7
         ```
     - `server-002` -> `npm ls react react-dom recharts --all`
       - 전문:
         ```
         npm warn Unknown env config "http-proxy". This will stop working in the next major version of npm.
         tena-cierge-web@ /workspace/tenaCierge
         ├─┬ drizzle-orm@0.30.10
         │ └── react@18.3.1 deduped
         ├─┬ next@14.2.33
         │ ├── react-dom@18.3.1 deduped
         │ ├── react@18.3.1 deduped
         │ └─┬ styled-jsx@5.1.1
         │   └── react@18.3.1 deduped
         ├─┬ react-dom@18.3.1
         │ └── react@18.3.1 deduped
         ├── react@18.3.1
         └─┬ recharts@2.12.7
           ├── react-dom@18.3.1 deduped
           └── react@18.3.1 deduped
         ```
     - `server-003` -> `bun pm ls react react-dom recharts`
       - 전문:
         ```
         [11.46ms] migrated lockfile from package-lock.json
         /workspace/tenaCierge node_modules (408)
         ├── @types/node@20.19.25
         ├── @types/react@18.3.27
         ├── @types/react-dom@18.3.7
         ├── clsx@vendor/clsx
         ├── drizzle-orm@0.30.10
         ├── eslint@8.57.1
         ├── eslint-config-next@14.2.33
         ├── eventemitter3@vendor/eventemitter3
         ├── google-auth-library@vendor/google-auth-library
         ├── lodash@vendor/lodash
         ├── luxon@3.7.2
         ├── mysql2@3.15.3
         ├── next@14.2.33
         ├── react@18.3.1
         ├── react-dom@18.3.1
         ├── react-smooth@vendor/react-smooth
         ├── recharts@2.12.7
         ├── recharts-scale@vendor/recharts-scale
         ├── sharp@0.33.5
         ├── tiny-invariant@vendor/tiny-invariant
         ├── typescript@5.9.3
         ├── victory-vendor@vendor/victory-vendor
         └── zod@3.25.76
         ```

3. **PR-003: 카드별 Bar 렌더 수/크기 분리 계측(원인 분리)** — 상태: 검증완료
   - 각 통계 카드 섹션에 id 부여: 요금제 `chart-subscription`, 월별 `chart-monthly`, 요일별 `chart-weekday`.
   - 마운트 후 800ms에 카드별 Bar path 개수/clipPath 개수/bbox 샘플을 로그로 남김.
   - prod 관찰: `chart-subscription` `barPathCount=0`, `chart-monthly` `barPathCount=0`, `chart-weekday` `barPathCount=45`.
   - 로그:
     - `client-020` -> chart-subscription -> bar counts
     - `client-021` -> chart-subscription -> bar bbox sample
     - `client-022` -> chart-monthly -> bar counts
     - `client-023` -> chart-monthly -> bar bbox sample
     - `client-024` -> chart-weekday -> bar counts
     - `client-025` -> chart-weekday -> bar bbox sample
     - `client-026` -> 카드별 clipPath count
   - 목표: 카드별 Bar 렌더 수를 분리 계측해 “subscription/monthly만 Bar 미생성”을 확정.

4. **PR-004: subscription/monthly Bar pathCount=0 원인 계측(데이터키/axis/tick)** — 상태: 진행
   - 목표: `chart-subscription`, `chart-monthly`에서 Bar path가 0이 되는 원인을 데이터키/axis/bandwidth/조건부 렌더 관점에서 계측.
   - 마운트 후 800ms에 데이터 shape, dataKey finite 여부, XAxis tick 분포, Bar DOM 존재 여부를 로그(`client-030~037`)로 출력.
   - 로그:
     - `client-030` -> chart-subscription-data-shape
     - `client-031` -> chart-subscription-datakey-sanity
     - `client-032` -> chart-monthly-data-shape
     - `client-033` -> chart-monthly-datakey-sanity
     - `client-034` -> chart-subscription-xaxis-ticks
     - `client-035` -> chart-monthly-xaxis-ticks
     - `client-036` -> subscription-dom-presence
     - `client-037` -> monthly-dom-presence

5. **PR-005: React/Recharts 의존성 중복 점검** — 상태: 진행(서버 로그 수집 포함)
   - `server-001~003`에서 수집한 React/ReactDOM/Recharts 버전 및 `npm ls`/`bun pm ls` 결과를 기반으로 중복 여부 검증(현재 자료 수집 완료, 추가 확인 보류).

6. **PR-006: 키 생성/정렬 고정 실험** — 상태: 보류
   - 실제 대시보드 차트에서 Bar 생성용 key 배열 정렬/고정, stack 순서 명시.
   - 로그 `client-040~`: keys 배열 전문, 렌더 순서, 특정 key에서 height=0/NaN 여부.
   - 목표: prod에서 순서 반전·중간 누락이 키 순서 문제인지 검증.

7. **PR-007: 도메인/NaN 가드 실험** — 상태: 예정
   - YAxis domain을 명시 범위로 고정하거나 데이터 전처리(0/NaN 방어) 추가.
   - 로그 `client-050~`: domain 확정값, 변환 후 데이터 스냅샷.
   - 목표: height 0/미생성 문제가 도메인/NaN 때문인지 확인.

8. **PR-008: 원인 확정 후 최소 수정 반영** — 상태: 예정
   - 위 실험 결과에 따라 최소 수정으로 prod Bar 렌더 복구.
   - 로그: 문제 해결 근거를 남기고, 해결 확인 후 상태 `검증완료`.

9. **PR-009: 디버그 로그/임시 코드 일괄 삭제** — 상태: 예정
   - 모든 디버그 로그/배너/임시 차트를 제거하고 기준 디자인만 남김.
   - 목표: 최종 정리.

## 5) 로그 설계 및 규칙
- **표기 규격:** `[고유ID -> 요약(코덱스전달용) -> 상세(전문)]`
- **ID 체계:**
  - 클라이언트 로그: `client-###` (예: `client-001`)
  - 서버 로그: `server-###` (예: `server-001`)
- **운용 규칙:**
  - 가능한 한 브라우저 devtools에서 확인 가능한 방식으로 출력한다.
  - 실험/검증 과정에서 생성한 로그는 “쓸모없는 로그가 아닌 이상 삭제 금지”; 해결 후 `PR-007`에서 일괄 삭제.
  - 각 PR 수행 시 관련 로그 ID를 문서에 추가 기록하고, 기대 결과/실제 결과/다음 행동을 업데이트한다.

---
- 초기 상태 기록: 모든 PR 항목 상태는 `예정`. 이후 각 PR 실행 시 이 문서를 함께 수정해 상태/로그/결과를 누적한다.
