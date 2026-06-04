/**
 * DigitalOcean Telegram Bot
 * Cloudflare Worker — single-file deployment
 *
 * Deploy: paste this file into the Cloudflare Workers editor, then visit
 *   https://<your-worker>.workers.dev/registerWebhook
 *
 * Required bindings (Settings → Variables and Secrets):
 *   TELEGRAM_BOT_TOKEN  — Secret  — from @BotFather
 *   ALLOWED_USER_IDS    — Secret  — comma-separated Telegram user IDs
 *
 * Required KV binding (Settings → Bindings → KV namespace):
 *   Variable name: DROPLET_CREATION
 *
 * Features:
 *   - Create / rebuild / rename / delete droplets
 *   - Power on / power off / restart droplets
 *   - Take snapshots per droplet
 *   - Manage account-wide snapshots (list + delete)
 *   - Add / edit / delete notes per droplet
 *   - Search 200+ OS images and applications
 *   - Smart caching (OS & Apps: 24 h, Snapshots: no cache)
 *   - Per-user DigitalOcean API tokens stored in KV
 *   - GenAI Serverless Inference usage & cost per month (/genai)
 */

const ITEMS_PER_PAGE = 20;
const MIN_SEARCH_LENGTH = 3;
const CACHE_TTL = 86400; // 24 hours for OS and Apps
const IMAGES_PER_PAGE = 200; // DigitalOcean API limit
const MAX_NOTE_LENGTH = 500;
const MAX_SNAPSHOT_NAME_LENGTH = 200;

// Validate droplet name (DigitalOcean only allows: a-z, A-Z, 0-9, ., -)
function isValidDropletName(name) {
	if (!name || name.length === 0) return false;
	return /^[a-zA-Z0-9.-]+$/.test(name);
}

// Validate snapshot name (letters, digits, space, . _ -)
function isValidSnapshotName(name) {
	if (!name || name.trim().length === 0) return false;
	if (name.length > MAX_SNAPSHOT_NAME_LENGTH) return false;
	return /^[a-zA-Z0-9 ._-]+$/.test(name);
}

// Generate default snapshot name: <dropletName>-YYYYMMDD-HHmm
function generateSnapshotName(dropletName) {
	const now = new Date();
	const pad = (n) => String(n).padStart(2, '0');
	const stamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}-${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}`;
	return `${dropletName}-${stamp}`;
}

// Format bytes (gigabytes) to a friendly string
function formatGB(value) {
	if (value == null) return '?';
	if (value < 1) return `${(value * 1024).toFixed(0)} MB`;
	return `${value} GB`;
}

// Format ISO date to readable form (YYYY-MM-DD HH:MM UTC)
function formatDate(iso) {
	if (!iso) return '?';
	try {
		const d = new Date(iso);
		const pad = (n) => String(n).padStart(2, '0');
		return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
	} catch (e) {
		return iso;
	}
}

export default {
	async fetch(request, env) {
		const url = new URL(request.url);

		if (url.pathname === '/registerWebhook') {
			const webhookUrl = `${url.origin}/webhook`;
			const telegramApiUrl = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/setWebhook?url=${webhookUrl}`;
			const response = await fetch(telegramApiUrl);
			const result = await response.json();

			await setMyCommands(env);
			await setChatMenuButton(env);

			return new Response(JSON.stringify({
				webhook: result,
				commands: 'registered',
				menuButton: 'configured'
			}, null, 2), {
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

// ─── API HELPERS ──────────────────────────────────────────────────────────────

async function doApiCall(endpoint, method, apiToken, body = null) {
	const options = {
		method,
		headers: {
			Authorization: `Bearer ${apiToken}`,
			'Content-Type': 'application/json',
		},
	};
	if (body) options.body = JSON.stringify(body);
	const response = await fetch(`https://api.digitalocean.com/v2${endpoint}`, options);
	return await response.json();
}

// Get ALL public images with proper pagination, cached for 24 h
async function getAllImages(apiToken, env) {
	try {
		const cacheKey = 'all_images_cache';
		const cached = await env.DROPLET_CREATION.get(cacheKey);
		if (cached) return JSON.parse(cached);

		let allImages = [];
		let page = 1;
		let totalPages = 1;

		const firstPage = await doApiCall(`/images?page=1&per_page=${IMAGES_PER_PAGE}`, 'GET', apiToken);
		allImages = allImages.concat(firstPage.images || []);
		if (firstPage.meta && firstPage.meta.total) {
			totalPages = Math.ceil(firstPage.meta.total / IMAGES_PER_PAGE);
		}
		for (page = 2; page <= totalPages; page++) {
			const pageData = await doApiCall(`/images?page=${page}&per_page=${IMAGES_PER_PAGE}`, 'GET', apiToken);
			allImages = allImages.concat(pageData.images || []);
		}

		await env.DROPLET_CREATION.put(cacheKey, JSON.stringify(allImages), { expirationTtl: CACHE_TTL });
		return allImages;
	} catch (error) {
		console.error('Error getting all images:', error);
		return [];
	}
}

// Get private snapshots (no cache)
async function getSnapshots(apiToken) {
	try {
		const data = await doApiCall('/images?private=true', 'GET', apiToken);
		return data.images || [];
	} catch (error) {
		console.error('Error getting snapshots:', error);
		return [];
	}
}

// Get images by type: 'os' | 'app' | 'snapshot'
async function getImagesByType(type, apiToken, env) {
	try {
		if (type === 'snapshot') return await getSnapshots(apiToken);
		const allImages = await getAllImages(apiToken, env);
		const typeFilter = type === 'os' ? 'base' : 'application';
		return allImages.filter(img => img.type === typeFilter && img.status === 'available');
	} catch (error) {
		console.error(`Error getting ${type} images:`, error);
		return [];
	}
}

function filterImagesByRegion(images, region) {
	return images.filter(img => !img.regions || img.regions.length === 0 || img.regions.includes(region));
}

function filterImagesForRebuild(images, droplet) {
	return images.filter(img => {
		if (img.status !== 'available') return false;
		if (img.min_disk_size > droplet.disk) return false;
		if (img.regions && img.regions.length > 0 && !img.regions.includes(droplet.region.slug)) return false;
		return true;
	});
}

// ─── TOKEN MANAGEMENT ─────────────────────────────────────────────────────────

async function saveUserApiToken(userId, apiToken, env) {
	try {
		const testResponse = await fetch('https://api.digitalocean.com/v2/account', {
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
			const listResult = await env.DROPLET_CREATION.list({ prefix });
			for (const key of listResult.keys) {
				await env.DROPLET_CREATION.delete(key.name);
			}
		}
	} catch (error) {
		console.error('Error clearing sessions:', error);
	}
}

async function clearAllCache(env) {
	try {
		let deletedCount = 0;
		const listResult = await env.DROPLET_CREATION.list({ prefix: 'all_images_cache' });
		for (const key of listResult.keys) {
			await env.DROPLET_CREATION.delete(key.name);
			deletedCount++;
		}
		return deletedCount;
	} catch (error) {
		console.error('Error clearing cache:', error);
		return 0;
	}
}

// ─── DROPLET NOTES ────────────────────────────────────────────────────────────

async function getDropletNote(dropletId, env) {
	try {
		return await env.DROPLET_CREATION.get(`droplet_note_${dropletId}`);
	} catch {
		return null;
	}
}

async function setDropletNote(dropletId, note, env) {
	try {
		if (!note || note.trim().length === 0) {
			await env.DROPLET_CREATION.delete(`droplet_note_${dropletId}`);
		} else {
			await env.DROPLET_CREATION.put(`droplet_note_${dropletId}`, note.trim());
		}
		return true;
	} catch {
		return false;
	}
}

async function deleteDropletNote(dropletId, env) {
	try {
		await env.DROPLET_CREATION.delete(`droplet_note_${dropletId}`);
		return true;
	} catch {
		return false;
	}
}

// ─── TELEGRAM HELPERS ─────────────────────────────────────────────────────────

async function sendMessage(chatId, text, env, replyMarkup = null) {
	const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
	const body = { chat_id: chatId, text, parse_mode: 'Markdown' };
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
	const body = { chat_id: chatId, message_id: messageId, text, parse_mode: 'Markdown' };
	if (replyMarkup) body.reply_markup = replyMarkup;
	await fetch(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	});
}

async function deleteMessage(chatId, messageId, env) {
	await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/deleteMessage`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ chat_id: chatId, message_id: messageId }),
	});
}

// Register bot commands (/ autocomplete)
async function setMyCommands(env) {
	const commands = [
		{ command: 'start',      description: 'Start the bot' },
		{ command: 'menu',       description: 'Show main menu' },
		{ command: 'droplets',   description: 'List your droplets' },
		{ command: 'create',     description: 'Create new droplet' },
		{ command: 'snapshots',  description: 'Manage snapshots' },
		{ command: 'genai',      description: 'GenAI inference usage & cost' },
		{ command: 'setapi',     description: 'Set API token' },
		{ command: 'clearcache', description: 'Clear cache' },
		{ command: 'help',       description: 'Show help' },
	];
	await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/setMyCommands`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ commands }),
	});
}

