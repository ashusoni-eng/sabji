# WhatsApp ordering bot

A Supabase Edge Function that lets customers order over WhatsApp — by typing or
by sending a voice note — with Gemini matching what they said to the shop's
catalogue. One bot number serves every shop on the platform; a customer reaches
a specific shop by scanning that shop's QR code.

## How a customer uses it

1. Scans the shop's QR (Admin → More → *Order on WhatsApp*). It opens WhatsApp
   with **"Hello SGS47400101"** already typed.
2. Sends it. The bot maps their number to the shop and greets them.
3. Sends what they need — _"2 kg aloo, 1 kg tamatar, 1 dozen kela"_ — typed, or
   as a voice note in Hindi, English or a mix.
4. Gets back an itemised list with today's prices, a subtotal, anything it could
   not find, and three buttons: **Place order · Add more · Clear**.
5. On *Place order*, the bot asks where to deliver:
   - no saved address → type or say it; the bot reads it back for confirmation
   - one saved address → *deliver here?* / *new address*
   - several → a list to pick from
6. The order is placed as cash on delivery and appears in the shop's admin with
   a **WhatsApp** badge, like any other order.

Every reply starts with the shop's name in bold, so someone who buys from two
shops through this number always knows which one is talking. If a number is
mapped to several shops and no shop is active, the bot asks which.

`cancel` clears the cart. `change shop` switches, if they are mapped to more
than one.

## Files

| File | |
|---|---|
| `index.ts` | Deno entry: the Meta verification handshake and the receive endpoint |
| `bot.ts` | The conversation state machine. Pure logic; talks to the world only through `deps` |
| `gemini.ts` | Item matching and address parsing, both with a JSON schema so nothing is parsed from prose |
| `graph.ts` | Meta Cloud API: text, reply buttons, list pickers, media download; `parseWebhook` |
| `db.ts` | The bot's database access via the service role |
| `test/` | The whole conversation driven under Node against fakes — 11 scenarios |

```bash
cd supabase/functions/whatsapp-webhook
node --test --experimental-strip-types test/conversation.test.ts
```

## Setup

### 1. Migrations

Run `019_tenants.sql`, `020_tenant_functions.sql` and `021_whatsapp.sql` in
order. They add tenants, the WhatsApp tables, and give `place_order` a
service-role path so the bot can order on a customer's behalf.

### 2. Secrets

`supabase/.secrets.local.sh` (gitignored) holds the ready-to-run command with
this project's values already filled in. Run it once the two placeholders are
replaced:

```bash
bash supabase/.secrets.local.sh
```

| Secret | This project |
|---|---|
| `WHATSAPP_PHONE_NUMBER_ID` | `989707754228556` |
| `WHATSAPP_WABA_ID` | `936090002100629` |
| `WHATSAPP_VERIFY_TOKEN` | generated, in the script |
| `WHATSAPP_ACCESS_TOKEN` | **needs a permanent token — see below** |
| `GEMINI_API_KEY` | set, verified live |
| `GEMINI_MODEL` | `gemini-2.5-flash` |

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically.

These are real secrets. None of them go anywhere near a `VITE_` variable.

#### The access token must be permanent

The token from the Meta dashboard's *Temporary access token* box lasts **24
hours**. A bot on one of those stops replying the next day, with no obvious
error beyond `190` in the logs.

Make a permanent one: **business.facebook.com → Business settings → Users →
System users** → add a system user with the Admin role → *Generate new token*
→ pick the app, tick `whatsapp_business_messaging` and
`whatsapp_business_management` → set expiry to **Never**.

Check any token before trusting it:

```bash
curl -s "https://graph.facebook.com/v19.0/debug_token?input_token=$TOK&access_token=$TOK" \
  | python3 -c "import json,sys,datetime; d=json.load(sys.stdin)['data']; \
    print('expires:', 'never' if d['expires_at']==0 else datetime.datetime.fromtimestamp(d['expires_at']))"
```

#### The number is a Meta test number

`+1 555 159 3204` is Meta's free sandbox number. Useful for building, but:

- it can only message **up to 5 recipient numbers you add** in the dashboard,
  so a customer scanning a QR cannot reach it unless they are on that list;
- it cannot be the number on a printed QR for real customers;
- it is US-based, which looks odd to an Indian customer.

For real use, add your own business number under **WhatsApp → API Setup → Add
phone number** and verify it. Everything else here stays the same — only
`WHATSAPP_PHONE_NUMBER_ID` changes.

### 3. Deploy

```bash
supabase functions deploy whatsapp-webhook --no-verify-jwt
```

`--no-verify-jwt` is required: Meta calls this endpoint directly with no
Supabase token. The verify token in step 4 is what proves the caller is Meta.

