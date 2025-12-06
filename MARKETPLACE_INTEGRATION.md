# Marketplace Integration Guide

This document explains how the Marketplace feature has been integrated into the bot.

## Architecture Overview

```
src/
├── constants/
│   └── categories.js       # Hard-coded category definitions
├── services/
│   └── marketplace.js      # API calls and caching logic
├── handlers/
│   └── marketplace.js      # UI handlers for marketplace interactions
├── utils/
│   ├── telegram.js         # Telegram API helpers
│   └── auth.js             # Authentication utilities
└── index.js               # Main application (needs integration)
```

## New Flow

### Old Flow (Before Marketplace):
```
/create
  ↓
1. Select Region
  ↓
2. Select Size
  ↓
3. Select OS Image
  ↓
4. Set Name
  ↓
5. Confirm & Create
```

### New Flow (With Marketplace):
```
/create
  ↓
1. Select Image Type:
   • 💿 OS Distribution (old flow)
   • 🚀 Marketplace Apps (new flow)
  ↓
2a. If OS Distribution:
    → Continue with old flow (Region → Size → OS)

2b. If Marketplace:
    ↓
   Choose Method:
   • 📂 Browse by Category
   • 🔍 Search by Name  
   • ⭐ Popular Apps
    ↓
   Select App
    ↓
3. Select Region (filtered by app.regions)
  ↓
4. Select Size (filtered by app.min_disk_size)
  ↓
5. Set Name
  ↓
6. Confirm & Create
```

## Integration Steps

### Step 1: Add to index.js

Import the new modules at the top of `src/index.js`:

```javascript
import { showImageTypeSelection, showMarketplaceMenu, showCategories, showCategoryApps, askForSearch, handleSearchQuery, showPopularApps } from './handlers/marketplace.js';
import { getUserApiToken } from './utils/auth.js';
```

### Step 2: Update /create Command

Replace the existing `/create` handler:

```javascript
// OLD:
else if (text === '/create') {
    await showRegions(chatId, env);
}

// NEW:
else if (text === '/create') {
    await showImageTypeSelection(chatId, env);
}
```

### Step 3: Add New Callback Handlers

In `handleCallbackQuery()`, add these new cases:

```javascript
// Image type selection
if (data === 'imgtype_distribution') {
    await deleteMessage(chatId, messageId, env);
    await showRegions(chatId, env); // Old flow
} 
else if (data === 'imgtype_marketplace') {
    await deleteMessage(chatId, messageId, env);
    await showMarketplaceMenu(chatId, env);
}

// Marketplace menu
else if (data === 'marketplace_categories') {
    await showCategories(chatId, messageId, env);
}
else if (data === 'marketplace_search') {
    await deleteMessage(chatId, messageId, env);
    await askForSearch(chatId, env);
}
else if (data === 'marketplace_popular') {
    await showPopularApps(chatId, messageId, env);
}

// Category selection
else if (data.startsWith('category_')) {
    const parts = data.replace('category_', '').split('_page_');
    const categoryId = parts[0];
    const page = parts[1] ? parseInt(parts[1]) : 1;
    await showCategoryApps(chatId, messageId, categoryId, page, env);
}

// App selection
else if (data.startsWith('select_app_')) {
    const appId = parseInt(data.replace('select_app_', ''));
    await showRegionsForApp(chatId, messageId, appId, env);
}

// Navigation
else if (data === 'back_to_image_types') {
    await showImageTypeSelection(chatId, env);
}
else if (data === 'back_to_marketplace_menu') {
    await deleteMessage(chatId, messageId, env);
    await showMarketplaceMenu(chatId, env);
}
else if (data === 'back_to_categories') {
    await showCategories(chatId, messageId, env);
}
```

### Step 4: Add Search Handler

In `handleMessage()`, add search detection:

```javascript
// Check if this is a reply to search request
if (message.reply_to_message?.text?.includes('Search Marketplace Apps')) {
    await handleSearchQuery(chatId, message.reply_to_message.message_id, text, env);
    return;
}
```

### Step 5: Update Region/Size Selection

Create new functions for marketplace app flow:

