# Deploying Sabji

Two routes are covered: **Vercel** (simpler, and what you are using) and the
**Apache server** srv1634371.hstgr.cloud, should you ever want it there instead.

> **Status: not executed.** The Apache commands are written against that
> server's real configuration, surveyed on 7 Sep 2026, but none of them have
> been run. Work through them once with a person watching.

---

## Which env file on live?

**Use `.env.production`.**

Vite loads four files, and later ones win. This ordering was verified against
Vite 8's own `loadEnv`, not assumed:

| Priority | File | Loaded in `dev` | Loaded in `build` |
|---|---|---|---|
| 4 (highest) | `.env.production.local` | no | **yes** |
| 3 | `.env.production` | no | **yes** |
| 2 | `.env.local` | **yes** | **yes** |
| 1 (lowest) | `.env` | **yes** | **yes** |

Two things follow from that table, and both matter here.

**`.env.local` is _not_ a development-only file.** It is loaded for production
builds too — the name misleads almost everyone; it means "local to this machine,
never committed". Keep it for your own machine and give the server its own
`.env.production`, so the two never quietly diverge and you can always tell
which values a given build was made from.

**`.env` also works, but is less safe.** It applies to every mode, so running
`npm run dev` on the server would pick up production credentials.
`.env.production` only ever applies to `npm run build`, which is exactly the
scope we want.

### The thing that surprises people

Vite **inlines** `VITE_*` values into the JavaScript at build time. `dist/` is
plain static files with the values already written into them.

- Editing the env file after a build changes nothing until you **rebuild**.
- There is no runtime env on the server. Apache serves files, nothing more.
- Whichever machine runs `npm run build` is the machine whose env file counts.

### What may and may not go in a `VITE_` variable

Anything prefixed `VITE_` is **public**. It ships in the bundle and any visitor
can read it. That is fine for what we use:

| Variable | Public? | Notes |
|---|---|---|
| `VITE_STORE_NAME` | fine | Just a label |
| `VITE_SUPABASE_URL` | fine | Public by design |
| `VITE_SUPABASE_ANON_KEY` | fine | Public by design; RLS is what protects the data |
| `VITE_DEV_STATIC_OTP` | set on purpose, for now | Accepts a fixed code for any number until SMS is connected |

Never give a `VITE_` prefix to a Supabase **service_role** key, a Razorpay
secret, or a JWT secret. Those belong on a server that the browser cannot read.

### The production file

```bash
# /home/sabji/app/.env.production   — on the server, chmod 600, never committed
VITE_STORE_NAME=Suvidha General Store
VITE_SUPABASE_URL=https://<your-project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<your anon key>
VITE_DEV_STATIC_OTP=123456
```

`.gitignore` now covers `.env` and `.env.*`, with `.env.example` explicitly
re-included, so no env file can be committed by accident.

---

## Deploying on Vercel

Simpler than the server route, and it sidesteps the Node problem entirely —
Vercel builds on Node 22 by default, which Vite 8 is happy with.

`vercel.json` in the repo already sets the build command, output directory, the
SPA rewrite and cache headers. Two of those matter more than they look:

- **The rewrite.** React Router owns the URLs. Vercel serves a real file when
  one exists, so `/assets/*` and `/sw.js` are untouched; everything else falls
  through to `index.html`. Without it, a reload on `/admin` returns 404.
- **`sw.js` and `index.html` must not be cached.** They are what tells a phone a
  new build exists. Cache them and users stay on an old version after every deploy.

### Environment variables

Add these in **Project → Settings → Environment Variables**, for Production
(and Preview, if you want preview deploys to work):

| Name | Value |
|---|---|
| `VITE_STORE_NAME` | `Suvidha General Store` |
| `VITE_SUPABASE_URL` | your project URL |
| `VITE_SUPABASE_ANON_KEY` | your anon key |
| `VITE_DEV_STATIC_OTP` | `123456` |

**Vercel will warn: _"Remove the public framework prefix to keep this value
private."_ Do not act on the first half of that.**