### 4. Point Meta at it

Meta for Developers → your app → **WhatsApp → Configuration → Webhook**:

- Callback URL: `https://<project-ref>.supabase.co/functions/v1/whatsapp-webhook`
- Verify token: the same string you set as `WHATSAPP_VERIFY_TOKEN`
- Click *Verify and save*, then subscribe to the **messages** field.

### 5. Tell the platform its bot number

Sign in as a superadmin → Profile → **Platform admin**, and enter the bot's
number (country code, no plus: `919876543210`). Every shop's QR is generated
from this.

To become a superadmin, in the SQL editor:

```sql
insert into public.superadmins (phone, name) values ('+919522272781', 'Ashish');
```

### 6. Test it

From Admin → More → *Order on WhatsApp*, tap **Try it** — it opens the same
link the QR encodes. Send the pre-typed message and the bot should greet you.

## Things worth knowing

**The 24-hour window.** WhatsApp only lets a business send free-form messages
within 24 hours of the customer's last message. The bot only ever replies to
something the customer just sent, so this never bites — but it means the bot
cannot, for example, message a customer the next day to say their order is out
for delivery. That would need an approved template.

**Pick a model the key can actually reach.** `gemini-2.0-flash` was already
retired for this key when the bot was wired up — the call 404s and every order
fails. `GEMINI_MODEL` overrides the default without a code change. To see what
a key can call:

```bash
curl -s "https://generativelanguage.googleapis.com/v1beta/models?key=$KEY" \
  | python3 -c "import json,sys; [print(m['name'].split('/')[-1]) for m in json.load(sys.stdin)['models']]"
```

**The free tier's rate limit is low.** Testing six orders back to back hit a
`503` then a string of `429`s. The client retries 503 and 429 twice with a short
backoff, which absorbs the occasional spike — but a shop taking several orders a
minute needs a paid key. Anything else (400 for a bad prompt, 403 for a bad key)
fails immediately, because retrying will not help.

**Voice notes cost a Gemini call with audio.** Cheap on flash, but not free. A
typed order is text-only.

**Quantities are units of the catalogue row.** "2 kg aloo" against a "1 kg" row
is qty 2; "1 dozen kela" against a "12 pc" row is qty 1; "500 g" of a 1 kg row
rounds up to 1. Gemini is told this explicitly.

**The customer's account.** On first contact the bot creates an auth user with
the number confirmed. If that person later signs into the web app with real
phone OTP on the same number, Supabase lands them on the same account — so
their WhatsApp orders and web orders are one history. With the dev static OTP
they get a separate anonymous user, but everything keys off the phone anyway.

**Idempotency.** Meta retries any delivery that is not a fast 200. The function
answers 200 immediately and works afterwards; `wa_messages` records every
`wamid`, so a retry is recognised and ignored.

## What has been verified live

Against the real APIs, not mocks:

| | |
|---|---|
| Meta: text send | delivered to a handset |
| Meta: 3-button review card, via `graph.ts` | delivered |
| Meta: address list picker, via `graph.ts` | delivered |
| Full pipeline: Meta envelope → `parseWebhook` → bot → real reply | delivered |
| Gemini: item matching | see below |
| Gemini: address parsing | see below |

Item matching, real replies from `gemini-2.5-flash`:

| Customer said | Matched |
|---|---|
| `2 kg aloo, 1 kg tamatar, 1 dozen kela` | 2× Aalu [1 kg], 1× Tamatar (Hybrid), 1× Kela [12 pc] |
| `ek bora aloo aur do kilo pyaz bhej do` | 1× Aalu (**Bora**) [5 kg], 2× Peyaj [1 kg] |
| `Desi tamatar 2 packet, bhindi aadha kilo, aur thoda dhaniya` | 2× Tamatar (**Desi**) [2 kg], 1× Bhindi · unmatched: *dhaniya* |
| `500 gram bhindi` | 1× Bhindi [1 kg] (rounds up) |
| `namaste bhaiya, kaise ho?` | nothing — greetings are ignored |

Address parsing:

| Customer said | Parsed |
|---|---|
| `B-402 Green Residency, Sector 12 Dwarka, near Shiv Mandir, New Delhi 110075` | every field, confident |
| `mera ghar hai 12 number, main bazaar ke paas, indore, pin code 452001` | house 12, landmark *main bazaar*, city *indore*, pin 452001, confident |
| `just deliver near the temple` | landmark only, **not** confident — the bot re-asks |

**Still unverified:** the deployed function itself. The handshake, Meta's
retries and `EdgeRuntime.waitUntil` have not run on Supabase's runtime — the
first real message through the deployed endpoint is that test.
