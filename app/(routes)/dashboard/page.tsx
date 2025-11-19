import type { Metadata } from 'next';
import { cookies } from 'next/headers';

import styles from './dashboard.module.css';

export const metadata: Metadata = {
  title: '업무 현황 | TenaCierge Ops',
  description: 'D+1 일정 기반 공용 대시보드'
};

const overviewMetrics = [
  { label: '당일 퇴실', value: '18건', tone: 'accent' },
  { label: '상태확인 전환', value: '7건', tone: 'neutral' },
  { label: '주의 알림', value: '3건', tone: 'warning' }
];

const adminQueue = [
  { building: '한강뷰 스위트', room: 'A-701', task: '클리닝', checkout: '11:00', checkin: '15:00', owner: '김서하', status: '대기' },
  { building: '씨티프라임', room: '1203', task: '상태확인', checkout: '-', checkin: '16:00', owner: '이은우', status: '확인 예정' },
  { building: '하이츠 M', room: '505', task: '클리닝', checkout: '10:00', checkin: '14:00', owner: '박세린', status: '배정 완료' },
  { building: '리버파크', room: 'B-903', task: '클리닝 + 상태확인', checkout: '09:30', checkin: '15:30', owner: '정도윤', status: '지연' }
];

const adminAlerts = [
  { label: '지연', message: '리버파크 B-903 퇴실 미확인, 정오까지 재확인 필요' },
  { label: '재배정', message: '씨티프라임 809호 2인 침구 추가 요청' },
  { label: '노쇼', message: '하이츠 M 1802 체크인 미도착 – 상태확인 전환' }
];

const butlerBoard = [
  { name: '유가람', window: '09:00-18:00', zone: '강남권', note: '긴급콜 가능' },
  { name: '차정후', window: '12:00-21:00', zone: '마포·용산', note: '점검 1건 대기' }
];

const cleanerTasks = [
  { room: 'A-701', building: '한강뷰 스위트', start: '11:00', end: '15:00', status: '대기', memo: '퇴실 후 바로 청소' },
  { room: '1203', building: '씨티프라임', start: '16:00', end: '17:00', status: '상태확인', memo: '체크인만 존재' },
  { room: 'B-903', building: '리버파크', start: '15:30', end: '17:30', status: '지연', memo: '퇴실 미확인' }
];

function formatDPlusOneLabel() {
  const target = new Date();
  target.setDate(target.getDate() + 1);
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'short'
  }).format(target);
}

function getRoleFromCookies(): 'admin' | 'butler' | 'cleaner' {
  const cookieStore = cookies();
  const storedRole = cookieStore.get('tc_role')?.value;

  if (storedRole === 'admin' || storedRole === 'butler' || storedRole === 'cleaner') {
    return storedRole;
  }

  return 'cleaner';
}

export default function DashboardPage() {
  const role = getRoleFromCookies();
  const dPlusOne = formatDPlusOneLabel();

  return (
    <section className={styles.wrapper}>
      <section className={styles.overview} data-child-id="1">
        <header>
          <h1>당일 업무 현황</h1>
          <p>매일 15:00 배치로 생성된 D+1 work_header를 한눈에 확인하세요.</p>
        </header>
        <div className={styles.datePanel}>
          <span>D+1</span>
          <strong>{dPlusOne}</strong>
        </div>
        <ul className={styles.metricList}>
          {overviewMetrics.map((metric) => (
            <li key={metric.label} className={`${styles.metric} ${styles[metric.tone]}`}>
              <span>{metric.label}</span>
              <strong>{metric.value}</strong>
            </li>
          ))}
        </ul>
      </section>

      {role === 'admin' && (
        <>
          <section className={styles.card} data-child-id="2">
            <header>
              <h2>D+1 업무 테이블</h2>
              <span>room / checkin / checkout 기준</span>
            </header>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>객실</th>
                  <th>업무</th>
                  <th>퇴실</th>
                  <th>입실</th>
                  <th>담당</th>
                  <th>상태</th>
                </tr>
              </thead>
              <tbody>
                {adminQueue.map((row) => (
                  <tr key={`${row.building}-${row.room}`}>
                    <td>
                      <strong>{row.room}</strong>
                      <div className={styles.helper}>{row.building}</div>
                    </td>
                    <td>{row.task}</td>
                    <td>{row.checkout}</td>
                    <td>{row.checkin}</td>
                    <td>{row.owner}</td>
                    <td>{row.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className={styles.card} data-child-id="3">
            <header>
              <h2>특이사항</h2>
              <span>work_reports 기반</span>
            </header>
            <ul className={styles.list}>
              {adminAlerts.map((alert) => (
                <li key={alert.message}>
                  <span className={styles.pill}>{alert.label}</span>
                  <p>{alert.message}</p>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}

      {role === 'butler' && (
        <section className={styles.card} data-child-id="4">
          <header>
            <h2>버틀러 배치</h2>
            <span>tier 7 배정 현황</span>
          </header>
          <ul className={styles.list}>
            {butlerBoard.map((item) => (
              <li key={item.name}>
                <div>
                  <strong>{item.name}</strong>
                  <div className={styles.helper}>{item.window}</div>
                </div>
                <div>
                  <div>{item.zone}</div>
                  <div className={styles.helper}>{item.note}</div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {role === 'cleaner' && (
        <section className={styles.card} data-child-id="5">
          <header>
            <h2>내 작업 리스트</h2>
            <span>D+1 개인 배정</span>
          </header>
          <ul className={styles.list}>
            {cleanerTasks.map((task) => (
              <li key={`${task.building}-${task.room}`}>
                <div>
                  <strong>{task.room}</strong>
                  <div className={styles.helper}>{task.building}</div>
                </div>
                <div>
                  <div>
                    {task.start} - {task.end}
                  </div>
                  <div className={styles.helper}>{task.status}</div>
                </div>
                <p>{task.memo}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}
