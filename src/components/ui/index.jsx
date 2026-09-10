import { useEffect, useRef } from 'react'

export function Icon({ name, className = '', fill = false, ...rest }) {
  return (
    <span aria-hidden="true"
          className={`material-symbols-outlined ${fill ? 'icon-fill' : ''} ${className}`} {...rest}>
      {name}
    </span>
  )
}

export function Button({
  children, variant = 'primary', size = 'md', full = false,
  loading = false, icon, className = '', disabled, ...rest
}) {
  const base =
    'inline-flex items-center justify-center gap-2 font-bold rounded-xl transition-[transform,opacity,background-color] ' +
    'active:scale-[.97] disabled:opacity-50 disabled:pointer-events-none select-none'
  const sizes = {
    sm: 'text-sm px-4 min-h-[44px]',
    md: 'text-[15px] px-5 min-h-[48px]',
    lg: 'text-base px-6 min-h-[54px]',
  }
  const variants = {
    primary: 'bg-brand text-on-brand',
    accent: 'bg-accent text-on-brand',
    outline: 'border border-line bg-surface text-ink',
    ghost: 'text-brand',
    danger: 'bg-danger text-on-brand',
    subtle: 'bg-brand-soft text-brand-ink',
  }
  return (
    <button
      className={`${base} ${sizes[size]} ${variants[variant]} ${full ? 'w-full' : ''} ${className}`}
      disabled={disabled || loading} {...rest}>
      {loading ? <Spinner size={18} /> : icon ? <Icon name={icon} className="text-[20px]" /> : null}
      {children}
    </button>
  )
}

/** Small icon-only control. `tap-sm` gives it a 44px hit area without a 44px box. */
export function IconButton({ name, label, className = '', fill = false, ...rest }) {
  return (
    <button aria-label={label}
            className={`tap-sm relative inline-flex items-center justify-center rounded-xl
                        transition-transform active:scale-90 ${className}`} {...rest}>
      <Icon name={name} fill={fill} />
    </button>
  )
}

export function Spinner({ size = 22, className = '' }) {
  return (
    <span role="status" aria-label="Loading"
          className={`inline-block animate-spin rounded-full border-2 border-current
                      border-t-transparent ${className}`}
          style={{ width: size, height: size }} />
  )
}

export function Field({ label, hint, error, children, required }) {
  return (
    <label className="block">
      <span className="block text-[13px] font-bold text-muted mb-1.5">
        {label}{required && <span className="text-danger"> *</span>}
      </span>
      {children}
      {error
        ? <span className="block text-[13px] text-danger mt-1.5 font-medium">{error}</span>
        : hint ? <span className="block text-[13px] text-faint mt-1.5">{hint}</span> : null}
    </label>
  )
}

export function Input({ className = '', invalid, ...rest }) {
  return (
    <input
      className={`w-full rounded-xl border bg-surface px-4 py-3 text-ink placeholder:text-faint
                  min-h-[48px] transition-colors
                  ${invalid ? 'border-danger' : 'border-line focus:border-brand'} ${className}`}
      {...rest} />
  )
}

export function Textarea({ className = '', ...rest }) {
  return (
    <textarea
      className={`w-full rounded-xl border border-line bg-surface px-4 py-3 text-ink
                  placeholder:text-faint focus:border-brand transition-colors ${className}`}
      {...rest} />
  )
}

export function Select({ className = '', children, ...rest }) {
  return (
    <select
      className={`w-full rounded-xl border border-line bg-surface px-4 py-3 text-ink
                  min-h-[48px] focus:border-brand transition-colors ${className}`}
      {...rest}>
      {children}
    </select>
  )
}

/* ------------------------------------------------------------------ states */

export function Skeleton({ className = '' }) {
  return <div className={`shimmer rounded-lg ${className}`} aria-hidden="true" />
}

export function ProductGridSkeleton({ count = 6 }) {
  return (
    <div className="grid grid-cols-2 gap-4" aria-label="Loading products" role="status">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="bg-surface rounded-xl border border-line p-3">
          <Skeleton className="aspect-square mb-3" />
          <Skeleton className="h-4 w-3/4 mb-2" />
          <Skeleton className="h-3 w-1/3 mb-3" />
          <Skeleton className="h-6 w-1/2" />
        </div>
      ))}
    </div>
  )
}

export function EmptyState({ icon = 'inbox', title, message, action }) {
  return (
    <div className="text-center py-14 px-6">
      <Icon name={icon} className="text-[52px] text-faint mb-3" />
      <h3 className="font-headline font-extrabold text-lg mb-1.5">{title}</h3>
      {message && <p className="text-muted text-sm mb-5 max-w-xs mx-auto leading-relaxed">{message}</p>}
      {action}
    </div>
  )
}

export function ErrorState({ message, onRetry }) {
  return (
    <div className="text-center py-14 px-6">
      <Icon name="cloud_off" className="text-[52px] text-danger mb-3" />
      <h3 className="font-headline font-extrabold text-lg mb-1.5">Could not load</h3>
      <p className="text-muted text-sm mb-5 max-w-xs mx-auto leading-relaxed">{message}</p>
      {onRetry && <Button variant="outline" onClick={onRetry} icon="refresh">Try again</Button>}
    </div>
  )
}

