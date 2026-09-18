# Mallet — landing page

Single static marketing page for **Mallet** (AI-native field-service platform for the trades). No build step — three files (`index.html`, `styles.css`, `main.js`) plus `vercel.json`.

**Live target:** `trymallet.com` (registered at Namecheap), hosted on Vercel.

Local preview: open `index.html` in a browser, or `npx serve .`

---

## What's already wired

- **Waitlist** → Tally form `Y5gxDv` embedded in the convert section (`main.js` auto-loads Tally's script).
- **Book a demo** → Calendly `owenduggan2003/30min`, opened by every `.js-book-demo` button (nav, hero, bottom CTA).
- **Footer email** → intentionally omitted (none for now).

### To change those later
- **Different Tally form:** edit the `data-tally-src` form id in `index.html` (the `tally.so/embed/<id>` value).
- **Different Calendly:** edit `data-calendly="…"` on the `#demoBtn` button in `index.html`.
- **Add a contact email:** add a `mailto:` line back into the `<p class="foot-meta">` block.

## Still to do

### Drop in the demo video
Replace the `<div class="video-frame">…</div>` in the hero with your embed:

```html
<div class="video-frame">
  <iframe src="https://www.youtube.com/embed/VIDEO_ID" title="Mallet demo"
          style="width:100%;height:100%;border:0" allowfullscreen></iframe>
</div>
```

### Social preview image (optional)
Drop a 1200×630 PNG at `assets/og.png` (referenced by the `og:image` meta tag) so shared links unfurl nicely.

---

## Deploy to Vercel — trymallet.com

### 1. Import the repo
1. In Vercel: **Add New → Project → Import** the `mallet-site` repo.
2. Configure:
   - **Framework Preset:** `Other`
   - **Build Command:** leave empty (no build step)
   - **Output Directory:** `.` (root — `index.html` is at the top level)
   - **Install Command:** leave empty
3. **Deploy.** You get a `*.vercel.app` URL to confirm the site loads. (Vercel reads the included `vercel.json` automatically.)

### 2. Add the domain in Vercel
1. **Project → Settings → Domains → Add Domain** → enter `trymallet.com`. Accept the prompt to also add `www.trymallet.com`.
2. Make `trymallet.com` (apex) **primary** and set `www.trymallet.com` to **Redirect → trymallet.com** (308).
3. Vercel now shows the **exact A-record IP** (apex) and **exact CNAME target** (www) for *this* project. **Copy those values verbatim** — see the warning below.

### 3. Point Namecheap DNS at Vercel
Namecheap: **Domain List → Manage (trymallet.com) → Advanced DNS**.

**First, delete the default parking records** (trash-bin icon):
- the **URL Redirect Record** on Host `@` (Namecheap parking page), and
- the **CNAME Record** on Host `www` → `parkingpage.namecheap.com`.

Then **Add New Record** for each row, using the exact values Vercel showed you:

| Host  | Type     | Value                                          | TTL       |
|-------|----------|------------------------------------------------|-----------|
| `@`   | A Record | *the apex IP from your Vercel Domains page*    | Automatic |
| `www` | CNAME    | *the www CNAME from your Vercel Domains page*  | Automatic |

Save each row (green check), then **Save All Changes**.

> ⚠️ **Use the dashboard values, not a hardcoded IP.** Vercel no longer publishes one universal apex IP. As of 2026, new projects are typically issued apex A = `216.198.79.1` and a **project-specific** www CNAME like `xxxxxxxx.vercel-dns-017.com`. The old `76.76.21.21` / `cname.vercel-dns.com` are **deprecated** — only use a value if your own Vercel Domains page literally shows it.
>
> Other rules: never put a CNAME on the bare `@` apex (it breaks email and is invalid at the zone apex — that's why apex uses an A record). If Vercel lists a second apex A record, add it too. If a CAA record exists, add `0 issue "letsencrypt.org"`.

### 4. HTTPS is automatic
Once DNS resolves and the Vercel Domains page flips to **Valid Configuration**, Vercel auto-provisions a free Let's Encrypt certificate and serves HTTPS with auto-renewal. No manual cert steps.

### 5. Propagation
A/CNAME changes usually take minutes to a few hours (allow up to 24–48h for full global propagation). Check with:

```
dig a trymallet.com +short
dig cname www.trymallet.com +short
```

…and watch the Vercel Domains page for **Valid Configuration**.

---

## Swap-point checklist

- [x] Waitlist — Tally form `Y5gxDv` embedded
- [x] Book-a-demo — Calendly `owenduggan2003/30min` on every "Book a demo" button
- [x] Footer contact email — intentionally omitted
- [x] Domain bought — `trymallet.com` (Namecheap)
- [ ] Demo-video placeholder → real embed (hero `.video-frame`)
- [ ] `assets/og.png` — social preview (optional)
- [ ] Push to GitHub → import in Vercel → set Namecheap DNS (steps above)
