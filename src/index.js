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
 * - /droplets   : List existing Droplets as inline buttons
 * - /create     : Interactive flow to create a new Droplet
 *   - Select region
 *   - Select size (plan)
 *   - Select operating system image
 *   - Auto-generated droplet name (can be customized)
 *   - Auto-generated strong password (can be customized)
 *   - Confirm creation before calling the API
 *
 * Droplet details:
 * - When selecting a droplet from the list, the bot shows detailed information
 *   (status, region, size, memory, vCPUs, disk, IP, created time, credentials)
 *   and provides inline buttons to:
 *   - Delete the droplet (with a confirmation step)
 *   - Go back to the droplet list
 *
 * Security and access control:
 * - Only whitelisted Telegram user IDs (defined in ALLOWED_USER_IDS) are allowed
 *   to use the bot. All other users receive an "Access denied" message.
 * - The bot uses Cloudflare Workers Secrets for:
 *   - TELEGRAM_BOT_TOKEN : Telegram bot token
 *   - DO_API_TOKEN       : DigitalOcean API token (with write access)
 *   - ALLOWED_USER_IDS   : Comma-separated list of allowed Telegram user IDs
 * - A Cloudflare KV namespace (DROPLET_CREATION) is used to temporarily store
 *   droplet creation data between steps and to support a final confirmation
 *   before calling the DigitalOcean API.
 * - Droplet credentials (username and password) are stored in KV for later retrieval
 *
 * Endpoints:
 * - /webhook         : Main Telegram webhook endpoint (POST)
 * - /registerWebhook : Helper endpoint to register the webhook URL with Telegram
 *
 * Requirements:
 * - Cloudflare Worker project with:
 *   - KV namespace bound as: DROPLET_CREATION
 *   - Secrets set: TELEGRAM_BOT_TOKEN, DO_API_TOKEN, ALLOWED_USER_IDS
 * - Telegram bot webhook configured to point to: https://<worker-url>/webhook
 *
 * Setup Instructions for New Deployment:
 *
 * 1. Create a new Telegram Bot:
 *    - Message @BotFather on Telegram
 *    - Send /newbot command
 *    - Follow prompts to get your Bot Token
 *
 * 2. Get DigitalOcean API Token:
 *    - Log in to DigitalOcean account
 *    - Go to API section in settings
 *    - Generate new token with Read & Write access
 *    - Copy and save the token (shown only once)
 *
 * 3. Get your Telegram User ID:
 *    - Message @userinfobot on Telegram
 *    - Copy your numeric User ID
 *
 * 4. Install Wrangler CLI:
 *    npm install -g wrangler
 *
 * 5. Login to Cloudflare:
 *    wrangler login
 *
 * 6. Create new Worker project:
 *    wrangler init telegram-do-bot
 *    cd telegram-do-bot
 *
 * 7. Copy this code to src/index.js
 *
 * 8. Create KV namespace:
 *    wrangler kv namespace create "DROPLET_CREATION"
 *    (Accept prompt to add to wrangler.toml)
 *
 * 9. Add secrets:
 *    wrangler secret put TELEGRAM_BOT_TOKEN
 *    (Paste your Telegram Bot Token)
 *
 *    wrangler secret put DO_API_TOKEN
 *    (Paste your DigitalOcean API Token)
 *
 *    wrangler secret put ALLOWED_USER_IDS
 *    (Enter your Telegram User ID, for multiple users use comma: 123456,789012)
 *
 * 10. Deploy:
 *     wrangler deploy
 *
 * 11. Register webhook:
 *     Open in browser: https://your-worker-url.workers.dev/registerWebhook
 *     You should see: {"ok": true, "result": true, "description": "Webhook was set"}
 *
 * 12. Test the bot:
 *     Open your Telegram bot and send /start
 *
 * Usage:
 * - Interact with the bot in Telegram using the commands above.
 * - All operations are performed through interactive inline buttons.
 * - The bot will guide you through each step of droplet creation.
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

	// Check if this is a reply to our bot's message (for droplet creation flow)
	if (message.reply_to_message && message.reply_to_message.text) {
		const replyText = message.reply_to_message.text;

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

			await askDropletPassword(chatId, text, region, size, image, env);
			return;
		} else if (replyText.includes('Auto-generated password:') && replyText.includes('Reply to this message to change the password')) {
			// Extract data and create droplet
			const lines = replyText.split('\n');
			const name = lines
				.find((l) => l.startsWith('Name:'))
				?.split(':')[1]
				.trim();
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

			await confirmDropletCreation(chatId, name, region, size, image, text, env);
			return;
		}
	}

	if (text === '/start') {
		await sendMessage(
			chatId,
			'Welcome to DigitalOcean Management Bot!\n\nCommands:\n/droplets - List droplets\n/create - Create new droplet',
			env
		);
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
		// Delete previous message before showing next step
		await deleteMessage(chatId, messageId, env);
		await showSizes(chatId, region, env);
	} else if (data === 'cancel_create') {
		await editMessage(chatId, messageId, '❌ Droplet creation cancelled.', env);
	} else if (data.startsWith('size_')) {
		const parts = data.replace('size_', '').split('_');
		const region = parts[0];
		const size = parts.slice(1).join('_');
		// Delete previous message before showing next step
		await deleteMessage(chatId, messageId, env);
		await showImages(chatId, region, size, env);
	} else if (data === 'back_to_regions') {
		await showRegionsEdit(chatId, messageId, env);
	} else if (data.startsWith('image_')) {
		const parts = data.replace('image_', '').split('_');
		const region = parts[0];
		const size = parts[1];
		const image = parts.slice(2).join('_');
		// Delete previous message before showing next step
		await deleteMessage(chatId, messageId, env);
		await askDropletName(chatId, region, size, image, env);
	} else if (data.startsWith('back_to_sizes_')) {
		const region = data.replace('back_to_sizes_', '');
		await showSizes(chatId, messageId, region, env);
	} else if (data.startsWith('use_default_name_')) {
		const sessionId = data.replace('use_default_name_', '');
		// Delete previous message before showing next step
		await deleteMessage(chatId, messageId, env);
		await useDefaultNameAndAskPassword(chatId, sessionId, env);
	} else if (data.startsWith('use_default_pass_')) {
		const sessionId = data.replace('use_default_pass_', '');
		// Delete previous message before showing next step
		await deleteMessage(chatId, messageId, env);
		await useDefaultPasswordAndConfirm(chatId, sessionId, env);
	} else if (data.startsWith('confirmcreate_')) {
		const creationId = data.replace('confirmcreate_', '');
		await createDropletFromKV(chatId, messageId, creationId, env);
	}
}

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

