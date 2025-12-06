/**
 * Marketplace Categories
 * 
 * Since DigitalOcean API doesn't provide category information,
 * we maintain a hard-coded list of categories and keywords for categorization.
 */

export const MARKETPLACE_CATEGORIES = {
    popular: {
        icon: '⭐',
        name: 'Popular Apps',
        slugs: [
            'wordpress-20-04',
            'docker-20-04',
            'nodejs-20-04',
            'mysql-20-04',
            'mariadb',
            'redis-7-22-04',
            'gitlab-gitlabenterprise-20-04',
            'nginx',
            'lamp-22-04',
            'lemp-22-04',
            'mean',
            'mern',
            'discourse-20-04',
            'ghost-20-04',
            'nextcloudgmbh-nextcloud'
        ]
    },
    cms: {
        icon: '📝',
        name: 'CMS & Blogs',
        keywords: ['wordpress', 'ghost', 'joomla', 'drupal', 'discourse', 'microweber']
    },
    databases: {
        icon: '🗄️',
        name: 'Databases',
        keywords: [
            'mysql', 'postgresql', 'mongodb', 'redis', 'mariadb', 
            'cassandra', 'influxdb', 'clickhouse', 'questdb', 'edgedb'
        ]
    },
    devtools: {
        icon: '🛠️',
        name: 'Developer Tools',
        keywords: ['docker', 'gitlab', 'jenkins', 'git', 'vscode', 'code-server', 'coder']
    },
    webservers: {
        icon: '🌐',
        name: 'Web Servers',
        keywords: [
            'nginx', 'apache', 'lamp', 'lemp', 'mean', 'mern', 
            'nodejs', 'django', 'flask', 'rails', 'farm'
        ]
    },
    ai: {
        icon: '🤖',
        name: 'AI & ML',
        keywords: [
            'jupyter', 'pytorch', 'tensorflow', 'ollama', 'deepseek', 
            'ai', 'ml', 'anaconda', 'rocm', 'vllm'
        ]
    },
    monitoring: {
        icon: '📊',
        name: 'Monitoring',
        keywords: ['grafana', 'prometheus', 'zabbix', 'netdata', 'uptimekuma', 'uptime']
    },
    messaging: {
        icon: '💬',
        name: 'Chat & Messaging',
        keywords: ['mattermost', 'rocket.chat', 'matrix', 'discord', 'jitsi']
    },
    control: {
        icon: '⚙️',
        name: 'Control Panels',
        keywords: [
            'plesk', 'cpanel', 'cloudron', 'easypanel', 'runcloud', 
            'ispmanager', 'caprover', 'coolify'
        ]
    }
};

/**
 * Categorize a marketplace app based on its name, slug, and description
 * @param {Object} app - The marketplace app object
 * @returns {string} - Category ID
 */
export function categorizeApp(app) {
    const searchText = `${app.name.toLowerCase()} ${app.slug.toLowerCase()} ${app.description?.toLowerCase() || ''}`;
    
    // Check Popular first (by exact slug match)
    if (MARKETPLACE_CATEGORIES.popular.slugs.includes(app.slug)) {
        return 'popular';
    }
    
    // Check other categories by keywords
    for (const [categoryId, category] of Object.entries(MARKETPLACE_CATEGORIES)) {
        if (categoryId === 'popular') continue;
        
        if (category.keywords) {
            for (const keyword of category.keywords) {
                if (searchText.includes(keyword)) {
                    return categoryId;
                }
            }
        }
    }
    
    return 'other';
}