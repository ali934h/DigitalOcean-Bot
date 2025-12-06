/**
 * DigitalOcean Telegram Bot - Complete Version with 1-Click Apps Support
 * 
 * Features:
 * - /start: Welcome message
 * - /setapi: Configure DigitalOcean API token
 * - /droplets: List and manage droplets
 * - /create: Create droplets with OS or 1-Click Apps
 *   - Choose between Operating Systems or 1-Click Apps
 *   - For Apps: Search or browse Popular Apps
 *   - Dynamic popular apps from config.js
 *   - Full droplet creation flow
 * - Rebuild and delete droplets
 * - SSH key management
 */

import { POPULAR_APP_KEYWORDS, APP_DISPLAY_NAMES } from './config.js';

export default {
	async fetch(request, env) {
		const url = new URL(request.url);

		if (url.pathname === '/registerWebhook') {
			const webhookUrl = `${url.origin}/webhook`;
			const telegramApiUrl = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/setWebhook?url=${webhookUrl}`;
			const response = await fetch(telegramApiUrl);
			const result = await response.json();
			return new Response(JSON.stringify(result, null, 2), {
				headers: { 'Content-Type': 'application/json' },
			});
		}

		if (url.pathname === '/webhook' && request.method === 'POST') {
			const update = await request.json();
			if (update.message) {
				await handleMessage(update.message, env);
			} else if (update.callback_query) {
				await handleCallbackQuery(update.callback_query, env);
			}
			return new Response('OK');
		}

		return new Response('DigitalOcean Bot Running!');
	},
};

// === API HELPERS ===

async function doApiCall(endpoint, method, apiToken, body = null) {
	const options = {
		method: method,
		headers: {
			Authorization: `Bearer ${apiToken}`,
			'Content-Type': 'application/json',
		},
	};
	if (body) options.body = JSON.stringify(body);
	const response = await fetch(`https://api.digitalocean.com/v2${endpoint}`, options);
	return await response.json();
}

// === TOKEN MANAGEMENT ===

async function saveUserApiToken(userId, apiToken, env) {
	try {
		const testUrl = 'https://api.digitalocean.com/v2/account';
		const testResponse = await fetch(testUrl, {
			headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
		});
		if (!testResponse.ok) return false;
		await clearUserSessions(userId, env);
		await env.DROPLET_CREATION.put(`api_token_${userId}`, apiToken);
		return true;
	} catch (error) {
		console.error('Error validating API token:', error);
		return false;
	}
}

async function getUserApiToken(userId, env) {
	try {
		return await env.DROPLET_CREATION.get(`api_token_${userId}`);
	} catch (error) {
		console.error('Error getting API token:', error);
		return null;
	}
}

async function clearUserSessions(userId, env) {
	try {
		const listResult = await env.DROPLET_CREATION.list({ prefix: `session_${userId}_` });
		const createListResult = await env.DROPLET_CREATION.list({ prefix: `create_${userId}_` });
		const allKeys = [...listResult.keys.map(k => k.name), ...createListResult.keys.map(k => k.name)];
		for (const key of allKeys) {
			await env.DROPLET_CREATION.delete(key);
		}
	} catch (error) {
		console.error('Error clearing sessions:', error);
	}
}

// === MARKETPLACE APPS ===

async function getMarketplaceApps(env, apiToken) {
	const cached = await env.DROPLET_CREATION.get('marketplace_apps');
	if (cached) return JSON.parse(cached);
	const data = await doApiCall('/1-clicks?type=droplet', 'GET', apiToken);
	const apps = data['1_clicks'];
	await env.DROPLET_CREATION.put('marketplace_apps', JSON.stringify(apps), { expirationTtl: 3600 });
	return apps;
}

async function getPopularApps(env, apiToken) {
	const allApps = await getMarketplaceApps(env, apiToken);
	const popularApps = [];
	POPULAR_APP_KEYWORDS.forEach(keyword => {
		const match = allApps.find(app => app.slug.toLowerCase().includes(keyword.toLowerCase()));
		if (match) {
			popularApps.push({
				slug: match.slug,
				name: APP_DISPLAY_NAMES[match.slug] || match.slug
			});
		}
	});
	return popularApps;
}

// === TELEGRAM HELPERS ===

async function sendMessage(chatId, text, env, replyMarkup = null) {
	const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
	const body = { chat_id: chatId, text: text, parse_mode: 'Markdown' };
	if (replyMarkup) body.reply_markup = replyMarkup;
	const response = await fetch(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	});
	return await response.json();
}

async function editMessage(chatId, messageId, text, env, replyMarkup = null) {
	const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/editMessageText`;
	const body = { chat_id: chatId, message_id: messageId, text: text, parse_mode: 'Markdown' };
	if (replyMarkup) body.reply_markup = replyMarkup;
	await fetch(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	});
}

async function deleteMessage(chatId, messageId, env) {
	const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/deleteMessage`;
	await fetch(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ chat_id: chatId, message_id: messageId }),
	});
}

