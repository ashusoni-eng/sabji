import { NavLink, Outlet, Navigate } from 'react-router-dom'
import { useAuth } from '../../context/contexts'
import { Icon, Spinner, EmptyState } from '../../components/ui'

const TABS = [
  { to: '/admin',           icon: 'receipt_long',   label: 'Orders', end: true },
  { to: '/admin/products',  icon: 'inventory_2',    label: 'Items' },
  { to: '/admin/promos',    icon: 'local_activity', label: 'Promos' },
  { to: '/admin/staff',     icon: 'group',          label: 'Staff' },
  { to: '/admin/settings',  icon: 'settings',       label: 'More' },
]

export default function AdminLayout() {
  const { loading, user, isAdmin } = useAuth()

  if (loading) return <div className="min-h-dvh grid place-items-center"><Spinner /></div>
  if (!user) return <Navigate to="/login?next=/admin" replace />
  if (!isAdmin) {
    return (
      <div className="min-h-dvh grid place-items-center px-6">
        <EmptyState icon="lock" title="Not an admin account"
          message="This area is for the shop owner. If that's you, ask for your account to be promoted." />
      </div>
    )
  }

  return (
    <>
      <main className="max-w-md mx-auto px-4 pt-4 below-nav"><Outlet /></main>
      <nav className="fixed bottom-0 left-0 right-0 z-50 bg-surface/95 backdrop-blur-md
                      border-t border-line pb-safe">
        <div className="max-w-md mx-auto flex justify-around h-16">
          {TABS.map((t) => (
            <NavLink key={t.to} to={t.to} end={t.end}
              className={({ isActive }) =>
                `flex-1 flex flex-col items-center justify-center gap-0.5
                 ${isActive ? 'text-brand' : 'text-faint'}`}>
              {({ isActive }) => (
                <>
                  <Icon name={t.icon} fill={isActive} className="text-[23px]" />
                  <span className="text-[10px] font-semibold">{t.label}</span>
                </>
              )}
            </NavLink>
          ))}
        </div>
      </nav>
    </>
  )
}
