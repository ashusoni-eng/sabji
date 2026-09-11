# Sabji

A mobile-first PWA for a neighbourhood fruit and vegetable shop. Customers browse,
order and track; the shop owner manages the catalogue and fulfils orders from the
same phone. Cash on delivery, phone-OTP sign-in.

**Stack** — React 19 · Vite 8 · Tailwind v4 · Supabase (Postgres, Auth, Storage,
Realtime) · vite-plugin-pwa.

---

**Deploying to a server?** See **[DEPLOYMENT.md](DEPLOYMENT.md)** — which env
file to use, DNS, Apache, HTTPS, and the update procedure.

## Setup

### 1. Create a Supabase project

Sign up at [supabase.com](https://supabase.com) and create a project (the free
tier is enough for a single shop).

### 2. Run the migrations

In the Supabase dashboard → **SQL Editor**, run these files **in order**:

| File | What it does |
|---|---|
| `supabase/migrations/001_schema.sql` | Tables, enums, triggers |
| `supabase/migrations/002_rls.sql` | Row-level security — the actual authorisation model |
| `supabase/migrations/003_functions.sql` | `place_order`, status transitions, daily summary |
| `supabase/migrations/004_storage.sql` | Product-image bucket and its policies |
| `supabase/migrations/005_dev_phone_login.sql` | Lets the profile trigger read the phone from user metadata |
| `supabase/migrations/006_place_order_race.sql` | Makes `place_order` idempotent under concurrent duplicate submits |
| `supabase/migrations/007_admin_hardening.sql` | Stops customers granting themselves admin; adds the admin allowlist |
| `supabase/migrations/008_roles_mrp_promos.sql` | Staff roles, variant MRP, promo tables, branding + support columns |
| `supabase/migrations/009_promo_and_delivery_functions.sql` | Promo validation and `place_order` with discounts |
| `supabase/migrations/010_delivery_workflow.sql` | Rider assignment, auto-select, and the rider's scoped view |
| `supabase/migrations/011_staff_admin_rpc.sql` | Admin-only staff management |
| `supabase/migrations/012_fix_promo_functions.sql` | Fixes checkout and promo validation; drops stale function overloads |
| `supabase/migrations/013_fix_role_escalation.sql` | Closes a phone-based privilege escalation; makes staff removal stick |
| `supabase/seed.sql` | The 15 starter products with their variants |

### 3. Point the app at it

```bash
cp .env.example .env.local
```

Fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from
**Project Settings → API**. The anon key is meant to be public — row-level
security is what protects the data, not the key.

**Which env file, and when.** Vite loads four, and later ones win:
`.env.production.local` > `.env.production` > `.env.local` > `.env`.

Use `.env.local` on your own machine and `.env.production` on a server. The trap
is that **`.env.local` is loaded for production builds too** — it is not a
dev-only file, despite the name — so never copy it to a server: ours carries
`VITE_DEV_STATIC_OTP`, which would ship a sign-in bypass. Values are inlined at
**build** time, so editing an env file does nothing until you rebuild.

### 4. Sign-in

**While developing (no SMS provider needed).** `.env.local` ships with:

```
VITE_DEV_STATIC_OTP=123456
```

Any 10-digit number plus the code `123456` signs you in. There is nothing in the
UI announcing this — the login screen looks exactly as it will in production.

Requires **Authentication → Providers → Anonymous sign-ins = ON**.

This is not a fake session. Sign-in goes through Supabase anonymous auth, so you
get a real user and a real JWT, and RLS, `place_order()` and the admin check all
run the production path. Only the proof that you own the number is skipped; the
number itself is still written to your profile, so promoting an admin by phone
works normally.

One caveat: anonymous auth mints a **new user on every sign-in**, so one phone
number accumulates several profiles — a second device or cleared storage makes
another. Everything a person owns keys off the phone rather than the user id
(migrations 016 and 018): roles, deliveries, addresses, order history and
promo usage all follow the number, so the duplicates are invisible in use.

Real phone OTP removes the duplicates entirely: Supabase reuses the user for a
given number.

**Going live.** Unset `VITE_DEV_STATIC_OTP`, then **Authentication → Providers →
Phone**, enable it and connect an SMS provider (Twilio, MessageBird, Vonage or
TextLocal). That is a paid third-party service, and until it is configured
nobody can sign in — including you. The app needs no code change; it already
calls `signInWithOtp` whenever the dev variable is absent.

Leaving `VITE_DEV_STATIC_OTP` set in a production build lets anyone sign in as
anyone. The app logs a console warning if it detects this, but nothing stops it.