// === MESSAGE HANDLERS ===

async function handleMessage(message, env) {
	const chatId = message.chat.id;
	const userId = message.from.id;
	const text = message.text;

	// Check authorization
	const allowedUsers = env.ALLOWED_USER_IDS.split(',').map(id => parseInt(id.trim()));
	if (!allowedUsers.includes(userId)) {
		await sendMessage(chatId, '⛔ Access denied. You are not authorized to use this bot.', env);
		return;
	}

	// Handle API token reply
	if (message.reply_to_message?.text?.includes('Please reply to this message with your') && 
	    message.reply_to_message?.text?.includes('DigitalOcean API token')) {
		await deleteMessage(chatId, message.reply_to_message.message_id, env);
		await deleteMessage(chatId, message.message_id, env);
		const validatingMsg = await sendMessage(chatId, '⏳ Validating your API token...', env);
		const isValid = await saveUserApiToken(chatId, text.trim(), env);
		if (validatingMsg.result?.message_id) {
			await deleteMessage(chatId, validatingMsg.result.message_id, env);
		}
		if (isValid) {
			await sendMessage(chatId, '✅ API token saved successfully!\n\nYou can now use /droplets and /create commands.', env);
		} else {
			await sendMessage(chatId, '❌ Invalid API token!\n\nPlease check and try /setapi again.', env);
		}
		return;
	}

	// Handle droplet name reply
	if (message.reply_to_message?.text?.includes('Default name:')) {
		const lines = message.reply_to_message.text.split('\n');
		const region = lines.find(l => l.startsWith('Region:'))?.split(':')[1].trim();
		const size = lines.find(l => l.startsWith('Size:'))?.split(':')[1].trim();
		const image = lines.find(l => l.startsWith('Image:'))?.split(':')[1].trim();
		await deleteMessage(chatId, message.reply_to_message.message_id, env);
		await confirmDropletCreation(chatId, text, region, size, image, env);
		return;
	}

	// Handle search query
	const state = await getState(chatId, env);
	if (state?.step === 'searching_app') {
		await handleAppSearch(chatId, text, env);
		return;
	}

	// Commands
	if (text === '/start') {
		const hasApiToken = await getUserApiToken(chatId, env);
		const welcomeMsg = hasApiToken
			? '👋 Welcome!\n\nCommands:\n/droplets - List droplets\n/create - Create new droplet\n/setapi - Change API token'
			: '👋 Welcome!\n\n⚠️ Set your API token first with /setapi';
		await sendMessage(chatId, welcomeMsg, env);
	} else if (text === '/setapi') {
		const hasExisting = await getUserApiToken(chatId, env);
		const tokenText = hasExisting
			? '🔑 *Change API Token*\n\n⚠️ This will clear all sessions.\n\nReply with your new DigitalOcean API token.'
			: '🔑 *Setup API Token*\n\nReply with your DigitalOcean API token.\n\nGet it at: https://cloud.digitalocean.com/';
		await sendMessage(chatId, tokenText, env);
	} else if (text === '/droplets') {
		await listDroplets(chatId, env);
	} else if (text === '/create') {
		await showImageTypeSelection(chatId, env);
	}
}

