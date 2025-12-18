# Strict Mode & `useEffect` Audit

## Strict Mode configuration
- **`next.config.mjs`** sets `reactStrictMode: true`, enabling React Strict Mode in both development and production builds.【F:next.config.mjs†L1-L11】
- **`app/layout.tsx`** does not wrap the app in `<React.StrictMode>`, so Strict Mode is applied solely via `reactStrictMode` from Next.js.【F:app/layout.tsx†L13-L28】

## `useEffect(() => {}, [])` occurrences and side effects
Only effects with an empty dependency array are listed because they re-run twice in development under Strict Mode.

| File | Lines | Side effect contents | Notable behaviors in dev (Strict Mode) |
| --- | --- | --- | --- |
| `app/components/ChunkLoadRecovery.tsx` | 45-61 | Adds/removes `error` & `unhandledrejection` listeners; triggers `window.location.reload()` on chunk errors. | Runs twice in dev, but listener cleanup in the return handler prevents leaks. No API calls. |
| `app/(routes)/dashboard/admin-weekly/WeeklyWorkDashboard.tsx` | 280-295 | Syncs layout mode by time and starts a 1-minute interval. | Interval is cleared on cleanup; duplicate setup in dev momentarily schedules two intervals but cleanup from the first pass prevents persistence. |
| `app/(routes)/dashboard/admin-weekly/WeeklyWorkDashboard.tsx` | 297-347 | Fetches `/api/dashboard/admin-weekly`, schedules refresh via `setTimeout`, and sets a 10-minute live `setInterval`. | In dev, the effect body can run twice, causing two immediate fetches and two timer chains before the first cleanup. There is a `canceled` flag to avoid state updates after cleanup but no guard to skip duplicate fetches. |
| `app/(routes)/dashboard/admin-monthly/MonthlyWorkDashboard.tsx` | 274-294 | Fetches `/api/dashboard/admin-monthly`, maps data, and updates state. | Runs twice in dev; no guard against double API calls. |
| `app/(routes)/screens/[screenId]/WorkListClient.tsx` | 202-211 | Reads and clears `sessionStorage` scroll position, scrolls window. | Idempotent; dev double-run scrolls twice but has no network side effects. |
| `app/(routes)/screens/[screenId]/CleaningListClient.tsx` | 228-234 | Registers cleanup to clear an interval on unmount. | No API/log side effects; double run is harmless because cleanup does nothing on mount. |
| `app/(routes)/login/LoginForm.tsx` | 80-87 | Reads persisted login values from `localStorage` and hydrates form state. | Dev-only double run re-reads storage; no API calls. |

## API duplication guard
- Weekly dashboard (`/api/dashboard/admin-weekly`) and monthly dashboard (`/api/dashboard/admin-monthly`) effects do **not** guard against duplicate fetches; development mode can trigger two immediate calls because Strict Mode remounts components.
- Other listed effects do not perform API calls; duplicate execution is either idempotent or limited to event listener setup with proper cleanup.

## Why logs double in dev but not in prod
- With `reactStrictMode: true`, React 18 deliberately mounts, unmounts, and re-mounts components once in development to surface unsafe side effects. Effects with empty dependency arrays therefore run twice in dev. In production (`bun run build` + `bun run start`), this extra cycle is skipped, so effects execute once.

## Conclusion
- The observed “logs run twice on local dev but once on prod” behavior matches React Strict Mode’s dev-only double invocation. The codebase enables Strict Mode via `reactStrictMode: true` and does not wrap components in additional `<React.StrictMode>`.
- No runtime bug is evident from these findings. However, weekly/monthly dashboard data fetching can be invoked twice in development. If that is undesirable, add a client-side guard (e.g., `useRef` flag) around the fetch calls.

