/**
 * DigitalOcean Telegram Bot - Fixed Version
 * 
 * FIXES:
 * - Proper pagination through ALL images (using meta.total)
 * - Separate handling for snapshots (private=true)
 * - Cache: OS & Apps (1 day), Snapshots (no cache)
 * - Fixed search lockup (clearState + Back button)
 * - Added Back buttons in all steps
 * - Correct type filtering (base, application, snapshot)
 * - Improved UX for rename with force_reply button
 * 
 * FLOW:
 * Create: Region → [OS | Apps | Snapshots] → Size (filtered) → Name → Confirm
 * Rebuild: [OS | Apps | Snapshots] → Confirm (filtered by droplet specs)
 */

const ITEMS_PER_PAGE = 20;
const MIN_SEARCH_LENGTH = 3;
const CACHE_TTL = 86400; // 24 hours for OS and Apps
const IMAGES_PER_PAGE = 200; // DigitalOcean API limit

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

// Get ALL images with proper pagination
async function getAllImages(apiToken, env) {
	try {
		const cacheKey = 'all_images_cache';
		const cached = await env.DROPLET_CREATION.get(cacheKey);
		if (cached) return JSON.parse(cached);

		let allImages = [];
		let page = 1;
		let totalPages = 1;

		// First request to get meta.total
		const firstPage = await doApiCall(`/images?page=1&per_page=${IMAGES_PER_PAGE}`, 'GET', apiToken);
		allImages = allImages.concat(firstPage.images || []);
		
		if (firstPage.meta && firstPage.meta.total) {
			totalPages = Math.ceil(firstPage.meta.total / IMAGES_PER_PAGE);
		}

		// Fetch remaining pages
		for (page = 2; page <= totalPages; page++) {
			const pageData = await doApiCall(`/images?page=${page}&per_page=${IMAGES_PER_PAGE}`, 'GET', apiToken);
			allImages = allImages.concat(pageData.images || []);
		}

		// Cache for 1 day
		await env.DROPLET_CREATION.put(cacheKey, JSON.stringify(allImages), { expirationTtl: CACHE_TTL });
		return allImages;
	} catch (error) {
		console.error('Error getting all images:', error);
		return [];
	}
}

// Get snapshots only (no cache)
async function getSnapshots(apiToken) {
	try {
		const data = await doApiCall('/images?private=true', 'GET', apiToken);
		return data.images || [];
	} catch (error) {
		console.error('Error getting snapshots:', error);
		return [];
	}
}

// Get images by type with proper caching
async function getImagesByType(type, apiToken, env) {
	try {
		// For snapshots, don't use cache
		if (type === 'snapshot') {
			return await getSnapshots(apiToken);
		}

		// For OS and Apps, get from all images and filter
		const allImages = await getAllImages(apiToken, env);
		const typeFilter = type === 'os' ? 'base' : type === 'app' ? 'application' : type;
		return allImages.filter(img => img.type === typeFilter && img.status === 'available');
	} catch (error) {
		console.error(`Error getting ${type} images:`, error);
		return [];
	}
}

// Filter images by region
function filterImagesByRegion(images, region) {
	return images.filter(img => {
		if (!img.regions || img.regions.length === 0) return true;
		return img.regions.includes(region);
	});
}

// Filter images compatible with droplet specs
function filterImagesForRebuild(images, droplet) {
	return images.filter(img => {
		if (img.status !== 'available') return false;
		if (img.min_disk_size > droplet.disk) return false;
		if (img.regions && img.regions.length > 0 && !img.regions.includes(droplet.region.slug)) {
			return false;
		}
		return true;
	});
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
		const prefixes = [`session_${userId}_`, `create_${userId}_`, `state_${userId}`, `rebuild_${userId}_`, `page_${userId}_`];
		for (const prefix of prefixes) {
			const listResult = await env.DROPLET_CREATION.list({ prefix: prefix });
			for (const key of listResult.keys) {
				await env.DROPLET_CREATION.delete(key.name);
			}
		}
	} catch (error) {
		console.error('Error clearing sessions:', error);
	}
}

