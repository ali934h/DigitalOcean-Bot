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
- **Per-User API Tokens** - Each user stores their own DigitalOcean API token securely
- **SSH Key Authentication** - Only SSH keys, no passwords
- **User Whitelist** - Restrict access to specific Telegram user IDs
- **Secure Storage** - API tokens stored encrypted in Cloudflare KV
- **Session Management** - Temporary data with auto-expiration

### ⚡ Technical Highlights
- **Serverless Architecture** - Runs on Cloudflare's global edge network
- **Zero Cold Starts** - Instant response times
- **Interactive UI** - Inline keyboards for smooth user experience
- **Smart Naming** - Auto-generated droplet names based on config
- **Multi-step Wizard** - Guided droplet creation process
- **Error Handling** - Comprehensive error messages and validations

## 🚀 Quick Start Guide

### Prerequisites

Before you begin, make sure you have:
- A [Cloudflare account](https://dash.cloudflare.com/sign-up) (free tier works)
- A [DigitalOcean account](https://www.digitalocean.com/)
- A [Telegram account](https://telegram.org/)
- [Node.js](https://nodejs.org/) v18 or higher installed

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

You need at least one SSH key in your DigitalOcean account for secure droplet access.

```bash
# If you don't have an SSH key, generate one:
ssh-keygen -t rsa -b 4096 -C "your_email@example.com"
# Press Enter for all prompts (use default location and no passphrase)

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

#### 3.2: Create API Token (You'll use this later in Telegram)

1. In DigitalOcean Console, go to **API** → **Tokens/Keys**
2. Click **Generate New Token**
3. Name it (e.g., "Telegram Bot")
4. Select **Read** and **Write** scopes
5. Click **Generate Token**
6. **Copy and save the token immediately** (it's only shown once)

### Step 4: Clone and Setup Project

```bash
# Clone the repository
git clone https://github.com/ali934h/DigitalOcean-Bot.git
cd DigitalOcean-Bot

# Install dependencies
npm install
```

### Step 5: Configure Cloudflare

#### 5.1: Login to Cloudflare

```bash
npx wrangler login
```

This will open a browser window. Click **Allow** to authorize Wrangler.

#### 5.2: Create KV Namespace

```bash
npx wrangler kv namespace create "DROPLET_CREATION"
```

You'll see output like:
```
{ binding = "DROPLET_CREATION", id = "abc123xyz456..." }
```

**Important:** Open `wrangler.jsonc` and verify the KV namespace ID on line 12 matches the `id` from the output above. If different, update it.

#### 5.3: Set Secrets

You need to configure two secrets:

```bash
# Set Telegram Bot Token
npx wrangler secret put TELEGRAM_BOT_TOKEN
# When prompted, paste your Telegram bot token and press Enter

# Set Allowed User IDs
npx wrangler secret put ALLOWED_USER_IDS
# When prompted, enter your Telegram User ID (e.g., 123456789) and press Enter
# For multiple users, separate with commas: 123456789,987654321
```

**Note:** Unlike traditional bots, each user will set their own DigitalOcean API token directly through the bot using the `/setapi` command. You don't need to configure it as a secret.

### Step 6: Deploy

```bash
npx wrangler deploy
```

After successful deployment, you'll see output like:
```
Published telegram-do-bot (X.XX sec)
  https://telegram-do-bot.your-username.workers.dev
```

**Copy this URL** - you'll need it in the next step.

### Step 7: Register Webhook

Open your browser and navigate to:
```
https://telegram-do-bot.your-username.workers.dev/registerWebhook
```

You should see:
```json
{
  "ok": true,
  "result": true,
  "description": "Webhook was set"
}
```

If you see this, your webhook is successfully registered! 🎉

### Step 8: Start Using the Bot

1. Open Telegram
2. Search for your bot (the username you created in Step 1)
3. Send `/start`
4. You'll see a welcome message asking you to configure your API token
5. Send `/setapi`
6. Reply to the bot's message with your DigitalOcean API token (from Step 3.2)
7. The bot will validate and save your token
8. Now you can use `/droplets` and `/create` commands!

## 📝 Bot Commands

| Command | Description |
|---------|-------------|
| `/start` | Show welcome message and available commands |
| `/setapi` | Configure or change your DigitalOcean API token |
| `/droplets` | List all your droplets with interactive buttons |
| `/create` | Start the interactive droplet creation wizard |

## 🔄 Development Workflow

### Local Development

```bash
# Run the bot locally (for testing)
npx wrangler dev
```

**Note:** For local testing with Telegram webhooks, you'll need to:
1. Use `npx wrangler dev --remote` to get a public URL, or
2. Use a tunneling service like [ngrok](https://ngrok.com/) to expose your local server

### Testing

```bash
# Run tests
npm test
```

### Viewing Logs

```bash
# Stream real-time logs
npx wrangler tail

# View logs with filtering
npx wrangler tail --status error
```

### Updating Secrets

```bash
# Update Telegram Bot Token
npx wrangler secret put TELEGRAM_BOT_TOKEN

# Update Allowed User IDs
npx wrangler secret put ALLOWED_USER_IDS

# List all secrets (doesn't show values)
npx wrangler secret list

# Delete a secret
npx wrangler secret delete SECRET_NAME
```

### Deploying Updates

```bash
# After making code changes
git add .
git commit -m "Your commit message"
git push origin main

# Deploy to Cloudflare
npx wrangler deploy
```

## 🛠️ Configuration

### Required Secrets

| Secret | Description | Example |
|--------|-------------|---------|
| `TELEGRAM_BOT_TOKEN` | Bot token from @BotFather | `1234567890:ABCdef...` |
| `ALLOWED_USER_IDS` | Comma-separated Telegram user IDs | `123456789` or `123,456,789` |

### KV Namespace

| Binding | Purpose |
|---------|---------|
| `DROPLET_CREATION` | Stores user API tokens and temporary session data |

### Per-User Configuration

Each user must configure their own DigitalOcean API token using the `/setapi` command in Telegram. This approach:
- Allows multiple users with different DigitalOcean accounts
- Keeps credentials isolated per user
- Stores tokens securely in Cloudflare KV
- Validates tokens before saving

## 📁 Project Structure

```
DigitalOcean-Bot/
├── src/
│   └── index.js          # Main bot logic and webhook handler
├── test/
│   └── index.spec.js     # Unit tests
├── .editorconfig         # Editor configuration
├── .gitignore            # Git ignore rules
├── .prettierrc           # Code formatter settings
├── package.json          # Project dependencies
├── vitest.config.js      # Test configuration
├── wrangler.jsonc        # Cloudflare Workers configuration
└── README.md             # This file
```

## 🐛 Troubleshooting

### Bot doesn't respond to messages

**Solution:**
1. Verify webhook registration: Visit `https://your-worker.workers.dev/registerWebhook`
2. Check secrets are configured: `npx wrangler secret list`
3. View logs for errors: `npx wrangler tail`

### "Access denied" message

**Cause:** Your Telegram User ID is not in the allowed list.

**Solution:**
1. Get your User ID from [@userinfobot](https://t.me/userinfobot)
2. Update the secret: `npx wrangler secret put ALLOWED_USER_IDS`
3. Enter your User ID (for multiple users: `123,456,789`)

### "No API token found" message

**Cause:** You haven't configured your DigitalOcean API token yet.

**Solution:**
1. Send `/setapi` to the bot
2. Reply with your DigitalOcean API token
3. Wait for confirmation

### "Invalid API token" error

**Cause:** The DigitalOcean API token is invalid or has insufficient permissions.

**Solution:**
1. Verify your token in [DigitalOcean Console](https://cloud.digitalocean.com/)
2. Ensure it has both **Read** and **Write** permissions
3. Generate a new token if needed
4. Use `/setapi` to configure the new token

### "No SSH Keys Found" error

**Cause:** Your DigitalOcean account has no SSH keys added.

**Solution:**
1. Follow [Step 3.1](#31-add-ssh-key-required) to add an SSH key
2. Try creating a droplet again

### Droplet creation fails

**Common causes:**
- Invalid API token permissions
- Selected region/size unavailable
- No billing method configured in DigitalOcean
- SSH key missing

**Solution:**
1. Check API token has Read & Write access
2. Try a different region or size
3. Ensure billing is set up in DigitalOcean
4. Verify at least one SSH key exists
5. Check logs: `npx wrangler tail`

### KV namespace binding error

**Error:** `KV namespace DROPLET_CREATION not found`

**Solution:**
1. Verify `wrangler.jsonc` has the correct KV namespace ID
2. Run: `npx wrangler kv namespace list`
3. Update the `id` field in `wrangler.jsonc` if needed
4. Redeploy: `npx wrangler deploy`

## 🔒 Security Best Practices

1. **Never commit secrets to Git** - Always use `wrangler secret put`
2. **Limit user access** - Only add trusted Telegram User IDs to `ALLOWED_USER_IDS`
3. **Use SSH keys only** - Droplets are created without password authentication
4. **Rotate API tokens periodically** - Use `/setapi` to update your token
5. **Monitor bot activity** - Regularly check logs with `wrangler tail`
6. **Keep dependencies updated** - Run `npm update` and redeploy regularly

## 🤝 Contributing

Contributions are welcome! Here's how to contribute:

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Make your changes
4. Test thoroughly: `npm test`
5. Commit your changes: `git commit -m 'Add amazing feature'`
6. Push to your fork: `git push origin feature/amazing-feature`
7. Open a Pull Request

## 📄 License

This project is open source and available under the [MIT License](LICENSE).

## 🙏 Acknowledgments

- [Cloudflare Workers](https://workers.cloudflare.com/) - Serverless platform
- [DigitalOcean API](https://docs.digitalocean.com/reference/api/) - Cloud infrastructure API
- [Telegram Bot API](https://core.telegram.org/bots/api) - Bot framework

## 📞 Support

- **Issues**: [GitHub Issues](https://github.com/ali934h/DigitalOcean-Bot/issues)
- **Telegram**: [@ali934h](https://t.me/ali934h)
- **Website**: [alihosseini.dev](https://alihosseini.dev)

---

**Made with ❤️ by [Ali Hosseini](https://github.com/ali934h)**