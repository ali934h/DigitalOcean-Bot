# 🤖 DigitalOcean Telegram Bot

Manage DigitalOcean Droplets directly from Telegram using Cloudflare Workers.

[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![DigitalOcean](https://img.shields.io/badge/DigitalOcean-API-0080FF?logo=digitalocean&logoColor=white)](https://www.digitalocean.com/)
[![Telegram](https://img.shields.io/badge/Telegram-Bot-26A5E4?logo=telegram&logoColor=white)](https://core.telegram.org/bots)

## 📑 Table of Contents

- [Features](#-features)
- [Initial Setup](#-initial-setup) ← First time installation
- [Updating](#-updating) ← Already have it installed?
- [Usage](#-usage)
- [Troubleshooting](#-troubleshooting)
- [Configuration](#️-configuration)
- [FAQ](#-faq)

---

## ✨ Features

- 🚀 Create, rebuild, and delete droplets
- 🔍 Search 200+ OS images and applications
- 📝 Direct input (no reply needed)
- ✅ Smart name validation (a-z, A-Z, 0-9, ., -)
- 🔐 Secure per-user API tokens
- ⚡ Smart caching for performance

---

## 🚀 Initial Setup

**First time? Follow these steps:**

### Prerequisites

- [Cloudflare account](https://dash.cloudflare.com/sign-up) (free)
- [DigitalOcean account](https://www.digitalocean.com/) with SSH key
- [Node.js](https://nodejs.org/) v18+

### 1. Create Telegram Bot

1. Message [@BotFather](https://t.me/BotFather)
2. Send `/newbot` and follow prompts
3. **Save bot token** (e.g., `1234567890:ABC...`)
4. Get your user ID from [@userinfobot](https://t.me/userinfobot)

### 2. Clone & Install

```bash
git clone https://github.com/ali934h/DigitalOcean-Bot.git
cd DigitalOcean-Bot
npm install
```

### 3. Create KV Namespace

```bash
npx wrangler login
npx wrangler kv namespace create "DROPLET_CREATION"
```

Copy the ID and update `wrangler.jsonc`:

```json
"kv_namespaces": [{
    "binding": "DROPLET_CREATION",
    "id": "abc123..."  // ← Your unique ID
}]
```

⚠️ **Critical:** This ID is unique to YOUR Cloudflare account. Keep it safe.

### 4. Set Secrets

```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN
# Paste your bot token

npx wrangler secret put ALLOWED_USER_IDS
# Enter user IDs (e.g., 123456789 or 123,456,789)
```

### 5. Deploy

```bash
npx wrangler deploy
```

### 6. Activate Bot

Open in browser:
```
https://YOUR-WORKER-NAME.workers.dev/registerWebhook
```

Expected response:
```json
{"webhook": {"ok": true}, "commands": "registered", "menuButton": "configured"}
```

### 7. Start Using

1. Open bot in Telegram → `/start`
2. Send `/setapi YOUR_DIGITALOCEAN_TOKEN`
3. Done! Use `/menu`

---

## 🔄 Updating

**Already installed? Update to latest version:**

### Quick Update (No Local Changes)

```bash
cd DigitalOcean-Bot
git pull origin main
npm run deploy
```

### Clean Update (Recommended)

If you modified files or have conflicts:

```bash
cd DigitalOcean-Bot

# ⚠️ Discards ALL local changes!
git fetch origin
git reset --hard origin/main
git clean -fd
```

**After reset, you MUST:**

1. Open `wrangler.jsonc`
2. Restore YOUR KV namespace ID:
   ```json
   "id": "YOUR_KV_ID"  // ← Put your ID back!
   ```
3. Deploy: `npm run deploy`

### Post-Update Verification

Always check:

```bash
# 1. Verify webhook
curl https://YOUR-WORKER.workers.dev/registerWebhook
# Should return: {"webhook": {"ok": true}, ...}

# 2. Check secrets (if bot doesn't work)
npx wrangler secret list
# If empty, set again:
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put ALLOWED_USER_IDS
```

---

## 📝 Usage

### Commands

| Command | Description |
|---------|-------------|
| `/start` | Show main menu |
| `/create` | Create droplet |
| `/droplets` | List droplets |
| `/setapi` | Set DigitalOcean token |
| `/clearcache` | Clear cached data |

### Creating Droplets

1. `/create` → Choose region → Select image → Choose size
2. Name droplet (allowed: `a-z A-Z 0-9 . -`)
3. Confirm and create

**Valid names:** `web-01`, `app.prod`, `test-server`  
**Invalid:** `my_server`, `my server`, `@server`

---

## 🐛 Troubleshooting

### Bot Doesn't Respond

```bash
# Check secrets
npx wrangler secret list

# Check webhook
curl https://YOUR-WORKER.workers.dev/registerWebhook

# View logs
npx wrangler tail
```

### Webhook Returns 404

Secrets missing:

```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put ALLOWED_USER_IDS
npx wrangler deploy
```

### Old Code After Update

1. Check KV namespace ID in `wrangler.jsonc` (must be YOUR ID)
2. Clear cache: `rm -rf .wrangler/`
3. Redeploy: `npx wrangler deploy`
4. Verify webhook: visit `/registerWebhook`

### Merge Conflicts

Use clean update:

```bash
git reset --hard origin/main
# Then restore your KV ID in wrangler.jsonc!
```

---

## 🛠️ Configuration

### Secrets (On Cloudflare)

| Secret | Source | Example |
|--------|--------|----------|
| `TELEGRAM_BOT_TOKEN` | @BotFather | `1234567890:ABC...` |
| `ALLOWED_USER_IDS` | @userinfobot | `123456789` |

**Note:** Secrets are stored on Cloudflare, NOT in Git. Set them after each fresh clone.

### wrangler.jsonc

- `name` - Worker name (determines URL)
- `kv_namespaces.id` - YOUR unique KV namespace ID

---

## ❓ FAQ

**Q: Why are secrets missing after clone?**  
A: Secrets are on Cloudflare, not in Git. Run `npx wrangler secret put` again.

**Q: Why does webhook return 404?**  
A: Secrets not set. Put `TELEGRAM_BOT_TOKEN` and `ALLOWED_USER_IDS`.

**Q: Old code deploys after update?**  
A: KV namespace ID was overwritten. Restore YOUR ID in `wrangler.jsonc`.

**Q: How to update without conflicts?**  
A: Use `git reset --hard origin/main`, then restore your KV ID.

**Q: Can multiple users use one bot?**  
A: Yes. Each sets their own DigitalOcean token via `/setapi`.

**Q: Is this free?**  
A: Cloudflare Workers free tier: 100K requests/day. You pay only for DigitalOcean droplets.

---

## 📊 Architecture

```
Telegram → Webhook → Cloudflare Worker → DigitalOcean API
                           ↓
                      KV Storage
                 (tokens, cache, state)
```

---

## 📜 License

MIT License

## 🙏 Credits

- [Cloudflare Workers](https://workers.cloudflare.com/)
- [DigitalOcean API](https://docs.digitalocean.com/reference/api/)
- [Telegram Bot API](https://core.telegram.org/bots/api)

## 📦 Support

- [GitHub Issues](https://github.com/ali934h/DigitalOcean-Bot/issues)
- Telegram: [@ali934h](https://t.me/ali934h)

---

**Made with ❤️ by [Ali Hosseini](https://github.com/ali934h)**