// Set menu button to commands-type (appears next to message input)
async function setChatMenuButton(env) {
	await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/setChatMenuButton`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ menu_button: { type: 'commands' } }),
	});
}

async function showMainMenu(chatId, env) {
	const hasApiToken = await getUserApiToken(chatId, env);
	const keyboard = {
		inline_keyboard: [
			[{ text: '📋 List Droplets',     callback_data: 'menu_droplets' }],
			[{ text: '🚀 Create Droplet',    callback_data: 'menu_create' }],
			[{ text: '📸 Manage Snapshots',  callback_data: 'menu_snapshots' }],
			[{ text: '🤖 GenAI Usage',       callback_data: 'menu_genai' }],
			[{ text: '🔑 API Token',         callback_data: 'menu_setapi' }],
			[{ text: '🗑️ Clear Cache',       callback_data: 'menu_clearcache' }],
			[{ text: 'ℹ️ Help',              callback_data: 'menu_help' }],
		]
	};
	const status = hasApiToken ? '✅ API token configured' : '⚠️ No API token set';
	await sendMessage(chatId, `🤖 *DigitalOcean Bot Menu*\n\n${status}\n\nSelect an option:`, env, keyboard);
}

// ─── GENAI USAGE ──────────────────────────────────────────────────────────────

// Parse token count and price-per-thousand from description string
// e.g. "Deepseek 3.2 Input tokens (681034 @ $0.0005/thousand)"
function parseGenAIDescription(description) {
	const match = description.match(/^(.+?)\s+(Input|Output) tokens \((\d+) @ \$([\d.]+)\/thousand\)$/i);
	if (!match) return null;
	return {
		modelName:  match[1].trim(),
		tokenType:  match[2].toLowerCase(), // 'input' | 'output'
		tokenCount: parseInt(match[3], 10),
		pricePerK:  parseFloat(match[4]),
	};
}

// Fetch invoice items for a given invoice UUID and return only GenAI items
async function fetchGenAIItems(invoiceUuid, apiToken) {
	try {
		const data = await doApiCall(`/customers/my/invoices/${invoiceUuid}`, 'GET', apiToken);
		const items = data.invoice_items || [];
		return items.filter(item => item.product === 'GenAI Serverless Inference');
	} catch (e) {
		console.error('Error fetching invoice items:', e);
		return [];
	}
}

// Build a human-readable message for GenAI usage of one invoice period
function buildGenAIMessage(period, genaiItems) {
	if (genaiItems.length === 0) {
		return `*${period}*\n_No GenAI Serverless Inference usage._`;
	}

	// Group by model name
	const models = {};
	let totalCost = 0;

	for (const item of genaiItems) {
		const parsed = parseGenAIDescription(item.description);
		const cost = parseFloat(item.amount) || 0;
		totalCost += cost;

		if (parsed) {
			const key = parsed.modelName;
			if (!models[key]) models[key] = { input: null, output: null };
			models[key][parsed.tokenType] = {
				tokenCount: parsed.tokenCount,
				pricePerK:  parsed.pricePerK,
				cost,
			};
		} else {
			// fallback: unknown format, show raw description
			const key = item.description;
			if (!models[key]) models[key] = { raw: [] };
			models[key].raw.push({ desc: item.description, cost });
		}
	}

	let msg = `🤖 *GenAI Usage — ${period}*\n`;
	msg += `━━━━━━━━━━━━━━━━━━━\n`;

	for (const [modelName, data] of Object.entries(models)) {
		if (data.raw) {
			for (const r of data.raw) {
				msg += `\n📌 ${r.desc}\n💰 Cost: $${r.cost.toFixed(4)}\n`;
			}
			continue;
		}

		msg += `\n🔷 *${modelName}*\n`;

		if (data.input) {
			const { tokenCount, pricePerK, cost } = data.input;
			const tokensFormatted = tokenCount.toLocaleString('en-US');
			msg += `  📥 Input:  \`${tokensFormatted}\` tokens\n`;
			msg += `      $${pricePerK}/K → *$${cost.toFixed(4)}*\n`;
		}

		if (data.output) {
			const { tokenCount, pricePerK, cost } = data.output;
			const tokensFormatted = tokenCount.toLocaleString('en-US');
			msg += `  📤 Output: \`${tokensFormatted}\` tokens\n`;
			msg += `      $${pricePerK}/K → *$${cost.toFixed(4)}*\n`;
		}
	}

	msg += `\n━━━━━━━━━━━━━━━━━━━\n`;
	msg += `💵 *Total GenAI cost: $${totalCost.toFixed(4)}*`;

	return msg;
}

// Show GenAI usage: list of months to choose from
async function showGenAIMenu(chatId, env) {
	const apiToken = await getUserApiToken(chatId, env);
	if (!apiToken) { await sendMessage(chatId, '❌ No API token. Use /setapi first.', env); return; }

	const loading = await sendMessage(chatId, '⏳ Loading billing periods...', env);

	let invoicesData;
	try {
		invoicesData = await doApiCall('/customers/my/invoices', 'GET', apiToken);
	} catch (e) {
		if (loading.result?.message_id) await deleteMessage(chatId, loading.result.message_id, env);
		await sendMessage(chatId, '❌ Failed to fetch invoices.', env);
		return;
	}

	if (loading.result?.message_id) await deleteMessage(chatId, loading.result.message_id, env);

	// Build list: invoice_preview (current month) + past invoices
	const buttons = [];

	if (invoicesData.invoice_preview) {
		const p = invoicesData.invoice_preview;
		buttons.push([{ text: `📅 ${p.invoice_period} (current)`, callback_data: `genai_inv_${p.invoice_uuid}` }]);
	}

	for (const inv of (invoicesData.invoices || [])) {
		buttons.push([{ text: `📄 ${inv.invoice_period}`, callback_data: `genai_inv_${inv.invoice_uuid}` }]);
	}

	if (buttons.length === 0) {
		await sendMessage(chatId, '❌ No billing periods found.', env);
		return;
	}

	await sendMessage(
		chatId,
		`🤖 *GenAI Serverless Inference Usage*\n\nSelect a billing period to view usage:`,
		env,
		{ inline_keyboard: buttons }
	);
}

// Show GenAI usage detail for a specific invoice
async function showGenAIInvoiceDetail(chatId, messageId, invoiceUuid, env) {
	const apiToken = await getUserApiToken(chatId, env);
	if (!apiToken) { await editMessage(chatId, messageId, '❌ No API token.', env); return; }

	await editMessage(chatId, messageId, '⏳ Loading GenAI usage...', env);

	// We need the period label — fetch invoice list to find it
	let period = invoiceUuid.slice(0, 8); // fallback
	try {
		const invList = await doApiCall('/customers/my/invoices', 'GET', apiToken);
		if (invList.invoice_preview?.invoice_uuid === invoiceUuid) {
			period = invList.invoice_preview.invoice_period + ' (current)';
		} else {
			const found = (invList.invoices || []).find(i => i.invoice_uuid === invoiceUuid);
			if (found) period = found.invoice_period;
		}
	} catch (_) {}

	const genaiItems = await fetchGenAIItems(invoiceUuid, apiToken);
	const msg = buildGenAIMessage(period, genaiItems);

	await editMessage(chatId, messageId, msg, env, {
		inline_keyboard: [
			[{ text: '◀️ Back to periods', callback_data: 'genai_back' }],
		]
	});
}

// ─── MESSAGE HANDLER ──────────────────────────────────────────────────────────

async function handleMessage(message, env) {
	const chatId = message.chat.id;
	const userId = message.from.id;
	const text = message.text;

	const allowedUsers = env.ALLOWED_USER_IDS.split(',').map(id => parseInt(id.trim()));
	if (!allowedUsers.includes(userId)) {
		await sendMessage(chatId, '⛔ Access denied. You are not authorized to use this bot.', env);
		return;
	}

	// Escape hatches — always break out of any state
	if (text === '/start' || text === '/menu') {
		await clearState(chatId, env);
		await showMainMenu(chatId, env);
		return;
	}
	if (text === '/cancel') {
		await clearState(chatId, env);
		await sendMessage(chatId, '✅ Cancelled.', env);
		return;
	}

	// Check current state for direct-input flows
	const state = await getState(chatId, env);

	if (state?.step === 'setting_api_token') {
		await deleteMessage(chatId, message.message_id, env);
		const validatingMsg = await sendMessage(chatId, '⏳ Validating your API token...', env);
		const isValid = await saveUserApiToken(chatId, text.trim(), env);
		if (validatingMsg.result?.message_id) await deleteMessage(chatId, validatingMsg.result.message_id, env);
		if (isValid) {
			await sendMessage(chatId, '✅ API token saved successfully!\n\nYou can now use /droplets and /create commands.', env);
		} else {
			await sendMessage(chatId, '❌ Invalid API token!\n\nPlease check your token and try /setapi again.', env);
		}
		await clearState(chatId, env);
		return;
	}

	if (state?.step === 'searching_image') {
		await handleImageSearch(chatId, text, state, env);
		return;
	}

	if (state?.step === 'rebuild_searching_image') {
		await handleRebuildImageSearch(chatId, text, state, env);
		return;
	}

	// CREATE flow — asking for custom droplet name
	if (state?.step === 'renaming_droplet') {
		const sessionId = state.sessionId;
		if (!sessionId) {
			await clearState(chatId, env);
			await sendMessage(chatId, '❌ Session expired. Please try /create again.', env);
			return;
		}
		const customName = text.trim();
		if (!isValidDropletName(customName)) {
			await sendMessage(chatId, '❌ *Invalid droplet name!*\n\n✅ Allowed: a-z, A-Z, 0-9, . and -\n\nPlease try again:', env);
			return;
		}
		const dataStr = await env.DROPLET_CREATION.get(sessionId);
		if (!dataStr) {
			await clearState(chatId, env);
			await sendMessage(chatId, '❌ Session expired. Please try /create again.', env);
			return;
		}
		const data = JSON.parse(dataStr);
		await clearState(chatId, env);
		await confirmDropletCreation(chatId, customName, data.region, data.size, data.image, env);
		return;
	}

	// Renaming an existing droplet
	if (state?.step === 'renaming_existing_droplet') {
		const { dropletId, oldName } = state;
		if (!dropletId) {
			await clearState(chatId, env);
			await sendMessage(chatId, '❌ Session expired. Please try again.', env);
			return;
		}
		const newName = text.trim();
		if (!isValidDropletName(newName)) {
			await sendMessage(chatId, '❌ *Invalid droplet name!*\n\n✅ Allowed: a-z, A-Z, 0-9, . and -\n\nPlease try again:', env);
			return;
		}
		if (newName === oldName) {
			await clearState(chatId, env);
			await sendMessage(chatId, '❌ *New name is same as old name!*\n\nPlease use a different name.', env);
			return;
		}
		await clearState(chatId, env);
		await confirmRenameDroplet(chatId, dropletId, oldName, newName, env);
		return;
	}

	// Custom snapshot name input
	if (state?.step === 'naming_snapshot') {
		const { dropletId, dropletName } = state;
		if (!dropletId) {
			await clearState(chatId, env);
			await sendMessage(chatId, '❌ Session expired. Please try again.', env);
			return;
		}
		const snapshotName = text.trim();
		if (!isValidSnapshotName(snapshotName)) {
			await sendMessage(chatId, `❌ *Invalid snapshot name!*\n\n✅ Allowed: a-z, A-Z, 0-9, spaces, . _ -\n✅ Max ${MAX_SNAPSHOT_NAME_LENGTH} characters\n\nPlease try again or send /cancel:`, env);
			return;
		}
		await clearState(chatId, env);
		await confirmSnapshotCreation(chatId, dropletId, dropletName, snapshotName, env);
		return;
	}

	// Editing a droplet note
	if (state?.step === 'editing_note') {
		const { dropletId } = state;
		if (!dropletId) {
			await clearState(chatId, env);
			await sendMessage(chatId, '❌ Session expired. Please try again.', env);
			return;
		}
		const noteText = text.trim();
		if (noteText.length > MAX_NOTE_LENGTH) {
			await sendMessage(chatId, `❌ Note too long! Maximum ${MAX_NOTE_LENGTH} characters (yours: ${noteText.length}).\n\nPlease try again:`, env);
			return;
		}
		const success = await setDropletNote(dropletId, noteText, env);
		await clearState(chatId, env);
		await sendMessage(chatId, success ? '✅ *Note saved!*\n\nYou can view it in droplet details.' : '❌ Failed to save note. Please try again.', env);
		return;
	}

	// Slash commands
	if (text === '/help') {
		await clearState(chatId, env);
		await sendMessage(chatId, `📚 *DigitalOcean Bot Help*\n\n*Commands:*\n• /menu - Show main menu\n• /droplets - List your droplets\n• /create - Create new droplet\n• /snapshots - Manage snapshots\n• /genai - GenAI usage & cost\n• /setapi - Set API token\n• /clearcache - Clear cached data\n• /help - Show this help\n\n*Features:*\n• Create droplets with OS/Apps/Snapshots\n• Rebuild existing droplets\n• Rename droplets\n• Power on/off/restart droplets\n• Take droplet snapshots\n• Delete droplets and snapshots\n• Search images\n• Add notes to droplets\n• GenAI token usage & cost per model per month\n• Smart caching for faster performance\n\n*Get API Token:*\nhttps://cloud.digitalocean.com/account/api/tokens`, env);
	} else if (text === '/setapi') {
		await clearState(chatId, env);
		const hasExisting = await getUserApiToken(chatId, env);
		await sendMessage(chatId, hasExisting
			? '🔑 *Change API Token*\n\n⚠️ This will clear all sessions.\n\nSend your new DigitalOcean API token:'
			: '🔑 *Setup API Token*\n\nSend your DigitalOcean API token:\n\nGet it at: https://cloud.digitalocean.com/', env);
		await setState(chatId, { step: 'setting_api_token' }, env);
	} else if (text === '/droplets') {
		await clearState(chatId, env);
		await listDroplets(chatId, env);
	} else if (text === '/create') {
		await clearState(chatId, env);
		await showRegions(chatId, env);
	} else if (text === '/snapshots') {
		await clearState(chatId, env);
		await showSnapshotsList(chatId, 0, env);
	} else if (text === '/genai') {
		await clearState(chatId, env);
		await showGenAIMenu(chatId, env);
	} else if (text === '/clearcache') {
		await clearState(chatId, env);
		const msg = await sendMessage(chatId, '⏳ Clearing cache...', env);
		const count = await clearAllCache(env);
		await clearUserSessions(chatId, env);
		if (msg.result?.message_id) await deleteMessage(chatId, msg.result.message_id, env);
		await sendMessage(chatId, `✅ Cache cleared!\n\n🗑️ Deleted ${count} cached items\n🔄 Cleared your sessions\n\n💡 API token & notes preserved`, env);
	}
}