// Clear all cache data but keep API tokens
async function clearAllCache(env) {
	try {
		let deletedCount = 0;
		const prefixes = ['all_images_cache'];
		
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

	// Check for reply messages
	if (message.reply_to_message) {
		const replyText = message.reply_to_message.text || '';
		
		// API Token reply
		if (replyText.includes('API Token') || replyText.includes('API token')) {
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
				await sendMessage(chatId, '❌ Invalid API token!\n\nPlease check your token and try /setapi again.', env);
			}
			return;
		}
		
		// Droplet rename reply (NEW - Improved UX)
		if (replyText.includes('📝 Rename Droplet')) {
			const lines = replyText.split('\n');
			const sessionLine = lines.find(l => l.startsWith('Session:'));
			if (!sessionLine) return;
			const sessionId = sessionLine.split(':')[1].trim();
			
			// Get session data
			const dataStr = await env.DROPLET_CREATION.get(sessionId);
			if (!dataStr) {
				await sendMessage(chatId, '❌ Session expired.', env);
				return;
			}
			
			// Delete messages for clean UX
			await deleteMessage(chatId, message.reply_to_message.message_id, env);
			await deleteMessage(chatId, message.message_id, env);
			
			// Parse data and confirm
			const data = JSON.parse(dataStr);
			await confirmDropletCreation(chatId, text.trim(), data.region, data.size, data.image, env);
			return;
		}
	}

	// Check state for search modes
	const state = await getState(chatId, env);
	
	if (state?.step === 'searching_image') {
		await handleImageSearch(chatId, text, state, env);
		return;
	}
	
	if (state?.step === 'rebuild_searching_image') {
		await handleRebuildImageSearch(chatId, text, state, env);
		return;
	}

	// Commands
	if (text === '/start') {
		await clearState(chatId, env);
		const hasApiToken = await getUserApiToken(chatId, env);
		const welcomeMsg = hasApiToken
			? '👋 Welcome!\n\nCommands:\n/droplets - List droplets\n/create - Create new droplet\n/clearcache - Clear cache data\n/setapi - Change API token'
			: '👋 Welcome!\n\n⚠️ Set your API token first with /setapi';
		await sendMessage(chatId, welcomeMsg, env);
	} else if (text === '/setapi') {
		await clearState(chatId, env);
		const hasExisting = await getUserApiToken(chatId, env);
		const tokenText = hasExisting
			? '🔑 *Change API Token*\n\n⚠️ This will clear all sessions.\n\nReply to this message with your new DigitalOcean API token.'
			: '🔑 *Setup API Token*\n\nReply to this message with your DigitalOcean API token.\n\nGet it at: https://cloud.digitalocean.com/';
		const keyboard = { force_reply: true, selective: true };
		await sendMessage(chatId, tokenText, env, keyboard);
	} else if (text === '/droplets') {
		await clearState(chatId, env);
		await listDroplets(chatId, env);
	} else if (text === '/create') {
		await clearState(chatId, env);
		await showRegions(chatId, env);
	} else if (text === '/clearcache') {
		await clearState(chatId, env);
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
		await deleteMessage(chatId, messageId, env);
		await showImagesList(chatId, region, type, 0, env);
	}
	// Pagination
	else if (data.startsWith('imgpage_')) {
		const parts = data.replace('imgpage_', '').split('_');
		const region = parts[0];
		const type = parts[1];
		const page = parseInt(parts[2]);
		await showImagesListEdit(chatId, messageId, region, type, page, env);
	}
	// Search trigger
	else if (data.startsWith('imgsearch_')) {
		const parts = data.replace('imgsearch_', '').split('_');
		const region = parts[0];
		const type = parts[1];
		await deleteMessage(chatId, messageId, env);
		await sendMessage(chatId, `🔍 *Search ${type === 'app' ? 'Applications' : type === 'os' ? 'OS' : 'Snapshots'}*\n\nType at least ${MIN_SEARCH_LENGTH} characters:`, env);
		await setState(chatId, { step: 'searching_image', region: region, type: type }, env);
	}
	// Back from search
	else if (data.startsWith('back_from_search_')) {
		const parts = data.replace('back_from_search_', '').split('_');
		const region = parts[0];
		await clearState(chatId, env);
		await deleteMessage(chatId, messageId, env);
		await showImageTypeSelection(chatId, region, env);
	}
	// Image selection
	else if (data.startsWith('selectimg_')) {
		const parts = data.replace('selectimg_', '').split('_');
		const region = parts[0];
		const imageId = parts.slice(1).join('_');
		await deleteMessage(chatId, messageId, env);
		await showSizes(chatId, region, imageId, env);
	}
	// Size selection (STEP 3)
	else if (data.startsWith('size_')) {
		const parts = data.replace('size_', '').split('_');
		const region = parts[0];
		const imageId = parts[1];
		const size = parts.slice(2).join('_');
		const state = await getState(chatId, env);
		state.size = size;
		state.region = region;
		state.image = imageId;
		await setState(chatId, state, env);
		await deleteMessage(chatId, messageId, env);
		await askDropletName(chatId, imageId, size, region, env);
	}
	// Use default name
	else if (data.startsWith('use_default_name_')) {
		const sessionId = data.replace('use_default_name_', '');
		await deleteMessage(chatId, messageId, env);
		await useDefaultNameAndConfirm(chatId, sessionId, env);
	}
	// Rename droplet (NEW - Improved UX)
	else if (data.startsWith('rename_droplet_')) {
		const sessionId = data.replace('rename_droplet_', '');
		
		// Get session data to show in reply message
		const dataStr = await env.DROPLET_CREATION.get(sessionId);
		if (!dataStr) {
			await editMessage(chatId, messageId, '❌ Session expired.', env);
			return;
		}
		
		const data = JSON.parse(dataStr);
		await deleteMessage(chatId, messageId, env);
		
		// Send message with force_reply (like /setapi)
		const text = `📝 *Rename Droplet*\n\nRegion: ${data.region}\nSize: ${data.size}\nImage ID: ${data.image}\n\nSession: ${sessionId}\n\nReply to this message with your desired droplet name:`;
		const keyboard = { force_reply: true, selective: true };
		await sendMessage(chatId, text, env, keyboard);
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
	}
	// Rebuild image type
	else if (data.startsWith('rebuildtype_')) {
		const parts = data.replace('rebuildtype_', '').split('_');
		const dropletId = parts[0];
		const type = parts[1];
		await showRebuildImagesList(chatId, messageId, dropletId, type, 0, env);
	}
	// Rebuild pagination
	else if (data.startsWith('rebuildpage_')) {
		const parts = data.replace('rebuildpage_', '').split('_');
		const dropletId = parts[0];
		const type = parts[1];
		const page = parseInt(parts[2]);
		await showRebuildImagesList(chatId, messageId, dropletId, type, page, env);
	}
	// Rebuild search
	else if (data.startsWith('rebuildsearch_')) {
		const parts = data.replace('rebuildsearch_', '').split('_');
		const dropletId = parts[0];
		const type = parts[1];
		await deleteMessage(chatId, messageId, env);
		await sendMessage(chatId, `🔍 *Search ${type === 'app' ? 'Applications' : type === 'os' ? 'OS' : 'Snapshots'}*\n\nType at least ${MIN_SEARCH_LENGTH} characters:`, env);
		await setState(chatId, { step: 'rebuild_searching_image', dropletId: dropletId, type: type }, env);
	}
	// Back from rebuild search
	else if (data.startsWith('back_from_rebuild_search_')) {
		const dropletId = data.replace('back_from_rebuild_search_', '');
		await clearState(chatId, env);
		await deleteMessage(chatId, messageId, env);
		await showRebuildImageTypeSelection(chatId, messageId, dropletId, env);
	}
	// Rebuild image selection
	else if (data.startsWith('rebuildimg_')) {
		const parts = data.replace('rebuildimg_', '').split('_');
		const dropletId = parts[0];
		const imageId = parts.slice(1).join('_');
		await confirmRebuild(chatId, messageId, dropletId, imageId, env);
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
			[{ text: '📦 Applications', callback_data: `imgtype_${region}_app` }],
			[{ text: '📸 My Snapshots', callback_data: `imgtype_${region}_snapshot` }],
			[{ text: '◀️ Back to Regions', callback_data: 'back_to_regions' }],
		]
	};
	await sendMessage(chatId, `✅ Region: *${region}*\n\n🖥️ Step 2: Choose image type`, env, keyboard);
}

