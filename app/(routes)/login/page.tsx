import type { Metadata } from 'next';
import LoginForm from './LoginForm';
import styles from './login.module.css';

export const metadata: Metadata = {
  title: '로그인 | TenaCierge Ops',
  description: '내부 운영 대시보드 접근을 위한 인증 화면'
};

export default function LoginPage() {
  return (
    <section className={styles.wrapper}>
      <div className={styles.card}>
        <h1>로그인 화면</h1>
        <p className={styles.helper}>둘 중 하나만 입력하셔도 됩니다.</p>
        <LoginForm />
      </div>
    </section>
  );
}
