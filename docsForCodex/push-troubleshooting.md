# 푸시 전송 503(`web-push module is not installed`) 대처법

푸시 작업 시 `delivery failed ... 503 web-push module is not installed`가 뜨면, 실제 `web-push` 패키지 대신 빌드 스크립트가 만들어 둔 폴백 shim이 실행되고 있다는 신호입니다. 아래 순서로 점검하세요.

## 원인 후보
- `node_modules/web-push`가 삭제되었거나, 의존성 설치 중 오류로 폴백 shim만 남아 있음.
- `npm ci` 직후 `scripts/ensureVendorPackages.js`가 필요한 의존성을 찾지 못해 shim을 다시 생성함.
- 서버 시각·타임존 보정 로직 변경으로 잡이 아직 “예정” 상태인데, 워커는 `sendNotification` 호출 직전 예외를 던지므로 실제 전송 없이 503으로 종료됨.

## 조치 순서
1. **설치 상태 확인**: `npm ls web-push`가 실제 버전(`3.x`)을 가리키는지 확인합니다. `npm ls`가 `empty` 또는 `missing`을 내면 폴백입니다.
2. **깨끗한 재설치**: `node_modules`를 삭제하고 `npm ci`를 다시 실행합니다. 설치 로그에 `web-push`와 내부 의존성(`http_ece`, `jws`, `asn1.js`, `https-proxy-agent`)이 정상 설치되었는지 확인합니다.
3. **빌드 스크립트 재실행**: `npm ci` 이후 `bun run build`를 다시 수행합니다. 빌드 과정에서 `web-push`를 찾지 못하면 같은 503 메시지를 계속 출력합니다.
4. **스케줄 타임존 확인**: 워커는 `scheduled_at`을 KST로 변환해 비교합니다. 서버 시간을 UTC로 가정하는 환경에서 스케줄이 미래로 인식될 수 있으니, DB의 `scheduled_at`이 KST 기준인지 확인하거나 테스트 시각을 KST로 맞춥니다.
5. **프로세스 교체**: 실행 중인 오래된 프로세스가 shim을 로드했을 수 있습니다. 새로 설치/빌드 후 프로세스를 완전히 재시작합니다 (`bun run start` 재실행).

위 절차로도 해결되지 않으면 설치 로그와 `npm ls web-push` 출력, 현재 서버 시각(`date`, `timedatectl`)을 함께 확인해 추가 단서를 찾으세요.