Vite only exposes variables beginning with `VITE_` to browser code — that is the
entire mechanism. Drop the prefix and `import.meta.env.VITE_SUPABASE_URL`
becomes `undefined` and the app renders its setup screen instead of the shop.
There is no server side here to hold a private value; this is a static bundle,
so everything it needs must reach the browser.

The second half of the warning is right: these are **configuration, not
secrets**, so classify them as such. The Supabase URL is just your project's
address, and the anon key is public by design — it identifies the project, not a
user, and row-level security is what protects the data.

The key that must **never** carry a `VITE_` prefix is Supabase's
**`service_role`** key. That one bypasses RLS completely.

Changing a variable does not affect the running site until you **redeploy** —
values are inlined at build time.

### After the first deploy

In Supabase, **Authentication → URL Configuration**, set the Site URL to your
Vercel domain and add `https://<your-domain>/**` to the redirect URLs. Sign-in
misbehaves in confusing ways if you skip this.

To use `sabji.aeologic.in` instead of the `.vercel.app` domain, add it under
**Project → Settings → Domains** and point a CNAME at Vercel — *not* the A
record to `187.127.159.226` described below, which is for the Apache route.

---

## Deploying to the Apache server instead

Only needed if you are **not** using Vercel. Two prerequisites that cannot be
done from the server itself.

### 1. DNS — `sabji.aeologic.in` does not exist yet

```
$ dig +short A sabji.aeologic.in     # → nothing
$ dig +short A crm.aeologic.in       # → 187.127.159.226
```

Add this at whoever hosts DNS for `aeologic.in`:

| Type | Name | Value | TTL |
|---|---|---|---|
| A | `sabji` | `187.127.159.226` | 300 |

Wait for it to resolve before going further. Certbot validates over HTTP, so
**without this record the certificate step will fail.**

```bash
dig +short A sabji.aeologic.in       # must return 187.127.159.226
```

### 2. Node — the server's version is too old to build this

```
server:  Node v18.20.8
Vite 8:  requires ^20.19.0 || >=22.12.0
```

`npm run build` **will fail** on the server as it stands. Step 3 installs Node
22 alongside, which does not disturb the existing Node 18 that other sites on
this box may rely on.

### 3. Sign-in

The live site runs with `VITE_DEV_STATIC_OTP=123456` for now, so any number plus
that code signs in. Supabase needs **Authentication → Providers → Anonymous
sign-ins = ON** for this to work.

Swap to real phone OTP later by connecting an SMS provider (Twilio, MessageBird,
Vonage or TextLocal) in Supabase and dropping the variable from
`.env.production`, then rebuilding. No code change is needed — the app already
calls `signInWithOtp` whenever the variable is absent.

---

## Deployment

### Step 1 — Create the site user

Follows the house convention on this box: one Linux user per site.

```bash
ssh aeo@srv1634371.hstgr.cloud
```

```bash
sudo adduser --disabled-password --gecos "" sabji
sudo mkdir -p /home/sabji/app /home/sabji/logs
sudo chown -R sabji:sabji /home/sabji
```

`--disabled-password` means no one signs in as `sabji` directly; you reach it
with `sudo -u sabji`. There is no reason for this account to have a password.

### Step 2 — Give the server access to the repo

The repo is private, so the server needs its own read-only key.

```bash
sudo -u sabji ssh-keygen -t ed25519 -C "srv1634371-sabji-deploy" \
  -f /home/sabji/.ssh/id_ed25519 -N ""
sudo -u sabji cat /home/sabji/.ssh/id_ed25519.pub
```

Add that public key to the repository on GitHub as a **deploy key**
(*Settings → Deploy keys → Add deploy key*), leaving *Allow write access*
**unchecked**. A deploy key is scoped to this one repo; a personal key would
give the server access to everything you can reach.

```bash
sudo -u sabji ssh -o StrictHostKeyChecking=accept-new -T git@github.com
# expect: "Hi yashtomer/sabji! You've successfully authenticated..."
```

