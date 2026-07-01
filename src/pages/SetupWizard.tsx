import { useState } from 'react'
import { createUserWithEmailAndPassword } from 'firebase/auth'
import { auth, firebaseConfigured } from '../lib/firebase'
import { markSetupDone } from '../store/AuthContext'
import { ShieldCheck, Eye, EyeOff, AlertCircle, CheckCircle, Zap } from 'lucide-react'

type Step = 'welcome' | 'create' | 'done'

function passwordStrength(pw: string): { score: number; label: string; color: string } {
  let score = 0
  if (pw.length >= 8)  score++
  if (pw.length >= 12) score++
  if (/[A-Z]/.test(pw)) score++
  if (/[0-9]/.test(pw)) score++
  if (/[^A-Za-z0-9]/.test(pw)) score++
  if (score <= 1) return { score, label: 'Weak',      color: '#ef4444' }
  if (score <= 2) return { score, label: 'Fair',      color: '#f97316' }
  if (score <= 3) return { score, label: 'Good',      color: '#eab308' }
  if (score <= 4) return { score, label: 'Strong',    color: '#22c55e' }
  return               { score, label: 'Very Strong', color: '#10b981' }
}

export function SetupWizard() {
  const [step, setStep]           = useState<Step>('welcome')
  const [email, setEmail]         = useState('')
  const [password, setPassword]   = useState('')
  const [confirm, setConfirm]     = useState('')
  const [showPw, setShowPw]       = useState(false)
  const [showCf, setShowCf]       = useState(false)
  const [error, setError]         = useState('')
  const [loading, setLoading]     = useState(false)

  const strength = passwordStrength(password)

  const validateAndCreate = async () => {
    setError('')
    if (!email.trim() || !email.includes('@')) {
      setError('Enter a valid email address.')
      return
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }
    if (!auth || !firebaseConfigured) {
      setError('Firebase is not configured. Add your credentials to .env.local and restart the dev server.')
      return
    }
    setLoading(true)
    try {
      const cred = await createUserWithEmailAndPassword(auth, email.trim(), password)
      markSetupDone(email.trim(), cred.user.uid)
      setStep('done')
    } catch (err: unknown) {
      const msg = (err as { code?: string; message?: string }).code
      if (msg === 'auth/email-already-in-use') setError('That email is already registered.')
      else if (msg === 'auth/invalid-email')    setError('Invalid email address.')
      else if (msg === 'auth/weak-password')    setError('Password is too weak — use at least 8 characters.')
      else setError('Setup failed. Check your Firebase configuration and try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex flex-col items-center justify-center p-4">
      {/* Background texture */}
      <div className="fixed inset-0 bg-[radial-gradient(ellipse_at_top,_#1a0a0010_0%,_transparent_70%)] pointer-events-none" />
      <div className="fixed inset-0 bg-[radial-gradient(ellipse_at_bottom_right,_#f9731608_0%,_transparent_60%)] pointer-events-none" />

      {/* Branding */}
      <div className="mb-8 text-center">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-orange-500/10 border border-orange-500/20 mb-4">
          <Zap size={28} className="text-orange-500" />
        </div>
        <h1 className="text-2xl font-bold text-white tracking-tight">NextGen Fiber LLC</h1>
        <p className="text-sm text-slate-500 mt-1">Powered by Fiberlytic</p>
      </div>

      {/* Card */}
      <div className="w-full max-w-md bg-[#111111] border border-[#1f1f1f] rounded-2xl shadow-2xl overflow-hidden">

        {/* Progress bar */}
        <div className="h-0.5 bg-[#1f1f1f]">
          <div
            className="h-full bg-orange-500 transition-all duration-500"
            style={{ width: step === 'welcome' ? '33%' : step === 'create' ? '66%' : '100%' }}
          />
        </div>

        {/* ── Step: Welcome ── */}
        {step === 'welcome' && (
          <div className="p-8">
            <div className="flex items-center gap-3 mb-6">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-orange-500/10 border border-orange-500/20">
                <ShieldCheck size={18} className="text-orange-500" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-white">First-Time Setup</h2>
                <p className="text-xs text-slate-500">This runs once to secure your application.</p>
              </div>
            </div>

            <div className="space-y-3 mb-8">
              {[
                'Create a Super Admin account',
                'Secure your app with Firebase Authentication',
                'Enable login protection on every visit',
                'Never stores passwords — fully encrypted',
              ].map((item, i) => (
                <div key={i} className="flex items-start gap-2.5">
                  <CheckCircle size={15} className="text-orange-500 shrink-0 mt-0.5" />
                  <span className="text-sm text-slate-300">{item}</span>
                </div>
              ))}
            </div>

            {!firebaseConfigured && (
              <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 mb-6">
                <AlertCircle size={15} className="text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-semibold text-amber-400 mb-0.5">Firebase credentials required</p>
                  <p className="text-xs text-slate-400">
                    Add your Firebase config to <code className="text-orange-400">.env.local</code> and restart the dev server before continuing.
                  </p>
                </div>
              </div>
            )}

            <button
              onClick={() => setStep('create')}
              disabled={!firebaseConfigured}
              className="w-full rounded-xl bg-orange-500 py-3 text-sm font-semibold text-white hover:bg-orange-400 disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              Begin Setup →
            </button>
          </div>
        )}

        {/* ── Step: Create Account ── */}
        {step === 'create' && (
          <div className="p-8">
            <h2 className="text-lg font-semibold text-white mb-1">Create Super Admin</h2>
            <p className="text-xs text-slate-500 mb-6">This account will have full access to all features.</p>

            <div className="space-y-4">
              {/* Email */}
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">Email address</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@nextgenfiberllc.com"
                  autoFocus
                  className="w-full rounded-lg border border-[#2a2a2a] bg-[#1a1a1a] px-3.5 py-2.5 text-sm text-white placeholder-slate-600 focus:border-orange-500/50 focus:outline-none focus:ring-1 focus:ring-orange-500/30 transition"
                />
              </div>

              {/* Password */}
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">Password</label>
                <div className="relative">
                  <input
                    type={showPw ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Create a strong password"
                    className="w-full rounded-lg border border-[#2a2a2a] bg-[#1a1a1a] px-3.5 py-2.5 pr-10 text-sm text-white placeholder-slate-600 focus:border-orange-500/50 focus:outline-none focus:ring-1 focus:ring-orange-500/30 transition"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition"
                  >
                    {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
                {/* Strength meter */}
                {password.length > 0 && (
                  <div className="mt-2">
                    <div className="flex gap-1 mb-1">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <div
                          key={n}
                          className="flex-1 h-1 rounded-full transition-all"
                          style={{ background: n <= strength.score ? strength.color : '#2a2a2a' }}
                        />
                      ))}
                    </div>
                    <p className="text-[11px]" style={{ color: strength.color }}>{strength.label}</p>
                  </div>
                )}
              </div>

              {/* Confirm password */}
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">Confirm password</label>
                <div className="relative">
                  <input
                    type={showCf ? 'text' : 'password'}
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder="Re-enter your password"
                    onKeyDown={(e) => e.key === 'Enter' && validateAndCreate()}
                    className="w-full rounded-lg border border-[#2a2a2a] bg-[#1a1a1a] px-3.5 py-2.5 pr-10 text-sm text-white placeholder-slate-600 focus:border-orange-500/50 focus:outline-none focus:ring-1 focus:ring-orange-500/30 transition"
                  />
                  <button
                    type="button"
                    onClick={() => setShowCf((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition"
                  >
                    {showCf ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
                {confirm.length > 0 && password !== confirm && (
                  <p className="text-[11px] text-red-400 mt-1">Passwords do not match</p>
                )}
                {confirm.length > 0 && password === confirm && (
                  <p className="text-[11px] text-emerald-400 mt-1">✓ Passwords match</p>
                )}
              </div>
            </div>

            {error && (
              <div className="flex items-start gap-2 mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2.5">
                <AlertCircle size={14} className="text-red-400 shrink-0 mt-0.5" />
                <p className="text-xs text-red-300">{error}</p>
              </div>
            )}

            <button
              onClick={validateAndCreate}
              disabled={loading}
              className="mt-6 w-full rounded-xl bg-orange-500 py-3 text-sm font-semibold text-white hover:bg-orange-400 disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <span className="h-4 w-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                  Creating account…
                </>
              ) : (
                'Create Super Admin Account'
              )}
            </button>
          </div>
        )}

        {/* ── Step: Done ── */}
        {step === 'done' && (
          <div className="p-8 text-center">
            <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/10 border border-emerald-500/20 mb-5">
              <CheckCircle size={32} className="text-emerald-400" />
            </div>
            <h2 className="text-lg font-semibold text-white mb-2">Setup Complete</h2>
            <p className="text-sm text-slate-400 mb-2">
              Super Admin account created for
            </p>
            <p className="text-sm font-medium text-orange-400 mb-6">{email}</p>
            <p className="text-xs text-slate-600 mb-8">
              The setup wizard is now permanently disabled. Every visit will require login.
            </p>
            <button
              onClick={() => window.location.reload()}
              className="w-full rounded-xl bg-orange-500 py-3 text-sm font-semibold text-white hover:bg-orange-400 transition"
            >
              Go to Login →
            </button>
          </div>
        )}
      </div>

      <p className="mt-6 text-xs text-slate-700">
        NextGen Fiber LLC · Secured by Firebase Authentication
      </p>
    </div>
  )
}
