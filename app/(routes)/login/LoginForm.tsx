'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ensurePushSubscription } from '@/src/client/push/ensureAfterLogin';
import { buildPushContexts, hasPushCheckRun, resetPushCheckFlags } from '@/src/client/push/session';
import { normalizePhone } from '@/src/utils/phone';
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

type LoginSuccess = {
  profile: { name: string; phone: string | null; registerNo: string | null };
  roleArrange: string[];
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
  const router = useRouter();
  const [values, setValues] = useState<FormValues>(initialValues);
  const [errors, setErrors] = useState<FormErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);

  async function syncWebPushConsent(loginResult: LoginSuccess) {
    if (typeof window === 'undefined') return;

    resetPushCheckFlags();

    const identity = {
      phone: loginResult.profile.phone,
      registerNo: loginResult.profile.registerNo,
      roles: loginResult.roleArrange,
    };

    const contexts = buildPushContexts(identity);

    if (contexts.length === 0 || hasPushCheckRun(identity)) {
      return;
    }

    try {
      await ensurePushSubscription(identity);
    } catch (error) {
      console.error('푸시 구독 처리 중 오류', error);
    }
  }

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const saved = window.localStorage.getItem('login_saved');
    if (!saved) return;

    try {
      const parsed = JSON.parse(saved);
      if (parsed && typeof parsed === 'object') {
        setValues({
          phone: typeof parsed.phone === 'string' ? parsed.phone : '',
          registerNo: typeof parsed.registerNo === 'string' ? parsed.registerNo : ''
        });
        setRememberMe(true);
      }
    } catch (error) {
      // ignore corrupted saved data
    }
  }, []);

  function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    const { name, value } = event.target;
    setValues((prev) => ({
      ...prev,
      [name]: value
    }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = validate(values);
    setErrors(nextErrors);

    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    setIsSubmitting(true);
    try {
      const normalizedPhone = values.phone.replace(/[^0-9]/g, '');
      const payload = {
        phone: normalizedPhone || undefined,
        registerNo: values.registerNo.trim() || undefined
      };

      const response = await fetch('/api/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({ message: '로그인에 실패했습니다.' }));
        const message = data?.message ?? '로그인에 실패했습니다.';

        if (message === '로그인이 제한된 유저입니다.') {
          alert(message);
        }

        setErrors({ global: message });
        return;
      }

      const data: LoginSuccess = await response.json();

      setValues(initialValues);
      setErrors({});

      if (rememberMe) {
        window.localStorage.setItem(
          'login_saved',
          JSON.stringify({ phone: values.phone, registerNo: values.registerNo })
        );
      } else {
        window.localStorage.removeItem('login_saved');
      }

      await syncWebPushConsent(data);

      router.replace('/dashboard');
      router.refresh();
    } catch (error) {
      setErrors({ global: '로그인 처리 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.' });
    } finally {
      setIsSubmitting(false);
    }
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
          placeholder="6글자고유코드"
          value={values.registerNo}
          onChange={handleChange}
          aria-invalid={Boolean(errors.registerNo)}
        />
        {errors.registerNo && <p className={styles.error}>{errors.registerNo}</p>}
      </div>

      <label className={styles.checkboxRow}>
        <input
          type="checkbox"
          checked={rememberMe}
          onChange={(event) => setRememberMe(event.target.checked)}
        />
        로그인 정보 기억하기
      </label>

      <button type="submit" className={styles.submitBtn} disabled={isSubmitting}>
        로그인
      </button>
    </form>
  );
}