async function handleCallbackQuery(callbackQuery, env) {
	const chatId = callbackQuery.message.chat.id;
	const messageId = callbackQuery.message.message_id;
	const data = callbackQuery.data;

	await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ callback_query_id: callbackQuery.id }),
	});

	// Image type selection
	if (data === 'image_type:os') {
		await editMessage(chatId, messageId, '⏳ Loading OS images...', env);
		await deleteMessage(chatId, messageId, env);
		await showOSImages(chatId, env);
	} else if (data === 'image_type:app') {
		const keyboard = {
			inline_keyboard: [
				[{ text: '🔍 Search Apps', callback_data: 'app_menu:search' }],
				[{ text: '⭐ Popular Apps', callback_data: 'app_menu:popular' }],
				[{ text: '❌ Cancel', callback_data: 'cancel_create' }],
			]
		};
		await editMessage(chatId, messageId, '📦 *1-Click Apps*\n\nChoose option:', env, keyboard);
	}
	// App menu
	else if (data === 'app_menu:search') {
		await deleteMessage(chatId, messageId, env);
		await sendMessage(chatId, '🔍 *Search Apps*\n\nType app name (e.g., wordpress, docker):', env);
		await setState(chatId, { step: 'searching_app' }, env);
	} else if (data === 'app_menu:popular') {
		await showPopularApps(chatId, messageId, env);
	}
	// App selection
	else if (data.startsWith('select_app:')) {
		const slug = data.replace('select_app:', '');
		const displayName = APP_DISPLAY_NAMES[slug] || slug;
		await editMessage(chatId, messageId, `✅ *App selected:* ${displayName}`, env);
		await setState(chatId, { image: slug }, env);
		await showRegions(chatId, env);
	}
	// OS selection
	else if (data.startsWith('select_os:')) {
		const slug = data.replace('select_os:', '');
		await editMessage(chatId, messageId, `✅ *OS selected:* ${slug}`, env);
		await setState(chatId, { image: slug }, env);
		await showRegions(chatId, env);
	}
	// Region selection
	else if (data.startsWith('region_')) {
		const region = data.replace('region_', '');
		const state = await getState(chatId, env);
		state.region = region;
		await setState(chatId, state, env);
		await deleteMessage(chatId, messageId, env);
		await showSizes(chatId, region, env);
	}
	// Size selection
	else if (data.startsWith('size_')) {
		const parts = data.replace('size_', '').split('_');
		const region = parts[0];
		const size = parts.slice(1).join('_');
		const state = await getState(chatId, env);
		state.size = size;
		await setState(chatId, state, env);
		await deleteMessage(chatId, messageId, env);
		await askDropletName(chatId, state.image, size, region, env);
	}
	// Droplet name
	else if (data.startsWith('use_default_name_')) {
		const sessionId = data.replace('use_default_name_', '');
		await deleteMessage(chatId, messageId, env);
		await useDefaultNameAndConfirm(chatId, sessionId, env);
	}
	// Confirm creation
	else if (data.startsWith('confirmcreate_')) {
		const creationId = data.replace('confirmcreate_', '');
		await createDropletFromKV(chatId, messageId, creationId, env);
	}
	// Droplet management
	else if (data.startsWith('droplet_')) {
		const dropletId = data.replace('droplet_', '');
		await showDropletDetails(chatId, messageId, dropletId, env);
	} else if (data.startsWith('confirm_delete_')) {
		const dropletId = data.replace('confirm_delete_', '');
		await showDeleteConfirmation(chatId, messageId, dropletId, env);
	} else if (data.startsWith('delete_')) {
		const dropletId = data.replace('delete_', '');
		await deleteDroplet(chatId, messageId, dropletId, env);
	} else if (data === 'back_to_list') {
		await editMessageToDropletList(chatId, messageId, env);
	} else if (data.startsWith('rebuild_')) {
		const dropletId = data.replace('rebuild_', '');
		await showRebuildOptions(chatId, messageId, dropletId, env);
	} else if (data.startsWith('rbc_')) {
		const sessionId = data.replace('rbc_', '');
		await confirmRebuild(chatId, messageId, sessionId, env);
	} else if (data.startsWith('rbe_')) {
		const sessionId = data;
		await executeRebuild(chatId, messageId, sessionId, env);
	}
	// Cancel
	else if (data === 'cancel_create') {
		await clearState(chatId, env);
		await editMessage(chatId, messageId, '❌ Cancelled.', env);
	} else if (data === 'back_to_regions') {
		await showRegionsEdit(chatId, messageId, env);
	} else if (data.startsWith('back_to_sizes_')) {
		const region = data.replace('back_to_sizes_', '');
		await showSizesEdit(chatId, messageId, region, env);
	}
}

