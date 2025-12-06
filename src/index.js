/**
 * DigitalOcean Telegram Bot - Optimized Flow Version
 * 
 * NEW FLOW:
 * /create → Region → OS/App → Size (filtered)
 * 
 * Rebuild: Shows OS/Apps compatible with current droplet size
 * 
 * Features:
 * - /start: Welcome message
 * - /setapi: Configure DigitalOcean API token
 * - /droplets: List and manage droplets
 * - /create: Region-first creation flow
 * - /clearcache: Clear all cache data (keeps API token)
 * - Rebuild: Smart filtering based on droplet specs
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

// Get image details including min_disk_size
async function getImageDetails(imageSlug, apiToken, env) {
	try {
		const cached = await env.DROPLET_CREATION.get(`image_${imageSlug}`);
		if (cached) return JSON.parse(cached);

		const apps = await getMarketplaceApps(env, apiToken);
		const app = apps.find(a => a.slug === imageSlug);
		
		if (app) {
			const imageData = await doApiCall(`/images/${app.slug}`, 'GET', apiToken);
			const details = {
				slug: app.slug,
				min_disk_size: imageData.image?.min_disk_size || 25,
				min_memory: 1024,
				type: 'app'
			};
			await env.DROPLET_CREATION.put(`image_${imageSlug}`, JSON.stringify(details), { expirationTtl: 3600 });
			return details;
		} else {
			const imageData = await doApiCall(`/images/${imageSlug}`, 'GET', apiToken);
			const details = {
				slug: imageSlug,
				min_disk_size: imageData.image?.min_disk_size || 10,
				min_memory: 512,
				type: 'os'
			};
			await env.DROPLET_CREATION.put(`image_${imageSlug}`, JSON.stringify(details), { expirationTtl: 3600 });
			return details;
		}
	} catch (error) {
		console.error('Error getting image details:', error);
		return { slug: imageSlug, min_disk_size: 25, min_memory: 1024, type: 'unknown' };
	}
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
		const stateResult = await env.DROPLET_CREATION.list({ prefix: `state_${userId}` });
		const rebuildResult = await env.DROPLET_CREATION.list({ prefix: `rebuild_${userId}_` });
		const allKeys = [
			...listResult.keys.map(k => k.name), 
			...createListResult.keys.map(k => k.name),
			...stateResult.keys.map(k => k.name),
			...rebuildResult.keys.map(k => k.name)
		];
		for (const key of allKeys) {
			await env.DROPLET_CREATION.delete(key);
		}
	} catch (error) {
		console.error('Error clearing sessions:', error);
	}
}

// Clear all cache data (images, apps) but keep API tokens
async function clearAllCache(env) {
	try {
		let deletedCount = 0;
		const prefixes = ['image_', 'marketplace_apps'];
		
		for (const prefix of prefixes) {
			const listResult = await env.DROPLET_CREATION.list({ prefix: prefix });
			for (const key of listResult.keys) {
				await env.DROPLET_CREATION.delete(key.name);
				deletedCount++;
			}
		}
		
		return deletedCount;
	} catch (error) {
		console.error('Error clearing cache:', error);
		return 0;
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

	const allowedUsers = env.ALLOWED_USER_IDS.split(',').map(id => parseInt(id.trim()));
	if (!allowedUsers.includes(userId)) {
		await sendMessage(chatId, '⛔ Access denied. You are not authorized to use this bot.', env);
		return;
	}

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

	if (message.reply_to_message?.text?.includes('Default name:') || message.reply_to_message?.text?.includes('Default:')) {
		const lines = message.reply_to_message.text.split('\n');
		const region = lines.find(l => l.startsWith('Region:'))?.split(':')[1].trim();
		const size = lines.find(l => l.startsWith('Size:'))?.split(':')[1].trim();
		const image = lines.find(l => l.startsWith('Image:'))?.split(':')[1].trim();
		await deleteMessage(chatId, message.reply_to_message.message_id, env);
		await confirmDropletCreation(chatId, text, region, size, image, env);
		return;
	}

	const state = await getState(chatId, env);
	if (state?.step === 'searching_app') {
		await handleAppSearch(chatId, text, state.region, env);
		return;
	}

	if (text === '/start') {
		const hasApiToken = await getUserApiToken(chatId, env);
		const welcomeMsg = hasApiToken
			? '👋 Welcome!\n\nCommands:\n/droplets - List droplets\n/create - Create new droplet\n/clearcache - Clear cache data\n/setapi - Change API token'
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
		await showRegions(chatId, env);
	} else if (text === '/clearcache') {
		const msg = await sendMessage(chatId, '⏳ Clearing cache...', env);
		const count = await clearAllCache(env);
		await clearUserSessions(chatId, env);
		if (msg.result?.message_id) {
			await deleteMessage(chatId, msg.result.message_id, env);
		}
		await sendMessage(chatId, `✅ Cache cleared!\n\n🗑️ Deleted ${count} cached items\n🔄 Cleared your sessions\n\n💡 API token preserved`, env);
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

	// Region selection (STEP 1)
	if (data.startsWith('region_')) {
		const region = data.replace('region_', '');
		await setState(chatId, { region: region }, env);
		await deleteMessage(chatId, messageId, env);
		await showImageTypeSelection(chatId, region, env);
	}
	// Image type selection (STEP 2)
	else if (data.startsWith('imgtype_')) {
		const parts = data.replace('imgtype_', '').split('_');
		const region = parts[0];
		const type = parts[1];
		if (type === 'os') {
			await deleteMessage(chatId, messageId, env);
			await showOSImages(chatId, region, env);
		} else if (type === 'app') {
			const keyboard = {
				inline_keyboard: [
					[{ text: '🔍 Search Apps', callback_data: `appmenu_${region}_search` }],
					[{ text: '⭐ Popular Apps', callback_data: `appmenu_${region}_popular` }],
					[{ text: '◀️ Back', callback_data: 'back_to_regions' }],
				]
			};
			await editMessage(chatId, messageId, '📦 *1-Click Apps*\n\nChoose option:', env, keyboard);
		}
	}
	// App menu
	else if (data.startsWith('appmenu_')) {
		const parts = data.replace('appmenu_', '').split('_');
		const region = parts[0];
		const action = parts[1];
		if (action === 'search') {
			await deleteMessage(chatId, messageId, env);
			await sendMessage(chatId, '🔍 *Search Apps*\n\nType app name:', env);
			await setState(chatId, { step: 'searching_app', region: region }, env);
		} else if (action === 'popular') {
			await showPopularApps(chatId, messageId, region, env);
		}
	}
	// Image selection (OS or App)
	else if (data.startsWith('selectimg_')) {
		const parts = data.replace('selectimg_', '').split('_');
		const region = parts[0];
		const imageSlug = parts.slice(1).join('_');
		await deleteMessage(chatId, messageId, env);
		await showSizes(chatId, region, imageSlug, env);
	}
	// Size selection (STEP 3)
	else if (data.startsWith('size_')) {
		const parts = data.replace('size_', '').split('_');
		const region = parts[0];
		const size = parts.slice(1).join('_');
		const state = await getState(chatId, env);
		state.size = size;
		state.region = region;
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
		await showRebuildImageTypeSelection(chatId, messageId, dropletId, env);
	} else if (data.startsWith('rebuildtype_')) {
		const parts = data.replace('rebuildtype_', '').split('_');
		const dropletId = parts[0];
		const type = parts[1];
		if (type === 'os') {
			await showRebuildOSImages(chatId, messageId, dropletId, env);
		} else if (type === 'app') {
			await showRebuildAppMenu(chatId, messageId, dropletId, env);
		}
	} else if (data.startsWith('rebuildappmenu_')) {
		const parts = data.replace('rebuildappmenu_', '').split('_');
		const dropletId = parts[0];
		const action = parts[1];
		if (action === 'popular') {
			await showRebuildPopularApps(chatId, messageId, dropletId, env);
		}
	} else if (data.startsWith('rebuildimg_')) {
		const parts = data.replace('rebuildimg_', '').split('_');
		const dropletId = parts[0];
		const imageSlug = parts.slice(1).join('_');
		await confirmRebuild(chatId, messageId, dropletId, imageSlug, env);
	} else if (data.startsWith('execute_rebuild_')) {
		const sessionId = data.replace('execute_rebuild_', '');
		await executeRebuild(chatId, messageId, sessionId, env);
	}
	// Cancel & Back
	else if (data === 'cancel_create') {
		await clearState(chatId, env);
		await editMessage(chatId, messageId, '❌ Cancelled.', env);
	} else if (data === 'back_to_regions') {
		await showRegionsEdit(chatId, messageId, env);
	}
}

// === STATE MANAGEMENT ===

async function getState(chatId, env) {
	const stateJson = await env.DROPLET_CREATION.get(`state_${chatId}`);
	return stateJson ? JSON.parse(stateJson) : {};
}

async function setState(chatId, state, env) {
	await env.DROPLET_CREATION.put(`state_${chatId}`, JSON.stringify(state), { expirationTtl: 600 });
}

async function clearState(chatId, env) {
	await env.DROPLET_CREATION.delete(`state_${chatId}`);
}

// === REGION SELECTION (STEP 1) ===

async function showRegions(chatId, env) {
	const apiToken = await getUserApiToken(chatId, env);
	if (!apiToken) {
		await sendMessage(chatId, '❌ No API token. Use /setapi first.', env);
		return;
	}
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
	await sendMessage(chatId, '🚀 *Create New Droplet*\n\n🌍 Step 1: Select region', env, { inline_keyboard: keyboard });
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
	await editMessage(chatId, messageId, '🌍 *Select region:*', env, { inline_keyboard: keyboard });
}

// === IMAGE TYPE SELECTION (STEP 2) ===

async function showImageTypeSelection(chatId, region, env) {
	const keyboard = {
		inline_keyboard: [
			[{ text: '🐧 Operating Systems', callback_data: `imgtype_${region}_os` }],
			[{ text: '📦 1-Click Apps', callback_data: `imgtype_${region}_app` }],
			[{ text: '◀️ Back to Regions', callback_data: 'back_to_regions' }],
		]
	};
	await sendMessage(chatId, `✅ Region: *${region}*\n\n🖥️ Step 2: Choose image type`, env, keyboard);
}

async function showOSImages(chatId, region, env) {
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
		callback_data: `selectimg_${region}_${image.slug || image.id}`
	}]);
	keyboard.push([{ text: '◀️ Back', callback_data: 'back_to_regions' }]);
	await sendMessage(chatId, '🐧 *Select Operating System:*', env, { inline_keyboard: keyboard });
}

async function showPopularApps(chatId, messageId, region, env) {
	const apiToken = await getUserApiToken(chatId, env);
	const popularApps = await getPopularApps(env, apiToken);
	if (popularApps.length === 0) {
		await editMessage(chatId, messageId, '❌ No popular apps found.', env);
		return;
	}
	const keyboard = popularApps.map(app => [{
		text: app.name,
		callback_data: `selectimg_${region}_${app.slug}`
	}]);
	keyboard.push([{ text: '🔍 Search Instead', callback_data: `appmenu_${region}_search` }]);
	keyboard.push([{ text: '◀️ Back', callback_data: 'back_to_regions' }]);
	await editMessage(chatId, messageId, '⭐ *Popular Apps:*', env, { inline_keyboard: keyboard });
}

async function handleAppSearch(chatId, query, region, env) {
	const apiToken = await getUserApiToken(chatId, env);
	const apps = await getMarketplaceApps(env, apiToken);
	const term = query.toLowerCase();
	const results = apps.filter(app => app.slug.toLowerCase().includes(term));
	if (results.length === 0) {
		await sendMessage(chatId, '❌ No apps found. Try again:', env);
		return;
	}
	// Region is embedded in callback data, no need for state here
	const keyboard = results.slice(0, 15).map(app => [{
		text: APP_DISPLAY_NAMES[app.slug] || app.slug,
		callback_data: `selectimg_${region}_${app.slug}`
	}]);
	await sendMessage(chatId, `📦 Found ${results.length} app(s):`, env, { inline_keyboard: keyboard });
	// Clear search step
	await setState(chatId, { region: region }, env);
}

// === SIZE SELECTION (STEP 3) ===

async function showSizes(chatId, region, imageSlug, env) {
	const apiToken = await getUserApiToken(chatId, env);
	const imageDetails = await getImageDetails(imageSlug, apiToken, env);
	const data = await doApiCall('/sizes', 'GET', apiToken);
	const availableSizes = data.sizes
		.filter(size => {
			if (!size.available || !size.regions.includes(region)) return false;
			if (size.disk < imageDetails.min_disk_size) return false;
			if (size.memory < imageDetails.min_memory) return false;
			return true;
		})
		.sort((a, b) => a.price_monthly - b.price_monthly);
	
	if (availableSizes.length === 0) {
		const warningText = `⚠️ *No compatible sizes!*\n\n${imageSlug} requires:\n• Min ${imageDetails.min_disk_size}GB disk\n• Min ${Math.ceil(imageDetails.min_memory / 1024)}GB RAM`;
		await sendMessage(chatId, warningText, env);
		return;
	}
	
	// Save image to state for later use
	await setState(chatId, { region: region, image: imageSlug }, env);
	
	const keyboard = availableSizes.map(size => [{
		text: `${size.slug} - $${size.price_monthly}/mo (${Math.ceil(size.memory / 1024)}GB RAM, ${size.disk}GB)`,
		callback_data: `size_${region}_${size.slug}`
	}]);
	keyboard.push([{ text: '◀️ Back', callback_data: 'back_to_regions' }]);
	const infoText = `✅ Image: *${imageSlug}*\n\n💰 Step 3: Select size`;
	await sendMessage(chatId, infoText, env, { inline_keyboard: keyboard });
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
	const text = `📝 *Droplet Name*\n\nRegion: ${region}\nSize: ${size}\nImage: ${image}\n\nDefault: \`${defaultName}\`\n\nReply to change name.`;
	const keyboard = {
		inline_keyboard: [
			[{ text: '✅ Use Default', callback_data: `use_default_name_${sessionId}` }],
			[{ text: '❌ Cancel', callback_data: 'cancel_create' }],
		]
	};
	await sendMessage(chatId, text, env, keyboard);
}

async function useDefaultNameAndConfirm(chatId, sessionId, env) {
	const dataStr = await env.DROPLET_CREATION.get(sessionId);
	if (!dataStr) {
		await sendMessage(chatId, '❌ Session expired.', env);
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
		await sendMessage(chatId, '❌ *No SSH Keys*\n\nAdd SSH key to DigitalOcean first.', env);
		return;
	}
	const creationId = `create_${chatId}_${Date.now()}`;
	await env.DROPLET_CREATION.put(creationId, JSON.stringify({
		name, region, size, image, sshKeyIds: sshKeys.map(key => key.id)
	}), { expirationTtl: 300 });
	const text = `⚠️ *Confirm*\n\n*Name:* ${name}\n*Region:* ${region}\n*Size:* ${size}\n*Image:* ${image}\n*SSH Keys:* ${sshKeys.length}`;
	const keyboard = {
		inline_keyboard: [
			[{ text: '✅ Create', callback_data: `confirmcreate_${creationId}` }],
			[{ text: '❌ Cancel', callback_data: 'cancel_create' }],
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
	await editMessage(chatId, messageId, '⏳ Creating...', env);
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
		const ip = result.droplet.networks.v4.find(net => net.type === 'public')?.ip_address || 'Assigning...';
		const successText = `✅ *Created!*\n\n*Name:* ${result.droplet.name}\n*IP:* \`${ip}\`\n\nSSH: \`ssh root@${ip}\``;
		await editMessage(chatId, messageId, successText, env);
		await env.DROPLET_CREATION.delete(creationId);
	} else {
		await editMessage(chatId, messageId, `❌ Failed: ${result.message || 'Unknown'}`, env);
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
		await editMessage(chatId, messageId, '❌ Not found.', env);
		return;
	}
	const droplet = data.droplet;
	const ip = droplet.networks.v4.find(net => net.type === 'public')?.ip_address || 'Not assigned';
	const details = `📦 *Droplet*\n\n*Name:* ${droplet.name}\n*Status:* ${droplet.status}\n*Region:* ${droplet.region.name}\n*Size:* ${droplet.size_slug}\n*IP:* \`${ip}\`\n\nSSH: \`ssh root@${ip}\``;
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
			[{ text: '✅ Yes, Delete', callback_data: `delete_${dropletId}` }],
			[{ text: '❌ Cancel', callback_data: `droplet_${dropletId}` }],
		]
	};
	await editMessage(chatId, messageId, '⚠️ Delete?\n\nCannot be undone!', env, keyboard);
}

async function deleteDroplet(chatId, messageId, dropletId, env) {
	const apiToken = await getUserApiToken(chatId, env);
	const response = await fetch(`https://api.digitalocean.com/v2/droplets/${dropletId}`, {
		method: 'DELETE',
		headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
	});
	if (response.status === 204) {
		await editMessage(chatId, messageId, '✅ Deleted!', env);
	} else {
		await editMessage(chatId, messageId, '❌ Failed.', env);
	}
}

async function editMessageToDropletList(chatId, messageId, env) {
	const apiToken = await getUserApiToken(chatId, env);
	const data = await doApiCall('/droplets', 'GET', apiToken);
	if (!data.droplets || data.droplets.length === 0) {
		await editMessage(chatId, messageId, 'No droplets.', env);
		return;
	}
	const keyboard = data.droplets.map(droplet => [{
		text: `${droplet.name} (${droplet.status})`,
		callback_data: `droplet_${droplet.id}`
	}]);
	await editMessage(chatId, messageId, 'Your Droplets:', env, { inline_keyboard: keyboard });
}

// === REBUILD WITH APP SUPPORT ===

async function showRebuildImageTypeSelection(chatId, messageId, dropletId, env) {
	const keyboard = {
		inline_keyboard: [
			[{ text: '🐧 Operating Systems', callback_data: `rebuildtype_${dropletId}_os` }],
			[{ text: '📦 1-Click Apps', callback_data: `rebuildtype_${dropletId}_app` }],
			[{ text: '◀️ Back', callback_data: `droplet_${dropletId}` }],
		]
	};
	await editMessage(chatId, messageId, '🔄 *Rebuild Droplet*\n\n⚠️ Region cannot be changed\n\nChoose image type:', env, keyboard);
}

async function showRebuildOSImages(chatId, messageId, dropletId, env) {
	const apiToken = await getUserApiToken(chatId, env);
	const dropletData = await doApiCall(`/droplets/${dropletId}`, 'GET', apiToken);
	const droplet = dropletData.droplet;
	const currentDisk = droplet.disk;
	const currentMemory = droplet.memory;
	
	const url = 'https://api.digitalocean.com/v2/images?type=distribution&per_page=100';
	const response = await fetch(url, {
		headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
	});
	const data = await response.json();
	const compatibleImages = data.images.filter(img => {
		if (img.status !== 'available') return false;
		if (!img.slug?.includes('ubuntu') && !img.slug?.includes('debian') && 
		    !img.slug?.includes('centos') && !img.slug?.includes('fedora') && 
		    !img.slug?.includes('rocky')) return false;
		const minDisk = img.min_disk_size || 10;
		if (minDisk > currentDisk) return false;
		return true;
	}).slice(0, 10);
	
	if (compatibleImages.length === 0) {
		await editMessage(chatId, messageId, '❌ No compatible OS images for current droplet size.', env);
		return;
	}
	
	const keyboard = compatibleImages.map(img => [{
		text: img.name,
		callback_data: `rebuildimg_${dropletId}_${img.slug || img.id}`
	}]);
	keyboard.push([{ text: '◀️ Back', callback_data: `rebuild_${dropletId}` }]);
	await editMessage(chatId, messageId, `🐧 *Select OS*\n\n✅ Filtered for ${currentDisk}GB disk`, env, { inline_keyboard: keyboard });
}

async function showRebuildAppMenu(chatId, messageId, dropletId, env) {
	const keyboard = {
		inline_keyboard: [
			[{ text: '⭐ Popular Apps', callback_data: `rebuildappmenu_${dropletId}_popular` }],
			[{ text: '◀️ Back', callback_data: `rebuild_${dropletId}` }],
		]
	};
	await editMessage(chatId, messageId, '📦 *1-Click Apps*', env, keyboard);
}

async function showRebuildPopularApps(chatId, messageId, dropletId, env) {
	const apiToken = await getUserApiToken(chatId, env);
	const dropletData = await doApiCall(`/droplets/${dropletId}`, 'GET', apiToken);
	const droplet = dropletData.droplet;
	const currentDisk = droplet.disk;
	const currentMemory = droplet.memory;
	
	const popularApps = await getPopularApps(env, apiToken);
	const compatibleApps = [];
	
	for (const app of popularApps) {
		const details = await getImageDetails(app.slug, apiToken, env);
		if (details.min_disk_size <= currentDisk && details.min_memory <= currentMemory) {
			compatibleApps.push(app);
		}
	}
	
	if (compatibleApps.length === 0) {
		await editMessage(chatId, messageId, `❌ No compatible apps\n\nYour droplet:\n• ${currentDisk}GB disk\n• ${Math.ceil(currentMemory/1024)}GB RAM\n\nUpgrade droplet size for more apps.`, env);
		return;
	}
	
	const keyboard = compatibleApps.map(app => [{
		text: app.name,
		callback_data: `rebuildimg_${dropletId}_${app.slug}`
	}]);
	keyboard.push([{ text: '◀️ Back', callback_data: `rebuildappmenu_${dropletId}_back` }]);
	await editMessage(chatId, messageId, `⭐ *Compatible Apps*\n\n✅ Filtered for ${currentDisk}GB / ${Math.ceil(currentMemory/1024)}GB`, env, { inline_keyboard: keyboard });
}

async function confirmRebuild(chatId, messageId, dropletId, imageSlug, env) {
	const sessionId = `rebuild_${chatId}_${Date.now()}`;
	await env.DROPLET_CREATION.put(sessionId, JSON.stringify({ dropletId, imageSlug }), { expirationTtl: 300 });
	const text = `⚠️ *Confirm Rebuild*\n\nDroplet: ${dropletId}\nNew Image: ${imageSlug}\n\n*All data will be deleted!*`;
	const keyboard = {
		inline_keyboard: [
			[{ text: '✅ Yes, Rebuild', callback_data: `execute_rebuild_${sessionId}` }],
			[{ text: '❌ Cancel', callback_data: `droplet_${dropletId}` }],
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
		await editMessage(chatId, messageId, '❌ No SSH keys.', env);
		return;
	}
	const result = await doApiCall(`/droplets/${data.dropletId}/actions`, 'POST', apiToken, {
		type: 'rebuild',
		image: data.imageSlug,
		ssh_keys: sshKeys.map(key => key.id),
	});
	if (result.action) {
		await editMessage(chatId, messageId, `✅ *Rebuild Started!*\n\nStatus: ${result.action.status}`, env);
		await env.DROPLET_CREATION.delete(sessionId);
	} else {
		await editMessage(chatId, messageId, `❌ Failed: ${result.message || 'Unknown'}`, env);
	}
}