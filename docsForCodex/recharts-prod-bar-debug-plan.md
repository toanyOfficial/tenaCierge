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

4. **PR-004: subscription/monthly Bar pathCount=0 원인 계측(데이터키/axis/tick)** — 상태: 검증완료
   - 목표: `chart-subscription`, `chart-monthly`에서 Bar path가 0이 되는 원인을 데이터키/axis/bandwidth/조건부 렌더 관점에서 계측.
   - 마운트 후 800ms에 데이터 shape, dataKey finite 여부, XAxis tick 분포, Bar DOM 존재 여부를 로그(`client-030~037`)로 출력.
   - prod 관찰: data length 13, XAxis key `label`, barDataKeys `subscriptionCount`/`totalCount`, tick 존재(17/22), Bar layer/rectangles 존재하지만 barPathCount=0, allPaths=1, allRects=1로 Bar 도형 미생성 확인.
   - 로그:
     - `client-030` -> chart-subscription-data-shape
     - `client-031` -> chart-subscription-datakey-sanity
     - `client-032` -> chart-monthly-data-shape
     - `client-033` -> chart-monthly-datakey-sanity
     - `client-034` -> chart-subscription-xaxis-ticks
     - `client-035` -> chart-monthly-xaxis-ticks
     - `client-036` -> subscription-dom-presence
     - `client-037` -> monthly-dom-presence

5. **PR-005: YAxis domain 명시 실험(구독/월별)** — 상태: 검증완료
   - 목표: `chart-subscription`, `chart-monthly`에서 YAxis domain을 명시(`[0, 'auto']`)해 Bar path 미생성을 해소하는지 확인하고, 도메인/NaN 가설을 검증.
   - 변경: 두 차트의 YAxis domain을 `[0, 'auto']`로 고정(weekday 차트는 변경 없음).
   - prod 관찰: `client-040/041`에서 `barPathCount=0` 유지, `client-042/043`에서 Y축 tick 정상 → 도메인 단독 원인 배제.
   - 로그 `client-040~043`:
     - `client-040` -> chart-subscription-domain-guard -> domain + barPathCount
     - `client-041` -> chart-monthly-domain-guard -> domain + barPathCount
     - `client-042` -> chart-subscription-yaxis-ticks
     - `client-043` -> chart-monthly-yaxis-ticks

6. **PR-006: minPointSize 실험(구독/월별 Bar 생성 스킵 원인 확정)** — 상태: 검증완료
   - 목표: `chart-subscription`, `chart-monthly`의 Bar에 `minPointSize={1}`만 추가해 prod에서 barPathCount가 0→양수로 변하는지 확인.
   - 변경: 두 Bar(`subscriptionCount`, `totalCount`)에만 `minPointSize={1}` 적용, 기타 옵션/레이아웃/weekday 차트는 그대로 유지.
   - prod 관찰: 사용자 DOM 확인 기준 barPathCount 여전히 0 → minPointSize 단독으로는 미생성 문제 해소 실패.
   - 로그: 신규 ID 없이 기존 `client-020~043` 계측 로그로 barPathCount 변화 확인.

7. **PR-007: clipPath/클리핑 영향 실험(구독/월별)** — 상태: 검증완료
   - 목표: `chart-subscription`, `chart-monthly`에서 clipPath에 의한 Bar 무력화 가능성을 배제/확정.
   - 변경: 두 차트 ComposedChart에 `style={{ overflow: 'visible' }}` 적용해 클리핑 영향 최소화, 마운트 800ms 후 clipPath/bar path 스냅샷을 로그(`client-060~065`)로 출력.
   - prod 관찰: overflow visible 적용만으로도 bar path 변화 없음 → 클리핑 단독 원인 배제.
   - 로그:
     - `client-060` -> chart-subscription-clip-debug -> overflow-visible before/after counts
     - `client-061` -> chart-monthly-clip-debug -> overflow-visible before/after counts
     - `client-062` -> chart-subscription-svg-snapshot
     - `client-063` -> chart-monthly-svg-snapshot
     - `client-064` -> chart-subscription-bar-bbox (bar 존재 시 상위 5개)
     - `client-065` -> chart-monthly-bar-bbox (bar 존재 시 상위 5개)