// ─── CALLBACK QUERY HANDLER ───────────────────────────────────────────────────

async function handleCallbackQuery(callbackQuery, env) {
	const chatId    = callbackQuery.message.chat.id;
	const messageId = callbackQuery.message.message_id;
	const data      = callbackQuery.data;

	await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ callback_query_id: callbackQuery.id }),
	});

	// ── Main menu ──
	if (data === 'menu_droplets') {
		await deleteMessage(chatId, messageId, env); await listDroplets(chatId, env); return;
	}
	if (data === 'menu_create') {
		await deleteMessage(chatId, messageId, env); await showRegions(chatId, env); return;
	}
	if (data === 'menu_setapi') {
		await deleteMessage(chatId, messageId, env);
		const hasExisting = await getUserApiToken(chatId, env);
		await sendMessage(chatId, hasExisting
			? '🔑 *Change API Token*\n\n⚠️ This will clear all sessions.\n\nSend your new DigitalOcean API token:'
			: '🔑 *Setup API Token*\n\nSend your DigitalOcean API token:\n\nGet it at: https://cloud.digitalocean.com/', env);
		await setState(chatId, { step: 'setting_api_token' }, env);
		return;
	}
	if (data === 'menu_clearcache') {
		await deleteMessage(chatId, messageId, env);
		const msg = await sendMessage(chatId, '⏳ Clearing cache...', env);
		const count = await clearAllCache(env);
		await clearUserSessions(chatId, env);
		if (msg.result?.message_id) await deleteMessage(chatId, msg.result.message_id, env);
		await sendMessage(chatId, `✅ Cache cleared!\n\n🗑️ Deleted ${count} cached items\n🔄 Cleared your sessions\n\n💡 API token & notes preserved`, env);
		return;
	}
	if (data === 'menu_help') {
		await deleteMessage(chatId, messageId, env);
		await sendMessage(chatId, `📚 *DigitalOcean Bot Help*\n\n*Commands:*\n• /menu - Show main menu\n• /droplets - List your droplets\n• /create - Create new droplet\n• /snapshots - Manage snapshots\n• /genai - GenAI usage & cost\n• /setapi - Set API token\n• /clearcache - Clear cached data\n• /help - Show this help\n\n*Features:*\n• Create droplets with OS/Apps/Snapshots\n• Rebuild existing droplets\n• Rename droplets\n• Power on/off/restart droplets\n• Take droplet snapshots\n• Delete droplets and snapshots\n• Search images\n• Add notes to droplets\n• GenAI token usage & cost per model per month\n• Smart caching for faster performance\n\n*Get API Token:*\nhttps://cloud.digitalocean.com/account/api/tokens`, env);
		return;
	}
	if (data === 'menu_snapshots') {
		await deleteMessage(chatId, messageId, env); await showSnapshotsList(chatId, 0, env); return;
	}
	if (data === 'menu_genai') {
		await deleteMessage(chatId, messageId, env); await showGenAIMenu(chatId, env); return;
	}

	// ── GenAI invoice detail ──
	if (data.startsWith('genai_inv_')) {
		const invoiceUuid = data.replace('genai_inv_', '');
		await showGenAIInvoiceDetail(chatId, messageId, invoiceUuid, env);
		return;
	}
	if (data === 'genai_back') {
		await deleteMessage(chatId, messageId, env);
		await showGenAIMenu(chatId, env);
		return;
	}

	// ── Region selection (Step 1) ──
	if (data.startsWith('region_')) {
		const region = data.replace('region_', '');
		await setState(chatId, { region }, env);
		await deleteMessage(chatId, messageId, env);
		await showImageTypeSelection(chatId, region, env);
	}
	// ── Image type selection (Step 2) ──
	else if (data.startsWith('imgtype_')) {
		const [region, type] = data.replace('imgtype_', '').split('_');
		await deleteMessage(chatId, messageId, env);
		await showImagesList(chatId, region, type, 0, env);
	}
	// ── Image pagination ──
	else if (data.startsWith('imgpage_')) {
		const parts = data.replace('imgpage_', '').split('_');
		await showImagesListEdit(chatId, messageId, parts[0], parts[1], parseInt(parts[2]), env);
	}
	// ── Image search ──
	else if (data.startsWith('imgsearch_')) {
		const [region, type] = data.replace('imgsearch_', '').split('_');
		await deleteMessage(chatId, messageId, env);
		await sendMessage(chatId, `🔍 *Search ${type === 'app' ? 'Applications' : type === 'os' ? 'OS' : 'Snapshots'}*\n\nType at least ${MIN_SEARCH_LENGTH} characters:`, env);
		await setState(chatId, { step: 'searching_image', region, type }, env);
	}
	else if (data.startsWith('back_from_search_')) {
		const region = data.replace('back_from_search_', '');
		await clearState(chatId, env);
		await deleteMessage(chatId, messageId, env);
		await showImageTypeSelection(chatId, region, env);
	}
	// ── Image selection → sizes (Step 3) ──
	else if (data.startsWith('selectimg_')) {
		const parts = data.replace('selectimg_', '').split('_');
		await deleteMessage(chatId, messageId, env);
		await showSizes(chatId, parts[0], parts.slice(1).join('_'), env);
	}
	else if (data.startsWith('size_')) {
		const parts = data.replace('size_', '').split('_');
		const state = await getState(chatId, env);
		state.size = parts.slice(2).join('_'); state.region = parts[0]; state.image = parts[1];
		await setState(chatId, state, env);
		await deleteMessage(chatId, messageId, env);
		await askDropletName(chatId, parts[1], parts.slice(2).join('_'), parts[0], env);
	}
	// ── Droplet name step ──
	else if (data.startsWith('use_default_name_')) {
		await deleteMessage(chatId, messageId, env);
		await useDefaultNameAndConfirm(chatId, data.replace('use_default_name_', ''), env);
	}
	else if (data.startsWith('rename_droplet_')) {
		const sessionId = data.replace('rename_droplet_', '');
		const dataStr = await env.DROPLET_CREATION.get(sessionId);
		if (!dataStr) { await editMessage(chatId, messageId, '❌ Session expired.', env); return; }
		const sessionData = JSON.parse(dataStr);
		await deleteMessage(chatId, messageId, env);
		await setState(chatId, { step: 'renaming_droplet', sessionId }, env);
		await sendMessage(chatId, `📝 *Rename Droplet*\n\nRegion: ${sessionData.region}\nSize: ${sessionData.size}\nImage: ${sessionData.image}\n\n✅ Allowed: a-z, A-Z, 0-9, . and -\n\nSend your desired droplet name:`, env);
	}
	// ── Confirm & create ──
	else if (data.startsWith('confirmcreate_')) {
		await createDropletFromKV(chatId, messageId, data.replace('confirmcreate_', ''), env);
	}
	// ── Droplet management ──
	else if (data.startsWith('droplet_')) {
		await showDropletDetails(chatId, messageId, data.replace('droplet_', ''), env);
	}
	else if (data.startsWith('confirm_delete_')) {
		await showDeleteConfirmation(chatId, messageId, data.replace('confirm_delete_', ''), env);
	}
	// NOTE: delete_note_ must be checked BEFORE delete_
	else if (data.startsWith('delete_note_')) {
		const dropletId = data.replace('delete_note_', '');
		const success = await deleteDropletNote(dropletId, env);
		await deleteMessage(chatId, messageId, env);
		await sendMessage(chatId, success ? '✅ *Note deleted!*' : '❌ Failed to delete note.', env);
	}
	else if (data.startsWith('delete_')) {
		await deleteDroplet(chatId, messageId, data.replace('delete_', ''), env);
	}
	else if (data === 'back_to_list') {
		await editMessageToDropletList(chatId, messageId, env);
	}
	else if (data.startsWith('rebuild_')) {
		await showRebuildImageTypeSelection(chatId, messageId, data.replace('rebuild_', ''), env);
	}
	// ── Notes ──
	else if (data.startsWith('manage_note_')) {
		await showNoteManagement(chatId, messageId, data.replace('manage_note_', ''), env);
	}
	else if (data.startsWith('add_note_')) {
		const dropletId = data.replace('add_note_', '');
		await deleteMessage(chatId, messageId, env);
		await setState(chatId, { step: 'editing_note', dropletId }, env);
		await sendMessage(chatId, `📝 *Add Note*\n\nSend your note for this droplet:\n\n✅ Max ${MAX_NOTE_LENGTH} characters\n✅ Multi-line supported`, env);
	}
	else if (data.startsWith('edit_note_')) {
		const dropletId = data.replace('edit_note_', '');
		await deleteMessage(chatId, messageId, env);
		const currentNote = await getDropletNote(dropletId, env);
		await setState(chatId, { step: 'editing_note', dropletId }, env);
		await sendMessage(chatId, `📝 *Edit Note*\n\nCurrent note:\n\`\`\`\n${currentNote || 'No note'}\n\`\`\`\n\nSend your new note:\n\n✅ Max ${MAX_NOTE_LENGTH} characters\n✅ Multi-line supported`, env);
	}
	else if (data.startsWith('back_to_droplet_')) {
		await showDropletDetails(chatId, messageId, data.replace('back_to_droplet_', ''), env);
	}
	// ── Rename existing droplet ──
	else if (data.startsWith('rename_existing_')) {
		const dropletId = data.replace('rename_existing_', '');
		const apiToken = await getUserApiToken(chatId, env);
		const dropletData = await doApiCall(`/droplets/${dropletId}`, 'GET', apiToken);
		if (!dropletData.droplet) { await editMessage(chatId, messageId, '❌ Droplet not found.', env); return; }
		await deleteMessage(chatId, messageId, env);
		await setState(chatId, { step: 'renaming_existing_droplet', dropletId, oldName: dropletData.droplet.name }, env);
		await sendMessage(chatId, `🏷️ *Rename Droplet*\n\nCurrent name: \`${dropletData.droplet.name}\`\n\n✅ Allowed: a-z, A-Z, 0-9, . and -\n\nSend new droplet name:`, env);
	}
	else if (data.startsWith('confirm_rename_')) {
		await executeRename(chatId, messageId, data.replace('confirm_rename_', ''), env);
	}
	// ── Rebuild ──
	else if (data.startsWith('rebuildtype_')) {
		const parts = data.replace('rebuildtype_', '').split('_');
		await showRebuildImagesList(chatId, messageId, parts[0], parts[1], 0, env);
	}
	else if (data.startsWith('rebuildpage_')) {
		const parts = data.replace('rebuildpage_', '').split('_');
		await showRebuildImagesList(chatId, messageId, parts[0], parts[1], parseInt(parts[2]), env);
	}
	else if (data.startsWith('rebuildsearch_')) {
		const parts = data.replace('rebuildsearch_', '').split('_');
		await deleteMessage(chatId, messageId, env);
		await sendMessage(chatId, `🔍 *Search ${parts[1] === 'app' ? 'Applications' : parts[1] === 'os' ? 'OS' : 'Snapshots'}*\n\nType at least ${MIN_SEARCH_LENGTH} characters:`, env);
		await setState(chatId, { step: 'rebuild_searching_image', dropletId: parts[0], type: parts[1] }, env);
	}
	else if (data.startsWith('back_from_rebuild_search_')) {
		const dropletId = data.replace('back_from_rebuild_search_', '');
		await clearState(chatId, env);
		await deleteMessage(chatId, messageId, env);
		await showRebuildImageTypeSelectionNew(chatId, dropletId, env);
	}
	else if (data.startsWith('rebuildimg_')) {
		const parts = data.replace('rebuildimg_', '').split('_');
		await confirmRebuild(chatId, messageId, parts[0], parts.slice(1).join('_'), env);
	}
	else if (data.startsWith('execute_rebuild_')) {
		await executeRebuild(chatId, messageId, data.replace('execute_rebuild_', ''), env);
	}
	// ── Power on/off ──
	else if (data.startsWith('pwr_on_yes_')) {
		await executePowerAction(chatId, messageId, data.replace('pwr_on_yes_', ''), 'power_on', env);
	}
	else if (data.startsWith('pwr_off_yes_')) {
		await executePowerAction(chatId, messageId, data.replace('pwr_off_yes_', ''), 'power_off', env);
	}
	else if (data.startsWith('pwr_on_')) {
		await confirmPowerAction(chatId, messageId, data.replace('pwr_on_', ''), 'power_on', env);
	}
	else if (data.startsWith('pwr_off_')) {
		await confirmPowerAction(chatId, messageId, data.replace('pwr_off_', ''), 'power_off', env);
	}
	// ── Restart ──
	else if (data.startsWith('restart_yes_')) {
		await executeRestartAction(chatId, messageId, data.replace('restart_yes_', ''), env);
	}
	else if (data.startsWith('restart_')) {
		await confirmRestartAction(chatId, messageId, data.replace('restart_', ''), env);
	}
	// ── Take snapshot ──
	else if (data.startsWith('snap_take_')) {
		await askSnapshotName(chatId, messageId, data.replace('snap_take_', ''), env);
	}
	else if (data.startsWith('snap_default_')) {
		await useDefaultSnapshotName(chatId, messageId, data.replace('snap_default_', ''), env);
	}
	else if (data.startsWith('snap_rename_')) {
		const sessionId = data.replace('snap_rename_', '');
		const dataStr = await env.DROPLET_CREATION.get(sessionId);
		if (!dataStr) { await editMessage(chatId, messageId, '❌ Session expired.', env); return; }
		const sessionData = JSON.parse(dataStr);
		await deleteMessage(chatId, messageId, env);
		await setState(chatId, { step: 'naming_snapshot', dropletId: sessionData.dropletId, dropletName: sessionData.dropletName }, env);
		await sendMessage(chatId, `📝 *Snapshot Name*\n\nDroplet: \`${sessionData.dropletName}\`\n\n✅ Allowed: a-z, A-Z, 0-9, spaces, . _ -\n✅ Max ${MAX_SNAPSHOT_NAME_LENGTH} characters\n\nSend your snapshot name (or /cancel to abort):`, env);
	}
	else if (data.startsWith('snap_exec_')) {
		await executeSnapshot(chatId, messageId, data.replace('snap_exec_', ''), env);
	}
	// ── Snapshot management ──
	else if (data.startsWith('snap_page_')) {
		await showSnapshotsListEdit(chatId, messageId, parseInt(data.replace('snap_page_', '')), env);
	}
	else if (data.startsWith('snap_view_')) {
		await showSnapshotDetails(chatId, messageId, data.replace('snap_view_', ''), env);
	}
	else if (data.startsWith('snap_del_yes_')) {
		await executeDeleteSnapshot(chatId, messageId, data.replace('snap_del_yes_', ''), env);
	}
	else if (data.startsWith('snap_del_')) {
		await confirmDeleteSnapshot(chatId, messageId, data.replace('snap_del_', ''), env);
	}
	else if (data === 'snap_back_list') {
		await showSnapshotsListEdit(chatId, messageId, 0, env);
	}
	// ── Cancel / back ──
	else if (data === 'cancel_create') {
		await clearState(chatId, env); await editMessage(chatId, messageId, '❌ Cancelled.', env);
	}
	else if (data === 'back_to_regions') {
		await showRegionsEdit(chatId, messageId, env);
	}
}

