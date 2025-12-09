# 🚀 Deployment Guide

## 📌 Common Issue: Why Does Old Code Deploy After Clone?

### ❓ Reason:
**Secrets** (like `TELEGRAM_BOT_TOKEN` and `ALLOWED_USER_IDS`) are **NOT stored in Git**!

- Secrets are only stored on **Cloudflare**
- Every time you clone the project, you must set secrets again
- This is for security (so tokens don't end up in Git)

---

## 🛠️ Proper Deployment Workflow

### 🆕 First Time Setup:

```bash
# 1. Clone the project
git clone https://github.com/ali934h/DigitalOcean-Bot.git
cd DigitalOcean-Bot

# 2. Install dependencies
npm install

# 3. Login to Cloudflare
npx wrangler login

# 4. Create KV Namespace (only for new projects)
npx wrangler kv namespace create "DROPLET_CREATION"
# Copy the ID and paste it in wrangler.jsonc

# 5. Set Secrets (Important!)
npm run setup-secrets
# Or manually:
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put ALLOWED_USER_IDS

# 6. Deploy
npm run deploy

# 7. Register Webhook
# Open in browser:
https://YOUR-WORKER-NAME.workers.dev/registerWebhook
```

---

### 🔄 For Updating Code:

```bash
# 1. Pull latest changes
git pull origin main

# 2. Deploy
npm run deploy

# Done! Secrets were already set and don't need to be set again.
```

---

### 🔍 Check Secrets:

```bash
# List secrets
npm run check-secrets

# If empty [], secrets are missing!
# Set them again:
npm run setup-secrets
```

---

## ⚠️ When Secrets Are Lost:

### ❌ **Always Lost:**
1. **Cloning project in a new location**
2. **Deleting Worker from Cloudflare Dashboard**
3. **Changing Worker name in `wrangler.jsonc`**

### ✅ **Preserved:**
1. **Normal deployment** (`npm run deploy`)
2. **Git pull**
3. **Code updates**

---

## 🐞 Troubleshooting

### Issue: Bot doesn't respond

```bash
# 1. Check Secrets
npm run check-secrets

# 2. Check Webhook
curl https://YOUR-WORKER.workers.dev/registerWebhook

# 3. Check Logs
npx wrangler tail
```

### Issue: New code doesn't deploy

```bash
# 1. Clear cache
rm -rf .wrangler/

# 2. Redeploy
npm run deploy

# 3. Check Dashboard
# Go to Cloudflare Dashboard → Workers → Deployments
# Verify latest version is active
```

### Issue: Webhook returns 404

```bash
# Set secrets
npm run setup-secrets

# Redeploy
npm run deploy

# Register webhook
# Open: https://YOUR-WORKER.workers.dev/registerWebhook
```

---

## 📝 Important Notes:

1. **Secrets are NEVER committed to Git** (for security)
2. **After cloning, always run `npm run setup-secrets`**
3. **For normal updates, just `git pull` and `npm run deploy` is enough**
4. **If you delete the Worker, you MUST set secrets again**

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

## ✅ Setup Checklist:

- [ ] Clone project
- [ ] `npm install`
- [ ] `npx wrangler login`
- [ ] Create KV Namespace (only for new projects)
- [ ] Update `wrangler.jsonc` with KV ID
- [ ] `npm run setup-secrets`
- [ ] `npm run deploy`
- [ ] Register webhook
- [ ] Test `/start` in Telegram

---

## 🔐 Security Best Practices:

1. **Never commit secrets to Git**
2. **Use different tokens for development and production**
3. **Rotate API tokens periodically**
4. **Keep `ALLOWED_USER_IDS` restricted to trusted users only**
5. **Monitor logs regularly** with `npx wrangler tail`

---

## 📚 Additional Resources:

- [Cloudflare Workers Docs](https://developers.cloudflare.com/workers/)
- [Wrangler Configuration](https://developers.cloudflare.com/workers/wrangler/configuration/)
- [Secrets Management](https://developers.cloudflare.com/workers/configuration/secrets/)
- [Telegram Bot API](https://core.telegram.org/bots/api)
- [DigitalOcean API](https://docs.digitalocean.com/reference/api/)

---

**Made with ❤️ by [Ali Hosseini](https://github.com/ali934h)**
