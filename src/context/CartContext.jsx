import { useReducer, useEffect, useMemo, useCallback } from 'react'
import { revalidateVariants } from '../services/catalog'
import { CartContext } from './contexts'


const KEY = 'sabji.cart.v1'

/**
 * A cart line stores the variant id, the quantity, and a DISPLAY-ONLY copy of
 * the name and price. The copy is what lets the cart render instantly and work
 * offline; it is never what the customer is charged. The server re-prices every
 * line in place_order(), and revalidate() below refreshes the copy before checkout.
 */
function reducer(state, action) {
  switch (action.type) {
    case 'hydrate':
      return action.lines

    case 'add': {
      const { variantId } = action.line
      const found = state.find((l) => l.variantId === variantId)
      if (found) {
        return state.map((l) =>
          l.variantId === variantId ? { ...l, qty: Math.min(l.qty + action.qty, 99) } : l)
      }
      return [...state, { ...action.line, qty: Math.min(action.qty, 99) }]
    }

    case 'adjustQty': {
      // Resolved here, where the current quantity is authoritative.
      return state.flatMap((l) => {
        if (l.variantId !== action.variantId) return [l]
        const next = l.qty + action.delta
        return next <= 0 ? [] : [{ ...l, qty: Math.min(next, 99) }]
      })
    }

    case 'setQty': {
      if (action.qty <= 0) return state.filter((l) => l.variantId !== action.variantId)
      return state.map((l) =>
        l.variantId === action.variantId ? { ...l, qty: Math.min(action.qty, 99) } : l)
    }

    case 'remove':
      return state.filter((l) => l.variantId !== action.variantId)

    case 'sync':
      // Drop lines that vanished, refresh price/stock on the ones that remain.
      return state
        .map((l) => {
          const live = action.live[l.variantId]
          if (!live || !live.product?.is_active) return null
          return {
            ...l,
            productName: live.product.name,
            variantLabel: live.label,
            unit: live.unit,
            pricePaise: live.price_paise,
            inStock: live.in_stock,
            imagePath: live.product.image_path,
            imageUrl: live.product.image_url,
          }
        })
        .filter(Boolean)

    case 'clear':
      return []

    default:
      return state
  }
}

function load() {
  try {
    const raw = localStorage.getItem(KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []   // private mode, cleared storage, corrupt JSON — start empty
  }
}

export function CartProvider({ children }) {
  const [lines, dispatch] = useReducer(reducer, [], load)

  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(lines)) } catch { /* storage blocked */ }
  }, [lines])

  const add = useCallback((product, variant, qty = 1) => {
    dispatch({
      type: 'add',
      qty,
      line: {
        variantId: variant.id,
        productId: product.id,
        productName: product.name,
        variantLabel: variant.label,
        unit: variant.unit,
        pricePaise: variant.price_paise,
        inStock: variant.in_stock,
        imagePath: product.image_path,
        imageUrl: product.image_url,
      },
    })
  }, [])

  const setQty  = useCallback((variantId, qty) => dispatch({ type: 'setQty', variantId, qty }), [])
  const adjust  = useCallback((variantId, delta) => dispatch({ type: 'adjustQty', variantId, delta }), [])
  const remove  = useCallback((variantId) => dispatch({ type: 'remove', variantId }), [])
  const clear   = useCallback(() => dispatch({ type: 'clear' }), [])

  /** Refresh prices and stock against the database. Call before showing checkout. */
  const revalidate = useCallback(async () => {
    const ids = lines.map((l) => l.variantId)
    if (!ids.length) return { changed: false, removed: 0 }
    const live = await revalidateVariants(ids)
    const removed = ids.filter((id) => !live[id] || !live[id].product?.is_active).length
    const changed = lines.some((l) => live[l.variantId] && live[l.variantId].price_paise !== l.pricePaise)
    dispatch({ type: 'sync', live })
    return { changed, removed }
  }, [lines])

  const value = useMemo(() => {
    const count = lines.reduce((n, l) => n + l.qty, 0)
    const subtotalPaise = lines.reduce((n, l) => n + l.pricePaise * l.qty, 0)
    const hasOutOfStock = lines.some((l) => l.inStock === false)
    return {
      lines, count, subtotalPaise, hasOutOfStock,
      add, setQty, adjust, remove, clear, revalidate,
      qtyOf: (variantId) => lines.find((l) => l.variantId === variantId)?.qty ?? 0,
    }
  }, [lines, add, setQty, adjust, remove, clear, revalidate])

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}
