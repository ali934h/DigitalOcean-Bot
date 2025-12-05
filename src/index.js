/**
 * Telegram DigitalOcean Management Bot (Cloudflare Workers).
 *
 * Overview:
 * This Worker implements a Telegram bot that can manage DigitalOcean Droplets
 * via the DigitalOcean API. It is designed to run serverlessly on Cloudflare
 * Workers and is restricted to specific Telegram user IDs for security.
 *
 * Main features:
 * - /start      : Show welcome message and available commands
 * - /setapi     : Configure your DigitalOcean API token
 * - /droplets   : List existing Droplets as inline buttons
 * - /create     : Interactive flow to create a new Droplet
 *   - Select region
 *   - Select size (plan)
 *   - Select operating system image
 *   - Auto-generated droplet name (can be customized)
 *   - Uses SSH keys from your DigitalOcean account
 *
 * Droplet management:
 * - When selecting a droplet from the list, the bot shows detailed information
 *   (status, region, size, memory, vCPUs, disk, IP, created time, SSH access)
 *   and provides inline buttons to:
 *   - Rebuild the droplet with a new OS
 *   - Delete the droplet (with a confirmation step)
 *   - Go back to the droplet list
 *
 * Security and access control:
 * - Only whitelisted Telegram user IDs (defined in ALLOWED_USER_IDS) are allowed
 *   to use the bot. All other users receive an "Access denied" message.
 * - Each user stores their own DigitalOcean API token securely in KV
 * - API tokens are validated before saving to prevent invalid credentials
 * - The bot uses Cloudflare Workers Secrets for:
 *   - TELEGRAM_BOT_TOKEN : Telegram bot token
 *   - ALLOWED_USER_IDS   : Comma-separated list of allowed Telegram user IDs
 * - A Cloudflare KV namespace (DROPLET_CREATION) is used to:
 *   - Store user API tokens
 *   - Temporarily store droplet creation data between steps
 *   - Support final confirmation before calling the DigitalOcean API
 * - All droplets use SSH key authentication (no passwords)
 *
 * Endpoints:
 * - /webhook         : Main Telegram webhook endpoint (POST)
 * - /registerWebhook : Helper endpoint to register the webhook URL with Telegram
 *
 * Requirements:
 * - Cloudflare Worker project with:
 *   - KV namespace bound as: DROPLET_CREATION
 *   - Secrets set: TELEGRAM_BOT_TOKEN, ALLOWED_USER_IDS
 * - Telegram bot webhook configured to point to: https://<worker-url>/webhook
 * - At least one SSH key added to your DigitalOcean account
 * - Users must configure their API token via /setapi command
 *
 * Setup Instructions for New Deployment:
 *
 * 1. Create a new Telegram Bot:
 *    - Message @BotFather on Telegram
 *    - Send /newbot command
 *    - Follow prompts to get your Bot Token
 *
 * 2. Get your Telegram User ID:
 *    - Message @userinfobot on Telegram
 *    - Copy your numeric User ID
 *
 * 3. Install Wrangler CLI:
 *    npm install -g wrangler
 *
 * 4. Login to Cloudflare:
 *    wrangler login
 *
 * 5. Create new Worker project:
 *    wrangler init telegram-do-bot
 *    cd telegram-do-bot
 *
 * 6. Copy this code to src/index.js
 *
 * 7. Create KV namespace:
 *    wrangler kv namespace create "DROPLET_CREATION"
 *    (Accept prompt to add to wrangler.toml)
 *
 * 8. Add secrets:
 *    wrangler secret put TELEGRAM_BOT_TOKEN
 *    (Paste your Telegram Bot Token)
 *
 *    wrangler secret put ALLOWED_USER_IDS
 *    (Enter your Telegram User ID, for multiple users use comma: 123456,789012)
 *
 * 9. Deploy:
 *    wrangler deploy
 *
 * 10. Register webhook:
 *     Open in browser: https://your-worker-url.workers.dev/registerWebhook
 *     You should see: {"ok": true, "result": true, "description": "Webhook was set"}
 *
 * 11. Test the bot:
 *     Open your Telegram bot and send /start
 *
 * 12. Configure API token:
 *     Send /setapi and follow the instructions to add your DigitalOcean API token
 *
 * Usage:
 * - Interact with the bot in Telegram using the commands above.
 * - Each user can configure their own DigitalOcean API token.
 * - All operations are performed through interactive inline buttons.
 * - The bot will guide you through each step of droplet creation.
 * - All droplets use SSH key authentication for secure access.
 */