// ─── STATE MANAGEMENT ─────────────────────────────────────────────────────────

async function getState(chatId, env) {
	const json = await env.DROPLET_CREATION.get(`state_${chatId}`);
	return json ? JSON.parse(json) : {};
}

async function setState(chatId, state, env) {
	await env.DROPLET_CREATION.put(`state_${chatId}`, JSON.stringify(state), { expirationTtl: 600 });
}

async function clearState(chatId, env) {
	await env.DROPLET_CREATION.delete(`state_${chatId}`);
}

// ─── REGION SELECTION (Step 1) ────────────────────────────────────────────────

async function showRegions(chatId, env) {
	const apiToken = await getUserApiToken(chatId, env);
	if (!apiToken) { await sendMessage(chatId, '❌ No API token. Use /setapi first.', env); return; }
	const data = await doApiCall('/regions', 'GET', apiToken);
	const regions = data.regions.filter(r => r.available);
	const keyboard = [];
	for (let i = 0; i < regions.length; i += 2) {
		const row = [{ text: regions[i].name, callback_data: `region_${regions[i].slug}` }];
		if (i + 1 < regions.length) row.push({ text: regions[i + 1].name, callback_data: `region_${regions[i + 1].slug}` });
		keyboard.push(row);
	}
	await sendMessage(chatId, '🚀 *Create New Droplet*\n\n🌍 Step 1: Select region', env, { inline_keyboard: keyboard });
}

