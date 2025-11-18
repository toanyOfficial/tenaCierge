'use client';

import { FormEvent, useState } from 'react';
import styles from './login.module.css';

type FormValues = {
  phone: string;
  registerNo: string;
};

type FormErrors = Partial<Record<keyof FormValues | 'global', string>>;

const phoneRegExp = /^01[0-9]{8,9}$/;

const initialValues: FormValues = {
  phone: '',
  registerNo: ''
};

function validate(values: FormValues): FormErrors {
  const errors: FormErrors = {};
  const normalizedPhone = values.phone.replace(/[^0-9]/g, '');

  if (!normalizedPhone && !values.registerNo.trim()) {
    errors.global = '휴대전화 또는 관리번호 중 하나는 반드시 입력해야 합니다.';
    return errors;
  }

  if (normalizedPhone && !phoneRegExp.test(normalizedPhone)) {
    errors.phone = '010으로 시작하는 숫자만 입력해 주세요.';
  }

  return errors;
}

export default function LoginForm() {
  const [values, setValues] = useState<FormValues>(initialValues);
  const [errors, setErrors] = useState<FormErrors>({});

  function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    const { name, value } = event.target;
    setValues((prev) => ({
      ...prev,
      [name]: value
    }));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = validate(values);
    setErrors(nextErrors);

    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    // TODO: 인증 API 연동 시 실제 로그인 로직을 추가합니다.
    setValues(initialValues);
    setErrors({});
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit} noValidate>
      {errors.global && <p className={styles.error}>{errors.global}</p>}

      <div className={styles.inputGroup}>
        <div className={styles.labelRow}>
          <label htmlFor="phone">휴대전화</label>
          <span className={styles.optional}>선택</span>
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
        {errors.phone && <p className={styles.error}>{errors.phone}</p>}
      </div>

      <div className={styles.inputGroup}>
        <div className={styles.labelRow}>
          <label htmlFor="registerNo">관리번호</label>
          <span className={styles.optional}>선택</span>
        </div>
        <input
          id="registerNo"
          name="registerNo"
          className={styles.field}
          placeholder="사번 또는 식별번호"
          value={values.registerNo}
          onChange={handleChange}
          aria-invalid={Boolean(errors.registerNo)}
        />
        {errors.registerNo && <p className={styles.error}>{errors.registerNo}</p>}
      </div>

      <button type="submit" className={styles.submitBtn}>
        로그인
      </button>
    </form>
  );
}
