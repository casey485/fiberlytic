import { useState } from 'react'
import { useAuth } from '../store/AuthContext'
import { Eye, EyeOff, AlertCircle, CheckCircle, Zap, ArrowLeft } from 'lucide-react'

type View = 'login' | 'forgot' | 'forgot_sent'

function friendlyError(code: string): string {
  switch (code) {
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return 'Incorrect email or password.'
    case 'auth/too-many-requests':
      return 'Too many attempts — account temporarily locked. Reset your password or try again later.'
    case 'auth/user-disabled':
      return 'This account has been disabled. Contact your administrator.'
    case 'auth/network-request-failed':
      return 'Network error — check your connection and try again.'
    default:
      return 'Sign-in failed. Please check your credentials and try again.'
  }
}

export function Login() {
  const { login, sendReset, firebaseReady } = useAuth()

  const [view, setView]         = useState<View>('login')
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(false)
  const [showPw, setShowPw]     = useState(false)
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)
  const [resetEmail, setResetEmail] = useState('')

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim() || !password) return
    setError('')
    setLoading(true)
    try {
      await login(email.trim(), password, remember)
      // onAuthStateChanged in AuthContext will update user → App re-renders
    } catch (err: unknown) {
      const code = (err as { code?: string }).code ?? ''
      setError(friendlyError(code))
    } finally {
      setLoading(false)
    }
  }

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!resetEmail.trim()) return
    setError('')
    setLoading(true)
    try {
      await sendReset(resetEmail.trim())
      setView('forgot_sent')
    } catch (err: unknown) {
      const code = (err as { code?: string }).code ?? ''
      if (code === 'auth/user-not-found') {
        setView('forgot_sent') // don't reveal if email exists
      } else {
        setError('Could not send reset email. Check your connection and try again.')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex flex-col items-center justify-center p-4">
      {/* Background glow */}
      <div className="fixed inset-0 bg-[radial-gradient(ellipse_at_top_left,_#f9731608_0%,_transparent_60%)] pointer-events-none" />
      <div className="fixed inset-0 bg-[radial-gradient(ellipse_at_bottom_right,_#f9731605_0%,_transparent_60%)] pointer-events-none" />

      {/* Branding */}
      <div className="mb-8 text-center">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-orange-500/10 border border-orange-500/20 mb-4">
          <Zap size={28} className="text-orange-500" />
        </div>
        <h1 className="text-2xl font-bold text-white tracking-tight">NextGen Fiber LLC</h1>
        <p className="text-sm text-slate-500 mt-1">Powered by Fiberlytic</p>
      </div>

      {/* Card */}
      <div className="w-full max-w-sm bg-[#111111] border border-[#1f1f1f] rounded-2xl shadow-2xl">

        {/* ── Login form ── */}
        {view === 'login' && (
          <form onSubmit={handleLogin} className="p-8">
            <h2 className="text-lg font-semibold text-white mb-1">Sign In</h2>
            <p className="text-xs text-slate-500 mb-6">Enter your credentials to access the system.</p>

            {!firebaseReady && (
              <div className="flex items-start gap-2 mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5">
                <AlertCircle size={13} className="text-amber-400 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-300">
                  Firebase not configured. Add credentials to <code className="text-orange-400">.env.local</code>.
                </p>
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">Email address</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@nextgenfiberllc.com"
                  autoComplete="email"
                  autoFocus
                  required
                  className="w-full rounded-lg border border-[#2a2a2a] bg-[#1a1a1a] px-3.5 py-2.5 text-sm text-white placeholder-slate-600 focus:border-orange-500/50 focus:outline-none focus:ring-1 focus:ring-orange-500/30 transition"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">Password</label>
                <div className="relative">
                  <input
                    type={showPw ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    autoComplete="current-password"
                    required
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
              </div>

              {/* Remember me + Forgot */}
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <div
                    onClick={() => setRemember((v) => !v)}
                    className={`h-4 w-4 rounded border flex items-center justify-center transition cursor-pointer ${
                      remember
                        ? 'border-orange-500 bg-orange-500'
                        : 'border-[#3a3a3a] bg-[#1a1a1a] hover:border-orange-500/50'
                    }`}
                  >
                    {remember && <span className="text-white text-[10px] font-bold leading-none">✓</span>}
                  </div>
                  <span className="text-xs text-slate-400">Remember me</span>
                </label>

                <button
                  type="button"
                  onClick={() => { setView('forgot'); setResetEmail(email); setError('') }}
                  className="text-xs text-orange-500 hover:text-orange-400 transition"
                >
                  Forgot password?
                </button>
              </div>
            </div>

            {error && (
              <div className="flex items-start gap-2 mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2.5">
                <AlertCircle size={13} className="text-red-400 shrink-0 mt-0.5" />
                <p className="text-xs text-red-300">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !firebaseReady}
              className="mt-6 w-full rounded-xl bg-orange-500 py-3 text-sm font-semibold text-white hover:bg-orange-400 disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <span className="h-4 w-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                  Signing in…
                </>
              ) : (
                'Sign In'
              )}
            </button>
          </form>
        )}

        {/* ── Forgot password form ── */}
        {view === 'forgot' && (
          <form onSubmit={handleForgotPassword} className="p-8">
            <button
              type="button"
              onClick={() => { setView('login'); setError('') }}
              className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 mb-6 transition"
            >
              <ArrowLeft size={13} /> Back to sign in
            </button>

            <h2 className="text-lg font-semibold text-white mb-1">Reset Password</h2>
            <p className="text-xs text-slate-500 mb-6">
              Enter your email and we'll send you a link to reset your password.
            </p>

            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Email address</label>
              <input
                type="email"
                value={resetEmail}
                onChange={(e) => setResetEmail(e.target.value)}
                placeholder="you@nextgenfiberllc.com"
                autoFocus
                required
                className="w-full rounded-lg border border-[#2a2a2a] bg-[#1a1a1a] px-3.5 py-2.5 text-sm text-white placeholder-slate-600 focus:border-orange-500/50 focus:outline-none focus:ring-1 focus:ring-orange-500/30 transition"
              />
            </div>

            {error && (
              <div className="flex items-start gap-2 mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2.5">
                <AlertCircle size={13} className="text-red-400 shrink-0 mt-0.5" />
                <p className="text-xs text-red-300">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="mt-6 w-full rounded-xl bg-orange-500 py-3 text-sm font-semibold text-white hover:bg-orange-400 disabled:opacity-50 transition flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <span className="h-4 w-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                  Sending…
                </>
              ) : (
                'Send Reset Link'
              )}
            </button>
          </form>
        )}

        {/* ── Forgot password sent ── */}
        {view === 'forgot_sent' && (
          <div className="p-8 text-center">
            <div className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/10 border border-emerald-500/20 mb-5">
              <CheckCircle size={28} className="text-emerald-400" />
            </div>
            <h2 className="text-lg font-semibold text-white mb-2">Check Your Email</h2>
            <p className="text-sm text-slate-400 mb-1">If that account exists, a reset link was sent to</p>
            <p className="text-sm font-medium text-orange-400 mb-6">{resetEmail}</p>
            <p className="text-xs text-slate-600 mb-8">
              Click the link in the email to reset your password. The link expires in 1 hour.
            </p>
            <button
              onClick={() => { setView('login'); setError('') }}
              className="w-full rounded-xl bg-[#1a1a1a] border border-[#2a2a2a] py-3 text-sm font-medium text-slate-300 hover:text-white hover:border-[#3a3a3a] transition"
            >
              ← Back to Sign In
            </button>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="mt-8 text-center space-y-1">
        <p className="text-xs text-slate-700">NextGen Fiber LLC · All rights reserved</p>
        <p className="text-xs text-slate-800">Secured by Firebase Authentication</p>
      </div>
    </div>
  )
}