// === STATE MANAGEMENT ===

async function getState(chatId, env) {
	const stateJson = await env.DROPLET_CREATION.get(`state_${chatId}`);
	return stateJson ? JSON.parse(stateJson) : null;
}

async function setState(chatId, state, env) {
	await env.DROPLET_CREATION.put(`state_${chatId}`, JSON.stringify(state), { expirationTtl: 600 });
}

async function clearState(chatId, env) {
	await env.DROPLET_CREATION.delete(`state_${chatId}`);
}

// === IMAGE SELECTION ===

async function showImageTypeSelection(chatId, env) {
	const apiToken = await getUserApiToken(chatId, env);
	if (!apiToken) {
		await sendMessage(chatId, '❌ No API token. Use /setapi first.', env);
		return;
	}
	const keyboard = {
		inline_keyboard: [
			[{ text: '🐧 Operating Systems', callback_data: 'image_type:os' }],
			[{ text: '📦 1-Click Apps', callback_data: 'image_type:app' }],
		]
	};
	await sendMessage(chatId, '🚀 *Create New Droplet*\n\nChoose image type:', env, keyboard);
}

async function showOSImages(chatId, env) {
	const apiToken = await getUserApiToken(chatId, env);
	const url = 'https://api.digitalocean.com/v2/images?type=distribution&per_page=100';
	const response = await fetch(url, {
		headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
	});
	const data = await response.json();
	const popularImages = data.images
		.filter(img => img.status === 'available' && 
			(img.slug?.includes('ubuntu') || img.slug?.includes('debian') || 
			 img.slug?.includes('centos') || img.slug?.includes('fedora') || 
			 img.slug?.includes('rocky')))
		.slice(0, 10);
	const keyboard = popularImages.map(image => [{
		text: image.name,
		callback_data: `select_os:${image.slug || image.id}`
	}]);
	keyboard.push([{ text: '❌ Cancel', callback_data: 'cancel_create' }]);
	await sendMessage(chatId, '🐧 *Select Operating System:*', env, { inline_keyboard: keyboard });
}

async function showPopularApps(chatId, messageId, env) {
	const apiToken = await getUserApiToken(chatId, env);
	const popularApps = await getPopularApps(env, apiToken);
	if (popularApps.length === 0) {
		await editMessage(chatId, messageId, '❌ No popular apps found.', env);
		return;
	}
	const keyboard = popularApps.map(app => [{
		text: app.name,
		callback_data: `select_app:${app.slug}`
	}]);
	keyboard.push([{ text: '🔍 Search Instead', callback_data: 'app_menu:search' }]);
	keyboard.push([{ text: '❌ Cancel', callback_data: 'cancel_create' }]);
	await editMessage(chatId, messageId, '⭐ *Popular Apps:*', env, { inline_keyboard: keyboard });
}

