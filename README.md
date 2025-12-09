# 🤖 DigitalOcean Telegram Bot

Manage DigitalOcean Droplets directly from Telegram using Cloudflare Workers.

[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![DigitalOcean](https://img.shields.io/badge/DigitalOcean-API-0080FF?logo=digitalocean&logoColor=white)](https://www.digitalocean.com/)
[![Telegram](https://img.shields.io/badge/Telegram-Bot-26A5E4?logo=telegram&logoColor=white)](https://core.telegram.org/bots)

## ✨ Features

- 📱 Interactive menu and inline keyboards
- 🚀 Create/rebuild/delete droplets
- 🔍 Search through 200+ OS images and applications
- 📸 Support for custom snapshots
- 📝 Direct input (no need to reply to messages)
- ✅ Smart validation for droplet names (a-z, A-Z, 0-9, ., -)
- 🛡️ Per-user API tokens with encryption
- ⚡ Smart caching for better performance

## 🚀 Quick Setup

### Prerequisites

- [Cloudflare account](https://dash.cloudflare.com/sign-up)
- [DigitalOcean account](https://www.digitalocean.com/) with SSH key
- [Node.js](https://nodejs.org/) v18+

### 1. Create Telegram Bot

1. Message [@BotFather](https://t.me/BotFather) on Telegram
2. Send `/newbot` and follow prompts
3. Save your bot token
4. Get your user ID from [@userinfobot](https://t.me/userinfobot)

### 2. Clone & Install

```bash
git clone https://github.com/ali934h/DigitalOcean-Bot.git
cd DigitalOcean-Bot
npm install
```

### 3. Configure Cloudflare

```bash
# Login to Cloudflare
npx wrangler login

# Create KV namespace
npx wrangler kv namespace create "DROPLET_CREATION"
```

Copy the ID from output and update `wrangler.jsonc`:

```json
"kv_namespaces": [
    {
        "binding": "DROPLET_CREATION",
        "id": "YOUR_KV_ID_HERE"  // ← Paste your ID
    }
]
```

**⚠️ Important:** The KV namespace ID is unique to your Cloudflare account. You must create your own and update this ID.

### 4. Set Secrets

```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN
# Paste your bot token

npx wrangler secret put ALLOWED_USER_IDS
# Enter your user ID (e.g., 123456789)
```

### 5. Deploy

```bash
npx wrangler deploy
```

### 6. Register Webhook

Open in browser:
```
https://YOUR-WORKER-NAME.workers.dev/registerWebhook
```

You should see:
```json
{
  "webhook": { "ok": true },
  "commands": "registered",
  "menuButton": "configured"
}
```

### 7. Start Using

1. Open your bot in Telegram
2. Send `/start`
3. Send `/setapi` followed by your DigitalOcean API token
4. Done! Use `/menu` to see all options

## 📝 Usage

### Commands

| Command | Description |
|---------|-------------|
| `/start` | Show main menu |
| `/menu` | Display all options |
| `/droplets` | List your droplets |
| `/create` | Create new droplet |
| `/setapi` | Set DigitalOcean API token |
| `/clearcache` | Clear cached data |
| `/help` | Show help |

### Creating a Droplet

1. `/create` → Choose region
2. Select image type (OS/App/Snapshot)
3. Browse or search for image
4. Choose size
5. Name your droplet (or use default)
6. Confirm and create

### Droplet Names

Allowed: `a-z`, `A-Z`, `0-9`, `.`, `-`

Examples:
- ✅ `web-server-01`
- ✅ `app.production`
- ❌ `my_server` (no underscores)
- ❌ `my server` (no spaces)

## 🔄 Updating

### After Pulling Updates

```bash
git pull origin main
npm run deploy
```

**⚠️ Critical:** After each update:

1. **Check your KV namespace ID** in `wrangler.jsonc` - it may have been overwritten
2. **Verify webhook** by visiting:
   ```
   https://YOUR-WORKER.workers.dev/registerWebhook
   ```
   Response should be `{"webhook": {"ok": true}, ...}`

### If Secrets Are Missing

Secrets are stored on Cloudflare, not in Git. After cloning or if bot stops working:

```bash
# Check secrets
npx wrangler secret list

# If empty, set them again
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put ALLOWED_USER_IDS
```

## 🐞 Troubleshooting

### Bot doesn't respond

```bash
# 1. Check secrets
npx wrangler secret list

# 2. Verify webhook
curl https://YOUR-WORKER.workers.dev/registerWebhook

# 3. Check logs
npx wrangler tail
```

### Webhook returns 404

Secrets are missing. Set them:

```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put ALLOWED_USER_IDS
npx wrangler deploy
```

### Old code deploys after update

1. Verify KV namespace ID in `wrangler.jsonc` matches your account
2. Clear cache: `rm -rf .wrangler/`
3. Redeploy: `npx wrangler deploy`
4. Check webhook: visit `/registerWebhook`

## 📚 Architecture

```
Telegram → Webhook → Cloudflare Worker → DigitalOcean API
                    │
                    ↓
                 KV Storage
          (tokens, cache, state)
```

## 🔒 Security

- Secrets never stored in Git
- API tokens encrypted in KV
- User whitelist protection
- SSH key authentication only
- Input validation on all fields

## 📝 Scripts

```bash
npm run deploy          # Deploy to Cloudflare
npm run dev             # Run locally
npm run test            # Run tests
npm run check-secrets   # List configured secrets
```

## 🛠️ Configuration

### Secrets (Cloudflare)

- `TELEGRAM_BOT_TOKEN` - From @BotFather
- `ALLOWED_USER_IDS` - Comma-separated user IDs

### wrangler.jsonc

- `name` - Your worker name
- `kv_namespaces.id` - **Your** KV namespace ID (unique per account)

## ❓ FAQ

**Q: Can multiple users use one bot?**
A: Yes. Each user sets their own DigitalOcean API token.

**Q: Why are secrets missing after clone?**
A: Secrets are stored on Cloudflare, not in Git. Set them again with `npx wrangler secret put`.

**Q: What if webhook returns 404?**
A: Secrets are missing. Set `TELEGRAM_BOT_TOKEN` and `ALLOWED_USER_IDS` again.

**Q: Why does old code deploy after update?**
A: Check if KV namespace ID was overwritten in `wrangler.jsonc`. Use your own ID, not the one from Git.

## 📝 Changelog

### v2.1.0 (Latest)
- ✅ Droplet name validation
- 🔑 Direct input for `/setapi`
- 📝 Improved rename flow
- 🐛 Better error messages

### v2.0.0
- 📱 Menu button and slash commands
- 🔍 Search functionality
- 📚 Pagination for 200+ images
- 🔄 Rebuild droplet feature
- 🛡️ Smart caching

## 📜 License

MIT License

## 🙏 Credits

- [Cloudflare Workers](https://workers.cloudflare.com/)
- [DigitalOcean API](https://docs.digitalocean.com/reference/api/)
- [Telegram Bot API](https://core.telegram.org/bots/api)

## 📦 Support

- Issues: [GitHub Issues](https://github.com/ali934h/DigitalOcean-Bot/issues)
- Telegram: [@ali934h](https://t.me/ali934h)

---

**Made with ❤️ by [Ali Hosseini](https://github.com/ali934h)**
