const fs = require('fs');
const path = require('path');
const https = require('https');

const CACHE_FILE = path.join(__dirname, '../../data/promo_cache.json');
const CACHE_DURATION = 3600; // 1 час в секундах

function saveToCache(data) {
    const cacheData = {
        timestamp: Math.floor(Date.now() / 1000),
        data: data
    };
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cacheData, null, 2));
}

function loadFromCache(ignoreExpiry = false) {
    try {
        if (!fs.existsSync(CACHE_FILE)) {
            return null;
        }

        const cacheContent = fs.readFileSync(CACHE_FILE, 'utf8');
        const cacheData = JSON.parse(cacheContent);

        if (!cacheData || !cacheData.data) {
            return null;
        }

        // Check expiry only if not ignoring it (for fallback scenarios)
        if (!ignoreExpiry && cacheData.timestamp && (Math.floor(Date.now() / 1000) - cacheData.timestamp) > CACHE_DURATION) {
            return null;
        }

        return cacheData;
    } catch (error) {
        console.error('Error loading cache:', error);
        return null;
    }
}

function callAPI(url) {
    return new Promise((resolve, reject) => {
        https.get(url, { rejectUnauthorized: false }, (res) => {
            let data = '';

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                resolve({
                    success: res.statusCode >= 200 && res.statusCode < 300,
                    data: data,
                    httpCode: res.statusCode
                });
            });
        }).on('error', (error) => {
            resolve({
                success: false,
                data: null,
                httpCode: 500,
                error: error.message
            });
        });
    });
}

async function getPromoData() {
    const apiUrl = 'https://lkk.smazka.ru/apiv1/get/cost?token=gulldl9yR7XKWadO1L64&g=promo&ds=20240101&de=20261231';

    try {
        const result = await callAPI(apiUrl);

        if (result.success) {
            saveToCache(result.data);

            const data = JSON.parse(result.data);
            return {
                success: true,
                data: data,
                cached: false
            };
        } else {
            // API failed, try to load cache ignoring expiry as fallback
            const cachedData = loadFromCache(true);

            if (cachedData !== null) {
                const data = typeof cachedData.data === 'string'
                    ? JSON.parse(cachedData.data)
                    : cachedData.data;
                return {
                    success: true,
                    data: data,
                    cached: true,
                    cacheTimestamp: cachedData.timestamp
                };
            }

            return {
                success: false,
                error: result.error || 'Failed to fetch data',
                httpCode: result.httpCode
            };
        }
    } catch (error) {
        // Error occurred, try to load cache ignoring expiry as fallback
        const cachedData = loadFromCache(true);

        if (cachedData !== null) {
            const data = typeof cachedData.data === 'string'
                ? JSON.parse(cachedData.data)
                : cachedData.data;
            return {
                success: true,
                data: data,
                cached: true,
                cacheTimestamp: cachedData.timestamp
            };
        }

        return {
            success: false,
            error: error.message
        };
    }
}

module.exports = {
    getPromoData
};
