import { useEffect, useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  adminGetProduct, saveProduct, adminListCategories,
  uploadProductImage, deleteProductImage,
} from '../../services/admin'
import { imageSrc } from '../../services/catalog'
import { useAsync } from '../../hooks/useAsync'
import { useToast, useStore } from '../../context/contexts'
import { readableError } from '../../lib/supabase'
import { compressProductImage, readableSize } from '../../lib/image'
import {
  Button, Field, Input, Textarea, Select, Icon, Spinner, Skeleton, ProductImage,
} from '../../components/ui'
import { rupees, toPaise } from '../../lib/format'

const BLANK_VARIANT = { label: 'Default', unit: '1 kg', price_paise: 0, mrp_paise: null, in_stock: true }

export default function AdminProductEdit() {
  const { id } = useParams()
  const isNew = !id || id === 'new'
  const navigate = useNavigate()
  const toast = useToast()
  const fileRef = useRef(null)
  const { tenantId } = useStore()

  const cats = useAsync(() => (tenantId ? adminListCategories(tenantId) : []), [tenantId])
  const existing = useAsync(() => (isNew ? null : adminGetProduct(id)), [id], { immediate: !isNew })

  const [form, setForm] = useState({
    name: '', description: '', badge: '', category_id: '',
    image_path: null, image_url: null, is_active: true, sort_order: 0,
  })
  const [variants, setVariants] = useState([{ ...BLANK_VARIANT }])
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)

  useEffect(() => {
    if (existing.data) {
      const p = existing.data
      setForm({
        name: p.name, description: p.description || '', badge: p.badge || '',
        category_id: p.category_id || '', image_path: p.image_path, image_url: p.image_url,
        is_active: p.is_active, sort_order: p.sort_order,
      })
      setVariants(p.variants.length ? p.variants : [{ ...BLANK_VARIANT }])
    }
  }, [existing.data])

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  /** Compresses on-device before upload — a raw phone photo is unusable on mobile data. */
  async function onPickImage(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setUploading(true)
    try {
      const before = file.size
      const compressed = await compressProductImage(file)
      const path = await uploadProductImage(compressed)
      if (form.image_path) await deleteProductImage(form.image_path)
      setForm((f) => ({ ...f, image_path: path, image_url: null }))
      toast.ok(`Photo added · ${readableSize(before)} → ${readableSize(compressed.size)}`)
    } catch (err) {
      toast.error(readableError(err, 'Could not upload that photo.'))
    } finally {
      setUploading(false)
    }
  }

  function updateVariant(i, patch) {
    setVariants((vs) => vs.map((v, j) => (j === i ? { ...v, ...patch } : v)))
  }

  function validate() {
    const e = {}
    if (!form.name.trim()) e.name = 'Give the item a name'
    if (!variants.length) e.variants = 'Add at least one price option'
    variants.forEach((v, i) => {
      if (!v.unit?.trim()) e[`unit${i}`] = 'Required'
      if (!Number.isInteger(v.price_paise) || v.price_paise <= 0) e[`price${i}`] = 'Enter a price'
      if (v.mrp_paise && v.mrp_paise < v.price_paise) {
        e[`mrp${i}`] = 'MRP cannot be below the selling price'
      }
    })
    setErrors(e)
    return Object.keys(e).length === 0
  }

  async function submit() {
    if (!validate()) return toast.error('Check the highlighted fields.')
    setSaving(true)
    try {
      await saveProduct({ ...form, id: isNew ? undefined : id }, variants, tenantId)
      toast.ok(isNew ? 'Item added' : 'Item updated')
      navigate('/admin/products')
    } catch (e) { toast.error(readableError(e)) }
    finally { setSaving(false) }
  }

  if (existing.loading) {
    return <><Skeleton className="h-48 rounded-xl mb-4" /><Skeleton className="h-64 rounded-xl" /></>
  }

  return (
    <>
      <div className="flex items-center gap-1 mb-4 -ml-3">
        <button onClick={() => navigate('/admin/products')} aria-label="Back"
                className="w-11 h-11 grid place-items-center text-ink">
          <Icon name="arrow_back" />
        </button>
        <h1 className="font-headline font-extrabold text-xl">{isNew ? 'New item' : 'Edit item'}</h1>
      </div>

      {/* Photo. `capture` lets a phone-only admin shoot the produce directly. */}
      <div className="mb-5">
        <p className="text-[13px] font-bold text-muted mb-1.5">Photo</p>
        <button onClick={() => fileRef.current?.click()} disabled={uploading}
                className="relative w-full aspect-square max-w-[220px] rounded-xl overflow-hidden
                           border-2 border-dashed border-line bg-surface-2 grid place-items-center
                           active:scale-[.99] transition-transform">
          {uploading ? (
            <span className="flex flex-col items-center gap-2 text-muted">
              <Spinner /><span className="text-sm font-semibold">Compressing…</span>
            </span>
          ) : form.image_path || form.image_url ? (
            <>
              <ProductImage src={imageSrc(form)} alt="Product photo" />
              <span className="absolute bottom-2 right-2 bg-black/65 text-white text-xs font-bold
                               px-2.5 py-1.5 rounded-lg flex items-center gap-1">
                <Icon name="photo_camera" className="text-[15px]" /> Change
              </span>
            </>
          ) : (
            <span className="flex flex-col items-center gap-1.5 text-faint">
              <Icon name="add_a_photo" className="text-[34px]" />
              <span className="text-sm font-semibold">Add a photo</span>
            </span>
          )}
        </button>
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp"
               capture="environment" onChange={onPickImage} className="hidden" />
        <p className="text-xs text-faint mt-2">
          Shot on your phone is fine — it is shrunk automatically before upload.
        </p>
      </div>

      <div className="flex flex-col gap-4 mb-6">
        <Field label="Item name" required error={errors.name}>
          <Input value={form.name} onChange={set('name')} invalid={!!errors.name}
                 placeholder="Tamatar (Tomato)" />
        </Field>

        <Field label="Description" hint="One line about how it is today">
          <Textarea rows={2} value={form.description} onChange={set('description')}
                    placeholder="Hybrid for curries, desi for chutney." maxLength={200} />
        </Field>

        <Field label="Category">
          <Select value={form.category_id} onChange={set('category_id')}>
            <option value="">Uncategorised</option>
            {(cats.data || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>

        <Field label="Badge" hint="Optional pill on the card — Fresh, Season's Best…">
          <Input value={form.badge} onChange={set('badge')} placeholder="Fresh" maxLength={20} />
        </Field>
      </div>

      {/* Variants */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-1">
          <h2 className="font-headline font-extrabold">Prices</h2>
          <button onClick={() => setVariants((vs) => [...vs, { ...BLANK_VARIANT }])}
                  className="text-brand font-bold text-sm min-h-[44px] px-2">+ Add option</button>
        </div>
        <p className="text-xs text-faint mb-3">
          Add one option per price. A tomato sold as “Hybrid ₹30/kg” and “Desi ₹50 for 2kg” is two options.
        </p>

        <div className="flex flex-col gap-3">
          {variants.map((v, i) => (
            <div key={v.id || i} className="bg-surface rounded-xl border border-line p-3.5">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-bold uppercase text-faint tracking-wide">
                  Option {i + 1}
                </span>
                {variants.length > 1 && (
                  <button onClick={() => setVariants((vs) => vs.filter((_, j) => j !== i))}
                          aria-label={`Remove option ${i + 1}`}
                          className="w-11 h-11 -mr-2 -my-2 grid place-items-center text-danger">
                    <Icon name="delete" className="text-[19px]" />
                  </button>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3 mb-3">
                <Field label="Label" hint={variants.length === 1 ? 'Leave as Default' : undefined}>
                  <Input value={v.label} onChange={(e) => updateVariant(i, { label: e.target.value })}
                         placeholder="Hybrid" maxLength={24} />
                </Field>
                <Field label="Unit" required error={errors[`unit${i}`]}>
                  <Input value={v.unit} onChange={(e) => updateVariant(i, { unit: e.target.value })}
                         invalid={!!errors[`unit${i}`]} placeholder="1 kg" maxLength={16} />
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field label="MRP" error={errors[`mrp${i}`]} hint="Optional">
                  <div className="relative">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 font-bold text-muted">₹</span>
                    <Input value={v.mrp_paise ? String(v.mrp_paise / 100) : ''}
                           onChange={(e) => updateVariant(i, { mrp_paise: toPaise(e.target.value) || null })}
                           invalid={!!errors[`mrp${i}`]} inputMode="decimal"
                           placeholder="500" className="pl-8" />
                  </div>
                </Field>
                <Field label="Selling price" required error={errors[`price${i}`]}>
                  <div className="relative">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 font-bold text-muted">₹</span>
                    <Input value={v.price_paise ? String(v.price_paise / 100) : ''}
                           onChange={(e) => updateVariant(i, { price_paise: toPaise(e.target.value) ?? 0 })}
                           invalid={!!errors[`price${i}`]} inputMode="decimal"
                           placeholder="320" className="pl-8" />
                  </div>
                </Field>
              </div>

              {v.mrp_paise > v.price_paise && (
                <p className="text-[13px] text-brand font-semibold -mt-1 mb-1">
                  Customers see <span className="line-through text-faint">{rupees(v.mrp_paise)}</span>{' '}
                  {rupees(v.price_paise)} · {Math.round(((v.mrp_paise - v.price_paise) / v.mrp_paise) * 100)}% off
                </p>
              )}

              <label className="flex items-center gap-3 mt-3 min-h-[44px] cursor-pointer">
                <input type="checkbox" checked={v.in_stock !== false}
                       onChange={(e) => updateVariant(i, { in_stock: e.target.checked })}
                       className="w-5 h-5 accent-[var(--c-brand)]" />
                <span className="font-semibold text-sm">In stock today</span>
              </label>
            </div>
          ))}
        </div>
      </div>

      <label className="flex items-center gap-3 mb-6 min-h-[44px] cursor-pointer">
        <input type="checkbox" checked={form.is_active}
               onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
               className="w-5 h-5 accent-[var(--c-brand)]" />
        <span className="font-semibold text-sm">Show this item in the shop</span>
      </label>

      <div className="flex flex-col gap-2.5 mb-6">
        <Button full size="lg" loading={saving} onClick={submit}>
          {isNew ? 'Add to shop' : 'Save changes'}
        </Button>
        <Button full variant="outline" onClick={() => navigate('/admin/products')}>Cancel</Button>
      </div>
    </>
  )
}
