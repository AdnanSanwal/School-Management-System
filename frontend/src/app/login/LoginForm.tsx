'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { useAuthStore, HOME_BY_ROLE } from '@/store/authStore';
import { api } from '@/lib/api';
import { Eye, EyeOff, Mail, LockKeyhole, LoaderCircle } from 'lucide-react';
import styles from './login.module.css';

const schema = z.object({
  email: z.string().trim().min(3, 'Enter your username or email'),
  password: z.string().min(1, 'Password required'),
});
type FormData = z.infer<typeof schema>;

export default function LoginForm({ name, logo }: { name: string; logo: string | null }) {
  const router = useRouter();
  const { setAuth } = useAuthStore();
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [logoFailed, setLogoFailed] = useState(false);
  const [needsCode, setNeedsCode] = useState(false);
  const [mfaCode, setMfaCode] = useState('');
  const queryClient = useQueryClient();
  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({ resolver: zodResolver(schema) });
  const onSubmit = async (data: FormData) => {
    setLoading(true);
    try {
      const res = await api.post('/auth/login', { ...data, ...(needsCode ? { mfaCode } : {}) });
      const { user, accessToken, refreshToken } = res.data.data;
      queryClient.clear(); // never show a previous user's cached screens
      setAuth(user, accessToken, refreshToken);
      // Admin-chosen password: choose your own before anything else.
      router.push(user.mustChangePassword ? '/change-password' : HOME_BY_ROLE[user.role] || '/dashboard');
    } catch (err: any) {
      const message = err.response?.data?.message || 'Login failed';
      if (message === 'MFA code required') {
        setNeedsCode(true);
        toast('Enter the 6-digit code from your authenticator app', { icon: '🔐' });
      } else {
        toast.error(message === 'Invalid MFA code' ? 'That code is wrong or expired. Try the current one.' : message);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className={styles.page}>
      <div className={styles.scene} aria-hidden="true" />
      <div className={styles.sweep} aria-hidden="true" />
      <section className={styles.panel} aria-label="Sign in">
        <div className={styles.card}>
          <header className={styles.brand}>
            {logo && !logoFailed ? (
              // Branding is restricted to same-origin public assets by the server.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logo} alt={`${name} logo`} className={styles.logo} onError={() => setLogoFailed(true)} />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src="/default-logo.svg" alt={`${name} logo`} className={styles.logo} />
            )}
            <h1>{name}</h1>
            <span className={styles.rule} />
          </header>
          <form onSubmit={handleSubmit(onSubmit)} className={styles.form} aria-busy={loading}>
            <div>
              <label htmlFor="login-email" className="sr-only">Email or username</label>
              <div className={styles.inputWrap}>
                <Mail aria-hidden="true" size={24} />
                <input id="login-email" {...register('email')} placeholder="Email or Username" autoCapitalize="none" spellCheck={false} autoComplete="username" aria-invalid={!!errors.email} aria-describedby={errors.email ? 'email-error' : undefined} />
              </div>
              {errors.email && <p id="email-error" className={styles.error}>{errors.email.message}</p>}
            </div>
            <div>
              <label htmlFor="login-password" className="sr-only">Password</label>
              <div className={styles.inputWrap}>
                <LockKeyhole aria-hidden="true" size={24} />
                <input id="login-password" {...register('password')} type={showPass ? 'text' : 'password'} placeholder="Password" autoComplete="current-password" aria-invalid={!!errors.password} aria-describedby={errors.password ? 'password-error' : undefined} />
                <button type="button" onClick={() => setShowPass(!showPass)} aria-label={showPass ? 'Hide password' : 'Show password'} aria-pressed={showPass}>
                  {showPass ? <EyeOff size={24} /> : <Eye size={24} />}
                </button>
              </div>
              {errors.password && <p id="password-error" className={styles.error}>{errors.password.message}</p>}
            </div>
            <div className={styles.options}><Link href="/forgot-password">Forgot Password?</Link></div>
            {needsCode && <div>
              <label htmlFor="mfa-code" className={styles.codeLabel}>Code from your authenticator app</label>
              <div className={styles.inputWrap}>
                <input id="mfa-code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" required maxLength={6} placeholder="123456" autoFocus value={mfaCode} onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, ''))} />
              </div>
            </div>}
            <button type="submit" disabled={loading} className={styles.submit}>
              {loading ? <><LoaderCircle className="animate-spin" size={22} /> Signing in...</> : 'Sign In'}
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}