```javascript
async function showRegionsForApp(chatId, messageId, appId, env) {
    const apiToken = await getUserApiToken(chatId, env);
    const apps = await getCachedMarketplaceApps(env, apiToken);
    const app = apps.find(a => a.id === appId);
    
    // Get regions
    const regionsResponse = await fetch('https://api.digitalocean.com/v2/regions', {
        headers: { Authorization: `Bearer ${apiToken}` }
    });
    const regionsData = await regionsResponse.json();
    
    // Filter only regions where this app is available
    const availableRegions = regionsData.regions.filter(
        region => region.available && app.regions.includes(region.slug)
    );
    
    const keyboard = { inline_keyboard: [] };
    
    for (let i = 0; i < availableRegions.length; i += 2) {
        const row = [];
        row.push({
            text: availableRegions[i].name,
            callback_data: `appregion_${appId}_${availableRegions[i].slug}`
        });
        if (i + 1 < availableRegions.length) {
            row.push({
                text: availableRegions[i + 1].name,
                callback_data: `appregion_${appId}_${availableRegions[i + 1].slug}`
            });
        }
        keyboard.inline_keyboard.push(row);
    }
    
    await editMessage(
        chatId,
        messageId,
        `🌍 *Select Region*\n\n${app.name}\nMin Disk: ${app.min_disk_size}GB`,
        env,
        keyboard
    );
}

async function showSizesForApp(chatId, messageId, appId, region, env) {
    const apiToken = await getUserApiToken(chatId, env);
    const apps = await getCachedMarketplaceApps(env, apiToken);
    const app = apps.find(a => a.id === appId);
    
    // Get sizes
    const sizesResponse = await fetch('https://api.digitalocean.com/v2/sizes', {
        headers: { Authorization: `Bearer ${apiToken}` }
    });
    const sizesData = await sizesResponse.json();
    
    // Filter: must be in region AND have enough disk
    const availableSizes = sizesData.sizes.filter(size => 
        size.available &&
        size.regions.includes(region) &&
        size.disk >= app.min_disk_size  // KEY FILTER!
    );
    
    const keyboard = { inline_keyboard: [] };
    
    for (const size of availableSizes) {
        keyboard.inline_keyboard.push([{
            text: `${size.slug} - $${size.price_monthly}/mo (${size.vcpus}CPU, ${size.memory}MB, ${size.disk}GB)`,
            callback_data: `appsize_${appId}_${region}_${size.slug}`
        }]);
    }
    
    await editMessage(
        chatId,
        messageId,
        `💾 *Select Size*\n\nMinimum: ${app.min_disk_size}GB`,
        env,
        keyboard
    );
}
```

## Key Features

### 1. Caching
Marketplace apps are cached for 1 hour to reduce API calls:
- Cache key: `marketplace_apps_cache`
- TTL: 3600 seconds
- Automatically refreshes after expiration

### 2. Smart Filtering

**Region Filtering:**
```javascript
app.regions.includes(region.slug)
```
Only shows regions where the selected app is available.

**Size Filtering:**
```javascript
size.disk >= app.min_disk_size
```
Only shows sizes that meet the app's minimum disk requirement.

### 3. Categorization
Apps are categorized using keyword matching:
```javascript
function categorizeApp(app) {
    const searchText = `${app.name} ${app.slug} ${app.description}`;
    
    // Check popular first
    if (POPULAR_SLUGS.includes(app.slug)) return 'popular';
    
    // Check by keywords
    for (const [category, keywords] of CATEGORIES) {
        if (keywords.some(k => searchText.includes(k))) {
            return category;
        }
    }
    
    return 'other';
}
```

### 4. Search
Client-side search using multiple fields:
```javascript
app.name.includes(term) ||
app.slug.includes(term) ||
app.description?.includes(term)
```

## Testing

### Test Checklist

- [ ] `/create` shows image type selection
- [ ] "OS Distribution" continues with old flow
- [ ] "Marketplace Apps" shows menu
- [ ] Browse by category works
- [ ] Category pagination works
- [ ] Search by name works
- [ ] Popular apps list works
- [ ] Region filtering works (only app-compatible regions)
- [ ] Size filtering works (only sizes >= min_disk_size)
- [ ] Navigation back buttons work
- [ ] Droplet creation with marketplace image works

### Test Cases

1. **Create with WordPress:**
   - Select Marketplace → Popular Apps → WordPress
   - Verify min_disk is 25GB
   - Verify only sizes with 25GB+ disk show up
   - Create and verify it works

2. **Search for Docker:**
   - Select Marketplace → Search
   - Type "docker"
   - Verify Docker appears in results
   - Select and create

3. **Browse Databases:**
   - Select Marketplace → Categories → Databases
   - Verify MySQL, PostgreSQL, MongoDB appear
   - Test pagination if >15 items

## Deployment

```bash
# Deploy to production
npx wrangler deploy

# Monitor logs
npx wrangler tail
```

## Migration Notes

**Breaking Changes:** None. The old flow still works for "OS Distribution" selection.

**New Dependencies:** None (uses existing fetch API)

**Environment Variables:** No changes needed

**KV Storage:** Uses existing `DROPLET_CREATION` namespace for caching