async function listDroplets(chatId, env) {
	const url = 'https://api.digitalocean.com/v2/droplets';

	const response = await fetch(url, {
		headers: {
			Authorization: `Bearer ${env.DO_API_TOKEN}`,
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
	const url = 'https://api.digitalocean.com/v2/regions';

	const response = await fetch(url, {
		headers: {
			Authorization: `Bearer ${env.DO_API_TOKEN}`,
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

// Generate random password (letters and numbers, not starting with number)
function generatePassword(length = 16) {
	const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
	const lowercase = 'abcdefghijklmnopqrstuvwxyz';
	const numbers = '0123456789';
	const firstChar = uppercase + lowercase; // First char must be letter
	const allChars = uppercase + lowercase + numbers;

	let password = firstChar.charAt(Math.floor(Math.random() * firstChar.length));

	for (let i = 1; i < length; i++) {
		password += allChars.charAt(Math.floor(Math.random() * allChars.length));
	}

	return password;
}

// Generate default droplet name
function generateDropletName(image, size, region) {
	const imageSlug = image.split('-')[0]; // Get OS name like 'ubuntu'
	const timestamp = Date.now().toString().slice(-4); // Last 4 digits of timestamp
	return `${imageSlug}-${size}-${region}-${timestamp}`;
}

async function showDropletDetails(chatId, messageId, dropletId, env) {
	const url = `https://api.digitalocean.com/v2/droplets/${dropletId}`;

	const response = await fetch(url, {
		headers: {
			Authorization: `Bearer ${env.DO_API_TOKEN}`,
			'Content-Type': 'application/json',
		},
	});

	const data = await response.json();
	const droplet = data.droplet;

	// Get public IPv4 address (not private)
	const publicIPv4 = droplet.networks.v4.find((net) => net.type === 'public')?.ip_address || 'Not assigned yet';

	// Try to get credentials from KV
	const credsStr = await env.DROPLET_CREATION.get(`creds_${dropletId}`);
	let credentialsSection = '';

	if (credsStr) {
		const creds = JSON.parse(credsStr);
		credentialsSection = `\n*Credentials:*\nUsername: \`root\`\nPassword: \`${creds.password}\`\n`;
	}

	const details = `📦 *Droplet Details*

*Name:* ${droplet.name}
*Status:* ${droplet.status}
*Region:* ${droplet.region.name}
*Size:* ${droplet.size_slug}
*Memory:* ${droplet.memory} MB
*vCPUs:* ${droplet.vcpus}
*Disk:* ${droplet.disk} GB
*IP:* \`${publicIPv4}\`${credentialsSection}
*Created:* ${new Date(droplet.created_at).toLocaleString()}`;

	const keyboard = {
		inline_keyboard: [
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
	const url = `https://api.digitalocean.com/v2/droplets/${dropletId}`;

	const response = await fetch(url, {
		method: 'DELETE',
		headers: {
			Authorization: `Bearer ${env.DO_API_TOKEN}`,
			'Content-Type': 'application/json',
		},
	});

	if (response.status === 204) {
		// Delete credentials from KV
		await env.DROPLET_CREATION.delete(`creds_${dropletId}`);
		await editMessage(chatId, messageId, '✅ Droplet deleted successfully!', env);
	} else {
		await editMessage(chatId, messageId, '❌ Failed to delete droplet.', env);
	}
}

async function editMessageToDropletList(chatId, messageId, env) {
	const url = 'https://api.digitalocean.com/v2/droplets';

	const response = await fetch(url, {
		headers: {
			Authorization: `Bearer ${env.DO_API_TOKEN}`,
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

async function showSizes(chatId, region, env) {
	const url = 'https://api.digitalocean.com/v2/sizes';

	const response = await fetch(url, {
		headers: {
			Authorization: `Bearer ${env.DO_API_TOKEN}`,
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
	const url = 'https://api.digitalocean.com/v2/images?type=distribution&per_page=100';

	const response = await fetch(url, {
		headers: {
			Authorization: `Bearer ${env.DO_API_TOKEN}`,
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
	const url = 'https://api.digitalocean.com/v2/regions';

	const response = await fetch(url, {
		headers: {
			Authorization: `Bearer ${env.DO_API_TOKEN}`,
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

async function useDefaultNameAndAskPassword(chatId, sessionId, env) {
	const dataStr = await env.DROPLET_CREATION.get(sessionId);
	if (!dataStr) {
		await sendMessage(chatId, '❌ Session expired. Please try again with /create', env);
		return;
	}

	const data = JSON.parse(dataStr);
	await askDropletPassword(chatId, data.defaultName, data.region, data.size, data.image, env);
	await env.DROPLET_CREATION.delete(sessionId);
}

async function askDropletPassword(chatId, name, region, size, image, env) {
	// Generate random password
	const defaultPassword = generatePassword(16);

	// Store session data
	const sessionId = `session_${chatId}_${Date.now()}`;
	await env.DROPLET_CREATION.put(
		sessionId,
		JSON.stringify({
			name: name,
			region: region,
			size: size,
			image: image,
			defaultPassword: defaultPassword,
		}),
		{ expirationTtl: 300 }
	);

	const text = `🔐 *Root Password*

Name: ${name}
Region: ${region}
Size: ${size}
Image: ${image}

Auto-generated password: \`${defaultPassword}\`

Reply to this message to change the password, or use the button below to continue with the auto-generated password.`;

	const keyboard = {
		inline_keyboard: [
			[{ text: '✅ Use Auto-Generated Password', callback_data: `use_default_pass_${sessionId}` }],
			[{ text: '❌ Cancel', callback_data: 'cancel_create' }],
		],
	};

	await sendMessage(chatId, text, env, keyboard);
}

async function useDefaultPasswordAndConfirm(chatId, sessionId, env) {
	const dataStr = await env.DROPLET_CREATION.get(sessionId);
	if (!dataStr) {
		await sendMessage(chatId, '❌ Session expired. Please try again with /create', env);
		return;
	}

	const data = JSON.parse(dataStr);
	await confirmDropletCreation(chatId, data.name, data.region, data.size, data.image, data.defaultPassword, env);
	await env.DROPLET_CREATION.delete(sessionId);
}

async function confirmDropletCreation(chatId, name, region, size, image, password, env) {
	// Store creation data in KV
	const creationId = `create_${chatId}_${Date.now()}`;
	await env.DROPLET_CREATION.put(
		creationId,
		JSON.stringify({
			name: name,
			region: region,
			size: size,
			image: image,
			password: password,
		}),
		{ expirationTtl: 300 }
	); // Expires in 5 minutes

	const text = `⚠️ *Confirm Droplet Creation*

*Name:* ${name}
*Region:* ${region}
*Size:* ${size}
*Image:* ${image}
*Username:* \`root\`
*Password:* \`${password}\`

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
		ssh_keys: [],
		backups: false,
		ipv6: false,
		monitoring: true,
		user_data: `#!/bin/bash\necho 'root:${data.password}' | chpasswd`,
	};

	const response = await fetch(url, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${env.DO_API_TOKEN}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify(body),
	});

	const result = await response.json();

	if (response.ok && result.droplet) {
		// Store credentials in KV (no expiration - permanent storage)
		await env.DROPLET_CREATION.put(
			`creds_${result.droplet.id}`,
			JSON.stringify({
				username: 'root',
				password: data.password,
			})
		);

		const successText = `✅ *Droplet Created Successfully!*

*Name:* ${result.droplet.name}
*ID:* ${result.droplet.id}
*Status:* ${result.droplet.status}
*Region:* ${result.droplet.region.slug}

*Credentials:*
Username: \`root\`
Password: \`${data.password}\`

⏳ The droplet is being created. IP address will be assigned shortly.

Use /droplets to check the status and get the IP address.`;

		await editMessage(chatId, messageId, successText, env);

		// Delete from KV
		await env.DROPLET_CREATION.delete(creationId);
	} else {
		await editMessage(chatId, messageId, `❌ Failed to create droplet: ${result.message || 'Unknown error'}`, env);
	}
}
