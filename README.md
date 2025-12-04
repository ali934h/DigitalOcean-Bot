# Telegram DigitalOcean Management Bot

A serverless Telegram bot running on Cloudflare Workers that allows you to manage DigitalOcean Droplets directly from Telegram.

## Features

### Commands
- `/start` - Show welcome message and available commands
- `/droplets` - List all your Droplets with interactive buttons
- `/create` - Create a new Droplet through an interactive flow

### Droplet Management
- **List Droplets**: View all droplets with their current status
- **View Details**: Click on any droplet to see:
  - Name, Status, Region
  - Size, Memory, vCPUs, Disk
  - IP Address
  - Creation date
- **Delete Droplet**: Remove droplets with double confirmation to prevent accidental deletion
- **Create Droplet**: Interactive step-by-step creation process:
  1. Select Region
  2. Select Size (plan)
  3. Select Operating System
  4. Enter Droplet name
  5. Enter root password
  6. Confirm and create

### Security Features
- **Access Control**: Only whitelisted Telegram user IDs can use the bot
- **Secure Secrets**: All sensitive data stored in Cloudflare Workers Secrets
- **Temporary Storage**: KV namespace for secure temporary data during droplet creation
- **Confirmation Steps**: Double confirmation required for destructive actions

## Architecture

- **Platform**: Cloudflare Workers (Serverless)
- **Database**: Cloudflare KV (for temporary session data)
- **APIs**: 
  - Telegram Bot API (for messaging)
  - DigitalOcean API v2 (for droplet management)

## Prerequisites

- Node.js and npm installed
- Cloudflare account (free tier is sufficient)
- DigitalOcean account with API access
- Telegram account

## Setup Instructions

### 1. Create a Telegram Bot