// === IMAGES LIST WITH PAGINATION ===

async function showImagesList(chatId, region, type, page, env) {
	const apiToken = await getUserApiToken(chatId, env);
	if (!apiToken) {
		await sendMessage(chatId, '❌ No API token.', env);
		return;
	}
	
	let allImages = await getImagesByType(type, apiToken, env);
	
	// Filter by region
	allImages = filterImagesByRegion(allImages, region);
	
	if (allImages.length === 0) {
		const typeLabel = type === 'app' ? 'applications' : type === 'os' ? 'OS images' : 'snapshots';
		await sendMessage(chatId, `❌ No ${typeLabel} available in ${region}.`, env);
		return;
	}
	
	// Pagination
	const totalPages = Math.ceil(allImages.length / ITEMS_PER_PAGE);
	const start = page * ITEMS_PER_PAGE;
	const end = start + ITEMS_PER_PAGE;
	const pageImages = allImages.slice(start, end);
	
	// Build keyboard
	const keyboard = pageImages.map(img => [{
		text: img.name,
		callback_data: `selectimg_${region}_${img.id}`
	}]);
	
	// Navigation buttons
	const navButtons = [];
	if (page > 0) {
		navButtons.push({ text: '◀️ Previous', callback_data: `imgpage_${region}_${type}_${page - 1}` });
	}
	if (page < totalPages - 1) {
		navButtons.push({ text: 'Next ▶️', callback_data: `imgpage_${region}_${type}_${page + 1}` });
	}
	if (navButtons.length > 0) keyboard.push(navButtons);
	
	// Search and Back buttons
	keyboard.push([{ text: '🔍 Search', callback_data: `imgsearch_${region}_${type}` }]);
	keyboard.push([{ text: '◀️ Back', callback_data: 'back_to_regions' }]);
	
	const typeLabel = type === 'app' ? 'Applications' : type === 'os' ? 'Operating Systems' : 'Snapshots';
	const emoji = typeLabel === 'Applications' ? '📦' : typeLabel === 'Operating Systems' ? '🐧' : '📸';
	const text = `${emoji} *${typeLabel}*\n\nPage ${page + 1}/${totalPages} (${allImages.length} total)`;
	await sendMessage(chatId, text, env, { inline_keyboard: keyboard });
}