export default {
	async fetch(request, env) {
		const url = new URL(request.url);

		// Route for registering webhook
		if (url.pathname === '/registerWebhook') {
			const webhookUrl = `${url.origin}/webhook`;
			const telegramApiUrl = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/setWebhook?url=${webhookUrl}`;

			const response = await fetch(telegramApiUrl);
			const result = await response.json();

			return new Response(JSON.stringify(result, null, 2), {
				headers: { 'Content-Type': 'application/json' },
			});
		}

		// Main webhook route for receiving Telegram messages
		if (url.pathname === '/webhook' && request.method === 'POST') {
			const update = await request.json();

			// Process message
			if (update.message) {
				await handleMessage(update.message, env);
			} else if (update.callback_query) {
				await handleCallbackQuery(update.callback_query, env);
			}

			return new Response('OK');
		}

		return new Response('Telegram DigitalOcean Bot is running!');
	},
};

// === API TOKEN MANAGEMENT ===

// Save user's API token to KV (with validation)
async function saveUserApiToken(userId, apiToken, env) {
	const key = `api_token_${userId}`;
	
	// Validate API token by testing it
	try {
		const testUrl = 'https://api.digitalocean.com/v2/account';
		const testResponse = await fetch(testUrl, {
			headers: {
				Authorization: `Bearer ${apiToken}`,
				'Content-Type': 'application/json',
			},
		});
		
		if (!testResponse.ok) {
			return false; // Invalid token
		}
		
		// Delete all user sessions when changing API token
		await clearUserSessions(userId, env);
		
		// Save new API token (no expiration - permanent storage)
		await env.DROPLET_CREATION.put(key, apiToken);
		
		return true; // Valid token
	} catch (error) {
		console.error('Error validating API token:', error);
		return false;
	}
}

// Get user's API token from KV (with error handling)
async function getUserApiToken(userId, env) {
	try {
		const key = `api_token_${userId}`;
		return await env.DROPLET_CREATION.get(key);
	} catch (error) {
		console.error('Error getting API token:', error);
		return null;
	}
}

// Clear all sessions for a user (when changing API token)
async function clearUserSessions(userId, env) {
	try {
		// List all keys with this user's sessions
		const listResult = await env.DROPLET_CREATION.list({ prefix: `session_${userId}_` });
		const createListResult = await env.DROPLET_CREATION.list({ prefix: `create_${userId}_` });
		
		// Delete all session keys
		const allKeys = [
			...listResult.keys.map(k => k.name),
			...createListResult.keys.map(k => k.name)
		];
		
		for (const key of allKeys) {
			await env.DROPLET_CREATION.delete(key);
		}
	} catch (error) {
		console.error('Error clearing sessions:', error);
	}
}

// Ask user for API token
async function askForApiToken(chatId, env) {
	const hasExisting = await getUserApiToken(chatId, env);
	
	const text = hasExisting
		? `🔑 *Change DigitalOcean API Token*

⚠️ *Warning:* Changing your API token will:
• Clear all active sessions
• Require re-authentication
• Switch to a different DigitalOcean account

Please reply to this message with your new DigitalOcean API token.

*How to get your API token:*
1. Go to [DigitalOcean Console](https://cloud.digitalocean.com/)
2. Settings → API → Tokens/Keys
3. Generate New Token (Read & Write)
4. Copy and send it here

🔒 Your token will be validated and stored securely.`
		: `🔑 *Setup DigitalOcean API Token*

To use this bot, you need to provide your DigitalOcean API token.

Please reply to this message with your DigitalOcean API token.

*How to get your API token:*
1. Go to [DigitalOcean Console](https://cloud.digitalocean.com/)
2. Settings → API → Tokens/Keys
3. Generate New Token (Read & Write)
4. Copy and send it here

🔒 Your token will be validated and stored securely.`;

	await sendMessage(chatId, text, env);
}

// === MESSAGE HANDLERS ===

async function handleMessage(message, env) {
	const chatId = message.chat.id;
	const userId = message.from.id;
	const text = message.text;

	// Check if user is allowed
	const allowedUsers = env.ALLOWED_USER_IDS.split(',').map((id) => parseInt(id.trim()));
	if (!allowedUsers.includes(userId)) {
		await sendMessage(chatId, '⛔ Access denied. You are not authorized to use this bot.', env);
		return;
	}

	// Check if this is a reply to API token request
	if (message.reply_to_message && message.reply_to_message.text) {
		const replyText = message.reply_to_message.text;

		if (replyText.includes('Please reply to this message with your') && replyText.includes('DigitalOcean API token')) {
			// Delete the request message
			await deleteMessage(chatId, message.reply_to_message.message_id, env);
			// Delete user's token message for security
			await deleteMessage(chatId, message.message_id, env);
			
			// Send "validating" message
			const validatingMsg = await sendMessage(chatId, '⏳ Validating your API token...', env);
			
			// Save API token (with validation)
			const isValid = await saveUserApiToken(chatId, text.trim(), env);
			
			// Delete validating message
			if (validatingMsg.result && validatingMsg.result.message_id) {
				await deleteMessage(chatId, validatingMsg.result.message_id, env);
			}
			
			if (isValid) {
				await sendMessage(chatId, '✅ API token saved successfully!\n\nYou can now use /droplets and /create commands.', env);
			} else {
				await sendMessage(
					chatId, 
					'❌ Invalid API token!\n\nThe token you provided is not valid or doesn\'t have the required permissions.\n\nPlease:\n1. Check your token is correct\n2. Ensure it has Read & Write permissions\n3. Try /setapi again', 
					env
				);
			}
			return;
		}

		if (replyText.includes('Default name:') && replyText.includes('Reply to this message to change the name')) {
			// Extract region, size, image from the message
			const lines = replyText.split('\n');
			const region = lines
				.find((l) => l.startsWith('Region:'))
				?.split(':')[1]
				.trim();
			const size = lines
				.find((l) => l.startsWith('Size:'))
				?.split(':')[1]
				.trim();
			const image = lines
				.find((l) => l.startsWith('Image:'))
				?.split(':')[1]
				.trim();

			// Delete the previous message
			await deleteMessage(chatId, message.reply_to_message.message_id, env);

			await confirmDropletCreation(chatId, text, region, size, image, env);
			return;
		}
	}

	if (text === '/start') {
		const hasApiToken = await getUserApiToken(chatId, env);
		const welcomeMsg = hasApiToken
			? 'Welcome to DigitalOcean Management Bot!\n\nCommands:\n/droplets - List droplets\n/create - Create new droplet\n/setapi - Change API token\n\n🔐 This bot uses SSH keys for secure access.'
			: 'Welcome to DigitalOcean Management Bot!\n\n⚠️ You need to set your DigitalOcean API token first.\n\nUse /setapi to get started.';
		
		await sendMessage(chatId, welcomeMsg, env);
	} else if (text === '/setapi') {
		await askForApiToken(chatId, env);
	} else if (text === '/droplets') {
		await listDroplets(chatId, env);
	} else if (text === '/create') {
		await showRegions(chatId, env);
	}
}

async function handleCallbackQuery(callbackQuery, env) {
	const chatId = callbackQuery.message.chat.id;
	const messageId = callbackQuery.message.message_id;
	const data = callbackQuery.data;

	// Answer callback query to remove loading state
	await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ callback_query_id: callbackQuery.id }),
	});

	if (data.startsWith('confirm_delete_')) {
		const dropletId = data.replace('confirm_delete_', '');
		await showDeleteConfirmation(chatId, messageId, dropletId, env);
	} else if (data.startsWith('rebuild_')) {
		const dropletId = data.replace('rebuild_', '');
		await showRebuildOptions(chatId, messageId, dropletId, env);
	} else if (data.startsWith('rbc_')) {
		const sessionId = data.replace('rbc_', '');
		await confirmRebuild(chatId, messageId, sessionId, env);
	} else if (data.startsWith('rbe_')) {
		const sessionId = data;
		await executeRebuild(chatId, messageId, sessionId, env);
	} else if (data.startsWith('droplet_')) {
		const dropletId = data.replace('droplet_', '');
		await showDropletDetails(chatId, messageId, dropletId, env);
	} else if (data.startsWith('delete_')) {
		const dropletId = data.replace('delete_', '');
		await deleteDroplet(chatId, messageId, dropletId, env);
	} else if (data === 'back_to_list') {
		await editMessageToDropletList(chatId, messageId, env);
	} else if (data.startsWith('region_')) {
		const region = data.replace('region_', '');
		await deleteMessage(chatId, messageId, env);
		await showSizes(chatId, region, env);
	} else if (data === 'cancel_create') {
		await editMessage(chatId, messageId, '❌ Droplet creation cancelled.', env);
	} else if (data.startsWith('size_')) {
		const parts = data.replace('size_', '').split('_');
		const region = parts[0];
		const size = parts.slice(1).join('_');
		await deleteMessage(chatId, messageId, env);
		await showImages(chatId, region, size, env);
	} else if (data === 'back_to_regions') {
		await showRegionsEdit(chatId, messageId, env);
	} else if (data.startsWith('image_')) {
		const parts = data.replace('image_', '').split('_');
		const region = parts[0];
		const size = parts[1];
		const image = parts.slice(2).join('_');
		await deleteMessage(chatId, messageId, env);
		await askDropletName(chatId, region, size, image, env);
	} else if (data.startsWith('back_to_sizes_')) {
		const region = data.replace('back_to_sizes_', '');
		await showSizes(chatId, messageId, region, env);
	} else if (data.startsWith('use_default_name_')) {
		const sessionId = data.replace('use_default_name_', '');
		await deleteMessage(chatId, messageId, env);
		await useDefaultNameAndConfirm(chatId, sessionId, env);
	} else if (data.startsWith('confirmcreate_')) {
		const creationId = data.replace('confirmcreate_', '');
		await createDropletFromKV(chatId, messageId, creationId, env);
	}
}

// === TELEGRAM HELPERS ===

async function sendMessage(chatId, text, env, replyMarkup = null) {
	const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
	const body = {
		chat_id: chatId,
		text: text,
		parse_mode: 'Markdown',
	};

	if (replyMarkup) {
		body.reply_markup = replyMarkup;
	}

	const response = await fetch(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	});

	const result = await response.json();
	console.log('Telegram API Response:', result);

	return result;
}

async function deleteMessage(chatId, messageId, env) {
	const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/deleteMessage`;

	await fetch(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			chat_id: chatId,
			message_id: messageId,
		}),
	});
}

async function editMessage(chatId, messageId, text, env, replyMarkup = null) {
	const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/editMessageText`;
	const body = {
		chat_id: chatId,
		message_id: messageId,
		text: text,
		parse_mode: 'Markdown',
	};

	if (replyMarkup) {
		body.reply_markup = replyMarkup;
	}

	await fetch(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	});
}

// === DROPLET OPERATIONS ===

async function listDroplets(chatId, env) {
	// Get user's API token
	const apiToken = await getUserApiToken(chatId, env);
	
	if (!apiToken) {
		await sendMessage(
			chatId, 
			'❌ No API token found.\n\nPlease use /setapi to configure your DigitalOcean API token first.', 
			env
		);
		return;
	}

	const url = 'https://api.digitalocean.com/v2/droplets';

	const response = await fetch(url, {
		headers: {
			Authorization: `Bearer ${apiToken}`,
			'Content-Type': 'application/json',
		},
	});

	const data = await response.json();

	if (!data.droplets || data.droplets.length === 0) {
		await sendMessage(chatId, 'No droplets found.', env);
		return;
	}

	// Create inline keyboard with droplet buttons
	const keyboard = data.droplets.map((droplet) => [
		{
			text: `${droplet.name} (${droplet.status})`,
			callback_data: `droplet_${droplet.id}`,
		},
	]);

	await sendMessage(chatId, 'Your Droplets:', env, {
		inline_keyboard: keyboard,
	});
}

async function showRegions(chatId, env) {
	// Get user's API token
	const apiToken = await getUserApiToken(chatId, env);
	
	if (!apiToken) {
		await sendMessage(
			chatId, 
			'❌ No API token found.\n\nPlease use /setapi to configure your DigitalOcean API token first.', 
			env
		);
		return;
	}

	const url = 'https://api.digitalocean.com/v2/regions';

	const response = await fetch(url, {
		headers: {
			Authorization: `Bearer ${apiToken}`,
			'Content-Type': 'application/json',
		},
	});

	const data = await response.json();

	// Filter only available regions
	const availableRegions = data.regions.filter((region) => region.available);

	// Create keyboard with region buttons (2 per row)
	const keyboard = [];
	for (let i = 0; i < availableRegions.length; i += 2) {
		const row = [];
		row.push({
			text: `${availableRegions[i].name}`,
			callback_data: `region_${availableRegions[i].slug}`,
		});
		if (i + 1 < availableRegions.length) {
			row.push({
				text: `${availableRegions[i + 1].name}`,
				callback_data: `region_${availableRegions[i + 1].slug}`,
			});
		}
		keyboard.push(row);
	}

	keyboard.push([{ text: '❌ Cancel', callback_data: 'cancel_create' }]);

	await sendMessage(chatId, '🌍 Select a region for your new droplet:', env, {
		inline_keyboard: keyboard,
	});
}

// Generate default droplet name
function generateDropletName(image, size, region) {
	const imageSlug = image.split('-')[0]; // Get OS name like 'ubuntu'
	const timestamp = Date.now().toString().slice(-4); // Last 4 digits of timestamp
	return `${imageSlug}-${size}-${region}-${timestamp}`;
}

async function showDropletDetails(chatId, messageId, dropletId, env) {
	// Get user's API token
	const apiToken = await getUserApiToken(chatId, env);
	
	if (!apiToken) {
		await editMessage(chatId, messageId, '❌ No API token found. Please use /setapi first.', env);
		return;
	}

	const url = `https://api.digitalocean.com/v2/droplets/${dropletId}`;

	const response = await fetch(url, {
		headers: {
			Authorization: `Bearer ${apiToken}`,
			'Content-Type': 'application/json',
		},
	});

	const data = await response.json();

	if (!data.droplet) {
		await editMessage(chatId, messageId, '❌ Droplet not found or has been deleted.', env);
		return;
	}

	const droplet = data.droplet;

	// Get public IPv4 address (not private)
	const publicIPv4 = droplet.networks.v4.find((net) => net.type === 'public')?.ip_address || 'Not assigned yet';

	const details = `📦 *Droplet Details*

*Name:* ${droplet.name}
*Status:* ${droplet.status}
*Region:* ${droplet.region.name}
*Size:* ${droplet.size_slug}
*Memory:* ${droplet.memory} MB
*vCPUs:* ${droplet.vcpus}
*Disk:* ${droplet.disk} GB
*IP:* \`${publicIPv4}\`

*SSH Access:*
\`ssh root@${publicIPv4}\`

*Created:* ${new Date(droplet.created_at).toLocaleString()}`;

	const keyboard = {
		inline_keyboard: [
			[{ text: '🔄 Rebuild Droplet', callback_data: `rebuild_${dropletId}` }],
			[{ text: '🗑️ Delete Droplet', callback_data: `confirm_delete_${dropletId}` }],
			[{ text: '◀️ Back to List', callback_data: 'back_to_list' }],
		],
	};

	await editMessage(chatId, messageId, details, env, keyboard);
}

async function showDeleteConfirmation(chatId, messageId, dropletId, env) {
	const text = '⚠️ Are you sure you want to delete this droplet?\n\nThis action cannot be undone!';

	const keyboard = {
		inline_keyboard: [
			[
				{ text: '✅ Yes, Delete', callback_data: `delete_${dropletId}` },
				{ text: '❌ Cancel', callback_data: `droplet_${dropletId}` },
			],
		],
	};

	await editMessage(chatId, messageId, text, env, keyboard);
}

async function deleteDroplet(chatId, messageId, dropletId, env) {
	// Get user's API token
	const apiToken = await getUserApiToken(chatId, env);
	
	if (!apiToken) {
		await editMessage(chatId, messageId, '❌ No API token found. Please use /setapi first.', env);
		return;
	}

	const url = `https://api.digitalocean.com/v2/droplets/${dropletId}`;

	const response = await fetch(url, {
		method: 'DELETE',
		headers: {
			Authorization: `Bearer ${apiToken}`,
			'Content-Type': 'application/json',
		},
	});

	if (response.status === 204) {
		await editMessage(chatId, messageId, '✅ Droplet deleted successfully!', env);
	} else {
		await editMessage(chatId, messageId, '❌ Failed to delete droplet.', env);
	}
}

async function editMessageToDropletList(chatId, messageId, env) {
	// Get user's API token
	const apiToken = await getUserApiToken(chatId, env);
	
	if (!apiToken) {
		await editMessage(chatId, messageId, '❌ No API token found. Please use /setapi first.', env);
		return;
	}

	const url = 'https://api.digitalocean.com/v2/droplets';

	const response = await fetch(url, {
		headers: {
			Authorization: `Bearer ${apiToken}`,
			'Content-Type': 'application/json',
		},
	});

	const data = await response.json();

	if (!data.droplets || data.droplets.length === 0) {
		await editMessage(chatId, messageId, 'No droplets found.', env);
		return;
	}

	const keyboard = data.droplets.map((droplet) => [
		{
			text: `${droplet.name} (${droplet.status})`,
			callback_data: `droplet_${droplet.id}`,
		},
	]);

	await editMessage(chatId, messageId, 'Your Droplets:', env, {
		inline_keyboard: keyboard,
	});
}

async function showSizes(chatId, region, env) {
	// Get user's API token
	const apiToken = await getUserApiToken(chatId, env);
	
	if (!apiToken) {
		await sendMessage(chatId, '❌ No API token found. Please use /setapi first.', env);
		return;
	}

	const url = 'https://api.digitalocean.com/v2/sizes';

	const response = await fetch(url, {
		headers: {
			Authorization: `Bearer ${apiToken}`,
			'Content-Type': 'application/json',
		},
	});

	const data = await response.json();

	// Filter available sizes and sort by price
	const availableSizes = data.sizes
		.filter((size) => size.available && size.regions.includes(region))
		.sort((a, b) => a.price_monthly - b.price_monthly);

	// Create keyboard with size buttons
	const keyboard = availableSizes.map((size) => [
		{
			text: `${size.slug} - $${size.price_monthly}/mo (${size.memory}MB RAM, ${size.vcpus} vCPU)`,
			callback_data: `size_${region}_${size.slug}`,
		},
	]);

	keyboard.push([{ text: '◀️ Back to Regions', callback_data: 'back_to_regions' }]);
	keyboard.push([{ text: '❌ Cancel', callback_data: 'cancel_create' }]);

	await sendMessage(chatId, '💾 Select a size for your droplet:', env, {
		inline_keyboard: keyboard,
	});
}

async function showImages(chatId, region, size, env) {
	// Get user's API token
	const apiToken = await getUserApiToken(chatId, env);
	
	if (!apiToken) {
		await sendMessage(chatId, '❌ No API token found. Please use /setapi first.', env);
		return;
	}

	const url = 'https://api.digitalocean.com/v2/images?type=distribution&per_page=100';

	const response = await fetch(url, {
		headers: {
			Authorization: `Bearer ${apiToken}`,
			'Content-Type': 'application/json',
		},
	});

	const data = await response.json();

	// Filter popular OS images
	const popularImages = data.images
		.filter(
			(img) =>
				img.status === 'available' &&
				(img.slug?.includes('ubuntu') ||
					img.slug?.includes('debian') ||
					img.slug?.includes('centos') ||
					img.slug?.includes('fedora') ||
					img.slug?.includes('rocky'))
		)
		.slice(0, 10);

	// Create keyboard with image buttons
	const keyboard = popularImages.map((image) => [
		{
			text: image.name,
			callback_data: `image_${region}_${size}_${image.slug || image.id}`,
		},
	]);

	keyboard.push([{ text: '◀️ Back to Sizes', callback_data: `back_to_sizes_${region}` }]);
	keyboard.push([{ text: '❌ Cancel', callback_data: 'cancel_create' }]);

	await sendMessage(chatId, '🖥️ Select an operating system:', env, {
		inline_keyboard: keyboard,
	});
}

async function showRegionsEdit(chatId, messageId, env) {
	// Get user's API token
	const apiToken = await getUserApiToken(chatId, env);
	
	if (!apiToken) {
		await editMessage(chatId, messageId, '❌ No API token found. Please use /setapi first.', env);
		return;
	}

	const url = 'https://api.digitalocean.com/v2/regions';

	const response = await fetch(url, {
		headers: {
			Authorization: `Bearer ${apiToken}`,
			'Content-Type': 'application/json',
		},
	});

	const data = await response.json();
	const availableRegions = data.regions.filter((region) => region.available);

	const keyboard = [];
	for (let i = 0; i < availableRegions.length; i += 2) {
		const row = [];
		row.push({
			text: `${availableRegions[i].name}`,
			callback_data: `region_${availableRegions[i].slug}`,
		});
		if (i + 1 < availableRegions.length) {
			row.push({
				text: `${availableRegions[i + 1].name}`,
				callback_data: `region_${availableRegions[i + 1].slug}`,
			});
		}
		keyboard.push(row);
	}

	keyboard.push([{ text: '❌ Cancel', callback_data: 'cancel_create' }]);

	await editMessage(chatId, messageId, '🌍 Select a region for your new droplet:', env, {
		inline_keyboard: keyboard,
	});
}

async function askDropletName(chatId, region, size, image, env) {
	// Generate default name
	const defaultName = generateDropletName(image, size, region);

	// Store session data
	const sessionId = `session_${chatId}_${Date.now()}`;
	await env.DROPLET_CREATION.put(
		sessionId,
		JSON.stringify({
			region: region,
			size: size,
			image: image,
			defaultName: defaultName,
		}),
		{ expirationTtl: 300 }
	);

	const text = `📝 *Droplet Name*

Region: ${region}
Size: ${size}
Image: ${image}

Default name: \`${defaultName}\`

Reply to this message to change the name, or use the button below to continue with the default name.`;

	const keyboard = {
		inline_keyboard: [
			[{ text: '✅ Use Default Name', callback_data: `use_default_name_${sessionId}` }],
			[{ text: '❌ Cancel', callback_data: 'cancel_create' }],
		],
	};

	await sendMessage(chatId, text, env, keyboard);
}

async function useDefaultNameAndConfirm(chatId, sessionId, env) {
	const dataStr = await env.DROPLET_CREATION.get(sessionId);
	if (!dataStr) {
		await sendMessage(chatId, '❌ Session expired. Please try again with /create', env);
		return;
	}

	const data = JSON.parse(dataStr);
	await confirmDropletCreation(chatId, data.defaultName, data.region, data.size, data.image, env);
	await env.DROPLET_CREATION.delete(sessionId);
}

async function confirmDropletCreation(chatId, name, region, size, image, env) {
	// Get user's API token
	const apiToken = await getUserApiToken(chatId, env);
	
	if (!apiToken) {
		await sendMessage(chatId, '❌ No API token found. Please use /setapi first.', env);
		return;
	}

	// Get SSH keys from DigitalOcean account
	const keysUrl = 'https://api.digitalocean.com/v2/account/keys';
	const keysResponse = await fetch(keysUrl, {
		headers: {
			Authorization: `Bearer ${apiToken}`,
			'Content-Type': 'application/json',
		},
	});

	const keysData = await keysResponse.json();
	const sshKeys = keysData.ssh_keys || [];

	if (sshKeys.length === 0) {
		await sendMessage(
			chatId,
			`❌ *No SSH Keys Found*

You need to add at least one SSH key to your DigitalOcean account before creating droplets.

*How to add SSH key:*
1. Go to DigitalOcean Console
2. Settings → Security → SSH Keys
3. Click "Add SSH Key"
4. Paste your public key

*Generate SSH key on your computer:*
\`ssh-keygen -t rsa -b 4096\`
\`cat ~/.ssh/id_rsa.pub\`

Then try /create again.`,
			env
		);
		return;
	}

	// Store creation data in KV
	const creationId = `create_${chatId}_${Date.now()}`;
	await env.DROPLET_CREATION.put(
		creationId,
		JSON.stringify({
			name: name,
			region: region,
			size: size,
			image: image,
			sshKeyIds: sshKeys.map((key) => key.id),
		}),
		{ expirationTtl: 300 }
	);

	const sshKeysList = sshKeys.map((key) => `• ${key.name}`).join('\n');

	const text = `⚠️ *Confirm Droplet Creation*

*Name:* ${name}
*Region:* ${region}
*Size:* ${size}
*Image:* ${image}

*SSH Keys (${sshKeys.length}):*
${sshKeysList}

Are you sure you want to create this droplet?`;

	const keyboard = {
		inline_keyboard: [
			[
				{ text: '✅ Yes, Create', callback_data: `confirmcreate_${creationId}` },
				{ text: '❌ Cancel', callback_data: 'cancel_create' },
			],
		],
	};

	await sendMessage(chatId, text, env, keyboard);
}

async function createDropletFromKV(chatId, messageId, creationId, env) {
	// Get user's API token
	const apiToken = await getUserApiToken(chatId, env);
	
	if (!apiToken) {
		await editMessage(chatId, messageId, '❌ No API token found. Please use /setapi first.', env);
		return;
	}

	// Get data from KV
	const dataStr = await env.DROPLET_CREATION.get(creationId);

	if (!dataStr) {
		await editMessage(chatId, messageId, '❌ Session expired. Please try again with /create', env);
		return;
	}

	const data = JSON.parse(dataStr);

	await editMessage(chatId, messageId, '⏳ Creating droplet... Please wait.', env);

	const url = 'https://api.digitalocean.com/v2/droplets';

	const body = {
		name: data.name,
		region: data.region,
		size: data.size,
		image: data.image,
		ssh_keys: data.sshKeyIds,
		backups: false,
		ipv6: false,
		monitoring: true,
	};

	const response = await fetch(url, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${apiToken}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify(body),
	});

	const result = await response.json();

	if (response.ok && result.droplet) {
		const publicIPv4 = result.droplet.networks.v4.find((net) => net.type === 'public')?.ip_address || 'Assigning...';

		const successText = `✅ *Droplet Created Successfully!*

*Name:* ${result.droplet.name}
*ID:* ${result.droplet.id}
*Status:* ${result.droplet.status}
*Region:* ${result.droplet.region.slug}
*IP:* \`${publicIPv4}\`

*SSH Access:*
\`ssh root@${publicIPv4}\`

⏳ The droplet is being created. IP address will be assigned shortly.

Use /droplets to check the status.`;

		await editMessage(chatId, messageId, successText, env);

		// Delete from KV
		await env.DROPLET_CREATION.delete(creationId);
	} else {
		await editMessage(chatId, messageId, `❌ Failed to create droplet: ${result.message || 'Unknown error'}`, env);
	}
}