async function handleAppSearch(chatId, query, env) {
	const apiToken = await getUserApiToken(chatId, env);
	const apps = await getMarketplaceApps(env, apiToken);
	const term = query.toLowerCase();
	const results = apps.filter(app => app.slug.toLowerCase().includes(term));
	if (results.length === 0) {
		await sendMessage(chatId, '❌ No apps found. Try again:', env);
		return;
	}
	const keyboard = results.slice(0, 15).map(app => [{
		text: APP_DISPLAY_NAMES[app.slug] || app.slug,
		callback_data: `select_app:${app.slug}`
	}]);
	await sendMessage(chatId, `📦 Found ${results.length} app(s):`, env, { inline_keyboard: keyboard });
	await clearState(chatId, env);
}

// === REGION & SIZE ===

async function showRegions(chatId, env) {
	const apiToken = await getUserApiToken(chatId, env);
	const data = await doApiCall('/regions', 'GET', apiToken);
	const availableRegions = data.regions.filter(region => region.available);
	const keyboard = [];
	for (let i = 0; i < availableRegions.length; i += 2) {
		const row = [];
		row.push({ text: availableRegions[i].name, callback_data: `region_${availableRegions[i].slug}` });
		if (i + 1 < availableRegions.length) {
			row.push({ text: availableRegions[i + 1].name, callback_data: `region_${availableRegions[i + 1].slug}` });
		}
		keyboard.push(row);
	}
	keyboard.push([{ text: '❌ Cancel', callback_data: 'cancel_create' }]);
	await sendMessage(chatId, '🌍 *Select a region:*', env, { inline_keyboard: keyboard });
}

async function showRegionsEdit(chatId, messageId, env) {
	const apiToken = await getUserApiToken(chatId, env);
	const data = await doApiCall('/regions', 'GET', apiToken);
	const availableRegions = data.regions.filter(region => region.available);
	const keyboard = [];
	for (let i = 0; i < availableRegions.length; i += 2) {
		const row = [];
		row.push({ text: availableRegions[i].name, callback_data: `region_${availableRegions[i].slug}` });
		if (i + 1 < availableRegions.length) {
			row.push({ text: availableRegions[i + 1].name, callback_data: `region_${availableRegions[i + 1].slug}` });
		}
		keyboard.push(row);
	}
	keyboard.push([{ text: '❌ Cancel', callback_data: 'cancel_create' }]);
	await editMessage(chatId, messageId, '🌍 *Select a region:*', env, { inline_keyboard: keyboard });
}

async function showSizes(chatId, region, env) {
	const apiToken = await getUserApiToken(chatId, env);
	const data = await doApiCall('/sizes', 'GET', apiToken);
	const availableSizes = data.sizes
		.filter(size => size.available && size.regions.includes(region))
		.sort((a, b) => a.price_monthly - b.price_monthly);
	const keyboard = availableSizes.map(size => [{
		text: `${size.slug} - $${size.price_monthly}/mo (${size.memory}MB RAM)`,
		callback_data: `size_${region}_${size.slug}`
	}]);
	keyboard.push([{ text: '◀️ Back', callback_data: 'back_to_regions' }]);
	keyboard.push([{ text: '❌ Cancel', callback_data: 'cancel_create' }]);
	await sendMessage(chatId, '💰 *Select a plan:*', env, { inline_keyboard: keyboard });
}

async function showSizesEdit(chatId, messageId, region, env) {
	const apiToken = await getUserApiToken(chatId, env);
	const data = await doApiCall('/sizes', 'GET', apiToken);
	const availableSizes = data.sizes
		.filter(size => size.available && size.regions.includes(region))
		.sort((a, b) => a.price_monthly - b.price_monthly);
	const keyboard = availableSizes.map(size => [{
		text: `${size.slug} - $${size.price_monthly}/mo (${size.memory}MB RAM)`,
		callback_data: `size_${region}_${size.slug}`
	}]);
	keyboard.push([{ text: '◀️ Back', callback_data: 'back_to_regions' }]);
	keyboard.push([{ text: '❌ Cancel', callback_data: 'cancel_create' }]);
	await editMessage(chatId, messageId, '💰 *Select a plan:*', env, { inline_keyboard: keyboard });
}