async function showRegionsEdit(chatId, messageId, env) {
	const apiToken = await getUserApiToken(chatId, env);
	const data = await doApiCall('/regions', 'GET', apiToken);
	const regions = data.regions.filter(r => r.available);
	const keyboard = [];
	for (let i = 0; i < regions.length; i += 2) {
		const row = [{ text: regions[i].name, callback_data: `region_${regions[i].slug}` }];
		if (i + 1 < regions.length) row.push({ text: regions[i + 1].name, callback_data: `region_${regions[i + 1].slug}` });
		keyboard.push(row);
	}
	await editMessage(chatId, messageId, '🌍 *Select region:*', env, { inline_keyboard: keyboard });
}

// ─── IMAGE TYPE SELECTION (Step 2) ────────────────────────────────────────────

async function showImageTypeSelection(chatId, region, env) {
	const keyboard = {
		inline_keyboard: [
			[{ text: '🐧 Operating Systems', callback_data: `imgtype_${region}_os` }],
			[{ text: '📦 Applications',      callback_data: `imgtype_${region}_app` }],
			[{ text: '📸 My Snapshots',      callback_data: `imgtype_${region}_snapshot` }],
			[{ text: '◀️ Back to Regions',   callback_data: 'back_to_regions' }],
		]
	};
	await sendMessage(chatId, `✅ Region: *${region}*\n\n🖥️ Step 2: Choose image type`, env, keyboard);
}

// ─── IMAGES LIST WITH PAGINATION ──────────────────────────────────────────────

async function showImagesList(chatId, region, type, page, env) {
	const apiToken = await getUserApiToken(chatId, env);
	if (!apiToken) { await sendMessage(chatId, '❌ No API token.', env); return; }
	let images = filterImagesByRegion(await getImagesByType(type, apiToken, env), region);
	if (images.length === 0) {
		await sendMessage(chatId, `❌ No ${type === 'app' ? 'applications' : type === 'os' ? 'OS images' : 'snapshots'} available in ${region}.`, env);
		return;
	}
	const totalPages = Math.ceil(images.length / ITEMS_PER_PAGE);
	const pageImages = images.slice(page * ITEMS_PER_PAGE, (page + 1) * ITEMS_PER_PAGE);
	const keyboard = pageImages.map(img => [{ text: img.name, callback_data: `selectimg_${region}_${img.id}` }]);
	const nav = [];
	if (page > 0) nav.push({ text: '◀️ Previous', callback_data: `imgpage_${region}_${type}_${page - 1}` });
	if (page < totalPages - 1) nav.push({ text: 'Next ▶️', callback_data: `imgpage_${region}_${type}_${page + 1}` });
	if (nav.length) keyboard.push(nav);
	keyboard.push([{ text: '🔍 Search', callback_data: `imgsearch_${region}_${type}` }]);
	keyboard.push([{ text: '◀️ Back',   callback_data: 'back_to_regions' }]);
	const label = type === 'app' ? 'Applications' : type === 'os' ? 'Operating Systems' : 'Snapshots';
	const emoji = type === 'app' ? '📦' : type === 'os' ? '🐧' : '📸';
	await sendMessage(chatId, `${emoji} *${label}*\n\nPage ${page + 1}/${totalPages} (${images.length} total)`, env, { inline_keyboard: keyboard });
}

async function showImagesListEdit(chatId, messageId, region, type, page, env) {
	const apiToken = await getUserApiToken(chatId, env);
	let images = filterImagesByRegion(await getImagesByType(type, apiToken, env), region);
	const totalPages = Math.ceil(images.length / ITEMS_PER_PAGE);
	const pageImages = images.slice(page * ITEMS_PER_PAGE, (page + 1) * ITEMS_PER_PAGE);
	const keyboard = pageImages.map(img => [{ text: img.name, callback_data: `selectimg_${region}_${img.id}` }]);
	const nav = [];
	if (page > 0) nav.push({ text: '◀️ Previous', callback_data: `imgpage_${region}_${type}_${page - 1}` });
	if (page < totalPages - 1) nav.push({ text: 'Next ▶️', callback_data: `imgpage_${region}_${type}_${page + 1}` });
	if (nav.length) keyboard.push(nav);
	keyboard.push([{ text: '🔍 Search', callback_data: `imgsearch_${region}_${type}` }]);
	keyboard.push([{ text: '◀️ Back',   callback_data: 'back_to_regions' }]);
	const label = type === 'app' ? 'Applications' : type === 'os' ? 'Operating Systems' : 'Snapshots';
	const emoji = type === 'app' ? '📦' : type === 'os' ? '🐧' : '📸';
	await editMessage(chatId, messageId, `${emoji} *${label}*\n\nPage ${page + 1}/${totalPages} (${images.length} total)`, env, { inline_keyboard: keyboard });
}

// ─── IMAGE SEARCH ─────────────────────────────────────────────────────────────

async function handleImageSearch(chatId, query, state, env) {
	if (query.length < MIN_SEARCH_LENGTH) {
		await sendMessage(chatId, `❌ Search query too short. Min ${MIN_SEARCH_LENGTH} characters.`, env);
		return;
	}
	const apiToken = await getUserApiToken(chatId, env);
	const results = filterImagesByRegion(await getImagesByType(state.type, apiToken, env), state.region)
		.filter(img => img.name.toLowerCase().includes(query.toLowerCase()));
	if (results.length === 0) {
		await clearState(chatId, env);
		await sendMessage(chatId, '❌ No results found.', env, {
			inline_keyboard: [[{ text: '◀️ Back to Menu', callback_data: `back_from_search_${state.region}` }]]
		});
		return;
	}
	const totalPages = Math.ceil(results.length / ITEMS_PER_PAGE);
	const keyboard = results.slice(0, ITEMS_PER_PAGE).map(img => [{ text: img.name, callback_data: `selectimg_${state.region}_${img.id}` }]);
	if (totalPages > 1) keyboard.push([{ text: 'Next ▶️', callback_data: `imgpage_${state.region}_${state.type}_1` }]);
	keyboard.push([{ text: '◀️ Back', callback_data: `back_from_search_${state.region}` }]);
	await sendMessage(chatId, `🔍 Found ${results.length} result(s)\n\nPage 1/${totalPages}`, env, { inline_keyboard: keyboard });
	await clearState(chatId, env);
}

// ─── SIZE SELECTION (Step 3) ──────────────────────────────────────────────────

async function showSizes(chatId, region, imageId, env) {
	const apiToken = await getUserApiToken(chatId, env);
	const imageData = await doApiCall(`/images/${imageId}`, 'GET', apiToken);
	const image = imageData.image;
	if (!image) { await sendMessage(chatId, '❌ Image not found.', env); return; }

	const regionData = await doApiCall('/regions', 'GET', apiToken);
	const regionSizes = regionData.regions.find(r => r.slug === region)?.sizes || [];
	if (regionSizes.length === 0) { await sendMessage(chatId, '❌ No sizes available in this region.', env); return; }

	const sizesData = await doApiCall('/sizes', 'GET', apiToken);
	const available = sizesData.sizes
		.filter(s => s.available && regionSizes.includes(s.slug) && s.disk >= image.min_disk_size)
		.sort((a, b) => a.price_monthly - b.price_monthly);
	if (available.length === 0) {
		await sendMessage(chatId, `⚠️ *No compatible sizes!*\n\n${image.name} requires:\n• Min ${image.min_disk_size}GB disk`, env);
		return;
	}
	await setState(chatId, { region, image: imageId }, env);
	const keyboard = available.slice(0, 15).map(s => [{
		text: `${s.slug} - $${s.price_monthly}/mo (${Math.ceil(s.memory / 1024)}GB RAM, ${s.disk}GB)`,
		callback_data: `size_${region}_${imageId}_${s.slug}`
	}]);
	keyboard.push([{ text: '◀️ Back', callback_data: 'back_to_regions' }]);
	await sendMessage(chatId, `✅ Image: *${image.name}*\n\n💰 Step 3: Select size`, env, { inline_keyboard: keyboard });
}

// ─── DROPLET NAME & CREATION ──────────────────────────────────────────────────

function generateDropletName(imageId, size, region) {
	return `droplet-${size}-${region}-${Date.now().toString().slice(-4)}`;
}

async function askDropletName(chatId, imageId, size, region, env) {
	const defaultName = generateDropletName(imageId, size, region);
	const sessionId = `session_${chatId}_${Date.now()}`;
	await env.DROPLET_CREATION.put(sessionId, JSON.stringify({ region, size, image: imageId, defaultName }), { expirationTtl: 300 });
	const keyboard = {
		inline_keyboard: [
			[{ text: '✅ Use Default', callback_data: `use_default_name_${sessionId}` },
			 { text: '📝 Rename',      callback_data: `rename_droplet_${sessionId}` }],
			[{ text: '◀️ Back', callback_data: 'back_to_regions' }],
		]
	};
	await sendMessage(chatId, `📝 *Droplet Name*\n\nRegion: ${region}\nSize: ${size}\nImage ID: ${imageId}\n\nDefault: \`${defaultName}\``, env, keyboard);
}

async function useDefaultNameAndConfirm(chatId, sessionId, env) {
	const dataStr = await env.DROPLET_CREATION.get(sessionId);
	if (!dataStr) { await sendMessage(chatId, '❌ Session expired.', env); return; }
	const data = JSON.parse(dataStr);
	await confirmDropletCreation(chatId, data.defaultName, data.region, data.size, data.image, env);
	await env.DROPLET_CREATION.delete(sessionId);
}

async function confirmDropletCreation(chatId, name, region, size, imageId, env) {
	const apiToken = await getUserApiToken(chatId, env);
	const keysData = await doApiCall('/account/keys', 'GET', apiToken);
	const sshKeys = keysData.ssh_keys || [];
	if (sshKeys.length === 0) {
		await sendMessage(chatId, '❌ *No SSH Keys*\n\nAdd an SSH key to your DigitalOcean account first.', env);
		return;
	}
	const creationId = `create_${chatId}_${Date.now()}`;
	await env.DROPLET_CREATION.put(creationId, JSON.stringify({ name, region, size, image: imageId, sshKeyIds: sshKeys.map(k => k.id) }), { expirationTtl: 300 });
	const keyboard = {
		inline_keyboard: [
			[{ text: '✅ Create', callback_data: `confirmcreate_${creationId}` }],
			[{ text: '◀️ Back',  callback_data: 'back_to_regions' }],
		]
	};
	await sendMessage(chatId, `⚠️ *Confirm*\n\n*Name:* ${name}\n*Region:* ${region}\n*Size:* ${size}\n*Image ID:* ${imageId}\n*SSH Keys:* ${sshKeys.length}`, env, keyboard);
}