async function showImagesListEdit(chatId, messageId, region, type, page, env) {
	const apiToken = await getUserApiToken(chatId, env);
	let allImages = await getImagesByType(type, apiToken, env);
	allImages = filterImagesByRegion(allImages, region);
	
	const totalPages = Math.ceil(allImages.length / ITEMS_PER_PAGE);
	const start = page * ITEMS_PER_PAGE;
	const end = start + ITEMS_PER_PAGE;
	const pageImages = allImages.slice(start, end);
	
	const keyboard = pageImages.map(img => [{
		text: img.name,
		callback_data: `selectimg_${region}_${img.id}`
	}]);
	
	const navButtons = [];
	if (page > 0) {
		navButtons.push({ text: '◀️ Previous', callback_data: `imgpage_${region}_${type}_${page - 1}` });
	}
	if (page < totalPages - 1) {
		navButtons.push({ text: 'Next ▶️', callback_data: `imgpage_${region}_${type}_${page + 1}` });
	}
	if (navButtons.length > 0) keyboard.push(navButtons);
	
	keyboard.push([{ text: '🔍 Search', callback_data: `imgsearch_${region}_${type}` }]);
	keyboard.push([{ text: '◀️ Back', callback_data: 'back_to_regions' }]);
	
	const typeLabel = type === 'app' ? 'Applications' : type === 'os' ? 'Operating Systems' : 'Snapshots';
	const emoji = typeLabel === 'Applications' ? '📦' : typeLabel === 'Operating Systems' ? '🐧' : '📸';
	const text = `${emoji} *${typeLabel}*\n\nPage ${page + 1}/${totalPages} (${allImages.length} total)`;
	await editMessage(chatId, messageId, text, env, { inline_keyboard: keyboard });
}

