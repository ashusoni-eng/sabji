import { createContext, useContext } from 'react'

/**
 * Contexts and their hooks live here, apart from the provider components, so
 * each provider file exports only components and Fast Refresh keeps working.
 */
export const AuthContext = createContext(null)
export const CartContext = createContext(null)
export const ToastContext = createContext(null)
export const StoreContext = createContext(null)

export const useAuth = () => useContext(AuthContext)
export const useCart = () => useContext(CartContext)
export const useToast = () => useContext(ToastContext)
export const useStore = () => useContext(StoreContext)
