import type { Metadata } from 'next';
import Link from 'next/link';
import LoginForm from './LoginForm';
import styles from './login.module.css';

const loginFeatures = [
  {
    title: '실시간 체크아웃 지표',
    description: 'D+1 일정과 work_header 동기화를 통해 업무량을 미리 공유합니다.'
  },
  {
    title: '역할 기반 권한',
    description: 'admin / butler / cleaner / host 권한을 쿠키 세션으로 제어합니다.'
  },
  {
    title: '2차 인증 옵션',
    description: '필요 시 일회용 보안코드(OTP)를 추가 입력해 민감 정보 접근을 제어합니다.'
  }
];

export const metadata: Metadata = {
  title: '로그인 | TenaCierge Ops',
  description: '내부 운영 대시보드 접근을 위한 인증 화면'
};

export default function LoginPage() {
  return (
    <section className={styles.wrapper}>
      <div className={styles.brandPanel}>
        <span className={styles.badge}>ID 000</span>
        <div>
          <h1>Ops Suite 로그인</h1>
          <p>
            청소·수퍼바이징·정산까지 이어지는 모든 워크플로우를 한 곳에서 제어합니다. 보안을 위해
            사내 계정과 휴대전화 인증을 함께 사용하세요.
          </p>
        </div>
        <div className={styles.featureList}>
          {loginFeatures.map((feature) => (
            <article className={styles.featureItem} key={feature.title}>
              <h3>{feature.title}</h3>
              <p>{feature.description}</p>
            </article>
          ))}
        </div>
      </div>

      <div className={styles.formPanel}>
        <header>
          <h2>사내 계정으로 로그인</h2>
          <p>로그인 후에는 자동으로 다음날 업무 카드(Work Header)가 로딩됩니다.</p>
        </header>
        <LoginForm />
        <div className={styles.footerLinks}>
          <Link href="#">개인정보 처리방침</Link>
          <Link href="#">계정 잠김 해제</Link>
          <Link href="mailto:support@tenaCierge.com">support@tenaCierge.com</Link>
        </div>
      </div>
    </section>
  );
}
