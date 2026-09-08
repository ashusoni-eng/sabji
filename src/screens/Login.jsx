import { useState, useRef, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/contexts'
import { useToast } from '../context/contexts'
import { readableError } from '../lib/supabase'
import { Button, Field, Input, Icon } from '../components/ui'
import { displayPhone } from '../lib/format'
import { STORE_NAME } from '../lib/store'

export default function Login() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const next = params.get('next') || '/'
  const { sendOtp, verifyOtp, user, updateProfile } = useAuth()
  const toast = useToast()

  const [step, setStep] = useState('phone')
  const [phone, setPhone] = useState('')
  const [e164, setE164] = useState('')
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const codeRef = useRef(null)

  useEffect(() => {
    if (user && step !== 'name') navigate(next, { replace: true })
  }, [user, next, navigate, step])
  useEffect(() => { if (step === 'code') codeRef.current?.focus() }, [step])
  useEffect(() => {
    if (cooldown <= 0) return
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [cooldown])

  async function send() {
    setBusy(true)
    try {
      const normalised = await sendOtp(phone)
      setE164(normalised)
      setStep('code')
      setCooldown(30)
      toast.ok(`Code sent to ${displayPhone(normalised)}`)
    } catch (e) { toast.error(readableError(e)) }
    finally { setBusy(false) }
  }

  async function verify() {
    setBusy(true)
    try {
      const result = await verifyOtp(e164, code.trim())
      // Ask a brand-new customer for their name here rather than leaving the
      // profile blank and nagging them for it later.
      const existingName = result?.profile?.full_name?.trim()
      if (!existingName) {
        setStep('name')
      } else {
        toast.ok(`Welcome back, ${existingName.split(' ')[0]}`)
        navigate(next, { replace: true })
      }
    } catch (e) { toast.error(readableError(e, 'That code did not work. Please try again.')) }
    finally { setBusy(false) }
  }

  async function saveName() {
    const trimmed = name.trim()
    if (!trimmed) return
    setBusy(true)
    try {
      await updateProfile({ full_name: trimmed })
      toast.ok(`Welcome, ${trimmed.split(' ')[0]}`)
      navigate(next, { replace: true })
    } catch (e) { toast.error(readableError(e)) }
    finally { setBusy(false) }
  }

  return (
    <main className="min-h-dvh flex flex-col px-6 pt-16 pb-8 max-w-md mx-auto">
      {step !== 'name' && (
        <button onClick={() => (step === 'code' ? setStep('phone') : navigate(-1))}
                aria-label="Go back" className="w-11 h-11 -ml-3 grid place-items-center text-ink mb-6">
          <Icon name="arrow_back" />
        </button>
      )}

      <span className="font-headline font-black text-3xl text-brand tracking-tight mb-2">{STORE_NAME}</span>

      {step === 'name' ? (
        <>
          <h1 className="font-headline font-extrabold text-2xl mb-1.5">What should we call you?</h1>
          <p className="text-muted mb-8">
            The delivery person will ask for this name at your door.
          </p>

          <Field label="Your name">
            <Input value={name} onChange={(e) => setName(e.target.value)}
                   autoComplete="name" autoFocus placeholder="Ashish Kumar" maxLength={60}
                   onKeyDown={(e) => e.key === 'Enter' && name.trim() && saveName()} />
          </Field>

          <Button full size="lg" className="mt-6" loading={busy}
                  disabled={!name.trim()} onClick={saveName}>
            Continue
          </Button>
        </>
      ) : step === 'phone' ? (
        <>
          <h1 className="font-headline font-extrabold text-2xl mb-1.5">What's your number?</h1>
          <p className="text-muted mb-8">We'll text you a code to sign in. No password to remember.</p>

          <Field label="Mobile number">
            <div className="flex items-stretch gap-2">
              <span className="grid place-items-center px-4 rounded-xl border border-line
                               bg-surface-2 font-bold text-muted">+91</span>
              <Input value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                     inputMode="numeric" autoComplete="tel" maxLength={10} placeholder="9876543210"
                     onKeyDown={(e) => e.key === 'Enter' && phone.length === 10 && send()} />
            </div>
          </Field>

          <Button full size="lg" className="mt-6" loading={busy}
                  disabled={phone.length !== 10} onClick={send}>
            Send code
          </Button>
        </>
      ) : (
        <>
          <h1 className="font-headline font-extrabold text-2xl mb-1.5">Enter the code</h1>
          <p className="text-muted mb-8">
            Sent to {displayPhone(e164)}.{' '}
            <button onClick={() => setStep('phone')} className="text-brand font-bold underline">Change</button>
          </p>

          <Field label="6-digit code">
            <Input ref={codeRef} value={code}
                   onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                   inputMode="numeric" autoComplete="one-time-code" maxLength={6}
                   placeholder="123456" className="text-center text-2xl tracking-[0.4em] font-bold"
                   onKeyDown={(e) => e.key === 'Enter' && code.length === 6 && verify()} />
          </Field>

          <Button full size="lg" className="mt-6" loading={busy}
                  disabled={code.length !== 6} onClick={verify}>
            Verify and sign in
          </Button>

          <button onClick={send} disabled={cooldown > 0 || busy}
                  className="mt-4 min-h-[44px] text-sm font-bold text-brand disabled:text-faint">
            {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
          </button>
        </>
      )}

      <p className="mt-auto pt-8 text-xs text-faint text-center leading-relaxed">
        By continuing you agree to receive order updates on this number.
      </p>
    </main>
  )
}
