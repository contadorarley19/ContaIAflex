const { getStore } = require("@netlify/blobs");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json",
};

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: CORS, body: "" };

  const store = getStore("contaia-config");
  const { action, key, value } = event.httpMethod === "GET"
    ? { action: "get", key: event.queryStringParameters?.key }
    : JSON.parse(event.body || "{}");

  try {
    if (action === "get" || event.httpMethod === "GET") {
      const data = await store.get(key);
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ value: data }) };
    }
    if (action === "set") {
      await store.set(key, typeof value === "string" ? value : JSON.stringify(value));
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true }) };
    }
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "action inválido" }) };
  } catch (e) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: e.message }) };
  }
};
