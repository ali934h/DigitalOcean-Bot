/**
 * Marketplace Service
 * 
 * Handles fetching and caching marketplace apps from DigitalOcean API
 */

/**
 * Get all marketplace apps with pagination
 * @param {string} apiToken - DigitalOcean API token
 * @returns {Promise<Array>} - Array of marketplace apps
 */
export async function getAllMarketplaceApps(apiToken) {
    let page = 1;
    const perPage = 100;
    const allApps = [];

    while (true) {
        const response = await fetch(
            `https://api.digitalocean.com/v2/images?type=application&page=${page}&per_page=${perPage}`,
            {
                headers: {
                    Authorization: `Bearer ${apiToken}`,
                    'Content-Type': 'application/json',
                },
            }
        );

        if (!response.ok) {
            throw new Error(`Failed to fetch marketplace apps: ${response.statusText}`);
        }

        const data = await response.json();
        const items = data.images || [];
        allApps.push(...items);

        // Check if there's a next page
        if (!data.links?.pages?.next || items.length === 0) {
            break;
        }

        page++;
    }

    // Filter only available apps
    return allApps.filter(app => app.status === 'available');
}

/**
 * Get cached marketplace apps or fetch fresh if cache expired
 * Cache duration: 1 hour
 * @param {Object} env - Worker environment (contains KV binding)
 * @param {string} apiToken - DigitalOcean API token
 * @returns {Promise<Array>} - Array of marketplace apps
 */
export async function getCachedMarketplaceApps(env, apiToken) {
    const cacheKey = 'marketplace_apps_cache';
    
    try {
        // Try to get from cache
        const cached = await env.DROPLET_CREATION.get(cacheKey);
        
        if (cached) {
            return JSON.parse(cached);
        }
    } catch (error) {
        console.error('Error reading cache:', error);
    }
    
    // Fetch from API
    const apps = await getAllMarketplaceApps(apiToken);
    
    try {
        // Cache for 1 hour (3600 seconds)
        await env.DROPLET_CREATION.put(
            cacheKey,
            JSON.stringify(apps),
            { expirationTtl: 3600 }
        );
    } catch (error) {
        console.error('Error writing cache:', error);
    }
    
    return apps;
}

/**
 * Search marketplace apps by name, slug, or description
 * @param {Array} apps - Array of marketplace apps
 * @param {string} searchTerm - Search query
 * @returns {Array} - Filtered apps
 */
export function searchApps(apps, searchTerm) {
    const term = searchTerm.toLowerCase();
    
    return apps.filter(app => 
        app.name.toLowerCase().includes(term) ||
        app.slug.toLowerCase().includes(term) ||
        (app.description && app.description.toLowerCase().includes(term))
    );
}

/**
 * Group apps by category
 * @param {Array} apps - Array of marketplace apps
 * @param {Function} categorizeFunc - Function to categorize an app
 * @returns {Object} - Apps grouped by category
 */
export function groupAppsByCategory(apps, categorizeFunc) {
    const grouped = {};
    
    for (const app of apps) {
        const category = categorizeFunc(app);
        
        if (!grouped[category]) {
            grouped[category] = [];
        }
        
        grouped[category].push(app);
    }
    
    return grouped;
}