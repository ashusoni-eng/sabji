import { useState } from 'react'
import { adminListCategories, saveCategory, deleteCategory } from '../../services/admin'
import { useAsync } from '../../hooks/useAsync'
import { useToast } from '../../context/contexts'
import { readableError } from '../../lib/supabase'
import { Button, Field, Input, Sheet, Skeleton, EmptyState, ErrorState, Icon } from '../../components/ui'

export default function AdminCategories() {
  const toast = useToast()
  const { data, loading, error, reload } = useAsync(() => adminListCategories(), [])
  const [sheet, setSheet] = useState({ open: false, cat: null })
  const [form, setForm] = useState({ name: '', sort_order: 0, is_active: true })
  const [saving, setSaving] = useState(false)

  function open(cat) {
    setForm(cat ? { ...cat } : { name: '', sort_order: (data?.length || 0) + 1, is_active: true })
    setSheet({ open: true, cat })
  }

  async function submit() {
    if (!form.name.trim()) return toast.error('Give the category a name.')
    setSaving(true)
    try {
      await saveCategory({ ...form, id: sheet.cat?.id })
      toast.ok(sheet.cat ? 'Category updated' : 'Category added')
      setSheet({ open: false, cat: null })
      reload()
    } catch (e) { toast.error(readableError(e)) }
    finally { setSaving(false) }
  }

  async function remove(c) {
    if (!confirm(`Delete "${c.name}"? Items in it become uncategorised — they are not deleted.`)) return
    try { await deleteCategory(c.id); toast.ok('Category deleted'); reload() }
    catch (e) { toast.error(readableError(e)) }
  }

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <h1 className="font-headline font-extrabold text-2xl">Categories</h1>
        <Button size="sm" icon="add" onClick={() => open(null)}>Add</Button>
      </div>

      {loading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}
        </div>
      ) : error ? <ErrorState message={error} onRetry={reload} />
      : !data?.length ? (
        <EmptyState icon="category" title="No categories" message="Group your items so customers can browse."
          action={<Button onClick={() => open(null)} icon="add">Add category</Button>} />
      ) : (
        <div className="flex flex-col gap-2">
          {data.map((c) => (
            <div key={c.id} className={`bg-surface rounded-xl border border-line p-3 flex items-center gap-3
                                        ${c.is_active ? '' : 'opacity-55'}`}>
              <span className="w-9 h-9 rounded-lg bg-brand-soft grid place-items-center shrink-0
                               text-brand-ink font-bold text-sm tabular-nums">{c.sort_order}</span>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-sm">{c.name}</p>
                <p className="text-xs text-faint">/{c.slug}{!c.is_active && ' · hidden'}</p>
              </div>
              <button onClick={() => open(c)} aria-label={`Edit ${c.name}`}
                      className="w-11 h-11 grid place-items-center text-muted">
                <Icon name="edit" className="text-[19px]" />
              </button>
              <button onClick={() => remove(c)} aria-label={`Delete ${c.name}`}
                      className="w-11 h-11 -mr-1 grid place-items-center text-danger">
                <Icon name="delete" className="text-[19px]" />
              </button>
            </div>
          ))}
        </div>
      )}

      <Sheet open={sheet.open} onClose={() => setSheet({ open: false, cat: null })}
             title={sheet.cat ? 'Edit category' : 'New category'}
             footer={<Button full size="lg" loading={saving} onClick={submit}>Save</Button>}>
        <div className="flex flex-col gap-4">
          <Field label="Name" required>
            <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                   placeholder="Leafy greens" />
          </Field>
          <Field label="Sort order" hint="Lower numbers show first">
            <Input type="number" inputMode="numeric" value={form.sort_order}
                   onChange={(e) => setForm((f) => ({ ...f, sort_order: Number(e.target.value) || 0 }))} />
          </Field>
          <label className="flex items-center gap-3 min-h-[44px] cursor-pointer">
            <input type="checkbox" checked={form.is_active}
                   onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
                   className="w-5 h-5 accent-[var(--c-brand)]" />
            <span className="font-semibold text-sm">Show in the shop</span>
          </label>
        </div>
      </Sheet>
    </>
  )
}