async function createDropletFromKV(chatId, messageId, creationId, env) {
	const apiToken = await getUserApiToken(chatId, env);
	const dataStr = await env.DROPLET_CREATION.get(creationId);
	if (!dataStr) { await editMessage(chatId, messageId, '❌ Session expired.', env); return; }
	const data = JSON.parse(dataStr);
	await editMessage(chatId, messageId, '⏳ Creating...', env);
	const result = await doApiCall('/droplets', 'POST', apiToken, {
		name: data.name, region: data.region, size: data.size, image: data.image,
		ssh_keys: data.sshKeyIds, backups: false, ipv6: false, monitoring: true,
	});
	if (result.droplet) {
		const ip = result.droplet.networks.v4.find(n => n.type === 'public')?.ip_address || 'Assigning...';
		await editMessage(chatId, messageId, `✅ *Created!*\n\n*Name:* ${result.droplet.name}\n*IP:* \`${ip}\`\n\nSSH: \`ssh root@${ip}\``, env);
		await env.DROPLET_CREATION.delete(creationId);
	} else {
		await editMessage(chatId, messageId, `❌ Failed: ${result.message || 'Unknown'}`, env);
	}
}

// ─── DROPLET MANAGEMENT ───────────────────────────────────────────────────────

async function listDroplets(chatId, env) {
	const apiToken = await getUserApiToken(chatId, env);
	if (!apiToken) { await sendMessage(chatId, '❌ No API token. Use /setapi first.', env); return; }
	const data = await doApiCall('/droplets', 'GET', apiToken);
	if (!data.droplets || data.droplets.length === 0) { await sendMessage(chatId, 'No droplets found.', env); return; }
	const keyboard = [];
	for (const droplet of data.droplets) {
		const hasNote = await getDropletNote(droplet.id, env);
		keyboard.push([{ text: `${droplet.name} (${droplet.status})${hasNote ? ' 📝' : ''}`, callback_data: `droplet_${droplet.id}` }]);
	}
	await sendMessage(chatId, 'Your Droplets:', env, { inline_keyboard: keyboard });
}

async function showDropletDetails(chatId, messageId, dropletId, env) {
	const apiToken = await getUserApiToken(chatId, env);
	const data = await doApiCall(`/droplets/${dropletId}`, 'GET', apiToken);
	if (!data.droplet) { await editMessage(chatId, messageId, '❌ Not found.', env); return; }
	const droplet = data.droplet;
	const ip = droplet.networks.v4.find(n => n.type === 'public')?.ip_address || 'Not assigned';
	const note = await getDropletNote(dropletId, env);
	const noteSection = note ? `\n\n📝 *Note:*\n\`\`\`\n${note}\n\`\`\`` : '';
	const details = `📦 *Droplet*\n\n*Name:* ${droplet.name}\n*Status:* ${droplet.status}\n*Region:* ${droplet.region.name}\n*Size:* ${droplet.size_slug}\n*IP:* \`${ip}\`\n\nSSH: \`ssh root@${ip}\`${noteSection}`;
	const powerButton = droplet.status === 'off'
		? { text: '⚡ Power On',  callback_data: `pwr_on_${dropletId}` }
		: { text: '🔌 Power Off', callback_data: `pwr_off_${dropletId}` };
	const restartButton = droplet.status !== 'off'
		? [{ text: '🔁 Restart', callback_data: `restart_${dropletId}` }]
		: null;
	const keyboard = {
		inline_keyboard: [
			[powerButton],
			...(restartButton ? [restartButton] : []),
			[{ text: '📸 Take Snapshot', callback_data: `snap_take_${dropletId}` },
			 { text: '🔄 Rebuild',       callback_data: `rebuild_${dropletId}` }],
			[{ text: '🏷️ Rename',        callback_data: `rename_existing_${dropletId}` },
			 { text: '📝 Note',          callback_data: `manage_note_${dropletId}` }],
			[{ text: '🗑️ Delete Droplet', callback_data: `confirm_delete_${dropletId}` }],
			[{ text: '◀️ Back',          callback_data: 'back_to_list' }],
		]
	};
	await editMessage(chatId, messageId, details, env, keyboard);
}

async function showNoteManagement(chatId, messageId, dropletId, env) {
	const note = await getDropletNote(dropletId, env);
	if (note) {
		await editMessage(chatId, messageId,
			`📝 *Droplet Note*\n\nCurrent note:\n\`\`\`\n${note}\n\`\`\``,
			env, {
				inline_keyboard: [
					[{ text: '✏️ Edit Note',   callback_data: `edit_note_${dropletId}` }],
					[{ text: '🗑️ Delete Note', callback_data: `delete_note_${dropletId}` }],
					[{ text: '◀️ Back',        callback_data: `back_to_droplet_${dropletId}` }],
				]
			});
	} else {
		await editMessage(chatId, messageId,
			`📝 *Droplet Note*\n\nNo note for this droplet.`,
			env, {
				inline_keyboard: [
					[{ text: '✏️ Add Note', callback_data: `add_note_${dropletId}` }],
					[{ text: '◀️ Back',    callback_data: `back_to_droplet_${dropletId}` }],
				]
			});
	}
}

async function showDeleteConfirmation(chatId, messageId, dropletId, env) {
	await editMessage(chatId, messageId, '⚠️ Delete?\n\nCannot be undone!', env, {
		inline_keyboard: [
			[{ text: '✅ Yes, Delete', callback_data: `delete_${dropletId}` }],
			[{ text: '◀️ Back',       callback_data: `droplet_${dropletId}` }],
		]
	});
}

async function deleteDroplet(chatId, messageId, dropletId, env) {
	const apiToken = await getUserApiToken(chatId, env);
	const response = await fetch(`https://api.digitalocean.com/v2/droplets/${dropletId}`, {
		method: 'DELETE',
		headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
	});
	if (response.status === 204) {
		await deleteDropletNote(dropletId, env);
		await editMessage(chatId, messageId, '✅ Deleted!', env);
	} else {
		await editMessage(chatId, messageId, '❌ Failed.', env);
	}
}

async function editMessageToDropletList(chatId, messageId, env) {
	const apiToken = await getUserApiToken(chatId, env);
	const data = await doApiCall('/droplets', 'GET', apiToken);
	if (!data.droplets || data.droplets.length === 0) { await editMessage(chatId, messageId, 'No droplets.', env); return; }
	const keyboard = [];
	for (const droplet of data.droplets) {
		const hasNote = await getDropletNote(droplet.id, env);
		keyboard.push([{ text: `${droplet.name} (${droplet.status})${hasNote ? ' 📝' : ''}`, callback_data: `droplet_${droplet.id}` }]);
	}
	await editMessage(chatId, messageId, 'Your Droplets:', env, { inline_keyboard: keyboard });
}

// ─── RENAME DROPLET ───────────────────────────────────────────────────────────

async function confirmRenameDroplet(chatId, dropletId, oldName, newName, env) {
	const sessionId = `rename_${chatId}_${Date.now()}`;
	await env.DROPLET_CREATION.put(sessionId, JSON.stringify({ dropletId, newName }), { expirationTtl: 300 });
	const keyboard = {
		inline_keyboard: [
			[{ text: '✅ Yes, Rename', callback_data: `confirm_rename_${sessionId}` }],
			[{ text: '◀️ Cancel',     callback_data: `droplet_${dropletId}` }],
		]
	};
	await sendMessage(chatId, `⚠️ *Confirm Rename*\n\nDroplet ID: ${dropletId}\n\nOld name: \`${oldName}\`\nNew name: \`${newName}\``, env, keyboard);
}

async function executeRename(chatId, messageId, sessionId, env) {
	const apiToken = await getUserApiToken(chatId, env);
	const dataStr = await env.DROPLET_CREATION.get(sessionId);
	if (!dataStr) { await editMessage(chatId, messageId, '❌ Session expired.', env); return; }
	const data = JSON.parse(dataStr);
	await editMessage(chatId, messageId, '⏳ Renaming...', env);
	const result = await doApiCall(`/droplets/${data.dropletId}/actions`, 'POST', apiToken, { type: 'rename', name: data.newName });
	if (result.action) {
		await editMessage(chatId, messageId, `✅ *Rename Started!*\n\nNew name: \`${data.newName}\`\nStatus: ${result.action.status}`, env);
		await env.DROPLET_CREATION.delete(sessionId);
	} else {
		await editMessage(chatId, messageId, `❌ Failed: ${result.message || 'Unknown'}`, env);
	}
}

// ─── REBUILD ──────────────────────────────────────────────────────────────────

async function showRebuildImageTypeSelection(chatId, messageId, dropletId, env) {
	await editMessage(chatId, messageId, '🔄 *Rebuild Droplet*\n\n⚠️ All data will be deleted\n\nChoose image type:', env, {
		inline_keyboard: [
			[{ text: '🐧 Operating Systems', callback_data: `rebuildtype_${dropletId}_os` }],
			[{ text: '📦 Applications',      callback_data: `rebuildtype_${dropletId}_app` }],
			[{ text: '📸 My Snapshots',      callback_data: `rebuildtype_${dropletId}_snapshot` }],
			[{ text: '◀️ Back',             callback_data: `droplet_${dropletId}` }],
		]
	});
}

async function showRebuildImageTypeSelectionNew(chatId, dropletId, env) {
	await sendMessage(chatId, '🔄 *Rebuild Droplet*\n\n⚠️ All data will be deleted\n\nChoose image type:', env, {
		inline_keyboard: [
			[{ text: '🐧 Operating Systems', callback_data: `rebuildtype_${dropletId}_os` }],
			[{ text: '📦 Applications',      callback_data: `rebuildtype_${dropletId}_app` }],
			[{ text: '📸 My Snapshots',      callback_data: `rebuildtype_${dropletId}_snapshot` }],
			[{ text: '◀️ Back',             callback_data: `droplet_${dropletId}` }],
		]
	});
}