// === IMAGE SEARCH ===

async function handleImageSearch(chatId, query, state, env) {
	if (query.length < MIN_SEARCH_LENGTH) {
		await sendMessage(chatId, `❌ Search query too short. Min ${MIN_SEARCH_LENGTH} characters.`, env);
		return;
	}
	
	const apiToken = await getUserApiToken(chatId, env);
	let allImages = await getImagesByType(state.type, apiToken, env);
	allImages = filterImagesByRegion(allImages, state.region);
	
	const searchTerm = query.toLowerCase();
	const results = allImages.filter(img => img.name.toLowerCase().includes(searchTerm));
	
	if (results.length === 0) {
		await clearState(chatId, env);
		const keyboard = {
			inline_keyboard: [[{ text: '◀️ Back to Menu', callback_data: `back_from_search_${state.region}` }]]
		};
		await sendMessage(chatId, '❌ No results found.', env, keyboard);
		return;
	}
	
	// Show first page of results
	const totalPages = Math.ceil(results.length / ITEMS_PER_PAGE);
	const pageResults = results.slice(0, ITEMS_PER_PAGE);
	
	const keyboard = pageResults.map(img => [{
		text: img.name,
		callback_data: `selectimg_${state.region}_${img.id}`
	}]);
	
	if (totalPages > 1) {
		keyboard.push([{ text: 'Next ▶️', callback_data: `imgpage_${state.region}_${state.type}_1` }]);
	}
	
	keyboard.push([{ text: '◀️ Back', callback_data: `back_from_search_${state.region}` }]);
	
	await sendMessage(chatId, `🔍 Found ${results.length} result(s)\n\nPage 1/${totalPages}`, env, { inline_keyboard: keyboard });
	await clearState(chatId, env);
}

// === SIZE SELECTION (STEP 3) ===

async function showSizes(chatId, region, imageId, env) {
	const apiToken = await getUserApiToken(chatId, env);
	
	// Get image details
	const imageData = await doApiCall(`/images/${imageId}`, 'GET', apiToken);
	const image = imageData.image;
	
	if (!image) {
		await sendMessage(chatId, '❌ Image not found.', env);
		return;
	}
	
	// Get region details for available sizes
	const regionData = await doApiCall('/regions', 'GET', apiToken);
	const regionInfo = regionData.regions.find(r => r.slug === region);
	const regionSizes = regionInfo?.sizes || [];
	
	if (regionSizes.length === 0) {
		await sendMessage(chatId, '❌ No sizes available in this region.', env);
		return;
	}
	
	// Get all sizes and filter
	const sizesData = await doApiCall('/sizes', 'GET', apiToken);
	const availableSizes = sizesData.sizes
		.filter(size => {
			if (!size.available) return false;
			if (!regionSizes.includes(size.slug)) return false;
			if (size.disk < image.min_disk_size) return false;
			return true;
		})
		.sort((a, b) => a.price_monthly - b.price_monthly);
	
	if (availableSizes.length === 0) {
		const warningText = `⚠️ *No compatible sizes!*\n\n${image.name} requires:\n• Min ${image.min_disk_size}GB disk`;
		await sendMessage(chatId, warningText, env);
		return;
	}
	
	// Save image to state
	await setState(chatId, { region: region, image: imageId }, env);
	
	const keyboard = availableSizes.slice(0, 15).map(size => [{
		text: `${size.slug} - $${size.price_monthly}/mo (${Math.ceil(size.memory / 1024)}GB RAM, ${size.disk}GB)`,
		callback_data: `size_${region}_${imageId}_${size.slug}`
	}]);
	keyboard.push([{ text: '◀️ Back', callback_data: 'back_to_regions' }]);
	const infoText = `✅ Image: *${image.name}*\n\n💰 Step 3: Select size`;
	await sendMessage(chatId, infoText, env, { inline_keyboard: keyboard });
}

// === DROPLET NAME & CREATION ===

function generateDropletName(imageId, size, region) {
	const timestamp = Date.now().toString().slice(-4);
	return `droplet-${size}-${region}-${timestamp}`;
}