// === DROPLET NAME & CREATION ===

function generateDropletName(image, size, region) {
	const imageSlug = image.split('-')[0];
	const timestamp = Date.now().toString().slice(-4);
	return `${imageSlug}-${size}-${region}-${timestamp}`;
}

async function askDropletName(chatId, image, size, region, env) {
	const defaultName = generateDropletName(image, size, region);
	const sessionId = `session_${chatId}_${Date.now()}`;
	await env.DROPLET_CREATION.put(sessionId, JSON.stringify({
		region, size, image, defaultName
	}), { expirationTtl: 300 });
	const text = `📝 *Droplet Name*\n\nRegion: ${region}\nSize: ${size}\nImage: ${image}\n\nDefault name: \`${defaultName}\`\n\nReply to this message to change the name.`;
	const keyboard = {
		inline_keyboard: [
			[{ text: '✅ Use Default Name', callback_data: `use_default_name_${sessionId}` }],
			[{ text: '❌ Cancel', callback_data: 'cancel_create' }],
		]
	};
	await sendMessage(chatId, text, env, keyboard);
}

async function useDefaultNameAndConfirm(chatId, sessionId, env) {
	const dataStr = await env.DROPLET_CREATION.get(sessionId);
	if (!dataStr) {
		await sendMessage(chatId, '❌ Session expired. Try /create again.', env);
		return;
	}
	const data = JSON.parse(dataStr);
	await confirmDropletCreation(chatId, data.defaultName, data.region, data.size, data.image, env);
	await env.DROPLET_CREATION.delete(sessionId);
}

async function confirmDropletCreation(chatId, name, region, size, image, env) {
	const apiToken = await getUserApiToken(chatId, env);
	const keysData = await doApiCall('/account/keys', 'GET', apiToken);
	const sshKeys = keysData.ssh_keys || [];
	if (sshKeys.length === 0) {
		await sendMessage(chatId, '❌ *No SSH Keys*\n\nAdd at least one SSH key to your DigitalOcean account first.', env);
		return;
	}
	const creationId = `create_${chatId}_${Date.now()}`;
	await env.DROPLET_CREATION.put(creationId, JSON.stringify({
		name, region, size, image, sshKeyIds: sshKeys.map(key => key.id)
	}), { expirationTtl: 300 });
	const sshKeysList = sshKeys.map(key => `• ${key.name}`).join('\n');
	const text = `⚠️ *Confirm*\n\n*Name:* ${name}\n*Region:* ${region}\n*Size:* ${size}\n*Image:* ${image}\n\n*SSH Keys (${sshKeys.length}):*\n${sshKeysList}`;
	const keyboard = {
		inline_keyboard: [
			[{ text: '✅ Create', callback_data: `confirmcreate_${creationId}` }, { text: '❌ Cancel', callback_data: 'cancel_create' }],
		]
	};
	await sendMessage(chatId, text, env, keyboard);
}

async function createDropletFromKV(chatId, messageId, creationId, env) {
	const apiToken = await getUserApiToken(chatId, env);
	const dataStr = await env.DROPLET_CREATION.get(creationId);
	if (!dataStr) {
		await editMessage(chatId, messageId, '❌ Session expired.', env);
		return;
	}
	const data = JSON.parse(dataStr);
	await editMessage(chatId, messageId, '⏳ Creating droplet...', env);
	const result = await doApiCall('/droplets', 'POST', apiToken, {
		name: data.name,
		region: data.region,
		size: data.size,
		image: data.image,
		ssh_keys: data.sshKeyIds,
		backups: false,
		ipv6: false,
		monitoring: true,
	});
	if (result.droplet) {
		const publicIPv4 = result.droplet.networks.v4.find(net => net.type === 'public')?.ip_address || 'Assigning...';
		const successText = `✅ *Droplet Created!*\n\n*Name:* ${result.droplet.name}\n*IP:* \`${publicIPv4}\`\n\n*SSH:*\n\`ssh root@${publicIPv4}\`\n\nUse /droplets to manage.`;
		await editMessage(chatId, messageId, successText, env);
		await env.DROPLET_CREATION.delete(creationId);
	} else {
		await editMessage(chatId, messageId, `❌ Failed: ${result.message || 'Unknown error'}`, env);
	}
}