async function showRebuildOptions(chatId, messageId, dropletId, env) {
	// Get user's API token
	const apiToken = await getUserApiToken(chatId, env);
	
	if (!apiToken) {
		await editMessage(chatId, messageId, '❌ No API token found. Please use /setapi first.', env);
		return;
	}

	const url = 'https://api.digitalocean.com/v2/images?type=distribution&per_page=100';

	const response = await fetch(url, {
		headers: {
			Authorization: `Bearer ${apiToken}`,
			'Content-Type': 'application/json',
		},
	});

	const data = await response.json();

	// Filter popular OS images
	const popularImages = data.images
		.filter(
			(img) =>
				img.status === 'available' &&
				(img.slug?.includes('ubuntu') ||
					img.slug?.includes('debian') ||
					img.slug?.includes('centos') ||
					img.slug?.includes('fedora') ||
					img.slug?.includes('rocky'))
		)
		.slice(0, 10);

	// Create keyboard with image buttons using SHORT session IDs
	const keyboard = [];

	for (let i = 0; i < popularImages.length; i++) {
		const image = popularImages[i];
		const imageSlug = image.slug || String(image.id);

		// Create very short session ID
		const timestamp = Date.now().toString(36);
		const random = Math.random().toString(36).substr(2, 3);
		const sessionId = `rb${i}_${timestamp}_${random}`;

		// Store in KV
		await env.DROPLET_CREATION.put(
			sessionId,
			JSON.stringify({
				dropletId: dropletId,
				imageSlug: imageSlug,
			}),
			{ expirationTtl: 300 }
		);

		const callbackData = `rbc_${sessionId}`;

		keyboard.push([
			{
				text: image.name,
				callback_data: callbackData,
			},
		]);
	}

	keyboard.push([{ text: '◀️ Back to Details', callback_data: `droplet_${dropletId}` }]);

	await editMessage(
		chatId,
		messageId,
		'🔄 *Select Operating System for Rebuild*\n\n⚠️ Warning: All data on this droplet will be erased!',
		env,
		{
			inline_keyboard: keyboard,
		}
	);
}