1. Open Telegram and message [@BotFather](https://t.me/BotFather)
2. Send `/newbot` command
3. Follow the prompts to choose a name and username
4. Copy and save your **Bot Token** (looks like: `123456789:ABCdefGHIjklMNOpqrsTUVwxyz`)

### 2. Get Your DigitalOcean API Token

1. Log in to [DigitalOcean](https://cloud.digitalocean.com)
2. Go to **API** section: [cloud.digitalocean.com/account/api/tokens](https://cloud.digitalocean.com/account/api/tokens)
3. Click **"Generate New Token"**
4. Give it a name and select **Read & Write** access
5. Copy and save the token (it's shown only once!)

### 3. Get Your Telegram User ID

1. Message [@userinfobot](https://t.me/userinfobot) on Telegram
2. Copy your numeric **User ID** (e.g., `123456789`)

### 4. Install Wrangler CLI

```bash
npm install -g wrangler
```

### 5. Login to Cloudflare

```bash
wrangler login
```

This will open a browser window for authentication.

### 6. Create Worker Project

```bash
wrangler init telegram-do-bot
cd telegram-do-bot
```

When prompted:
- Choose: **Hello World example**
- Choose: **Worker only**
- Choose: **JavaScript**
- Git: **Yes** (optional)
- Deploy now: **No**

### 7. Add the Code

Copy the code from `src/index.js` in this repository to your project's `src/index.js` file.

### 8. Create KV Namespace

```bash
wrangler kv namespace create "DROPLET_CREATION"
```

When prompted:
- Binding name: **DROPLET_CREATION** (press Enter)
- Add to wrangler.toml: **Y**
- Local dev: **N**

### 9. Configure Secrets

Add your Telegram Bot Token:
```bash
wrangler secret put TELEGRAM_BOT_TOKEN
```
Paste your Bot Token when prompted.

Add your DigitalOcean API Token:
```bash
wrangler secret put DO_API_TOKEN
```
Paste your DO API Token when prompted.

Add allowed User IDs:
```bash
wrangler secret put ALLOWED_USER_IDS
```
Enter your Telegram User ID. For multiple users, separate with commas: `123456789,987654321`

### 10. Deploy

```bash
wrangler deploy
```

The output will show your Worker URL, like:
```
https://telegram-do-bot.your-subdomain.workers.dev
```

### 11. Register Webhook

Open this URL in your browser:
```
https://telegram-do-bot.your-subdomain.workers.dev/registerWebhook
```

You should see:
```json
{
  "ok": true,
  "result": true,
  "description": "Webhook was set"
}
```

### 12. Test the Bot

1. Open Telegram
2. Find your bot (use the username you created)
3. Send `/start`
4. You should receive a welcome message!

## Usage

### Creating a Droplet

1. Send `/create` to the bot
2. Select a **Region** from the list
3. Choose a **Size** (plan) - prices shown per month
4. Pick an **Operating System**
5. Reply with the **Droplet name**
6. Reply with a **root password**
7. Confirm the creation

The bot will create the droplet and show you the details!

### Managing Droplets

1. Send `/droplets` to see all your droplets
2. Click on any droplet to view details
3. Use the **Delete** button to remove a droplet (requires confirmation)
4. Use **Back to List** to return to the droplet list

## Project Structure

```
telegram-do-bot/
├── src/
│   └── index.js          # Main Worker code
├── wrangler.toml         # Worker configuration
├── package.json          # Node dependencies
└── README.md             # This file
```

## Environment Variables (Secrets)

| Secret | Description | Example |
|--------|-------------|---------|
| `TELEGRAM_BOT_TOKEN` | Your Telegram bot token from BotFather | `123456:ABC-DEF...` |
| `DO_API_TOKEN` | DigitalOcean API token with Read/Write access | `dop_v1_abc123...` |
| `ALLOWED_USER_IDS` | Comma-separated Telegram user IDs allowed to use the bot | `123456789,987654321` |

## KV Namespace

| Binding | Purpose |
|---------|---------|
| `DROPLET_CREATION` | Temporary storage for droplet creation flow data (expires after 5 minutes) |

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/webhook` | POST | Main Telegram webhook endpoint |
| `/registerWebhook` | GET | Helper to register webhook with Telegram |

## Deploying to a New Account

To deploy this bot with a different DigitalOcean account, Telegram bot, or Cloudflare account:

1. Create new Telegram bot (step 1)
2. Get new DigitalOcean API token (step 2)
3. Login to different Cloudflare account: `wrangler login`
4. Follow steps 6-12 with the new credentials
5. Copy the same `src/index.js` code (no modifications needed)

## Limitations

- Cloudflare Workers free tier: 100,000 requests/day
- Cloudflare KV free tier: 100,000 reads/day, 1,000 writes/day
- Telegram callback_data limited to 64 bytes (handled with KV storage)

## Security Considerations

- ✅ Only whitelisted users can access the bot
- ✅ All secrets stored securely in Workers Secrets
- ✅ No sensitive data in code or logs
- ✅ Passwords transmitted but not stored permanently
- ✅ Session data expires after 5 minutes
- ⚠️ Use strong passwords for root access
- ⚠️ Regularly rotate your API tokens

## Troubleshooting

### Bot doesn't respond
```bash
wrangler tail
```
Run this and send a message to see real-time logs.

### Webhook registration fails
Make sure your Worker is deployed first, then try registering the webhook again.

### "Access denied" message
Your User ID is not in `ALLOWED_USER_IDS`. Check your ID with @userinfobot and update the secret:
```bash
wrangler secret put ALLOWED_USER_IDS
```

### Droplet creation fails
- Verify your DO API token has Write access
- Check if you have sufficient quota in DigitalOcean
- Review the error message returned by the bot

## Development

### Local testing
```bash
wrangler dev
```

### View logs
```bash
wrangler tail
```

### Update secrets
```bash
wrangler secret put SECRET_NAME
```

### Delete the Worker
```bash
wrangler delete
```

## License

MIT License - feel free to modify and use for your own projects.

## Contributing

Contributions are welcome! Feel free to open issues or submit pull requests.

## Credits

Built with:
- [Cloudflare Workers](https://workers.cloudflare.com/)
- [Telegram Bot API](https://core.telegram.org/bots/api)
- [DigitalOcean API](https://docs.digitalocean.com/reference/api/)

---

**Note**: This bot is for personal/educational use. Always secure your API tokens and follow best practices for production deployments.
