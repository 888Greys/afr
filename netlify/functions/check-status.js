const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

async function redisGet(key) {
    const res = await fetch(`${REDIS_URL}/get/${key}`, {
        headers: { Authorization: `Bearer ${REDIS_TOKEN}` }
    });
    const json = await res.json();
    return json.result; // null | string
}

exports.handler = async (event) => {
    const { sessionId, type } = event.queryStringParameters || {};
    if (!sessionId || !type) {
        return { statusCode: 400, body: JSON.stringify({ error: 'Missing sessionId or type' }) };
    }

    const key = `session:${sessionId}:${type}`; // type = "login" | "otp"
    const status = await redisGet(key);

    return {
        statusCode: 200,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({ status: status || 'pending' })
    };
};
