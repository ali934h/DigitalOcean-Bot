/**
 * Marketplace Handlers
 * 
 * Handles all marketplace-related UI interactions
 */

import { MARKETPLACE_CATEGORIES, categorizeApp } from '../constants/categories.js';
import { getCachedMarketplaceApps, searchApps, groupAppsByCategory } from '../services/marketplace.js';
import { sendMessage, editMessage, deleteMessage } from '../utils/telegram.js';
import { getUserApiToken } from '../utils/auth.js';

/**
 * Show image type selection (OS Distribution or Marketplace)
 */
export async function showImageTypeSelection(chatId, env) {
    const text = '💾 *Choose Image Type*\n\nSelect the type of image for your droplet:';
    
    const keyboard = {
        inline_keyboard: [
            [{ text: '💿 OS Distribution', callback_data: 'imgtype_distribution' }],
            [{ text: '🚀 Marketplace 1-Click App', callback_data: 'imgtype_marketplace' }],
            [{ text: '❌ Cancel', callback_data: 'cancel_create' }]
        ]
    };
    
    await sendMessage(chatId, text, env, keyboard);
}

/**
 * Show marketplace menu (Browse, Search, Popular)
 */
export async function showMarketplaceMenu(chatId, env) {
    const text = '🚀 *Marketplace Apps*\n\nHow would you like to find your app?';
    
    const keyboard = {
        inline_keyboard: [
            [{ text: '📂 Browse by Category', callback_data: 'marketplace_categories' }],
            [{ text: '🔍 Search by Name', callback_data: 'marketplace_search' }],
            [{ text: '⭐ Popular Apps', callback_data: 'marketplace_popular' }],
            [{ text: '◀️ Back to Image Type', callback_data: 'back_to_image_types' }]
        ]
    };
    
    await sendMessage(chatId, text, env, keyboard);
}

/**
 * Show categories list
 */
export async function showCategories(chatId, messageId, env) {
    const text = '📂 *Browse by Category*\n\nSelect a category:';
    
    const keyboard = { inline_keyboard: [] };
    
    // Add all categories
    for (const [categoryId, category] of Object.entries(MARKETPLACE_CATEGORIES)) {
        keyboard.inline_keyboard.push([{
            text: `${category.icon} ${category.name}`,
            callback_data: `category_${categoryId}`
        }]);
    }
    
    keyboard.inline_keyboard.push([{ text: '◀️ Back', callback_data: 'back_to_marketplace_menu' }]);
    
    if (messageId) {
        await editMessage(chatId, messageId, text, env, keyboard);
    } else {
        await sendMessage(chatId, text, env, keyboard);
    }
}

/**
 * Show apps in a specific category
 */
export async function showCategoryApps(chatId, messageId, categoryId, page, env) {
    const apiToken = await getUserApiToken(chatId, env);
    
    if (!apiToken) {
        await editMessage(chatId, messageId, '❌ No API token found. Please use /setapi first.', env);
        return;
    }
    
    const apps = await getCachedMarketplaceApps(env, apiToken);
    const grouped = groupAppsByCategory(apps, categorizeApp);
    const categoryApps = grouped[categoryId] || [];
    
    if (categoryApps.length === 0) {
        await editMessage(chatId, messageId, '❌ No apps found in this category.', env);
        return;
    }
    
    const category = MARKETPLACE_CATEGORIES[categoryId] || { name: 'Other', icon: '📦' };
    const perPage = 15;
    const totalPages = Math.ceil(categoryApps.length / perPage);
    const currentPage = Math.min(page || 1, totalPages);
    const startIdx = (currentPage - 1) * perPage;
    const endIdx = startIdx + perPage;
    const pageApps = categoryApps.slice(startIdx, endIdx);
    
    const text = `${category.icon} *${category.name}* (Page ${currentPage}/${totalPages})\n\nTotal: ${categoryApps.length} apps`;
    
    const keyboard = { inline_keyboard: [] };
    
    // Add app buttons
    for (const app of pageApps) {
        keyboard.inline_keyboard.push([{
            text: `${app.name} (${app.min_disk_size}GB)`,
            callback_data: `select_app_${app.id}`
        }]);
    }
    
    // Add pagination
    const navButtons = [];
    if (currentPage > 1) {
        navButtons.push({ 
            text: '◀️ Previous', 
            callback_data: `category_${categoryId}_page_${currentPage - 1}` 
        });
    }
    navButtons.push({ 
        text: `📄 ${currentPage}/${totalPages}`, 
        callback_data: 'noop' 
    });
    if (currentPage < totalPages) {
        navButtons.push({ 
            text: 'Next ▶️', 
            callback_data: `category_${categoryId}_page_${currentPage + 1}` 
        });
    }
    
    if (navButtons.length > 1) {
        keyboard.inline_keyboard.push(navButtons);
    }
    
    keyboard.inline_keyboard.push([{ text: '🔙 Back to Categories', callback_data: 'back_to_categories' }]);
    
    await editMessage(chatId, messageId, text, env, keyboard);
}

