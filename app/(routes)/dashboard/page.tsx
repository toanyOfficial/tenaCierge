import type { Metadata } from 'next';
import styles from './dashboard.module.css';

const summaryCards = [
  {
    title: '당일 퇴실',
    value: '18건',
    delta: '+2건 vs 어제',
    footnote: '클리닝 대상 (cleaning_yn = 1)',
    variant: 'cardAccent'
  },
  {
    title: '상태확인 전환',
    value: '7건',
    delta: '체크인만 존재',
    footnote: 'conditionCheckYn = 1, cleaning_yn = 0'
  },
  {
    title: '필요 인원',
    value: '12명',
    delta: '클리너 8 · 버틀러 4',
    footnote: '침구/어메니티는 bed 수 기준 배정'
  },
  {
    title: '주의 알림',
    value: '3건',
    delta: '문제 방 · 지연 2건',
    footnote: 'D+1 처리 필요',
    variant: 'cardWarning'
  }
];

const workSchedule = [
  {
    building: '한강뷰 스위트',
    room: 'A-701',
    task: '클리닝',
    checkout: '11:00',
    checkin: '15:00',
    owner: '김서하',
    status: '대기',
    flag: 'cleaning'
  },
  {
    building: '씨티프라임',
    room: '1203',
    task: '상태확인',
    checkout: '-',
    checkin: '16:00',
    owner: '이은우',
    status: '확인 예정',
    flag: 'condition'
  },
  {
    building: '하이츠 M',
    room: '505',
    task: '클리닝',
    checkout: '10:00',
    checkin: '14:00',
    owner: '박세린',
    status: '배정 완료',
    flag: 'cleaning'
  },
  {
    building: '리버파크',
    room: 'B-903',
    task: '클리닝 + 상태확인',
    checkout: '09:30',
    checkin: '15:30',
    owner: '정도윤',
    status: '지연',
    flag: 'alert'
  }
];

const alerts = [
  { label: '지연', message: '리버파크 B-903 퇴실 미확인, 정오까지 재확인 필요' },
  { label: '재배정', message: '씨티프라임 809호 2인 침구 추가 요청' },
  { label: '노쇼', message: '하이츠 M 1802 체크인 미도착 – 상태확인 전환' }
];

const staffAllocations = [
  { name: '김서하', role: '클리너', window: '08:00-17:00', capacity: '2건 남음' },
  { name: '정도윤', role: '클리너', window: '12:00-21:00', capacity: '1건 남음' },
  { name: '유가람', role: '버틀러', window: '09:00-18:00', capacity: '긴급콜 가능' }
];

const checklist = [
  { title: '퇴실 없는 입실만 존재하는 객실에 상태확인 카드 생성', done: true },
  { title: 'bed_count 기준 blanket/amenities 값 입력', done: true },
  { title: '추가 메모는 supervisor가 현장 입력', done: false }
];

export const metadata: Metadata = {
  title: '업무 현황 | TenaCierge Ops',
  description: 'D+1 일정 기반의 Work Header 개요 화면'
};

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

export default function DashboardPage() {
  const dPlusOne = formatDPlusOneLabel();

  return (
    <section className={styles.container}>
      <div className={styles.header}>
        <div>
          <span className={styles.badge}>ID 001</span>
          <h1>당일 업무 현황</h1>
          <p>
            매일 15:00 배치가 생성하는 D+1 work_header 데이터를 바로 확인하고, 퇴실 유무에 따라
            클리닝/상태확인 카드를 분류할 수 있는 운영 메인 보드입니다.
          </p>
        </div>
        <div className={styles.datePanel}>
          <span>당일 기준 D+1</span>
          <strong>{dPlusOne}</strong>
          <small>표시되는 수치는 모두 샘플 데이터입니다.</small>
        </div>
      </div>

      <section className={styles.summaryGrid}>
        {summaryCards.map((card) => (
          <article
            key={card.title}
            className={`${styles.summaryCard} ${card.variant ? styles[card.variant] : ''}`}
          >
            <h3>{card.title}</h3>
            <p className={styles.summaryValue}>{card.value}</p>
            <p className={styles.summaryDelta}>{card.delta}</p>
            <p className={styles.summaryFootnote}>{card.footnote}</p>
          </article>
        ))}
      </section>

      <section className={styles.bodyGrid}>
        <article className={styles.card}>
          <header>
            <h2>D+1 업무 리스트</h2>
            <span>room / bed / 시간표를 기준으로 생성</span>
          </header>
          <table className={styles.workTable}>
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
              {workSchedule.map((item) => (
                <tr key={`${item.building}-${item.room}`}>
                  <td>
                    <strong>{item.room}</strong>
                    <div className={styles.helperText}>{item.building}</div>
                  </td>
                  <td className={styles.task}>{item.task}</td>
                  <td>{item.checkout}</td>
                  <td>{item.checkin}</td>
                  <td>{item.owner}</td>
                  <td>
                    <span
                      className={`${styles.statusBadge} ${
                        item.flag === 'cleaning'
                          ? styles.statusCleaning
                          : item.flag === 'condition'
                          ? styles.statusCondition
                          : styles.statusAlert
                      }`}
                    >
                      {item.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className={styles.helperText}>
            실 DB 연동 전까지는 위 표와 카드가 mock 데이터로 렌더링됩니다.
          </p>
        </article>

        <div className={styles.card}>
          <header>
            <h2>알림 &amp; 특이사항</h2>
            <span>work_reports / supervisor 메모 기반</span>
          </header>
          <ul className={styles.list}>
            {alerts.map((alert) => (
              <li className={styles.listItem} key={alert.message}>
                <div>
                  <span className={`${styles.pill}`}>{alert.label}</span>
                  <div>{alert.message}</div>
                </div>
              </li>
            ))}
          </ul>
          <header>
            <h2>인원 배치</h2>
            <span>tier 3~7 인원 기준</span>
          </header>
          <ul className={styles.list}>
            {staffAllocations.map((staff) => (
              <li className={styles.listItem} key={staff.name}>
                <div>
                  <strong>{staff.name}</strong>
                  <div className={styles.helperText}>{staff.role}</div>
                </div>
                <div>
                  <div>{staff.window}</div>
                  <div className={styles.helperText}>{staff.capacity}</div>
                </div>
              </li>
            ))}
          </ul>
          <header>
            <h2>체크리스트</h2>
            <span>최근 배치 규칙</span>
          </header>
          <ul className={styles.list}>
            {checklist.map((item) => (
              <li className={styles.listItem} key={item.title}>
                <div>
                  <strong>{item.title}</strong>
                  <div className={styles.helperText}>
                    {item.done ? '완료' : '확인 필요'}
                  </div>
                </div>
                <span className={styles.pill}>{item.done ? '완료' : '대기'}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </section>
  );
}