async function confirmRebuild(chatId, messageId, sessionId, env) {
	// Get data from KV
	const dataStr = await env.DROPLET_CREATION.get(sessionId);

	if (!dataStr) {
		await editMessage(chatId, messageId, '❌ Session expired. Please try again.', env);
		return;
	}

	const data = JSON.parse(dataStr);
	const dropletId = data.dropletId;
	const imageSlug = data.imageSlug;

	const text = `⚠️ *Confirm Rebuild*

Are you sure you want to rebuild this droplet?

*Droplet ID:* ${dropletId}
*New OS:* ${imageSlug}

*WARNING:*
• All data will be permanently deleted
• The droplet will be offline during rebuild
• IP address will remain the same
• Your SSH keys will be added automatically

This action cannot be undone!`;

	// Create new short session for execute
	const execSessionId = `rbe_${Date.now().toString(36)}_${Math.random().toString(36).substr(2, 3)}`;
	await env.DROPLET_CREATION.put(
		execSessionId,
		JSON.stringify({
			dropletId: dropletId,
			imageSlug: imageSlug,
		}),
		{ expirationTtl: 300 }
	);

	const keyboard = {
		inline_keyboard: [
			[
				{ text: '✅ Yes, Rebuild Now', callback_data: execSessionId },
				{ text: '❌ Cancel', callback_data: `droplet_${dropletId}` },
			],
		],
	};

	await editMessage(chatId, messageId, text, env, keyboard);
}