8. **PR-008: xAxis bandwidth/bar width 0/NaN 계측 + barSize 강제 실험** — 상태: 진행
   - 목표: `chart-subscription`, `chart-monthly`에서 x축 bandwidth/Bar 폭 계산이 0/NaN인지 DOM 기반으로 계측하고, `barSize` 강제(20) 시 bar path가 생성되는지 확인.
   - 변경:
     - 마운트 800ms 후 tick 위치 간격, 첫 bar bbox, svg viewBox/axis/grid 존재 등을 `client-070~075` 로그로 출력.
     - 구독/월별 Bar에 `barSize={20}` 적용(weekday 변경 없음).
   - 로그:
     - `client-070` -> chart-subscription-bar-width-debug (barPathCount, 첫 bbox, tick gap)
     - `client-071` -> chart-monthly-bar-width-debug
     - `client-072` -> chart-subscription-svg-basic (viewBox/width/height, axis/grid count)
     - `client-073` -> chart-monthly-svg-basic
     - `client-074` -> chart-subscription-barSize-result (barSize=20 적용 후 barPathCount)
     - `client-075` -> chart-monthly-barSize-result

9. **PR-009: Bar shape 호출 여부 계측(구독/월별 vs 요일별 비교)** — 상태: 진행
   - 목표: `chart-subscription`, `chart-monthly` Bar에서 shape 렌더 함수가 호출되는지 여부를 로그로 확인하고, 정상인 weekday와 비교해 파이프라인 스킵 vs 계산 문제를 확정.
   - 변경: 두 Bar에 `shape={DebugBarShape}`를 적용하고, weekday Bar 중 1개에도 동일 shape를 적용해 비교군 확보. shape는 최초 10회만 props 로그 출력.
   - 로그:
     - `client-080` -> subscription DebugBarShape props(x, y, width, height, value, index, dataKey, fill, background)
     - `client-081` -> monthly DebugBarShape props
     - `client-082` -> weekday DebugBarShape props

10. **PR-010: NaN probe 실험(구독/월별 value=1 강제 주입)** — 상태: 검증완료
    - 결과: value=1 주입 시 subscription/monthly 모두 y·height finite로 정상 계산 → 축/스케일보다는 원래 차트 구성(gradient/stack 등)에서 NaN 유발 가능성 높음.
    - 변경: 별도 client 컴포넌트 `PR010NaNProbe.client.tsx`로 shallow copy + value=1 강제 후 shape/DOM 로그 출력.
    - 로그:
      - `client-090` -> subscription probe bar-shape-props (value=1 우선)
      - `client-091` -> monthly probe bar-shape-props (value=1 우선)
      - `client-092` -> subscription/monthly barPathCount after probe 적용

11. **PR-011: gradient fill 제거 실험(구독/월별)** — 상태: 진행
    - 목표: subscription/monthly 원본 차트에서 gradient fill(`url(#...)`)을 단색으로 교체해 y/height NaN 및 barPathCount=0이 해소되는지 확인.
    - 변경: 두 Bar의 fill을 단색(hex)로 교체하고 shape 로그를 1회만 `client-110/111`으로 스냅샷, barPathCount를 `client-112/113`으로 계측.
    - 로그:
      - `client-110` -> subscription shape snapshot (index/value/y/height finite 여부, fill, stackId, yAxisId)
      - `client-111` -> monthly shape snapshot
      - `client-112` -> subscription barPathCount after solid fill
      - `client-113` -> monthly barPathCount after solid fill

12. **PR-012: Bar 내부 생성 스킵 원인 확정(구독/월별 shape 호출 + NaN 필드 로깅)** — 상태: 검증완료
    - 목표: `chart-subscription`, `chart-monthly` Bar에서 shape 함수 호출 여부를 확정하고, 호출 시 props(y/height/value/axis) NaN 여부를 1회 스냅샷으로 남김. 호출이 안 되면 DOM/축 설정을 함께 로그로 기록.
    - 결과: shape는 호출되나 `y/height`가 NaN이고 `xAxisId/yAxisId`가 undefined, DOM에는 bar-rectangle layer만 존재하여 Bar↔Axis 매칭 실패 가능성이 높음.
    - 로그:
      - `client-120` -> subscription shape called 여부 및 props(y/height/value/xAxisId/yAxisId/stackId)
      - `client-121` -> monthly shape called 여부 및 props
      - `client-122` -> subscription DOM after 800ms (bar layer/path/clipPath count)
      - `client-123` -> monthly DOM after 800ms
      - `client-124` -> subscription YAxis config (domain/allowDataOverflow/scale/yAxisId)
      - `client-125` -> monthly YAxis config(좌/우) 스냅샷

