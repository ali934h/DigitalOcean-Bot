# 🤖 DigitalOcean Telegram Bot

A **powerful serverless Telegram bot** to manage DigitalOcean Droplets directly from Telegram, powered by **Cloudflare Workers**.

[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![DigitalOcean](https://img.shields.io/badge/DigitalOcean-API-0080FF?logo=digitalocean&logoColor=white)](https://www.digitalocean.com/)
[![Telegram](https://img.shields.io/badge/Telegram-Bot-26A5E4?logo=telegram&logoColor=white)](https://core.telegram.org/bots)

## ✨ Features

### 📱 Interactive UI
- **Menu Button** - Quick access to all commands next to message input
- **Slash Commands** - Type `/` to see all available commands with descriptions
- **Inline Keyboards** - Beautiful interactive buttons for all actions
- **Search Functionality** - Quickly find OS images, applications, and snapshots
- **Pagination** - Browse through hundreds of images efficiently
- **Multi-Step Wizards** - Guided workflows for complex operations

### 🖥️ Droplet Management
- **List Droplets** - View all your droplets with real-time status
- **Droplet Details** - Comprehensive information (IP, region, size, specs)
- **Create Droplet** - Interactive creation wizard:
  - 🌍 Choose from **all available regions**
  - 💰 Select **size** (sorted by price, 15+ options)
  - 🐧 Pick **Operating System** (Ubuntu, Debian, CentOS, Fedora, Rocky Linux, etc.)
  - 📦 Install **Applications** (Docker, WordPress, LAMP, etc.)
  - 📸 Use **Your Snapshots**
  - 🔍 **Search** through 200+ images
  - 📝 Custom or auto-generated names
  - ✅ Confirmation with full details
- **Rebuild Droplet** - Reinstall with a new OS while keeping IP:
  - 🔄 Change OS without creating new droplet
  - ⚡ Compatibility check (disk size, region)
  - 📸 Support for snapshots
  - ⚠️ Safe confirmation workflow
- **Delete Droplet** - Remove droplets with double confirmation

### 🚀 Performance & Reliability
- **Smart Caching** - Images cached for 24 hours (reduces API calls)
- **Optimized Pagination** - Fetch all images once, page locally
- **Snapshot Fresh Data** - Snapshots always fetched live (no cache)
- **Session Management** - Auto-expiring temporary data (10 min)
- **Zero Cold Starts** - Instant responses on Cloudflare's edge network
- **Global CDN** - Low latency from anywhere in the world

### 🔐 Security Features
- **Per-User API Tokens** - Each user stores their own DigitalOcean API token
- **Token Validation** - Automatic verification before saving
- **SSH Key Authentication** - Only SSH keys, no passwords
- **User Whitelist** - Restrict access to specific Telegram user IDs
- **Secure Storage** - API tokens encrypted in Cloudflare KV
- **Session Isolation** - Each user's data is completely separate
- **Auto Token Cleanup** - API tokens never exposed or logged

### 🛠️ Technical Highlights
- **Serverless Architecture** - No servers to manage
- **Cloudflare Workers** - Runs on the edge, globally distributed
- **State Management** - Stateful conversations with KV storage
- **Error Handling** - Comprehensive validation and user feedback
- **Rate Limiting** - Built-in Cloudflare protection
- **Logging** - Real-time logs with `wrangler tail`

## 📝 Bot Commands

| Command | Description |
|---------|-------------|
| `/start` | Start the bot and show main menu |
| `/menu` | Display interactive menu with all options |
| `/droplets` | List all your droplets |
| `/create` | Create a new droplet (guided wizard) |
| `/setapi` | Configure or change your DigitalOcean API token |
| `/clearcache` | Clear cached image data (force refresh) |
| `/help` | Show detailed help and feature list |

## 🚀 Quick Start Guide

### Prerequisites

Before you begin, make sure you have:
- A [Cloudflare account](https://dash.cloudflare.com/sign-up) (free tier works)
- A [DigitalOcean account](https://www.digitalocean.com/)
- A [Telegram account](https://telegram.org/)
- [Node.js](https://nodejs.org/) v18+ installed

### Step 1: Create Your Telegram Bot

1. Open Telegram and search for [@BotFather](https://t.me/BotFather)
2. Send `/newbot` command
3. Follow the prompts:
   - Choose a name (e.g., "My DO Manager")
   - Choose a username (must end with `_bot`, e.g., `my_do_manager_bot`)
4. **Save the bot token** (looks like `1234567890:ABCdefGHIjklMNOpqrsTUVwxyz`)

### Step 2: Get Your Telegram User ID

1. Open Telegram and search for [@userinfobot](https://t.me/userinfobot)
2. Send any message to the bot
3. **Copy your numeric User ID** (e.g., `123456789`)

### Step 3: Prepare Your DigitalOcean Account

#### 3.1: Add SSH Key (Required)

You need at least one SSH key in your DigitalOcean account.

```bash
# Generate SSH key if you don't have one:
ssh-keygen -t rsa -b 4096 -C "your_email@example.com"
# Press Enter for all prompts

# Display your public key:
cat ~/.ssh/id_rsa.pub
# Copy the entire output
```

Now add it to DigitalOcean:
1. Go to [DigitalOcean Console](https://cloud.digitalocean.com/)
2. Navigate to **Settings** → **Security** → **SSH Keys**
3. Click **Add SSH Key**
4. Paste your public key and give it a name
5. Click **Add SSH Key**

#### 3.2: Create API Token (You'll set this later in bot)

1. In DigitalOcean Console, go to **API** → **Tokens/Keys**
2. Click **Generate New Token**
3. Name it (e.g., "Telegram Bot")
4. Select **Read** and **Write** scopes
5. Click **Generate Token**
6. **Copy and save the token** (shown only once!)

### Step 4: Clone and Setup Project

```bash
# Clone the repository
git clone https://github.com/ali934h/DigitalOcean-Bot.git
cd DigitalOcean-Bot

# Install dependencies
npm install
```

#### 4.1: Customize Worker Configuration

Open `wrangler.jsonc` and customize:

**1. Change Worker Name:**

```json
{
  "name": "my-awesome-bot",  // Change this
  ...
}
```

This determines your URL: `https://my-awesome-bot.workers.dev`

**2. Clear KV Namespace ID:**

```json
"kv_namespaces": [
    {
        "binding": "DROPLET_CREATION",
        "id": ""  // ← Clear the existing ID
    }
]
```

You'll add your own in Step 5.2.

### Step 5: Configure Cloudflare

#### 5.1: Login to Cloudflare

```bash
npx wrangler login
```

Click **Allow** in the browser.

#### 5.2: Create KV Namespace

```bash
npx wrangler kv namespace create "DROPLET_CREATION"
```

You'll see:
```
🎉 Successfully created KV namespace.
id = "abc123xyz456..."
```

**Copy the ID** and update `wrangler.jsonc`:

```json
"kv_namespaces": [
    {
        "binding": "DROPLET_CREATION",
        "id": "abc123xyz456..."  // ← Paste here
    }
]
```

#### 5.3: Set Secrets

```bash
# Set Telegram Bot Token
npx wrangler secret put TELEGRAM_BOT_TOKEN
# Paste your bot token and press Enter

# Set Allowed User IDs
npx wrangler secret put ALLOWED_USER_IDS
# Enter your User ID (e.g., 123456789)
# For multiple users: 123456789,987654321
```

### Step 6: Deploy

```bash
npx wrangler deploy
```

You'll see:
```
Published my-awesome-bot
  https://my-awesome-bot.your-username.workers.dev
```

**Copy this URL!**

### Step 7: Register Webhook & Enable Commands

Open your browser and navigate to:
```
https://your-worker-name.workers.dev/registerWebhook
```

You should see:
```json
{
  "webhook": { "ok": true, ... },
  "commands": "registered",
  "menuButton": "configured"
}
```

✅ **This step:**
- Registers the Telegram webhook
- Enables slash command autocomplete (`/`)
- Activates the Menu button next to message input

### Step 8: Start Using the Bot

1. Open Telegram
2. Search for your bot
3. Send `/start`
4. Send `/setapi` and reply with your DigitalOcean API token
5. Use `/menu` to see all options!

**Now you can:**
- 📋 List droplets
- 🚀 Create new droplets with OS/Apps/Snapshots
- 🔍 Search through 200+ images
- 🔄 Rebuild existing droplets
- 🗑️ Delete droplets

## 📚 User Guide

### Creating a Droplet

1. Send `/create` or use Menu button → "Create Droplet"
2. **Select Region** - Choose datacenter location
3. **Choose Image Type**:
   - 🐧 **Operating Systems** - Ubuntu, Debian, CentOS, Fedora, etc.
   - 📦 **Applications** - Docker, WordPress, LAMP, etc.
   - 📸 **My Snapshots** - Your custom images
4. **Browse or Search**:
   - Use pagination (◀️ Previous / Next ▶️)
   - Or tap 🔍 Search and type keywords (min 3 chars)
5. **Select Image** - Tap the image you want
6. **Choose Size** - Pick specs and pricing
7. **Name Your Droplet**:
   - ✅ Use Default (auto-generated)
   - 📝 Rename (custom name)
8. **Confirm** - Review and create!

Your droplet will be ready in ~60 seconds!

### Rebuilding a Droplet

1. Send `/droplets`
2. Select the droplet to rebuild
3. Tap 🔄 **Rebuild**
4. Choose new OS/App/Snapshot
5. Search or browse (same as creation)
6. **Confirm** - Review and rebuild

⚠️ **Warning**: All data will be deleted! IP address stays the same.

### Managing Cache

The bot caches OS and Application images for **24 hours** to improve performance.

**When to clear cache:**
- After DigitalOcean adds new OS versions
- If you see outdated image lists
- To force refresh all data

**How to clear:**
Send `/clearcache`

Snapshots are **never cached** (always fresh data).

## 🔧 Development

### Local Development

```bash
# Run locally with remote mode (needed for Telegram webhooks)
npx wrangler dev --remote
```

### Testing

```bash
npm test
```

### Viewing Logs

```bash
# Real-time logs
npx wrangler tail

# Filter by level
npx wrangler tail --status error
```

### Updating

```bash
# After code changes
git add .
git commit -m "Your changes"
git push

# Deploy
npx wrangler deploy
```

## 🛡️ Configuration

### Required Secrets

| Secret | Description | Example |
|--------|-------------|---------||
| `TELEGRAM_BOT_TOKEN` | Bot token from @BotFather | `1234567890:ABC...` |
| `ALLOWED_USER_IDS` | Comma-separated user IDs | `123456789,987654321` |

### KV Namespace

| Binding | Purpose |
|---------|---------||
| `DROPLET_CREATION` | User API tokens, sessions, cache |

**Data stored:**
- User API tokens (permanent)
- Session data (10 min TTL)
- Image cache (24 hour TTL)
- Search states (10 min TTL)

## 📚 Architecture

```
┌─────────────────┐
│  Telegram User  │
└───────┬────────┘
        │
        │ Webhook (HTTPS)
        │
┌───────┴──────────────────────────┐
│  Cloudflare Workers (Edge)    │
│  - Handle messages/callbacks  │
│  - State management           │
│  - Caching logic              │
└─────┬──────────┬──────────────┘
      │            │
      │            │
┌─────┴─────┐  ┌───┴───────────────────┐
│  KV Store  │  │  DigitalOcean API  │
│  - Tokens  │  │  - Droplets        │
│  - Cache   │  │  - Images          │
│  - State   │  │  - Regions/Sizes   │
└───────────┘  └─────────────────────┘
```

**Workflow:**
1. User sends message → Telegram webhook → Worker
2. Worker checks KV for user's API token
3. Worker calls DigitalOcean API (with caching)
4. Worker processes response
5. Worker sends formatted message back to Telegram

## 🐛 Troubleshooting

### Bot doesn't respond

**Check:**
1. Webhook registered? Visit `/registerWebhook`
2. Secrets configured? Run `npx wrangler secret list`
3. Check logs: `npx wrangler tail`

### "Access denied"

**Fix:** Add your User ID to `ALLOWED_USER_IDS`:
```bash
npx wrangler secret put ALLOWED_USER_IDS
# Enter: 123456789
```

### "No API token found"

**Fix:** Configure your token:
1. Send `/setapi`
2. Reply with DigitalOcean API token

### "Invalid API token"

**Reasons:**
- Token doesn't have Read + Write permissions
- Token is expired or revoked

**Fix:** Generate new token with both scopes, use `/setapi`

### "No SSH Keys Found"

**Fix:** Add SSH key to DigitalOcean (see Step 3.1)

### Commands don't autocomplete

**Fix:** Re-register webhook:
```
https://your-worker.workers.dev/registerWebhook
```

Must see: `"commands": "registered"`

### Menu button doesn't appear

**Fix:**
1. Re-register webhook (above)
2. Restart Telegram app
3. Clear Telegram cache: Settings → Data and Storage → Clear Cache

### Search not working

**Minimum 3 characters** required. If still fails:
1. Check image type has available images
2. Try different search terms
3. Use pagination instead

### Cache issues

**Symptoms:**
- Outdated image lists
- New snapshots not appearing

**Fix:** Send `/clearcache` to force refresh

## 🔒 Security Best Practices

1. **Never commit secrets** - Use `wrangler secret put`
2. **Limit user access** - Only trusted User IDs in whitelist
3. **Use SSH keys** - No password authentication
4. **Rotate tokens** - Change API tokens periodically
5. **Monitor logs** - Check `wrangler tail` regularly
6. **Update dependencies** - Run `npm update` monthly
7. **Unique worker names** - Avoid name conflicts

## ❓ FAQ

### Q: Can multiple users use the same bot?
**A:** Yes! Each user sets their own API token with `/setapi`. Add all user IDs to `ALLOWED_USER_IDS`.

### Q: Is my API token secure?
**A:** Yes. Stored encrypted in Cloudflare KV, never logged or exposed.

### Q: Does this cost money?
**A:** 
- **Cloudflare Workers:** Free tier includes 100,000 requests/day
- **KV Storage:** Free tier includes 1GB storage
- **DigitalOcean:** You pay only for droplets you create

### Q: How many images can the bot handle?
**A:** All of them! Bot fetches and caches all 200+ OS/App images. Pagination handles unlimited results.

### Q: Can I use this for production?
**A:** Absolutely! Built on Cloudflare's production-grade infrastructure.

### Q: What if DigitalOcean API is down?
**A:** Bot will show error messages. Check [DigitalOcean Status](https://status.digitalocean.com/).

### Q: Can I customize the bot?
**A:** Yes! Fork the repo, modify `src/index.js`, and deploy your version.

### Q: Do I need Premium Telegram?
**A:** No! All features work on free Telegram accounts.

## 🤝 Contributing

Contributions welcome!

1. Fork the repository
2. Create feature branch: `git checkout -b feature/amazing`
3. Make changes
4. Test: `npm test`
5. Commit: `git commit -m 'Add amazing feature'`
6. Push: `git push origin feature/amazing`
7. Open Pull Request

## 📝 Changelog

### v2.0.0 (Latest)
- ✨ Added Menu Button next to message input
- 🔍 Added slash command autocomplete
- 🔍 Added search functionality (OS/Apps/Snapshots)
- 📚 Added pagination for 200+ images
- 🔄 Added rebuild droplet feature
- 📏 Smart caching system (24h TTL)
- ❔ Added `/help` command
- 🗑️ Added `/clearcache` command
- 🐛 Fixed session management
- ⚡ Performance improvements

### v1.0.0
- 🎉 Initial release
- ✅ Create/delete droplets
- 📋 List droplets
- 🔐 Per-user API tokens

## 📜 License

MIT License - See [LICENSE](LICENSE)

## 🙏 Acknowledgments

- [Cloudflare Workers](https://workers.cloudflare.com/) - Serverless platform
- [DigitalOcean API](https://docs.digitalocean.com/reference/api/) - Cloud infrastructure
- [Telegram Bot API](https://core.telegram.org/bots/api) - Bot framework

## 📦 Support

- **Issues**: [GitHub Issues](https://github.com/ali934h/DigitalOcean-Bot/issues)
- **Telegram**: [@ali934h](https://t.me/ali934h)
- **Website**: [alihosseini.dev](https://alihosseini.dev)

---

**Made with ❤️ by [Ali Hosseini](https://github.com/ali934h)**