/* ------------------------------------------------------------------ sheet */

/** Bottom sheet. Phone-native pattern: slides from the bottom, taps outside to close. */
export function Sheet({ open, onClose, title, children, footer }) {
  const ref = useRef(null)

  // Held in a ref so the effect below does not depend on it. Callers pass an
  // inline arrow, which is a new function on every render; with onClose in the
  // dependency list the effect re-ran on each keystroke and moved focus back to
  // the dialog, so typing into a field in a sheet dropped focus after one
  // character.
  const onCloseRef = useRef(onClose)
  useEffect(() => { onCloseRef.current = onClose }, [onClose])

  useEffect(() => {
    if (!open) return
    const onKey = (e) => e.key === 'Escape' && onCloseRef.current()
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    // Move focus into the dialog once, when it opens — not on every render.
    ref.current?.focus()
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[90] flex items-end animate-fade-in">
      <div className="absolute inset-0 bg-black/45" onClick={onClose} aria-hidden="true" />
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title}
           className="relative w-full max-w-md mx-auto bg-surface rounded-t-2xl
                      max-h-[88vh] flex flex-col animate-sheet-in outline-none">
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-line shrink-0">
          <h2 className="font-headline font-extrabold text-lg pr-4">{title}</h2>
          <IconButton name="close" label="Close" onClick={onClose} className="text-muted -mr-2" />
        </div>
        <div className="overflow-y-auto px-5 py-4 flex-1">{children}</div>
        {footer && <div className="border-t border-line p-4 pb-safe shrink-0 bg-surface">{footer}</div>}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ misc */

export function QtyStepper({ qty, onDelta, max = 99, size = 'md' }) {
  const dim = size === 'sm' ? 'h-9 min-w-9' : 'h-11 min-w-11'
  // Emits +1 / -1 rather than a computed total. Two taps in the same tick would
  // both read the same rendered `qty` and produce the same number, so the caller
  // resolves the delta against the current value instead.
  return (
    <div className="inline-flex items-center rounded-xl border border-line bg-surface overflow-hidden">
      <button onClick={() => onDelta(-1)} aria-label="Reduce quantity"
              className={`${dim} flex items-center justify-center text-brand active:bg-brand-soft transition-colors`}>
        <Icon name={qty <= 1 ? 'delete' : 'remove'} className="text-[19px]" />
      </button>
      <span className="min-w-8 text-center font-bold tabular-nums text-[15px]"
            aria-live="polite" aria-label={`Quantity ${qty}`}>{qty}</span>
      <button onClick={() => onDelta(1)} disabled={qty >= max} aria-label="Increase quantity"
              className={`${dim} flex items-center justify-center text-brand active:bg-brand-soft
                          disabled:opacity-40 transition-colors`}>
        <Icon name="add" className="text-[19px]" />
      </button>
    </div>
  )
}

export function StatusPill({ status, label }) {
  const tone = {
    placed: 'bg-brand-soft text-brand-ink',
    confirmed: 'bg-brand-soft text-brand-ink',
    packed: 'bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200',
    out_for_delivery: 'bg-blue-100 text-blue-900 dark:bg-blue-900/30 dark:text-blue-200',
    delivered: 'bg-brand text-on-brand',
    cancelled: 'bg-danger-soft text-danger',
  }[status] || 'bg-surface-2 text-muted'
  return (
    <span className={`inline-block px-2.5 py-1 rounded-full text-[11px] font-bold uppercase
                      tracking-wide whitespace-nowrap ${tone}`}>
      {label}
    </span>
  )
}

/**
 * Payment state at a glance. "Paid" and "Paid · unverified" are deliberately
 * different: the second means only that the customer tapped a button, and the
 * shop has not yet checked their own UPI app.
 */
export function PaymentBadge({ method, status, compact = false }) {
  if (method !== 'online') return null
  const confirmed = status === 'confirmed'
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full
                      text-[10px] font-bold uppercase tracking-wide whitespace-nowrap
                      ${confirmed
                        ? 'bg-brand text-on-brand'
                        : 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200'}`}>
      <Icon name={confirmed ? 'verified' : 'schedule'} fill className="text-[12px]" />
      {confirmed ? 'Paid' : compact ? 'Paid?' : 'Paid · unverified'}
    </span>
  )
}

/** Product image with dimensions and lazy loading, so the grid does not shift. */
export function ProductImage({ src, alt, className = '' }) {
  return src ? (
    <img src={src} alt={alt} loading="lazy" decoding="async" width="400" height="400"
         className={`w-full h-full object-cover ${className}`} />
  ) : (
    <div className={`w-full h-full grid place-items-center bg-surface-2 ${className}`}>
      <Icon name="photo_camera" className="text-[28px] text-faint" />
    </div>
  )
}