### 5. Make yourself the admin

Roles are granted to a **phone number**, not to a user row — so someone keeps
their role when they sign in again on another device or after clearing storage.

1. Sign in through the app once with the number you want to be the admin.
2. Run this in the SQL editor, with your own number:

```sql
insert into public.staff_phones (phone, role, name)
values ('+919876543210', 'admin', 'Shop owner')
on conflict (phone) do update set role = 'admin';

-- no-op write that fires the trigger and applies the role to the existing account
update public.profiles set phone = phone where phone = '+919876543210';
```

After that first admin exists, add everyone else — including delivery riders —
from **Admin → Staff** instead of the SQL editor.

3. Reload the app. An **Admin** tab replaces Profile in the bottom nav.

Note the `+91`. The app stores numbers in E.164, so the row must match exactly.

To check it worked:

```sql
select p.phone, p.is_admin from public.profiles p where p.phone = '+919876543210';
```

To revoke: delete the row from `admin_phones`, then
`update public.profiles set is_admin = false where phone = '+919876543210';`

### 6. Run it

```bash
npm install
npm run dev
```

---

## Commands

```bash
npm run dev       # dev server on :5173, uses .env.local
npm run build     # production build into dist/
npm run preview   # serve the built app (the only way to test the service worker)
npm run lint      # eslint
```

The service worker is disabled in dev on purpose. To test offline behaviour and
the install prompt, use `npm run build && npm run preview`.

---

## How it is put together

```
src/
├── lib/          supabase client, money & phone formatting, image compression
├── services/     every database call — catalog, orders, addresses, admin
├── context/      auth, cart, toasts  (contexts.js holds the hooks)
├── hooks/        useAsync — the loading/error/retry shape every screen shares
├── components/   ui/ primitives · layout/ shell · product/ cards
└── screens/      customer screens, and admin/ for the shop owner
supabase/
├── migrations/   schema, RLS, functions, storage
└── seed.sql      starter catalogue
```

### Addresses

Stored as separate fields rather than "address line 1 / 2", because a rider
needs them separately: **House / Flat No.**, **Building Name**, **Colony /
Society Name**, **Landmark**, **City**, **Pin code**. House, colony, city and
pin code are required; building and landmark are optional.

`line1` / `line2` still exist and are kept in step by a trigger, so anything
reading them keeps working and older orders stay readable. Display goes through
`formatAddress()` / `addressLines()` in `src/lib/format.js`, which accept an
address row or an order's `ship_*` snapshot and fall back to the old lines.

### Three decisions worth knowing about

**Money is integer paise, everywhere.** It becomes a rupee string exactly once,
in `rupees()` at display time. Nothing adds or compares rupees as floats.

**Products have variants, not a price.** Sabji pricing is genuinely
multi-priced — "Hybrid ₹30/kg" and "Desi ₹50 for 2 kg" are the same tomato. Every
product owns one or more `product_variants`; a simple product just has one.

**Orders snapshot what was bought.** `order_items` copies the product name,
variant, unit *and* unit price at checkout, and the delivery address is copied
onto the order too. Vegetable prices move daily — joining to the live catalogue
would silently re-price completed orders every time you update a price.

### Is it safe that the anon key is public?

Yes — but only because RLS is doing the work, so it is worth knowing what that
key actually grants. It ships in the JavaScript bundle, so treat it as though
it were printed on the homepage. Probed against a live project with nothing but
that key and no session:

| | |
|---|---|
| Catalogue, categories, variants, shop settings | **readable** — intended, this is the shop |
| Orders, order items, status history | blocked |
| Profiles, addresses | blocked |
| Staff list, promo codes, redemptions | blocked |
| Change a price, rename or hide a product | blocked |
| Insert an order, category or promo directly | blocked (`42501`) |
| Grant yourself admin, add yourself to staff | blocked (`42501`) |
| Change the delivery fee, delete orders | blocked |

The key identifies the *project*, not a user. It carries no privileges of its
own — every one of those outcomes comes from a policy, which is why the
migrations matter more than the key does.

The key that must never be exposed is Supabase's **`service_role`**, which
bypasses RLS entirely. It is not used anywhere in this app.

### A note on roles and the phone column

A profile's `phone` is **not writable by the client**. Roles are matched against
that column, so while it was writable a customer could set their own phone to
the shop owner's number and inherit admin. The number is now written only by
`sync_my_phone()`, which copies it from `auth.users` — the value the OTP
verified. Customers can update `full_name` and nothing else.

For API-driven writes, `staff_phones` is the **only** source of a role. That is
what makes removing someone from Staff actually take their access away.