// === DROPLET MANAGEMENT ===

async function listDroplets(chatId, env) {
	const apiToken = await getUserApiToken(chatId, env);
	if (!apiToken) {
		await sendMessage(chatId, '❌ No API token. Use /setapi first.', env);
		return;
	}
	const data = await doApiCall('/droplets', 'GET', apiToken);
	if (!data.droplets || data.droplets.length === 0) {
		await sendMessage(chatId, 'No droplets found.', env);
		return;
	}
	const keyboard = data.droplets.map(droplet => [{
		text: `${droplet.name} (${droplet.status})`,
		callback_data: `droplet_${droplet.id}`
	}]);
	await sendMessage(chatId, 'Your Droplets:', env, { inline_keyboard: keyboard });
}

async function showDropletDetails(chatId, messageId, dropletId, env) {
	const apiToken = await getUserApiToken(chatId, env);
	const data = await doApiCall(`/droplets/${dropletId}`, 'GET', apiToken);
	if (!data.droplet) {
		await editMessage(chatId, messageId, '❌ Droplet not found.', env);
		return;
	}
	const droplet = data.droplet;
	const publicIPv4 = droplet.networks.v4.find(net => net.type === 'public')?.ip_address || 'Not assigned';
	const details = `📦 *Droplet*\n\n*Name:* ${droplet.name}\n*Status:* ${droplet.status}\n*Region:* ${droplet.region.name}\n*Size:* ${droplet.size_slug}\n*IP:* \`${publicIPv4}\`\n\n*SSH:*\n\`ssh root@${publicIPv4}\``;
	const keyboard = {
		inline_keyboard: [
			[{ text: '🔄 Rebuild', callback_data: `rebuild_${dropletId}` }],
			[{ text: '🗑️ Delete', callback_data: `confirm_delete_${dropletId}` }],
			[{ text: '◀️ Back', callback_data: 'back_to_list' }],
		]
	};
	await editMessage(chatId, messageId, details, env, keyboard);
}

async function showDeleteConfirmation(chatId, messageId, dropletId, env) {
	const keyboard = {
		inline_keyboard: [
			[{ text: '✅ Yes, Delete', callback_data: `delete_${dropletId}` }, { text: '❌ Cancel', callback_data: `droplet_${dropletId}` }],
		]
	};
	await editMessage(chatId, messageId, '⚠️ Delete this droplet?\n\nCannot be undone!', env, keyboard);
}

async function deleteDroplet(chatId, messageId, dropletId, env) {
	const apiToken = await getUserApiToken(chatId, env);
	const response = await fetch(`https://api.digitalocean.com/v2/droplets/${dropletId}`, {
		method: 'DELETE',
		headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
	});
	if (response.status === 204) {
		await editMessage(chatId, messageId, '✅ Droplet deleted!', env);
	} else {
		await editMessage(chatId, messageId, '❌ Failed to delete.', env);
	}
}

async function editMessageToDropletList(chatId, messageId, env) {
	const apiToken = await getUserApiToken(chatId, env);
	const data = await doApiCall('/droplets', 'GET', apiToken);
	if (!data.droplets || data.droplets.length === 0) {
		await editMessage(chatId, messageId, 'No droplets found.', env);
		return;
	}
	const keyboard = data.droplets.map(droplet => [{
		text: `${droplet.name} (${droplet.status})`,
		callback_data: `droplet_${droplet.id}`
	}]);
	await editMessage(chatId, messageId, 'Your Droplets:', env, { inline_keyboard: keyboard });
}