13. **PR-013: axisId 명시 고정(구독/월별)** — 상태: 실패
    - 목표: `xAxisId/yAxisId`를 Bar/Axis에 강제 지정해 NaN 문제를 제거하려 했으나 prod에서 "Invariant violation" 크래시 발생.
    - 로그:
      - `client-130` -> subscription barPathCount after axis fix
      - `client-131` -> monthly barPathCount after axis fix

13-a. **PR-013-HOTFIX: invariant 크래시 방지 + axisId 안전 적용** — 상태: 검증완료
    - 목표: admin-stats 페이지 크래시를 막고, axis 매칭 상태를 안전하게 계측.
    - 변경:
      - charts 영역에 ErrorBoundary 추가 → 크래시 시 화면 유지 + `[client-150]` 로그
      - Bar의 `xAxisId` 강제 제거, `yAxisId`만 안전하게 명시(구독:left, 월별:right)
      - mount 800ms 후 axis/DOM 상태 계측(`client-141/142`)
    - 로그:
      - `client-150` -> recharts-error-boundary catch 로그
      - `client-141` -> subscription axis/dom sanity
      - `client-142` -> monthly axis/dom sanity
      - 기존 shape 로그 `client-120/121` 유지(축 id undefined 여부 확인)

14. **PR-014: Invariant 범인 분리(섹션별 ErrorBoundary + 렌더 토글)** — 상태: 검증완료
    - 결과: `client-150` 로그로 subscription/monthly 섹션에서 invariant 발생이 확정됨. 토글은 이후 비활성화.
    - 변경: 섹션별 ErrorBoundary 적용(각기 fallback 문구). 이후 토글/디버그 섹션은 제거됨.
    - 로그:
      - `client-150` -> boundary catch 시 섹션명 포함 로그

15. **PR-015: subscription/monthly invariant 제거 + finite 가드** — 상태: 검증완료
    - 목표: 축 매칭을 단일 left YAxis로 고정하고, NaN/undefined를 0으로 치환하며 domain을 `[0,1]/[0,'auto']`로 안정화해 invariant와 NaN을 제거.
    - 결과: 데이터 finite 가드/단일 축 적용 후에도 subscription/monthly에서 invariant가 발생해 추가 단순화 필요.
    - 변경:
      - 구독/월별 데이터 shallow copy 후 finite 가드 → domain `[0,1]`(전부 0) or `[0,'auto']`.
      - 구독/월별 Bar는 단일 left 축 사용, 불필요한 axisId 제거.
      - 디버그 섹션/shape 실험 제거, 필수 로그만 유지.
      - **빌드 복구:** StatsDashboard에 `dynamic` import 및 PR-001 client-only 고정 차트를 다시 렌더하도록 복구(고정형 카드가 항상 DOM에 포함됨).
      - **추가 빌드 수습:** weekday Bar에서 남아 있을 수 있는 `debugBarShapes` shape 참조를 안전한 기본 shape 변수로 고정해 TS 빌드 오류(`Cannot find name 'debugBarShapes'`)를 차단.
    - 로그:
      - `client-160` -> chart-finite-guard-summary (데이터 총계/치환 건수/domain)

16. **PR-016: subscription/monthly invariant 제거(BarChart 단순화)** — 상태: 실패
    - 목표: subscription/monthly 차트를 ComposedChart에서 BarChart로 단순화해 invariant를 제거하고 동일 데이터/라벨 기반으로 안정 렌더 확인.
    - 결과: `client-170` 로그로 BarChart 단순화 적용이 기록되었으나 prod에서 subscription/monthly 섹션 invariant( `client-150`)가 계속 발생함.
    - 변경:
      - 구독/월별 차트를 `BarChart` + XAxis(label)/YAxis(domain `[0,1]` 또는 `[0,'auto']`)/Legend/Bar(단일) 구성으로 단순화, stack/Line/axisId 제거.
      - mount 200ms 후 차트 타입/적용 도메인을 1회 로그(`client-170`)로 기록.
    - 로그:
      - `client-170` -> chart-type-simplified (subscriptionChart, monthlyChart, sub_domain, mon_domain)