async function executeRebuild(chatId, messageId, sessionId, env) {
	// Get user's API token
	const apiToken = await getUserApiToken(chatId, env);
	
	if (!apiToken) {
		await editMessage(chatId, messageId, '❌ No API token found. Please use /setapi first.', env);
		return;
	}

	const dataStr = await env.DROPLET_CREATION.get(sessionId);

	if (!dataStr) {
		await editMessage(chatId, messageId, '❌ Session expired. Please try again.', env);
		return;
	}

	const data = JSON.parse(dataStr);
	const dropletId = data.dropletId;
	const imageSlug = data.imageSlug;

	await editMessage(chatId, messageId, '⏳ Rebuilding droplet... Please wait.', env);

	// Get SSH keys from DigitalOcean account
	const keysUrl = 'https://api.digitalocean.com/v2/account/keys';
	const keysResponse = await fetch(keysUrl, {
		headers: {
			Authorization: `Bearer ${apiToken}`,
			'Content-Type': 'application/json',
		},
	});

	const keysData = await keysResponse.json();
	const sshKeys = keysData.ssh_keys || [];

	if (sshKeys.length === 0) {
		await editMessage(
			chatId,
			messageId,
			`❌ *No SSH Keys Found*

You need to add at least one SSH key to your DigitalOcean account before rebuilding.

Go to DigitalOcean Console → Settings → Security → SSH Keys`,
			env
		);
		return;
	}

	const url = `https://api.digitalocean.com/v2/droplets/${dropletId}/actions`;

	const body = {
		type: 'rebuild',
		image: imageSlug,
		ssh_keys: sshKeys.map((key) => key.id),
	};

	const response = await fetch(url, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${apiToken}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify(body),
	});

	const result = await response.json();

	if (response.ok && result.action) {
		const successText = `✅ *Rebuild Started Successfully!*

*Droplet ID:* ${dropletId}
*New OS:* ${imageSlug}
*Action ID:* ${result.action.id}
*Status:* ${result.action.status}

*SSH Keys Added:* ${sshKeys.length}

⏳ The rebuild process has started. It may take several minutes to complete.

After completion, connect with:
\`ssh root@<droplet-ip>\`

Use /droplets to check the status and get the IP address.`;

		await editMessage(chatId, messageId, successText, env);

		// Delete session from KV
		await env.DROPLET_CREATION.delete(sessionId);
	} else {
		await editMessage(chatId, messageId, `❌ Failed to rebuild droplet: ${result.message || 'Unknown error'}`, env);
	}
}