async function showRebuildOptions(chatId, messageId, dropletId, env) {
	const apiToken = await getUserApiToken(chatId, env);
	const url = 'https://api.digitalocean.com/v2/images?type=distribution&per_page=100';
	const response = await fetch(url, {
		headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
	});
	const data = await response.json();
	const popularImages = data.images
		.filter(img => img.status === 'available' && 
			(img.slug?.includes('ubuntu') || img.slug?.includes('debian') || 
			 img.slug?.includes('centos') || img.slug?.includes('fedora') || 
			 img.slug?.includes('rocky')))
		.slice(0, 10);
	const keyboard = [];
	for (let i = 0; i < popularImages.length; i++) {
		const image = popularImages[i];
		const imageSlug = image.slug || String(image.id);
		const timestamp = Date.now().toString(36);
		const random = Math.random().toString(36).substr(2, 3);
		const sessionId = `rb${i}_${timestamp}_${random}`;
		await env.DROPLET_CREATION.put(sessionId, JSON.stringify({ dropletId, imageSlug }), { expirationTtl: 300 });
		keyboard.push([{ text: image.name, callback_data: `rbc_${sessionId}` }]);
	}
	keyboard.push([{ text: '◀️ Back', callback_data: `droplet_${dropletId}` }]);
	await editMessage(chatId, messageId, '🔄 *Rebuild*\n\n⚠️ All data will be erased!', env, { inline_keyboard: keyboard });
}

async function confirmRebuild(chatId, messageId, sessionId, env) {
	const dataStr = await env.DROPLET_CREATION.get(sessionId);
	if (!dataStr) {
		await editMessage(chatId, messageId, '❌ Session expired.', env);
		return;
	}
	const data = JSON.parse(dataStr);
	const execSessionId = `rbe_${Date.now().toString(36)}_${Math.random().toString(36).substr(2, 3)}`;
	await env.DROPLET_CREATION.put(execSessionId, JSON.stringify(data), { expirationTtl: 300 });
	const text = `⚠️ *Confirm Rebuild*\n\nDroplet ID: ${data.dropletId}\nNew OS: ${data.imageSlug}\n\n*All data will be deleted!*`;
	const keyboard = {
		inline_keyboard: [
			[{ text: '✅ Yes, Rebuild', callback_data: execSessionId }, { text: '❌ Cancel', callback_data: `droplet_${data.dropletId}` }],
		]
	};
	await editMessage(chatId, messageId, text, env, keyboard);
}

async function executeRebuild(chatId, messageId, sessionId, env) {
	const apiToken = await getUserApiToken(chatId, env);
	const dataStr = await env.DROPLET_CREATION.get(sessionId);
	if (!dataStr) {
		await editMessage(chatId, messageId, '❌ Session expired.', env);
		return;
	}
	const data = JSON.parse(dataStr);
	await editMessage(chatId, messageId, '⏳ Rebuilding...', env);
	const keysData = await doApiCall('/account/keys', 'GET', apiToken);
	const sshKeys = keysData.ssh_keys || [];
	if (sshKeys.length === 0) {
		await editMessage(chatId, messageId, '❌ No SSH keys found.', env);
		return;
	}
	const result = await doApiCall(`/droplets/${data.dropletId}/actions`, 'POST', apiToken, {
		type: 'rebuild',
		image: data.imageSlug,
		ssh_keys: sshKeys.map(key => key.id),
	});
	if (result.action) {
		await editMessage(chatId, messageId, `✅ *Rebuild Started!*\n\nStatus: ${result.action.status}\n\nUse /droplets to check.`, env);
		await env.DROPLET_CREATION.delete(sessionId);
	} else {
		await editMessage(chatId, messageId, `❌ Failed: ${result.message || 'Unknown error'}`, env);
	}
}