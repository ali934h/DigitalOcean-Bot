/**
 * Authentication Utility Functions
 */

/**
 * Get user's API token from KV
 */
export async function getUserApiToken(userId, env) {
    try {
        const key = `api_token_${userId}`;
        return await env.DROPLET_CREATION.get(key);
    } catch (error) {
        console.error('Error getting API token:', error);
        return null;
    }
}

/**
 * Save user's API token to KV (with validation)
 */
export async function saveUserApiToken(userId, apiToken, env) {
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

/**
 * Clear all sessions for a user (when changing API token)
 */
export async function clearUserSessions(userId, env) {
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