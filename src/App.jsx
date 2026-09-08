import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { isConfigured } from './lib/supabase'
import { AuthProvider } from './context/AuthContext'
import { useAuth } from './context/contexts'
import { CartProvider } from './context/CartContext'
import { StoreProvider } from './context/StoreContext'
import { ToastProvider } from './context/ToastContext'
import { OfflineBanner } from './components/layout/OfflineBanner'
import { Spinner } from './components/ui'
import SetupNotice from './components/SetupNotice'
import UpdatePrompt from './components/UpdatePrompt'

import Shop from './screens/Shop'
import Cart from './screens/Cart'

// Everything past the shop and cart is split out, so the first paint on a
// phone downloads only what the shop screen actually needs.
const Categories       = lazy(() => import('./screens/Categories'))
const CategoryProducts = lazy(() => import('./screens/CategoryProducts'))
const ProductDetail    = lazy(() => import('./screens/ProductDetail'))
const Checkout         = lazy(() => import('./screens/Checkout'))
const OrderPlaced      = lazy(() => import('./screens/OrderPlaced'))
const Orders           = lazy(() => import('./screens/Orders'))
const OrderDetail      = lazy(() => import('./screens/OrderDetail'))
const Profile          = lazy(() => import('./screens/Profile'))
const Addresses        = lazy(() => import('./screens/Addresses'))
const Login            = lazy(() => import('./screens/Login'))

const AdminLayout      = lazy(() => import('./screens/admin/AdminLayout'))
const AdminOrders      = lazy(() => import('./screens/admin/AdminOrders'))
const AdminOrderDetail = lazy(() => import('./screens/admin/AdminOrderDetail'))
const AdminProducts    = lazy(() => import('./screens/admin/AdminProducts'))
const AdminProductEdit = lazy(() => import('./screens/admin/AdminProductEdit'))
const AdminCategories  = lazy(() => import('./screens/admin/AdminCategories'))
const AdminSettings    = lazy(() => import('./screens/admin/AdminSettings'))
const AdminPromos      = lazy(() => import('./screens/admin/AdminPromos'))
const AdminStaff       = lazy(() => import('./screens/admin/AdminStaff'))

const MyDeliveries     = lazy(() => import('./screens/delivery/MyDeliveries'))
const DeliveryDetail   = lazy(() => import('./screens/delivery/DeliveryDetail'))

function Loading() {
  return <div className="min-h-dvh grid place-items-center text-brand"><Spinner size={28} /></div>
}

/** Sends signed-out customers to login, then back to where they were going. */
function RequireAuth({ children, next }) {
  const { user, loading } = useAuth()
  if (loading) return <Loading />
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />
  return children
}

export default function App() {
  if (!isConfigured) return <SetupNotice />

  return (
    <Providers>
      <BrowserRouter>
        <OfflineBanner />
        <UpdatePrompt />
        <Suspense fallback={<Loading />}>
          <Routes>
            <Route path="/"                  element={<Shop />} />
            <Route path="/categories"        element={<Categories />} />
            <Route path="/category/:slug"    element={<CategoryProducts />} />
            <Route path="/product/:id"       element={<ProductDetail />} />
            <Route path="/cart"              element={<Cart />} />
            <Route path="/login"             element={<Login />} />

            <Route path="/checkout" element={
              <RequireAuth next="/checkout"><Checkout /></RequireAuth>} />
            <Route path="/order-placed/:id" element={
              <RequireAuth next="/orders"><OrderPlaced /></RequireAuth>} />
            <Route path="/orders"            element={<Orders />} />
            <Route path="/orders/:id" element={
              <RequireAuth next="/orders"><OrderDetail /></RequireAuth>} />
            <Route path="/profile"           element={<Profile />} />
            <Route path="/addresses" element={
              <RequireAuth next="/addresses"><Addresses /></RequireAuth>} />

            {/* Admin. AdminLayout re-checks is_admin, and RLS enforces it server-side. */}
            <Route path="/admin" element={<AdminLayout />}>
              <Route index                 element={<AdminOrders />} />
              <Route path="orders/:id"     element={<AdminOrderDetail />} />
              <Route path="products"       element={<AdminProducts />} />
              <Route path="products/:id"   element={<AdminProductEdit />} />
              <Route path="categories"     element={<AdminCategories />} />
              <Route path="promos"         element={<AdminPromos />} />
              <Route path="staff"          element={<AdminStaff />} />
              <Route path="settings"       element={<AdminSettings />} />
            </Route>

            {/* Delivery riders. RLS scopes what they can read; these routes
                only decide what they are shown. */}
            <Route path="/deliveries"     element={<MyDeliveries />} />
            <Route path="/deliveries/:id" element={
              <RequireAuth next="/deliveries"><DeliveryDetail /></RequireAuth>} />

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </Providers>
  )
}

function Providers({ children }) {
  return (
    <AuthProvider>
      <StoreProvider>
        <CartProvider>
          <ToastProvider>{children}</ToastProvider>
        </CartProvider>
      </StoreProvider>
    </AuthProvider>
  )
}