// IMPROVED: Added Rename button with better UX
async function askDropletName(chatId, imageId, size, region, env) {
	const defaultName = generateDropletName(imageId, size, region);
	const sessionId = `session_${chatId}_${Date.now()}`;
	await env.DROPLET_CREATION.put(sessionId, JSON.stringify({
		region, size, image: imageId, defaultName
	}), { expirationTtl: 300 });
	
	const text = `📝 *Droplet Name*\n\nRegion: ${region}\nSize: ${size}\nImage ID: ${imageId}\n\nDefault: \`${defaultName}\``;
	const keyboard = {
		inline_keyboard: [
			[
				{ text: '✅ Use Default', callback_data: `use_default_name_${sessionId}` },
				{ text: '📝 Rename', callback_data: `rename_droplet_${sessionId}` }
			],
			[{ text: '◀️ Back', callback_data: 'back_to_regions' }],
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

async function confirmDropletCreation(chatId, name, region, size, imageId, env) {
	const apiToken = await getUserApiToken(chatId, env);
	const keysData = await doApiCall('/account/keys', 'GET', apiToken);
	const sshKeys = keysData.ssh_keys || [];
	if (sshKeys.length === 0) {
		await sendMessage(chatId, '❌ *No SSH Keys*\n\nAdd SSH key to DigitalOcean first.', env);
		return;
	}
	const creationId = `create_${chatId}_${Date.now()}`;
	await env.DROPLET_CREATION.put(creationId, JSON.stringify({
		name, region, size, image: imageId, sshKeyIds: sshKeys.map(key => key.id)
	}), { expirationTtl: 300 });
	const text = `⚠️ *Confirm*\n\n*Name:* ${name}\n*Region:* ${region}\n*Size:* ${size}\n*Image ID:* ${imageId}\n*SSH Keys:* ${sshKeys.length}`;
	const keyboard = {
		inline_keyboard: [
			[{ text: '✅ Create', callback_data: `confirmcreate_${creationId}` }],
			[{ text: '◀️ Back', callback_data: 'back_to_regions' }],
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
			[{ text: '◀️ Back', callback_data: `droplet_${dropletId}` }],
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

// === REBUILD ===

async function showRebuildImageTypeSelection(chatId, messageId, dropletId, env) {
	const keyboard = {
		inline_keyboard: [
			[{ text: '🐧 Operating Systems', callback_data: `rebuildtype_${dropletId}_os` }],
			[{ text: '📦 Applications', callback_data: `rebuildtype_${dropletId}_app` }],
			[{ text: '📸 My Snapshots', callback_data: `rebuildtype_${dropletId}_snapshot` }],
			[{ text: '◀️ Back', callback_data: `droplet_${dropletId}` }],
		]
	};
	await editMessage(chatId, messageId, '🔄 *Rebuild Droplet*\n\n⚠️ All data will be deleted\n\nChoose image type:', env, keyboard);
}

async function showRebuildImagesList(chatId, messageId, dropletId, type, page, env) {
	const apiToken = await getUserApiToken(chatId, env);
	
	// Get droplet details
	const dropletData = await doApiCall(`/droplets/${dropletId}`, 'GET', apiToken);
	const droplet = dropletData.droplet;
	
	if (!droplet) {
		await editMessage(chatId, messageId, '❌ Droplet not found.', env);
		return;
	}
	
	// Get images
	let allImages = await getImagesByType(type, apiToken, env);
	
	// Filter for rebuild compatibility
	allImages = filterImagesForRebuild(allImages, droplet);
	
	if (allImages.length === 0) {
		const typeLabel = type === 'app' ? 'applications' : type === 'os' ? 'OS images' : 'snapshots';
		await editMessage(chatId, messageId, `❌ No compatible ${typeLabel} for this droplet.`, env);
		return;
	}
	
	// Pagination
	const totalPages = Math.ceil(allImages.length / ITEMS_PER_PAGE);
	const start = page * ITEMS_PER_PAGE;
	const end = start + ITEMS_PER_PAGE;
	const pageImages = allImages.slice(start, end);
	
	const keyboard = pageImages.map(img => [{
		text: img.name,
		callback_data: `rebuildimg_${dropletId}_${img.id}`
	}]);
	
	const navButtons = [];
	if (page > 0) {
		navButtons.push({ text: '◀️ Previous', callback_data: `rebuildpage_${dropletId}_${type}_${page - 1}` });
	}
	if (page < totalPages - 1) {
		navButtons.push({ text: 'Next ▶️', callback_data: `rebuildpage_${dropletId}_${type}_${page + 1}` });
	}
	if (navButtons.length > 0) keyboard.push(navButtons);
	
	keyboard.push([{ text: '🔍 Search', callback_data: `rebuildsearch_${dropletId}_${type}` }]);
	keyboard.push([{ text: '◀️ Back', callback_data: `rebuild_${dropletId}` }]);
	
	const typeLabel = type === 'app' ? 'Applications' : type === 'os' ? 'Operating Systems' : 'Snapshots';
	const emoji = typeLabel === 'Applications' ? '📦' : typeLabel === 'Operating Systems' ? '🐧' : '📸';
	const text = `${emoji} *${typeLabel}*\n\n✅ Compatible with ${droplet.size_slug}\nPage ${page + 1}/${totalPages} (${allImages.length} total)`;
	await editMessage(chatId, messageId, text, env, { inline_keyboard: keyboard });
}

async function handleRebuildImageSearch(chatId, query, state, env) {
	if (query.length < MIN_SEARCH_LENGTH) {
		await sendMessage(chatId, `❌ Search query too short. Min ${MIN_SEARCH_LENGTH} characters.`, env);
		return;
	}
	
	const apiToken = await getUserApiToken(chatId, env);
	const dropletId = state.dropletId;
	
	// Get droplet details
	const dropletData = await doApiCall(`/droplets/${dropletId}`, 'GET', apiToken);
	const droplet = dropletData.droplet;
	
	let allImages = await getImagesByType(state.type, apiToken, env);
	allImages = filterImagesForRebuild(allImages, droplet);
	
	const searchTerm = query.toLowerCase();
	const results = allImages.filter(img => img.name.toLowerCase().includes(searchTerm));
	
	if (results.length === 0) {
		await clearState(chatId, env);
		const keyboard = {
			inline_keyboard: [[{ text: '◀️ Back to Menu', callback_data: `back_from_rebuild_search_${dropletId}` }]]
		};
		await sendMessage(chatId, '❌ No results found.', env, keyboard);
		return;
	}
	
	const keyboard = results.slice(0, ITEMS_PER_PAGE).map(img => [{
		text: img.name,
		callback_data: `rebuildimg_${dropletId}_${img.id}`
	}]);
	
	keyboard.push([{ text: '◀️ Back', callback_data: `back_from_rebuild_search_${dropletId}` }]);
	
	await sendMessage(chatId, `🔍 Found ${results.length} result(s)`, env, { inline_keyboard: keyboard });
	await clearState(chatId, env);
}

async function confirmRebuild(chatId, messageId, dropletId, imageId, env) {
	const sessionId = `rebuild_${chatId}_${Date.now()}`;
	await env.DROPLET_CREATION.put(sessionId, JSON.stringify({ dropletId, imageId }), { expirationTtl: 300 });
	const text = `⚠️ *Confirm Rebuild*\n\nDroplet ID: ${dropletId}\nNew Image ID: ${imageId}\n\n*All data will be deleted!*`;
	const keyboard = {
		inline_keyboard: [
			[{ text: '✅ Yes, Rebuild', callback_data: `execute_rebuild_${sessionId}` }],
			[{ text: '◀️ Back', callback_data: `droplet_${dropletId}` }],
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
	
	const result = await doApiCall(`/droplets/${data.dropletId}/actions`, 'POST', apiToken, {
		type: 'rebuild',
		image: data.imageId,
	});
	
	if (result.action) {
		await editMessage(chatId, messageId, `✅ *Rebuild Started!*\n\nStatus: ${result.action.status}`, env);
		await env.DROPLET_CREATION.delete(sessionId);
	} else {
		await editMessage(chatId, messageId, `❌ Failed: ${result.message || 'Unknown'}`, env);
	}
}
