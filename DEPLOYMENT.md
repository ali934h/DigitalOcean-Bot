# 🚀 Deployment Guide

## 📌 مشکل متداول: چرا بعد از Clone کد قدیمی Deploy میشه؟

### ❓ علت:
**Secrets** (مثل `TELEGRAM_BOT_TOKEN` و `ALLOWED_USER_IDS`) در **Git** ذخیره نمیشن!

- Secrets فقط روی **Cloudflare** ذخیره میشن
- هر بار که پروژه رو Clone میکنی، باید دوباره Secrets رو Set کنی
- این برای امنیت هست (تا توکن‌ها تو Git نرن)

---

## 🛠️ روند صحیح Deployment

### 🆕 برای اولین بار (Setup اولیه):

```bash
# 1. Clone کردن پروژه
git clone https://github.com/ali934h/DigitalOcean-Bot.git
cd DigitalOcean-Bot

# 2. نصب dependencies
npm install

# 3. Login به Cloudflare
npx wrangler login

# 4. ایجاد KV Namespace (فقط برای پروژه جدید)
npx wrangler kv namespace create "DROPLET_CREATION"
# ID رو کپی کن و در wrangler.jsonc جایگزین کن

# 5. Set کردن Secrets (مهم!)
npm run setup-secrets
# یا:
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put ALLOWED_USER_IDS

# 6. Deploy
npm run deploy

# 7. ثبت Webhook
# Open in browser:
https://YOUR-WORKER-NAME.workers.dev/registerWebhook
```

---

### 🔄 برای Update کردن کد:

```bash
# 1. گرفتن آخرین تغییرات
git pull origin main

# 2. Deploy
npm run deploy

# تمام! Secrets قبلاً Set شدن و نیازی به Set مجدد نیست.
```

---

### 🔍 چک کردن Secrets:

```bash
# لیست Secrets
npm run check-secrets

# اگر خالی بود [] یعنی Secrets نیستن!
# باید دوباره Set کنی:
npm run setup-secrets
```

---

## ⚠️ مواردی که Secrets پاک میشن:

### ❌ **همیشه پاک میشن:**
1. **Clone کردن پروژه در مسیر جدید**
2. **Delete کردن Worker از Cloudflare Dashboard**
3. **تغییر اسم Worker در `wrangler.jsonc`**

### ✅ **باقی میمونن:**
1. **Deploy عادی** (`npm run deploy`)
2. **Git Pull** کردن
3. **Update کردن کد**

---

## 🐞 Troubleshooting

### مشکل: Bot جواب نمیده

```bash
# 1. چک Secrets
npm run check-secrets

# 2. چک Webhook
curl https://YOUR-WORKER.workers.dev/registerWebhook

# 3. چک Logs
npx wrangler tail
```

### مشکل: کد جدید Deploy نمیشه

```bash
# 1. پاک کردن کش
 rm -rf .wrangler/

# 2. Deploy مجدد
npm run deploy

# 3. چک Dashboard
# برو به Cloudflare Dashboard → Workers → Deployments
# آخرین version رو چک کن
```

### مشکل: Webhook 404 میده

```bash
# Secrets رو Set کن
npm run setup-secrets

# دوباره Deploy
npm run deploy

# Webhook رو ثبت کن
# Open: https://YOUR-WORKER.workers.dev/registerWebhook
```

---

## 📝 نکات مهم:

1. **Secrets هیچوقت تو Git Commit نمیشن** (برای امنیت)
2. **بعد از Clone حتماً `npm run setup-secrets` رو اجرا کن**
3. **برای Update عادی، فقط `git pull` و `npm run deploy` کافیه**
4. **اگر Worker رو Delete کردی، حتماً Secrets رو دوباره Set کن**

---

## 🛠️ Available Scripts:

```bash
npm run deploy          # Deploy to Cloudflare
npm run dev             # Run locally
npm run test            # Run tests
npm run setup-secrets   # Configure secrets (first time or after clone)
npm run check-secrets   # List configured secrets
```

---

## ✅ چک لیست برای Setup جدید:

- [ ] Clone پروژه
- [ ] `npm install`
- [ ] `npx wrangler login`
- [ ] Create KV Namespace (فقط برای پروژه جدید)
- [ ] Update `wrangler.jsonc` with KV ID
- [ ] `npm run setup-secrets`
- [ ] `npm run deploy`
- [ ] Register webhook
- [ ] Test `/start` in Telegram

---

**Made with ❤️ by [Ali Hosseini](https://github.com/ali934h)**
