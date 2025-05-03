// server.js

const express = require("express");
const crypto  = require("crypto");
const axios   = require("axios");

const app = express();
app.use(express.json());

const PRIVAT_PASSWORD = "9a2d8957ab524df2889c0cca0f288f5e";
const STORE_ID        = "83B07D9AFC5046A9A45E";
const RESPONSE_URL    = "https://privatbot.onrender.com/payment/callback";
const REDIRECT_URL    = "https://t.me/master_izobiliia_bot";

const SENDPULSE_CLIENT_ID     = "d5615cc69aee8a5f67251bb12bf8231c";
const SENDPULSE_CLIENT_SECRET = "2a0579a6ac7705c341a86b92f8a8bac9";
const BOT_ID                  = "6810f00c85e77658ef0b4a45";

let cachedToken   = null;
let tokenExpireAt = 0;

// 1) Кешируем токен, чтобы не просрочить
async function getSendPulseToken() {
  const now = Date.now();
  if (cachedToken && now < tokenExpireAt) return cachedToken;

  const res = await axios.post("https://api.sendpulse.com/oauth/access_token", {
    grant_type:    "client_credentials",
    client_id:     SENDPULSE_CLIENT_ID,
    client_secret: SENDPULSE_CLIENT_SECRET
  });
  cachedToken   = res.data.access_token;
  // уменьшаем expires_in на 60 сек, чтобы успеть
  tokenExpireAt = now + (res.data.expires_in - 60) * 1000;
  return cachedToken;
}

// 2) Находим contact_id по user_id
async function getContactId(userId, token) {
  const res = await axios.get(
    "https://api.sendpulse.com/telegram/contacts/getByVariable",
    {
      params: { bot_id: BOT_ID, variable_name: "user_id", variable_value: userId },
      headers: { Authorization: `Bearer ${token}` }
    }
  );
  return res.data.data?.[0]?.id || null;
}

// 3) Ставим флаг access_granted = true
async function grantAccess(contactId, token) {
  await axios.post(
    "https://api.sendpulse.com/telegram/contacts/setVariable",
    {
      bot_id:         BOT_ID,
      contact_id:     contactId,
      variable_name:  "access_granted",
      variable_value: "true"
    },
    { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } }
  );
  console.log("✅ access_granted=true for", contactId);
}

// === Колбэк от ПриватБанка ===
app.post("/payment/callback", async (req, res) => {
  const data = req.body;

  // 1) Проверяем подпись (ваша логика)
  const baseSig = PRIVAT_PASSWORD + data.storeId + data.orderId + data.paymentState + (data.message||"") + PRIVAT_PASSWORD;
  const expected = crypto.createHash("sha1").update(baseSig).digest("base64");
  if (expected !== data.signature) {
    return res.status(403).send("Invalid signature");
  }

  // 2) Отвечаем сразу, чтобы ПриватБанк не повторял колбэки
  res.send("OK");

  // 3) Если успешно — апдейтим SendPulse
  if (data.paymentState === "SUCCESS") {
    try {
      const userId    = data.orderId.split("_")[0];
      const token     = await getSendPulseToken();
      const contactId = await getContactId(userId, token);
      if (!contactId) {
        console.warn("❌ Contact not found for user_id", userId);
        return;
      }
      await grantAccess(contactId, token);
    } catch (e) {
      console.error("❌ Error granting access:", e.response?.data||e.message);
    }
  }
});

app.listen(process.env.PORT||10000, () =>
  console.log("🚀 Server running")
);