/**
 * Ask user to search
 */
export async function askForSearch(chatId, env) {
    const text = '🔍 *Search Marketplace Apps*\n\nReply to this message with the app name or keyword.\n\nExamples:\n• WordPress\n• Docker\n• database\n• monitoring';
    
    await sendMessage(chatId, text, env);
}

/**
 * Handle search results
 */
export async function handleSearchQuery(chatId, messageId, searchTerm, env) {
    const apiToken = await getUserApiToken(chatId, env);
    
    if (!apiToken) {
        await sendMessage(chatId, '❌ No API token found. Please use /setapi first.', env);
        return;
    }
    
    // Delete the search request message
    if (messageId) {
        await deleteMessage(chatId, messageId, env);
    }
    
    const apps = await getCachedMarketplaceApps(env, apiToken);
    const results = searchApps(apps, searchTerm);
    
    if (results.length === 0) {
        await sendMessage(chatId, '❌ No apps found. Try different keywords.', env);
        return;
    }
    
    // Show up to 20 results
    const limitedResults = results.slice(0, 20);
    const keyboard = { inline_keyboard: [] };
    
    for (const app of limitedResults) {
        keyboard.inline_keyboard.push([{
            text: `${app.name} (${app.min_disk_size}GB)`,
            callback_data: `select_app_${app.id}`
        }]);
    }
    
    const text = `🔍 Found ${results.length} apps${results.length > 20 ? ' (showing first 20)' : ''}:`;
    
    await sendMessage(chatId, text, env, keyboard);
}

/**
 * Show popular apps
 */
export async function showPopularApps(chatId, messageId, env) {
    const apiToken = await getUserApiToken(chatId, env);
    
    if (!apiToken) {
        await editMessage(chatId, messageId, '❌ No API token found. Please use /setapi first.', env);
        return;
    }
    
    const apps = await getCachedMarketplaceApps(env, apiToken);
    const popularSlugs = MARKETPLACE_CATEGORIES.popular.slugs;
    const popularApps = apps.filter(app => popularSlugs.includes(app.slug));
    
    if (popularApps.length === 0) {
        await editMessage(chatId, messageId, '❌ No popular apps found.', env);
        return;
    }
    
    const text = '⭐ *Popular Apps*\n\nMost commonly used marketplace apps:';
    const keyboard = { inline_keyboard: [] };
    
    for (const app of popularApps) {
        keyboard.inline_keyboard.push([{
            text: `${app.name} (${app.min_disk_size}GB)`,
            callback_data: `select_app_${app.id}`
        }]);
    }
    
    keyboard.inline_keyboard.push([{ text: '◀️ Back', callback_data: 'back_to_marketplace_menu' }]);
    
    await editMessage(chatId, messageId, text, env, keyboard);
}