### A note on `is_admin`

`is_admin` is **not writable through the API**. Migration 007 revokes
column-level UPDATE on it, so a customer can only change their own name and
phone. Before that migration, any signed-in customer could PATCH
`is_admin: true` onto their own profile and take over the shop — row-level
security filters rows, not columns, which is easy to get wrong. If you ever add
another privileged column to `profiles`, keep it out of the `grant update (...)`
list in 007.

### Where the rules are enforced

Everything that matters happens in the database, not the client:

- **Order totals** are computed by `place_order()` from database prices. The
  client sends variant ids and quantities only — never an amount.
- **Double taps** are absorbed by an idempotency key. Re-sending the same key
  returns the original order rather than creating a second one.
- **Status transitions** are validated in `set_order_status()`; an order cannot
  jump from `placed` straight to `delivered`.
- **Admin access** is `is_admin()` inside RLS policies. Hiding the admin tab in
  React hides a button; the policies are what stop a customer editing prices.

---

## Deploying

Any static host works — the app is a SPA plus a service worker.

```bash
npm run build        # -> dist/
```

On Vercel or Netlify, point the project at this repo, set the build command to
`npm run build`, the output directory to `dist`, and add `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY` as environment variables. Both hosts handle SPA
rewrites automatically for Vite projects.

After the first deploy, add your production origin to Supabase under
**Authentication → URL Configuration**.

---

## Roles

| Role | Sees |
|---|---|
| Customer | The shop, their own cart, orders and addresses |
| Delivery | Only orders assigned to them, and only once out for delivery |
| Admin | Everything, plus items, promos, staff and settings |

A rider's only power is marking their own assigned delivery as delivered. This
is enforced in `set_order_status()` and by RLS, not just by hiding buttons.

**Assigning a delivery.** When an order moves to *out for delivery* the shop
picks a rider. With exactly one rider on the books there is nothing to choose,
so the server assigns them and no picker is shown.

## Payment

Cash on delivery, plus optional UPI. The shop uploads a payment QR under
**Admin → More → Online payment** and switches it on; customers then get a
"Pay online" choice at checkout, scan the QR in their own UPI app, enter what
they sent, and mark it paid.

**Nothing here verifies that money arrived.** There is no gateway and no
webhook, so what the customer taps is a *claim*. The order carries that
distinction explicitly:

| `payment_status` | Means |
|---|---|
| `pending` | Cash on delivery |
| `claimed` | The customer says they paid — amount, time, optional UPI reference |
| `confirmed` | The shop checked their own UPI app and agreed |

The admin badge shows **Paid · unverified** for a claim and **Paid** only once
confirmed, and the order screen flags a mismatch ("Short by ₹20") when the
amount sent does not match the total. Riders see prepaid orders as *already
paid* with nothing to collect.

Removing the QR also switches online payment off, so checkout can never offer a
method the shop has no way to receive.

## Promo codes

Created under **Admin → Promos**: percentage or flat discount, optional cap,
minimum order, date range, and a total redemption limit. Codes are always
**once per customer** — that is deliberate and not exposed as an option, because
a code one person can spend repeatedly is almost never what a shop wants.

Discounts are recalculated inside `place_order()`. The checkout preview is only
a preview; a customer cannot get a discount by lying to the client.

Free-delivery and minimum-order thresholds use the **pre-discount** subtotal, so
a promo cannot also buy free delivery as a side effect.

## Branding

`VITE_STORE_NAME` sets the shop name. It is fixed at build time because it goes
into the PWA manifest and the install prompt, which cannot change at runtime.

The logo and the home banner ARE editable, under **Admin → More → Branding**. The
home page shows the banner image if there is one, otherwise the banner text,
otherwise nothing at all — the customer lands straight on search.

## Not built yet

Deliberate omissions, in rough priority order:

- **Online payment.** Cash on delivery only. Razorpay would need a serverless
  function for webhook signature verification.
- **New-order push notification.** The admin order list updates live over
  Supabase Realtime and vibrates on a new order, but only while the app is open.
  Real web push needs a VAPID key pair and a push service.
- **Stock counts.** Variants have an in-stock/out-of-stock flag, not a quantity.
- **Rider live location.** The shop sees who is carrying an order, not where they are.
- **Delivery radius.** Any pincode is accepted at checkout.
- **Tests.** No test runner is configured. `place_order` and the cart totals are
  the two things most worth covering first.
- **Phone-verified identity in dev.** See step 4 — the dev bypass trusts the
  number you type. Real ownership is only proven once SMS is connected.
