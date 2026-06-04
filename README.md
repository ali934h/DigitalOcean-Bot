# 🤖 DigitalOcean Telegram Bot

Manage DigitalOcean Droplets directly from Telegram, powered by Cloudflare Workers.

## Features

- Create, rebuild, rename, and delete droplets
- Power on / power off (smart button per status)
- Take snapshots per droplet
- Manage account-wide snapshots (list + delete)
- Add / edit / delete notes per droplet
- Search 200+ OS images and applications
- Smart caching (OS & Apps: 24 h | Snapshots: no cache)
- Per-user DigitalOcean API tokens

## Deploy

### 1. Create a KV Namespace

In the Cloudflare Dashboard → Workers & Pages → KV → **Create namespace**.
Name it anything (e.g. `do-bot-kv`).

### 2. Create the Worker

Dashboard → Workers & Pages → **Create Worker** → pick a name → **Deploy**.
Then click **Edit code**, paste the entire contents of `_worker.js`, and **Save and deploy**.

### 3. Bind the KV Namespace

Worker → Settings → Bindings → Add → KV namespace:

| Variable name | KV namespace |
|---|---|
| `DROPLET_CREATION` | the one you just created |

Click **Deploy**.

### 4. Add Secrets

Worker → Settings → Variables and Secrets → Add:

| Name | Type | Value |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | Secret | your token from @BotFather |
| `ALLOWED_USER_IDS` | Secret | comma-separated Telegram user IDs |

### 5. Set Compatibility Date

Worker → Settings → Compatibility date → `2025-12-09` (or later).

### 6. Register the Webhook

Open in your browser:

```
https://<your-worker>.<your-subdomain>.workers.dev/registerWebhook
```

Expected response:
```json
{"webhook": {"ok": true}, "commands": "registered", "menuButton": "configured"}
```

## First Use

1. Open your bot in Telegram → `/start`
2. Send `/setapi YOUR_DIGITALOCEAN_API_TOKEN`
3. Use `/menu`

Get a DigitalOcean API token at: https://cloud.digitalocean.com/account/api/tokens

## Commands

| Command | Description |
|---|---|
| `/start` / `/menu` | Show main menu |
| `/droplets` | List droplets |
| `/create` | Create a new droplet |
| `/snapshots` | Manage snapshots |
| `/setapi` | Set your DigitalOcean API token |
| `/clearcache` | Clear cached image data |
| `/help` | Show help |

## Architecture

```
Telegram → Webhook → Cloudflare Worker → DigitalOcean API
                           ↓
                     KV Storage
              (tokens · cache · state · notes)
```

## License

MIT — made by [Ali Hosseini](https://github.com/ali934h)