async function showRebuildImagesList(chatId, messageId, dropletId, type, page, env) {
	const apiToken = await getUserApiToken(chatId, env);
	const dropletData = await doApiCall(`/droplets/${dropletId}`, 'GET', apiToken);
	const droplet = dropletData.droplet;
	if (!droplet) { await editMessage(chatId, messageId, '❌ Droplet not found.', env); return; }

	let images = filterImagesForRebuild(await getImagesByType(type, apiToken, env), droplet);
	if (images.length === 0) {
		const hint = type === 'snapshot' ? '\n\nTake a snapshot from a droplet first.' : '';
		await editMessage(chatId, messageId, `❌ No compatible ${type === 'app' ? 'applications' : type === 'os' ? 'OS images' : 'snapshots'} for this droplet.${hint}`, env, {
			inline_keyboard: [
				[{ text: '◀️ Back to image types', callback_data: `rebuild_${dropletId}` }],
				[{ text: '◀️ Back to droplet',    callback_data: `droplet_${dropletId}` }],
			]
		});
		return;
	}
	const totalPages = Math.ceil(images.length / ITEMS_PER_PAGE);
	const pageImages = images.slice(page * ITEMS_PER_PAGE, (page + 1) * ITEMS_PER_PAGE);
	const keyboard = pageImages.map(img => [{ text: img.name, callback_data: `rebuildimg_${dropletId}_${img.id}` }]);
	const nav = [];
	if (page > 0) nav.push({ text: '◀️ Previous', callback_data: `rebuildpage_${dropletId}_${type}_${page - 1}` });
	if (page < totalPages - 1) nav.push({ text: 'Next ▶️', callback_data: `rebuildpage_${dropletId}_${type}_${page + 1}` });
	if (nav.length) keyboard.push(nav);
	keyboard.push([{ text: '🔍 Search', callback_data: `rebuildsearch_${dropletId}_${type}` }]);
	keyboard.push([{ text: '◀️ Back',   callback_data: `rebuild_${dropletId}` }]);
	const label = type === 'app' ? 'Applications' : type === 'os' ? 'Operating Systems' : 'Snapshots';
	const emoji = type === 'app' ? '📦' : type === 'os' ? '🐧' : '📸';
	await editMessage(chatId, messageId, `${emoji} *${label}*\n\n✅ Compatible with ${droplet.size_slug}\nPage ${page + 1}/${totalPages} (${images.length} total)`, env, { inline_keyboard: keyboard });
}

async function handleRebuildImageSearch(chatId, query, state, env) {
	if (query.length < MIN_SEARCH_LENGTH) {
		await sendMessage(chatId, `❌ Search query too short. Min ${MIN_SEARCH_LENGTH} characters.`, env);
		return;
	}
	const apiToken = await getUserApiToken(chatId, env);
	const dropletData = await doApiCall(`/droplets/${state.dropletId}`, 'GET', apiToken);
	const results = filterImagesForRebuild(await getImagesByType(state.type, apiToken, env), dropletData.droplet)
		.filter(img => img.name.toLowerCase().includes(query.toLowerCase()));
	if (results.length === 0) {
		await clearState(chatId, env);
		await sendMessage(chatId, '❌ No results found.', env, {
			inline_keyboard: [[{ text: '◀️ Back to Menu', callback_data: `back_from_rebuild_search_${state.dropletId}` }]]
		});
		return;
	}
	const keyboard = results.slice(0, ITEMS_PER_PAGE).map(img => [{ text: img.name, callback_data: `rebuildimg_${state.dropletId}_${img.id}` }]);
	keyboard.push([{ text: '◀️ Back', callback_data: `back_from_rebuild_search_${state.dropletId}` }]);
	await sendMessage(chatId, `🔍 Found ${results.length} result(s)`, env, { inline_keyboard: keyboard });
	await clearState(chatId, env);
}

async function confirmRebuild(chatId, messageId, dropletId, imageId, env) {
	const sessionId = `rebuild_${chatId}_${Date.now()}`;
	await env.DROPLET_CREATION.put(sessionId, JSON.stringify({ dropletId, imageId }), { expirationTtl: 300 });
	await editMessage(chatId, messageId,
		`⚠️ *Confirm Rebuild*\n\nDroplet ID: ${dropletId}\nNew Image ID: ${imageId}\n\n*All data will be deleted!*`,
		env, {
			inline_keyboard: [
				[{ text: '✅ Yes, Rebuild', callback_data: `execute_rebuild_${sessionId}` }],
				[{ text: '◀️ Back',        callback_data: `droplet_${dropletId}` }],
			]
		});
}

async function executeRebuild(chatId, messageId, sessionId, env) {
	const apiToken = await getUserApiToken(chatId, env);
	const dataStr = await env.DROPLET_CREATION.get(sessionId);
	if (!dataStr) { await editMessage(chatId, messageId, '❌ Session expired.', env); return; }
	const data = JSON.parse(dataStr);
	await editMessage(chatId, messageId, '⏳ Rebuilding...', env);
	const result = await doApiCall(`/droplets/${data.dropletId}/actions`, 'POST', apiToken, { type: 'rebuild', image: data.imageId });
	if (result.action) {
		await editMessage(chatId, messageId, `✅ *Rebuild Started!*\n\nStatus: ${result.action.status}`, env);
		await env.DROPLET_CREATION.delete(sessionId);
	} else {
		await editMessage(chatId, messageId, `❌ Failed: ${result.message || 'Unknown'}`, env);
	}
}

// ─── POWER ON / POWER OFF ─────────────────────────────────────────────────────

async function confirmPowerAction(chatId, messageId, dropletId, action, env) {
	const apiToken = await getUserApiToken(chatId, env);
	const dropletData = await doApiCall(`/droplets/${dropletId}`, 'GET', apiToken);
	if (!dropletData.droplet) { await editMessage(chatId, messageId, '❌ Droplet not found.', env); return; }
	const droplet = dropletData.droplet;
	const isOn = action === 'power_on';
	const warning = isOn
		? '\n\nThis will start the droplet.'
		: '\n\n⚠️ This is a *non-graceful* power-off (like pulling the plug).\nFor a graceful shutdown, use the OS instead.';
	const keyboard = {
		inline_keyboard: [
			[{ text: isOn ? '✅ Yes, Power On' : '✅ Yes, Power Off', callback_data: isOn ? `pwr_on_yes_${dropletId}` : `pwr_off_yes_${dropletId}` }],
			[{ text: '◀️ Cancel', callback_data: `droplet_${dropletId}` }],
		]
	};
	await editMessage(chatId, messageId,
		`${isOn ? '⚡ *Power On*' : '🔌 *Power Off*'}\n\nDroplet: \`${droplet.name}\`\nCurrent status: \`${droplet.status}\`${warning}`,
		env, keyboard);
}

async function executePowerAction(chatId, messageId, dropletId, action, env) {
	const apiToken = await getUserApiToken(chatId, env);
	const isOn = action === 'power_on';
	await editMessage(chatId, messageId, isOn ? '⏳ Powering on...' : '⏳ Powering off...', env);
	const result = await doApiCall(`/droplets/${dropletId}/actions`, 'POST', apiToken, { type: action });
	if (result.action) {
		await editMessage(chatId, messageId,
			`✅ *${isOn ? 'Power On' : 'Power Off'} Started!*\n\nStatus: \`${result.action.status}\`\n\nUse 📋 List Droplets to refresh status.`,
			env, { inline_keyboard: [[{ text: '◀️ Back to Droplet', callback_data: `droplet_${dropletId}` }]] });
	} else {
		await editMessage(chatId, messageId, `❌ Failed: ${result.message || 'Unknown error'}`, env);
	}
}

// ─── RESTART (reboot) ─────────────────────────────────────────────────────────

async function confirmRestartAction(chatId, messageId, dropletId, env) {
	const apiToken = await getUserApiToken(chatId, env);
	const dropletData = await doApiCall(`/droplets/${dropletId}`, 'GET', apiToken);
	if (!dropletData.droplet) { await editMessage(chatId, messageId, '❌ Droplet not found.', env); return; }
	const droplet = dropletData.droplet;
	if (droplet.status === 'off') {
		await editMessage(chatId, messageId, '❌ Droplet is powered off. Power it on first.', env, {
			inline_keyboard: [[{ text: '◀️ Back', callback_data: `droplet_${dropletId}` }]]
		});
		return;
	}
	await editMessage(chatId, messageId,
		`🔁 *Restart Droplet*\n\nDroplet: \`${droplet.name}\`\nCurrent status: \`${droplet.status}\`\n\nThis sends a graceful *reboot* signal to the OS.`,
		env, {
			inline_keyboard: [
				[{ text: '✅ Yes, Restart', callback_data: `restart_yes_${dropletId}` }],
				[{ text: '◀️ Cancel',       callback_data: `droplet_${dropletId}` }],
			]
		});
}

async function executeRestartAction(chatId, messageId, dropletId, env) {
	const apiToken = await getUserApiToken(chatId, env);
	await editMessage(chatId, messageId, '⏳ Restarting...', env);
	const result = await doApiCall(`/droplets/${dropletId}/actions`, 'POST', apiToken, { type: 'reboot' });
	if (result.action) {
		await editMessage(chatId, messageId,
			`✅ *Restart Started!*\n\nStatus: \`${result.action.status}\`\n\nUse 📋 List Droplets to refresh status.`,
			env, { inline_keyboard: [[{ text: '◀️ Back to Droplet', callback_data: `droplet_${dropletId}` }]] });
	} else {
		await editMessage(chatId, messageId, `❌ Failed: ${result.message || 'Unknown error'}`, env);
	}
}

// ─── TAKE SNAPSHOT (per-droplet) ──────────────────────────────────────────────