### Step 3 — Install Node 22

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v        # v22.x
```

This replaces the system `node`. If another site on this server depends on Node
18, use `nvm` under the `sabji` user instead and leave the system one alone:

```bash
sudo -u sabji bash -lc '
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
  export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"
  nvm install 22 && nvm alias default 22 && node -v
'
```

**Check what else runs on this box before replacing the system Node.**

### Step 4 — Clone and configure

```bash
sudo -u sabji git clone git@github.com:yashtomer/sabji.git /home/sabji/app
cd /home/sabji/app
sudo -u sabji git checkout <the branch you are deploying>
```

> The default branch is the original static mockup, and `main` holds a
> different Next.js implementation. Check out the branch you actually mean.

```bash
sudo -u sabji tee /home/sabji/app/.env.production >/dev/null <<'ENV'
VITE_STORE_NAME=Suvidha General Store
VITE_SUPABASE_URL=https://<your-project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<your anon key>
VITE_DEV_STATIC_OTP=123456
ENV
sudo chmod 600 /home/sabji/app/.env.production
sudo chown sabji:sabji /home/sabji/app/.env.production
```

Copy the values from your local `.env.local`. Write the file rather than
copying it across, so you can see exactly what the server ends up with.

### Step 5 — Build

```bash
cd /home/sabji/app
sudo -u sabji npm ci
sudo -u sabji npm run build
ls -la /home/sabji/app/dist        # index.html, assets/, sw.js, manifest
```

`npm ci` installs exactly what `package-lock.json` pins, unlike `npm install`
which may quietly resolve something newer. Use `ci` on servers, always.

### Step 6 — Apache vhost

```bash
sudo tee /etc/apache2/sites-available/sabji.aeologic.in.conf >/dev/null <<'CONF'
<VirtualHost *:80>
    ServerName sabji.aeologic.in
    ServerAdmin support@aeologic.in
    DocumentRoot /home/sabji/app/dist

    <Directory /home/sabji/app/dist>
        Options -Indexes +FollowSymLinks
        AllowOverride None
        Require all granted

        # Single-page app: React Router owns the URLs. Without this, a reload
        # on /admin or /orders asks Apache for a file that does not exist and
        # returns 404. Real files are served as-is; everything else gets
        # index.html and the router takes over.
        RewriteEngine On
        RewriteCond %{REQUEST_FILENAME} -f [OR]
        RewriteCond %{REQUEST_FILENAME} -d
        RewriteRule ^ - [L]
        RewriteRule ^ /index.html [L]
    </Directory>

    # Fingerprinted assets never change under the same name — cache them hard.
    <FilesMatch "\.(js|css|woff2|png|svg|webp)$">
        Header set Cache-Control "public, max-age=31536000, immutable"
    </FilesMatch>

    # These three decide when a phone picks up a new version. If they are
    # cached, users stay stuck on an old build after every deploy.
    <FilesMatch "^(index\.html|sw\.js|manifest\.webmanifest)$">
        Header set Cache-Control "no-cache, must-revalidate"
    </FilesMatch>

    ErrorLog  ${APACHE_LOG_DIR}/sabji.aeologic.in-error.log
    CustomLog ${APACHE_LOG_DIR}/sabji.aeologic.in-access.log combined
</VirtualHost>
CONF

sudo a2enmod rewrite headers
sudo a2ensite sabji.aeologic.in
sudo apache2ctl configtest        # must say "Syntax OK"
sudo systemctl reload apache2
```

Apache must be able to traverse into the home directory:

```bash
sudo chmod 755 /home/sabji
sudo -u www-data test -r /home/sabji/app/dist/index.html \
  && echo "apache can read the build" || echo "PERMISSION PROBLEM"
```

Check over plain HTTP before adding TLS:

```bash
curl -I http://sabji.aeologic.in            # expect 200
curl -s http://sabji.aeologic.in/admin | head -5    # expect index.html, not 404
```

### Step 7 — HTTPS

```bash
sudo certbot --apache -d sabji.aeologic.in
```

Choose **redirect** when prompted, so `http://` sends visitors to `https://`.
Certbot writes a second vhost with the certificate and installs the redirect.

