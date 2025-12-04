# 🤖 DigitalOcean Telegram Bot

A **serverless Telegram bot** to manage DigitalOcean Droplets directly from Telegram, powered by **Cloudflare Workers**.

[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![DigitalOcean](https://img.shields.io/badge/DigitalOcean-API-0080FF?logo=digitalocean&logoColor=white)](https://www.digitalocean.com/)
[![Telegram](https://img.shields.io/badge/Telegram-Bot-26A5E4?logo=telegram&logoColor=white)](https://core.telegram.org/bots)

## ✨ Features

### 🖥️ Droplet Management
- **List Droplets** - View all your droplets with status
- **Droplet Details** - See comprehensive information (IP, RAM, vCPUs, disk, region, etc.)
- **Create Droplet** - Interactive wizard with step-by-step selection:
  - Choose from all available regions
  - Select droplet size (sorted by price)
  - Pick OS image (Ubuntu, Debian, CentOS, Fedora, Rocky Linux)
  - Custom or auto-generated names
- **Rebuild Droplet** - Reinstall with a new operating system
- **Delete Droplet** - Remove droplets with confirmation

### 🔐 Security Features
- **SSH Key Authentication** - Only SSH keys, no passwords
- **User Whitelist** - Restrict access to specific Telegram user IDs
- **Secure Credentials** - All sensitive data stored in Cloudflare Workers Secrets
- **Session Management** - Temporary data storage with auto-expiration

### ⚡ Technical Highlights
- **Serverless Architecture** - Runs on Cloudflare's global edge network
- **Zero Cold Starts** - Instant response times
- **Interactive UI** - Inline keyboards for smooth user experience
- **Smart Naming** - Auto-generated droplet names based on config
- **Multi-step Wizard** - Guided droplet creation process
- **Error Handling** - Comprehensive error messages and validations

## 📸 Screenshots

### Main Commands
```
/start     - Welcome message and help
/droplets  - List all droplets
/create    - Create new droplet
```

### Interactive Flow
1. Select region → 2. Choose size → 3. Pick OS → 4. Name droplet → 5. Confirm → ✅ Created!

## 🚀 Quick Start

### Prerequisites
- [DigitalOcean Account](https://www.digitalocean.com/) with API token
- [Cloudflare Account](https://www.cloudflare.com/)
- [Telegram Account](https://telegram.org/)
- [Node.js](https://nodejs.org/) v18+ installed
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/)

### 1️⃣ Create Telegram Bot

```bash
# Open Telegram and message @BotFather
/newbot

# Follow the prompts and save your bot token
```

### 2️⃣ Get DigitalOcean API Token

1. Log in to [DigitalOcean](https://cloud.digitalocean.com/)
2. Go to **API** → **Tokens/Keys**
3. Generate New Token (Read & Write access)
4. Copy and save the token ⚠️ (shown only once)

### 3️⃣ Add SSH Key to DigitalOcean

```bash
# Generate SSH key (if you don't have one)
ssh-keygen -t rsa -b 4096 -C "your_email@example.com"

# Copy your public key
cat ~/.ssh/id_rsa.pub
```

Then add it to DigitalOcean:
- **Settings** → **Security** → **SSH Keys** → **Add SSH Key**

### 4️⃣ Get Your Telegram User ID

Message [@userinfobot](https://t.me/userinfobot) on Telegram and copy your numeric user ID.

### 5️⃣ Deploy to Cloudflare Workers

```bash
# Clone the repository
git clone https://github.com/ali934h/DigitalOcean-Bot.git
cd DigitalOcean-Bot

# Install dependencies
npm install

# Login to Cloudflare
npx wrangler login

# Create KV namespace
npx wrangler kv namespace create "DROPLET_CREATION"
# Copy the ID from output and paste into wrangler.jsonc

# Add secrets
npx wrangler secret put TELEGRAM_BOT_TOKEN
# Paste your Telegram bot token

npx wrangler secret put DO_API_TOKEN
# Paste your DigitalOcean API token

npx wrangler secret put ALLOWED_USER_IDS
# Enter your Telegram User ID (comma-separated for multiple: 123456,789012)

# Deploy
npx wrangler deploy
```

### 6️⃣ Register Webhook

After deployment, visit:
```
https://your-worker-url.workers.dev/registerWebhook
```

You should see:
```json
{
  "ok": true,
  "result": true,
  "description": "Webhook was set"
}
```

### 7️⃣ Test Your Bot

Open Telegram, find your bot, and send `/start` 🎉

## 🛠️ Configuration

### Environment Variables (Secrets)

| Variable | Description | Required |
|----------|-------------|----------|
| `TELEGRAM_BOT_TOKEN` | Your Telegram bot token from @BotFather | ✅ Yes |
| `DO_API_TOKEN` | DigitalOcean API token with Read & Write access | ✅ Yes |
| `ALLOWED_USER_IDS` | Comma-separated Telegram user IDs (e.g., `123456,789012`) | ✅ Yes |

### KV Namespace

| Binding | Purpose |
|---------|---------|
| `DROPLET_CREATION` | Temporary storage for multi-step droplet creation flow |

## 📁 Project Structure

```
DigitalOcean-Bot/
├── src/
│   └── index.js          # Main bot logic
├── test/
│   └── index.spec.js     # Tests
├── .editorconfig         # Editor configuration
├── .gitignore           # Git ignore rules
├── .prettierrc          # Code formatter config
├── package.json         # Dependencies
├── vitest.config.js     # Test configuration
├── wrangler.jsonc       # Cloudflare Workers config
└── README.md            # This file
```

## 🔧 Development

```bash
# Install dependencies
npm install

# Run locally
npx wrangler dev

# Run tests
npm test

# Deploy to production
npx wrangler deploy

# View logs
npx wrangler tail
```

## 📝 Commands Reference

### Bot Commands

| Command | Description |
|---------|-------------|
| `/start` | Show welcome message and available commands |
| `/droplets` | List all your droplets with inline buttons |
| `/create` | Start interactive droplet creation wizard |

### Interactive Features

- **View Details** - Click any droplet to see full information
- **Rebuild** - Select new OS and rebuild (preserves IP)
- **Delete** - Remove droplet with confirmation
- **Back Navigation** - Navigate through menus easily

## 🔒 Security Best Practices

1. **Never commit secrets** - Use Wrangler secrets, not environment variables
2. **Whitelist users** - Only authorized Telegram IDs can use the bot
3. **SSH keys only** - No password authentication for droplets
4. **Regular updates** - Keep dependencies and Wrangler up to date
5. **Monitor logs** - Use `wrangler tail` to watch for suspicious activity

## 🐛 Troubleshooting

### Bot doesn't respond
- Check webhook registration: visit `/registerWebhook` endpoint
- Verify secrets are set correctly: `wrangler secret list`
- Check logs: `wrangler tail`

### "Access denied" message
- Verify your Telegram User ID is in `ALLOWED_USER_IDS`
- Multiple users need comma separation: `123,456,789`

### "No SSH Keys Found" error
- Add at least one SSH key to DigitalOcean account
- Go to: Settings → Security → SSH Keys

### Droplet creation fails
- Verify DO_API_TOKEN has Read & Write permissions
- Check if selected region/size is available
- Ensure you have billing set up on DigitalOcean

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is open source and available under the [MIT License](LICENSE).

## 🙏 Acknowledgments

- [Cloudflare Workers](https://workers.cloudflare.com/) - Serverless platform
- [DigitalOcean](https://www.digitalocean.com/) - Cloud infrastructure
- [Telegram Bot API](https://core.telegram.org/bots/api) - Bot framework

## 📞 Support

- **Issues**: [GitHub Issues](https://github.com/ali934h/DigitalOcean-Bot/issues)
- **Telegram**: [@ali934h](https://t.me/ali934h)
- **Website**: [alihosseini.dev](https://alihosseini.dev)

---

**Made with ❤️ by [Ali Hosseini](https://github.com/ali934h)**