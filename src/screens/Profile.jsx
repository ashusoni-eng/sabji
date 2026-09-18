import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth, useToast, useStore } from '../context/contexts'
import { readableError } from '../lib/supabase'
import { Screen } from '../components/layout/AppShell'
import { Button, EmptyState, Icon, Field, Input, Sheet } from '../components/ui'
import { displayPhone } from '../lib/format'

export default function Profile() {
  const navigate = useNavigate()
  const { user, profile, isAdmin, isRider, signOut, updateProfile } = useAuth()
  const toast = useToast()
  const { settings, isSuper } = useStore()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem('sabji.theme') || 'light' } catch { return 'light' }
  })

  if (!user) {
    return (
      <Screen title="Profile">
        <EmptyState icon="person" title="You're not signed in"
          message="Sign in to save addresses and see your order history."
          action={<Button onClick={() => navigate('/login?next=/profile')} icon="login">Sign in</Button>} />
      </Screen>
    )
  }

  async function saveName() {
    setSaving(true)
    try {
      await updateProfile({ full_name: name.trim() })
      toast.ok('Name updated')
      setEditing(false)
    } catch (e) { toast.error(readableError(e)) }
    finally { setSaving(false) }
  }

  function applyTheme(next) {
    setTheme(next)
    if (next === 'auto') delete document.documentElement.dataset.theme
    else document.documentElement.dataset.theme = next
    try { localStorage.setItem('sabji.theme', next) } catch { /* storage blocked */ }
  }

  return (
    <Screen title="Profile">
      <div className="bg-surface rounded-xl border border-line p-4 mb-4 flex items-center gap-4">
        <div className="w-14 h-14 rounded-full bg-brand-soft grid place-items-center shrink-0">
          <Icon name="person" fill className="text-[28px] text-brand" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-headline font-extrabold text-lg truncate">
            {profile?.full_name || 'Add your name'}
          </p>
          <p className="text-muted text-sm tabular-nums">+91 {displayPhone(profile?.phone || user.phone)}</p>
        </div>
        <button onClick={() => { setName(profile?.full_name || ''); setEditing(true) }}
                aria-label="Edit name" className="w-11 h-11 grid place-items-center text-muted">
          <Icon name="edit" className="text-[20px]" />
        </button>
      </div>

      {isSuper && (
        <button onClick={() => navigate('/super')}
                className="w-full bg-accent text-on-brand rounded-xl p-4 mb-4 flex items-center gap-3
                           text-left active:scale-[.99] transition-transform">
          <Icon name="domain" fill className="text-[26px]" />
          <div className="flex-1">
            <p className="font-bold">Platform admin</p>
            <p className="text-on-brand/80 text-sm">Manage shops and the WhatsApp bot</p>
          </div>
          <Icon name="chevron_right" />
        </button>
      )}

      {isAdmin && (
        <button onClick={() => navigate('/admin')}
                className="w-full bg-brand text-on-brand rounded-xl p-4 mb-4 flex items-center gap-3
                           text-left active:scale-[.99] transition-transform">
          <Icon name="admin_panel_settings" fill className="text-[26px]" />
          <div className="flex-1">
            <p className="font-bold">Shop admin</p>
            <p className="text-on-brand/80 text-sm">Manage products and orders</p>
          </div>
          <Icon name="chevron_right" />
        </button>
      )}

      {isRider && (
        <button onClick={() => navigate('/deliveries')}
                className="w-full bg-brand text-on-brand rounded-xl p-4 mb-4 flex items-center gap-3
                           text-left active:scale-[.99] transition-transform">
          <Icon name="local_shipping" fill className="text-[26px]" />
          <div className="flex-1">
            <p className="font-bold">My deliveries</p>
            <p className="text-on-brand/80 text-sm">Orders assigned to you</p>
          </div>
          <Icon name="chevron_right" />
        </button>
      )}

      <nav className="bg-surface rounded-xl border border-line overflow-hidden mb-4">
        <Item icon="receipt_long" label="My orders" onClick={() => navigate('/orders')} />
        <Item icon="location_on" label="My addresses" onClick={() => navigate('/addresses')} />
      </nav>

      {(settings?.support_phone || settings?.support_email) && (
        <div className="bg-surface rounded-xl border border-line overflow-hidden mb-4">
          <p className="px-4 pt-4 pb-1 font-bold text-sm">Need help?</p>
          {settings.support_phone && (
            <a href={`tel:${settings.support_phone}`}
               className="flex items-center gap-3 px-4 min-h-[56px] border-t border-line
                          active:bg-surface-2 transition-colors">
              <Icon name="call" className="text-brand text-[22px]" />
              <span className="flex-1 font-semibold tabular-nums">{settings.support_phone}</span>
              <Icon name="chevron_right" className="text-faint" />
            </a>
          )}
          {settings.support_email && (
            <a href={`mailto:${settings.support_email}`}
               className="flex items-center gap-3 px-4 min-h-[56px] border-t border-line
                          active:bg-surface-2 transition-colors">
              <Icon name="mail" className="text-brand text-[22px]" />
              <span className="flex-1 font-semibold truncate">{settings.support_email}</span>
              <Icon name="chevron_right" className="text-faint" />
            </a>
          )}
        </div>
      )}

      <div className="bg-surface rounded-xl border border-line p-4 mb-4">
        <p className="font-bold text-sm mb-3">Appearance</p>
        <div className="flex gap-2">
          {[['light', 'Light'], ['dark', 'Dark'], ['auto', 'Auto']].map(([v, l]) => (
            <button key={v} onClick={() => applyTheme(v)}
              className={`flex-1 min-h-[44px] rounded-xl border font-bold text-sm transition-colors
                          ${theme === v ? 'border-brand bg-brand-soft text-brand-ink' : 'border-line text-muted'}`}>
              {l}
            </button>
          ))}
        </div>
      </div>

      <Button full variant="outline" icon="logout" className="text-danger border-danger/30"
              onClick={async () => { await signOut(); toast.ok('Signed out'); navigate('/') }}>
        Sign out
      </Button>

      <Sheet open={editing} onClose={() => setEditing(false)} title="Your name"
        footer={<Button full size="lg" loading={saving} onClick={saveName}>Save</Button>}>
        <Field label="Full name" hint="So the delivery person knows who to ask for">
          <Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name"
                 placeholder="Ashish Kumar" />
        </Field>
      </Sheet>
    </Screen>
  )
}

function Item({ icon, label, onClick }) {
  return (
    <button onClick={onClick}
            className="w-full flex items-center gap-3 px-4 min-h-[56px] text-left
                       border-b border-line last:border-0 active:bg-surface-2 transition-colors">
      <Icon name={icon} className="text-muted text-[22px]" />
      <span className="flex-1 font-semibold">{label}</span>
      <Icon name="chevron_right" className="text-faint" />
    </button>
  )
}