```bash
sudo certbot renew --dry-run       # proves auto-renewal will work
curl -I https://sabji.aeologic.in  # expect 200
```

### Step 8 — Tell Supabase about the new origin

In the Supabase dashboard, **Authentication → URL Configuration**:

- Site URL: `https://sabji.aeologic.in`
- Redirect URLs: add `https://sabji.aeologic.in/**`

Sign-in will misbehave in ways that are annoying to debug if you skip this.

### Step 9 — Run the migrations

If this Supabase project has not had them applied, run every file in
`supabase/migrations/` **in numeric order** in the SQL editor, then `seed.sql`.
See the main [README](README.md) for what each one does.

If the project is shared with another app, read the warning at the end of this
document first.

---

## Deploying an update

```bash
sudo -u sabji tee /home/sabji/deploy.sh >/dev/null <<'SH'
#!/bin/bash
set -euo pipefail
cd /home/sabji/app

echo "==> pulling"
git pull --ff-only

echo "==> installing"
npm ci

echo "==> building"
npm run build

echo "==> done: $(git log --oneline -1)"
SH
sudo chmod +x /home/sabji/deploy.sh
sudo chown sabji:sabji /home/sabji/deploy.sh
```

```bash
sudo -u sabji /home/sabji/deploy.sh
```

The build writes into `dist/` in place. Apache picks it up immediately — no
reload needed, because it is only serving files.

`--ff-only` makes the pull fail loudly rather than creating a merge commit on
the server if someone has edited files there.

### Zero-downtime, if you want it

Building in place leaves `dist/` briefly incomplete. For a shop that matters,
build to a new directory and swap a symlink:

```bash
DocumentRoot /home/sabji/current/dist        # in the vhost
```

```bash
REL=/home/sabji/releases/$(date +%Y%m%d-%H%M%S)
git clone -b <branch> /home/sabji/app "$REL"
cp /home/sabji/app/.env.production "$REL/"
cd "$REL" && npm ci && npm run build
ln -sfn "$REL" /home/sabji/current           # atomic swap
```

Rolling back is then re-pointing the symlink at the previous release.

---

## Verifying a deploy

```bash
curl -I https://sabji.aeologic.in                       # 200, valid cert
curl -s https://sabji.aeologic.in/admin | head -3       # index.html, not 404
curl -sI https://sabji.aeologic.in/sw.js | grep -i cache-control   # no-cache
curl -sI https://sabji.aeologic.in/assets/*.js | grep -i cache-control  # immutable
```

Then on a phone:

1. Load the site, confirm the catalogue appears and images load.
2. Search, open a product, add to cart — the cart badge should count up.
3. "Add to home screen" should be offered; the installed icon should be the leaf.
4. Reload while on `/orders` — it must not 404. That is the SPA rewrite working.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `npm run build` fails on `engine` | Server is on Node 18 | Step 3 |
| Blank page, console shows a Supabase error | Env missing at build time | Check `.env.production` exists, rebuild |
| Setup screen instead of the shop | `VITE_SUPABASE_*` still placeholders | Fill in real values, **rebuild** |
| 404 on reload at `/admin` | SPA rewrite missing | `a2enmod rewrite`, check the `<Directory>` block |
| Changes not showing after deploy | `index.html` or `sw.js` cached | Confirm the `no-cache` `FilesMatch` |
| Certbot fails | DNS not resolving | `dig +short A sabji.aeologic.in` |
| 403 Forbidden | Apache cannot traverse `/home/sabji` | `sudo chmod 755 /home/sabji` |
| Sign-in fails on live but works locally | Supabase Site URL not set | Step 8 |
| Stale version on a phone | Old service worker | The in-app update prompt handles it; hard-reload to force |

---

## One warning

**The shared Supabase project.** The `main` branch of this repo holds a
different Next.js application with its own schema, and both define `products`,
`orders` and `order_items` with different shapes. If both apps point at one
Supabase project they will corrupt each other's data. Give each application its
own project, or settle on one application first.
