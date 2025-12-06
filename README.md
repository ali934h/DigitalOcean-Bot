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
  - Choose between OS Distribution or Marketplace 1-Click Apps
  - Browse 300+ Marketplace apps by category
  - Search apps by name or keyword
  - Quick access to popular apps (WordPress, Docker, GitLab, etc.)
  - Choose from all available regions
  - Select droplet size (sorted by price)
  - Custom or auto-generated names
- **Rebuild Droplet** - Reinstall with a new operating system
- **Delete Droplet** - Remove droplets with confirmation

### 🚀 Marketplace Apps
Deploy pre-configured applications in one click:

**Popular Apps:**
- WordPress, Ghost, Discourse (CMS & Blogs)
- Docker, GitLab, Jenkins (Developer Tools)
- MySQL, PostgreSQL, MongoDB, Redis (Databases)
- NGINX, LAMP, LEMP, MEAN, MERN (Web Servers)
- Grafana, Prometheus, Zabbix (Monitoring)
- Jupyter, PyTorch, Ollama (AI & ML)
- cPanel, Plesk, Cloudron (Control Panels)

**Browse by Category:**
- ⭐ Popular Apps
- 📝 CMS & Blogs
- 🗄️ Databases  
- 🛠️ Developer Tools
- 🌐 Web Servers
- 🤖 AI & ML
- 📊 Monitoring
- 💬 Chat & Messaging
- ⚙️ Control Panels

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
- **Smart Caching** - Marketplace apps cached for 1 hour to reduce API calls
- **Smart Filtering** - Automatically filters regions and sizes based on app requirements
- **Smart Naming** - Auto-generated droplet names based on config
- **Multi-step Wizard** - Guided droplet creation process
- **Error Handling** - Comprehensive error messages and validations

[Rest of README remains the same...]