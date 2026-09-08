import { NavLink, useNavigate } from 'react-router-dom'
import { useCart } from '../../context/contexts'
import { useAuth, useStore } from '../../context/contexts'
import { STORE_NAME } from '../../lib/store'
import { Icon, IconButton } from '../ui'

/** The shop's uploaded logo if there is one, otherwise its name set in type. */
export function StoreMark() {
  const { logoUrl } = useStore()
  if (logoUrl) {
    return (
      <img src={logoUrl} alt={STORE_NAME} width="140" height="36"
           className="h-8 w-auto max-w-[190px] object-contain pl-2" />
    )
  }
  return (
    <span className="font-headline font-black text-xl text-brand tracking-tight pl-2 truncate">
      {STORE_NAME}
    </span>
  )
}

export function TopBar({ title, back, right, transparent = false }) {
  const navigate = useNavigate()
  return (
    <header className={`fixed top-0 left-0 right-0 z-50 pt-safe
                        ${transparent ? '' : 'bg-surface border-b border-line'}`}>
      <div className="max-w-md mx-auto h-16 px-2 flex items-center justify-between gap-1">
        <div className="flex items-center gap-1 min-w-0">
          {back ? (
            <IconButton name="arrow_back" label="Go back" onClick={() => navigate(-1)}
                        className="text-ink w-11 h-11" />
          ) : (
            <span className="w-2" />
          )}
          {title ? (
            <h1 className="font-headline font-extrabold text-lg truncate">{title}</h1>
          ) : (
            <StoreMark />
          )}
        </div>
        <div className="flex items-center gap-0.5 shrink-0">{right}</div>
      </div>
    </header>
  )
}

export function CartButton() {
  const { count } = useCart()
  const navigate = useNavigate()
  return (
    <button onClick={() => navigate('/cart')} aria-label={`Cart, ${count} items`}
            className="relative w-11 h-11 grid place-items-center rounded-xl text-brand
                       active:scale-90 transition-transform">
      <Icon name="shopping_cart" />
      {count > 0 && (
        <span className="absolute top-1 right-0.5 bg-accent text-on-brand text-[10px] font-bold
                         min-w-[18px] h-[18px] px-1 grid place-items-center rounded-full tabular-nums">
          {count > 99 ? '99+' : count}
        </span>
      )}
    </button>
  )
}

const TABS = [
  { to: '/',           icon: 'storefront',  label: 'Shop' },
  { to: '/categories', icon: 'category',    label: 'Categories' },
  { to: '/orders',     icon: 'receipt_long', label: 'Orders' },
  { to: '/profile',    icon: 'person',      label: 'Profile' },
]

export function BottomNav() {
  const { isAdmin, isRider } = useAuth()
  const tabs = isAdmin
    ? [...TABS.slice(0, 3), { to: '/admin', icon: 'admin_panel_settings', label: 'Admin' }]
    : isRider
      ? [...TABS.slice(0, 3), { to: '/deliveries', icon: 'local_shipping', label: 'Deliver' }]
      : TABS
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-surface/95 backdrop-blur-md
                    border-t border-line pb-safe">
      <div className="max-w-md mx-auto flex justify-around items-stretch h-16">
        {tabs.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.to === '/'}
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center justify-center gap-0.5 transition-colors
               ${isActive ? 'text-brand' : 'text-faint'}`}>
            {({ isActive }) => (
              <>
                <Icon name={t.icon} fill={isActive} className="text-[23px]" />
                <span className="text-[11px] font-semibold">{t.label}</span>
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  )
}

/**
 * Standard page frame. `action` tells it a sticky ActionBar is present so the
 * body reserves room for it; a screen should never show both the bottom nav and
 * an ActionBar, because they occupy the same strip.
 */
export function Screen({ children, title, back, right, nav = true, action = false, className = '' }) {
  const pad = action ? 'below-action' : nav ? 'below-nav' : 'pb-8'
  return (
    <>
      <TopBar title={title} back={back} right={right} />
      <main className={`max-w-md mx-auto px-4 pt-20 ${pad} ${className}`}>
        {children}
      </main>
      {nav && !action && <BottomNav />}
    </>
  )
}

/** Sticky bar for a screen's single primary action (Add to cart, Place order). */
export function ActionBar({ children }) {
  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 bg-surface border-t border-line pb-safe">
      <div className="max-w-md mx-auto p-3">{children}</div>
    </div>
  )
}
