'use client';

import { FormEvent, useMemo, useState } from 'react';
import styles from './login.module.css';

type FormValues = {
  phone: string;
  password: string;
  otp: string;
  remember: boolean;
};

type FormErrors = Partial<Record<keyof FormValues, string>>;

const phoneRegExp = /^01[0-9]{8,9}$/;

const initialValues: FormValues = {
  phone: '',
  password: '',
  otp: '',
  remember: false
};

function validate(values: FormValues): FormErrors {
  const errors: FormErrors = {};
  const normalizedPhone = values.phone.replace(/[^0-9]/g, '');

  if (!normalizedPhone) {
    errors.phone = '휴대전화 번호를 입력해 주세요.';
  } else if (!phoneRegExp.test(normalizedPhone)) {
    errors.phone = '010으로 시작하는 숫자만 입력해 주세요.';
  }

  if (!values.password.trim()) {
    errors.password = '비밀번호를 입력해 주세요.';
  } else if (values.password.length < 6) {
    errors.password = '비밀번호는 6자 이상이어야 합니다.';
  }

  if (values.otp && values.otp.length < 4) {
    errors.otp = '보안코드는 4자리 이상이어야 합니다.';
  }

  return errors;
}

export default function LoginForm() {
  const [values, setValues] = useState<FormValues>(initialValues);
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [errors, setErrors] = useState<FormErrors>({});

  const statusMessage = useMemo(() => {
    if (status === 'success') {
      return '입력값이 검증되었습니다. 인증 API 연동 시 이 영역을 활용해 주세요.';
    }

    if (status === 'error') {
      return '입력값을 다시 확인해 주세요.';
    }

    return '';
  }, [status]);

  function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    const { name, value, type, checked } = event.target;
    setValues((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = validate(values);
    setErrors(nextErrors);

    if (Object.keys(nextErrors).length > 0) {
      setStatus('error');
      return;
    }

    setStatus('success');
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit} noValidate>
      {statusMessage && (
        <p className={status === 'success' ? styles.success : styles.error}>{statusMessage}</p>
      )}

      <div className={styles.inputGroup}>
        <div className={styles.labelRow}>
          <label htmlFor="phone">휴대전화</label>
          <span className={styles.optional}>필수</span>
        </div>
        <input
          id="phone"
          name="phone"
          className={styles.field}
          inputMode="tel"
          placeholder="01012345678"
          value={values.phone}
          onChange={handleChange}
          aria-invalid={Boolean(errors.phone)}
        />
        <p className={styles.helper}>숫자만 입력하면 자동으로 정규화됩니다.</p>
        {errors.phone && <p className={styles.error}>{errors.phone}</p>}
      </div>

      <div className={styles.inputGroup}>
        <div className={styles.labelRow}>
          <label htmlFor="password">비밀번호</label>
          <span className={styles.optional}>필수</span>
        </div>
        <input
          id="password"
          name="password"
          type="password"
          className={styles.field}
          placeholder="최소 6자"
          value={values.password}
          onChange={handleChange}
          aria-invalid={Boolean(errors.password)}
        />
        {errors.password && <p className={styles.error}>{errors.password}</p>}
      </div>

      <div className={styles.inputGroup}>
        <div className={styles.labelRow}>
          <label htmlFor="otp">보안코드</label>
          <span className={styles.optional}>선택</span>
        </div>
        <input
          id="otp"
          name="otp"
          className={styles.field}
          placeholder="6자리 일회용 코드"
          value={values.otp}
          onChange={handleChange}
          aria-invalid={Boolean(errors.otp)}
        />
        <p className={styles.helper}>사내 2차 인증을 사용하는 계정만 입력하세요.</p>
        {errors.otp && <p className={styles.error}>{errors.otp}</p>}
      </div>

      <div className={styles.actions}>
        <label className={styles.checkbox}>
          <input type="checkbox" name="remember" checked={values.remember} onChange={handleChange} />
          30일 동안 로그인 유지
        </label>
        <button type="button" className={styles.linkBtn} onClick={() => setStatus('idle')}>
          비밀번호 재설정
        </button>
      </div>

      <button type="submit" className={styles.submitBtn}>
        대시보드 입장
      </button>
    </form>
  );
}