17. **PR-017-HOTFIX: subscription/monthly invariant 즉시 차단 + fingerprint** — 상태: 진행
    - 목표: prod에서 subscription/monthly 섹션이 invariant를 발생시키지 않도록 기본적으로 Recharts 렌더를 차단하고, 빌드/코드 fingerprint와 렌더 경로를 로그로 남김.
    - 변경:
      - `unsafeCharts` URL 쿼리(`?unsafeCharts=1`)가 없으면 subscription/monthly 섹션에서 차트를 렌더하지 않고 안내 문구를 표시하는 안전 모드 적용.
      - `chart` 쿼리(`subscription|monthly|weekday|pr001|pr010|all|none`)와 단일 렌더 토글은 PR-018에서 보완.
      - fingerprint 로그(`client-180`)로 빌드 정보/토글 상태/파일 마커(v3) 및 chart 파라미터를 1회 출력.
      - 렌더 경로 로그(`client-181/182`)로 subscription/monthly의 렌더 여부와 사유 기록.
      - 토글 상태/실제로 렌더된 섹션 목록을 `client-190/191`로 1회 기록.
      - 컨테이너 ref/크기/style 원시 상태를 `client-202/203/204`로 1회 기록(unsafeCharts=1, 섹션 활성 시).
    - 로그:
      - `client-180` -> admin-stats-fingerprint { commit, buildTime, fileMarker, unsafeCharts, chart }
      - `client-181` -> subscription-render-path { rendered, reason }
      - `client-182` -> monthly-render-path { rendered, reason }
      - `client-190` -> charts-toggle-state { unsafeCharts, chart }
      - `client-191` -> charts-enabled-sections { enabledSections }
      - `client-202` -> chart-container-ref-state { section, hasRef, nodeName, isConnected }
      - `client-203` -> chart-container-rect-raw { section, rect }
      - `client-204` -> chart-container-style-sample { section, style(width/height/minHeight/display/position) }

18. **PR-018: unsafeCharts+chart 단독 렌더 버그 수정 + 데이터/컨테이너 스냅샷** — 상태: 진행
    - 목표: `?unsafeCharts=1&chart=<section>`일 때 해당 섹션만 렌더되도록 필터를 단일 선택으로 강제하고, 데이터Key/컨테이너 크기 스냅샷 로그로 원인 확정을 지원. 추가로 container ref가 항상 DOM을 가리키게 하고, w/h가 0/null이면 안전하게 fallback UI를 노출해 invariant를 차단.
    - 변경:
      - `chart` 파라미터가 `subscription|monthly|weekday|pr001|pr010|all|none` 중 하나일 때만 반영하며, unsafeCharts=false면 모든 섹션 렌더 차단.
      - enabledSections 계산을 단일 선택 규칙으로 재구성하여 `chart=monthly` 등에서 해당 섹션만 렌더.
      - subscription/monthly 카드에 독립 DOM 컨테이너(ref)와 minHeight를 부여해 ref null/size 0을 방지하고, 사이즈가 준비되지 않으면 차트를 렌더하지 않고 안내 문구를 표시.
      - fingerprint(`client-180`) fileMarker를 v3로 갱신, 토글 상태/활성 섹션 로그(`client-190/191`) 유지.
      - 새 로그: 데이터/키 스냅샷 `client-200`, 컨테이너 크기 스냅샷 `client-201`, container ref/rect/style `client-202~204` (subscription/monthly 활성 시 1회 기록).
    - 로그:
      - `client-200` -> chart-data-sample { sub0/mon0, label/key/type 유무 등 }
      - `client-201` -> chart-container-rect { section, w, h }
      - `client-202` -> chart-container-ref-state { section, hasRef, nodeName, isConnected }
      - `client-203` -> chart-container-rect-raw { section, rect }
      - `client-204` -> chart-container-style-sample { section, style }

19. **PR-017: 디버그 로그/임시 코드 일괄 삭제** — 상태: 예정
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