async function askSnapshotName(chatId, messageId, dropletId, env) {
	const apiToken = await getUserApiToken(chatId, env);
	const dropletData = await doApiCall(`/droplets/${dropletId}`, 'GET', apiToken);
	if (!dropletData.droplet) { await editMessage(chatId, messageId, '❌ Droplet not found.', env); return; }
	const droplet = dropletData.droplet;
	const defaultName = generateSnapshotName(droplet.name);
	const sessionId = `snap_session_${chatId}_${Date.now()}`;
	await env.DROPLET_CREATION.put(sessionId, JSON.stringify({ dropletId, dropletName: droplet.name, defaultName }), { expirationTtl: 300 });
	const liveWarning = droplet.status !== 'off'
		? '\n\n⚠️ Droplet is *running*. Snapshotting a live droplet may produce inconsistent state.'
		: '';
	await editMessage(chatId, messageId,
		`📸 *Take Snapshot*\n\nDroplet: \`${droplet.name}\`\nStatus: \`${droplet.status}\`\nDefault name: \`${defaultName}\`${liveWarning}`,
		env, {
			inline_keyboard: [
				[{ text: '✅ Use Default', callback_data: `snap_default_${sessionId}` },
				 { text: '📝 Rename',      callback_data: `snap_rename_${sessionId}` }],
				[{ text: '◀️ Cancel', callback_data: `droplet_${dropletId}` }],
			]
		});
}

async function useDefaultSnapshotName(chatId, messageId, sessionId, env) {
	const dataStr = await env.DROPLET_CREATION.get(sessionId);
	if (!dataStr) { await editMessage(chatId, messageId, '❌ Session expired.', env); return; }
	const data = JSON.parse(dataStr);
	await deleteMessage(chatId, messageId, env);
	await confirmSnapshotCreation(chatId, data.dropletId, data.dropletName, data.defaultName, env);
	await env.DROPLET_CREATION.delete(sessionId);
}

async function confirmSnapshotCreation(chatId, dropletId, dropletName, snapshotName, env) {
	const apiToken = await getUserApiToken(chatId, env);
	const dropletData = await doApiCall(`/droplets/${dropletId}`, 'GET', apiToken);
	const droplet = dropletData.droplet;
	const sessionId = `snap_exec_${chatId}_${Date.now()}`;
	await env.DROPLET_CREATION.put(sessionId, JSON.stringify({ dropletId, snapshotName }), { expirationTtl: 300 });
	const liveWarning = droplet && droplet.status !== 'off' ? '\n\n⚠️ *Droplet is running.* Snapshot may be inconsistent.' : '';
	await sendMessage(chatId,
		`⚠️ *Confirm Snapshot*\n\nDroplet: \`${dropletName}\`\nSnapshot name: \`${snapshotName}\`${liveWarning}\n\nThis can take several minutes.`,
		env, {
			inline_keyboard: [
				[{ text: '✅ Yes, Take Snapshot', callback_data: `snap_exec_${sessionId}` }],
				[{ text: '◀️ Cancel',            callback_data: `droplet_${dropletId}` }],
			]
		});
}

async function executeSnapshot(chatId, messageId, sessionId, env) {
	const apiToken = await getUserApiToken(chatId, env);
	const dataStr = await env.DROPLET_CREATION.get(sessionId);
	if (!dataStr) { await editMessage(chatId, messageId, '❌ Session expired.', env); return; }
	const data = JSON.parse(dataStr);
	await editMessage(chatId, messageId, '⏳ Starting snapshot...', env);
	const result = await doApiCall(`/droplets/${data.dropletId}/actions`, 'POST', apiToken, { type: 'snapshot', name: data.snapshotName });
	if (result.action) {
		await editMessage(chatId, messageId,
			`✅ *Snapshot Started!*\n\nName: \`${data.snapshotName}\`\nStatus: \`${result.action.status}\`\n\n💡 Snapshot will appear in 📸 *Manage Snapshots* once complete.`,
			env, {
				inline_keyboard: [
					[{ text: '📸 Manage Snapshots',  callback_data: 'menu_snapshots' }],
					[{ text: '◀️ Back to Droplet', callback_data: `droplet_${data.dropletId}` }],
				]
			});
		await env.DROPLET_CREATION.delete(sessionId);
	} else {
		await editMessage(chatId, messageId, `❌ Failed: ${result.message || 'Unknown error'}`, env);
	}
}

// ─── SNAPSHOT MANAGEMENT (account-wide) ──────────────────────────────────────

async function getDropletSnapshots(apiToken) {
	try {
		let all = [];
		let page = 1;
		const perPage = 200;
		while (page <= 20) {
			const resp = await doApiCall(`/snapshots?resource_type=droplet&page=${page}&per_page=${perPage}`, 'GET', apiToken);
			const list = resp.snapshots || [];
			all = all.concat(list);
			if (list.length < perPage) break;
			page++;
		}
		return all;
	} catch (error) {
		console.error('Error getting droplet snapshots:', error);
		return [];
	}
}

function buildSnapshotsKeyboard(snapshots, page) {
	const totalPages = Math.max(1, Math.ceil(snapshots.length / ITEMS_PER_PAGE));
	const pageItems = snapshots.slice(page * ITEMS_PER_PAGE, (page + 1) * ITEMS_PER_PAGE);
	const keyboard = pageItems.map(s => [{
		text: `📸 ${s.name}${s.size_gigabytes != null ? ` • ${formatGB(s.size_gigabytes)}` : ''}`,
		callback_data: `snap_view_${s.id}`
	}]);
	const nav = [];
	if (page > 0) nav.push({ text: '◀️ Previous', callback_data: `snap_page_${page - 1}` });
	if (page < totalPages - 1) nav.push({ text: 'Next ▶️', callback_data: `snap_page_${page + 1}` });
	if (nav.length) keyboard.push(nav);
	return { keyboard, totalPages };
}

async function showSnapshotsList(chatId, page, env) {
	const apiToken = await getUserApiToken(chatId, env);
	if (!apiToken) { await sendMessage(chatId, '❌ No API token. Use /setapi first.', env); return; }
	const loading = await sendMessage(chatId, '⏳ Loading snapshots...', env);
	const snapshots = await getDropletSnapshots(apiToken);
	if (loading.result?.message_id) await deleteMessage(chatId, loading.result.message_id, env);
	if (snapshots.length === 0) {
		await sendMessage(chatId, '📸 *Snapshots*\n\nNo droplet snapshots found.\n\nTake one from any droplet via 📋 List Droplets.', env);
		return;
	}
	const { keyboard, totalPages } = buildSnapshotsKeyboard(snapshots, page);
	await sendMessage(chatId, `📸 *Manage Snapshots*\n\nTotal: ${snapshots.length}\nPage ${page + 1}/${totalPages}\n\nTap a snapshot to view details or delete it.`, env, { inline_keyboard: keyboard });
}

async function showSnapshotsListEdit(chatId, messageId, page, env) {
	const apiToken = await getUserApiToken(chatId, env);
	if (!apiToken) { await editMessage(chatId, messageId, '❌ No API token.', env); return; }
	const snapshots = await getDropletSnapshots(apiToken);
	if (snapshots.length === 0) { await editMessage(chatId, messageId, '📸 *Snapshots*\n\nNo droplet snapshots found.', env); return; }
	const { keyboard, totalPages } = buildSnapshotsKeyboard(snapshots, page);
	await editMessage(chatId, messageId, `📸 *Manage Snapshots*\n\nTotal: ${snapshots.length}\nPage ${page + 1}/${totalPages}\n\nTap a snapshot to view details or delete it.`, env, { inline_keyboard: keyboard });
}

async function showSnapshotDetails(chatId, messageId, snapshotId, env) {
	const apiToken = await getUserApiToken(chatId, env);
	const data = await doApiCall(`/snapshots/${snapshotId}`, 'GET', apiToken);
	if (!data.snapshot) { await editMessage(chatId, messageId, '❌ Snapshot not found.', env); return; }
	const s = data.snapshot;
	const regions = (s.regions || []).join(', ') || 'none';
	await editMessage(chatId, messageId,
		`📸 *Snapshot Details*\n\n*Name:* \`${s.name}\`\n*ID:* \`${s.id}\`\n*Distribution:* \`${s.distribution || '?'}\`\n*Size:* ${formatGB(s.size_gigabytes)}\n*Min disk:* ${formatGB(s.min_disk_size)}\n*Created:* ${formatDate(s.created_at)}\n*Regions:* ${regions}\n*Resource:* ${s.resource_type} #${s.resource_id}`,
		env, {
			inline_keyboard: [
				[{ text: '🗑️ Delete Snapshot',    callback_data: `snap_del_${snapshotId}` }],
				[{ text: '◀️ Back to Snapshots', callback_data: 'snap_back_list' }],
			]
		});
}

async function confirmDeleteSnapshot(chatId, messageId, snapshotId, env) {
	const apiToken = await getUserApiToken(chatId, env);
	const data = await doApiCall(`/snapshots/${snapshotId}`, 'GET', apiToken);
	if (!data.snapshot) { await editMessage(chatId, messageId, '❌ Snapshot not found.', env); return; }
	const s = data.snapshot;
	await editMessage(chatId, messageId,
		`⚠️ *Delete Snapshot?*\n\nName: \`${s.name}\`\nSize: ${formatGB(s.size_gigabytes)}\nCreated: ${formatDate(s.created_at)}\n\n*This cannot be undone!*`,
		env, {
			inline_keyboard: [
				[{ text: '✅ Yes, Delete', callback_data: `snap_del_yes_${snapshotId}` }],
				[{ text: '◀️ Cancel',     callback_data: `snap_view_${snapshotId}` }],
			]
		});
}

async function executeDeleteSnapshot(chatId, messageId, snapshotId, env) {
	const apiToken = await getUserApiToken(chatId, env);
	await editMessage(chatId, messageId, '⏳ Deleting snapshot...', env);
	const response = await fetch(`https://api.digitalocean.com/v2/snapshots/${snapshotId}`, {
		method: 'DELETE',
		headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
	});
	if (response.status === 204) {
		await editMessage(chatId, messageId, '✅ *Snapshot deleted!*', env, {
			inline_keyboard: [[{ text: '◀️ Back to Snapshots', callback_data: 'snap_back_list' }]]
		});
	} else {
		let detail = '';
		try { const json = await response.json(); detail = json.message ? `\n\n${json.message}` : ''; } catch (e) {}
		await editMessage(chatId, messageId, `❌ Failed to delete snapshot.${detail}`, env);
	}
}
