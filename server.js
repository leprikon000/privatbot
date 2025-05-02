// server.js

const express = require("express");
const crypto = require("crypto");
const axios = require("axios");

const app = express();
app.use(express.json());

// === Configuration ===
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const PRIVAT_PASSWORD     = "9a2d8957ab524df2889c0cca0f288f5e";
const STORE_ID            = "83B07D9AFC5046A9A45E";
const RESPONSE_URL        = "https://privatbot.onrender.com/payment/callback";
const REDIRECT_URL        = "https://t.me/master_izobiliia_bot";
const SENDPULSE_CLIENT_ID     = "d5615cc69aee8a5f67251bb12bf8231c";
const SENDPULSE_CLIENT_SECRET = "2a0579a6ac7705c341a86b92f8a8bac9";
const BOT_ID              = "6810f00c85e77658ef0b4a45";

// === Helper Functions ===

// Generate signature for create-payment
function generateSignature({ orderId, amount, partsCount, merchantType, product }) {
  const amountStr = String(amount * 100);
  const priceStr = String(product.price * 100);
  const productString = product.name + product.count + priceStr;
  const baseString = PRIVAT_PASSWORD + STORE_ID + orderId + amountStr + partsCount + merchantType + RESPONSE_URL + REDIRECT_URL + productString + PRIVAT_PASSWORD;
  return crypto.createHash("sha1").update(baseString).digest("base64");
}

// Get OAuth token from SendPulse
async function getSendPulseToken() {
  const res = await axios.post(
    "https://api.sendpulse.com/oauth/access_token",
    {
      grant_type:    "client_credentials",
      client_id:     SENDPULSE_CLIENT_ID,
      client_secret: SENDPULSE_CLIENT_SECRET
    }
  );
  return res.data.access_token;
}


// Find contact_id by user_id via getByVariable
async function getContactIdByUserId(userId, accessToken) {
  const res = await axios.get("https://api.sendpulse.com/telegram/contacts/getByVariable", {
    params: { bot_id: BOT_ID, name: "user_id", value: userId },
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const list = res.data.data || [];
  return list.length ? list[0].id : null;
}

// Set variable access_granted = true (простой режим с логами)
async function grantAccess(contactId, accessToken) {
  console.log("🔔 grantAccess called, contactId =", contactId);

  const payload = {
    contact_id:     contactId,
    variable_name:  "access_granted",
    variable_value: "true"
  };
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json"
  };

  console.log("→ setVariable payload:", JSON.stringify(payload));
  console.log("→ setVariable headers:", JSON.stringify(headers));

  const res = await axios.post(
    "https://api.sendpulse.com/telegram/contacts/setVariable",
    payload,
    { headers }
  );

  console.log("← setVariable response status:", res.status);
  console.log("← setVariable response data:", JSON.stringify(res.data));
}


// === Routes ===

// Create payment endpoint
app.post("/create-payment", async (req, res) => {
  const { orderId, amount, partsCount, tariffName } = req.body;
  if (!orderId || !amount || !partsCount || !tariffName) return res.status(400).json({ success: false, error: "Missing parameters" });

  const product = { name: `Курс МАСТЕР ИЗОБИЛИЯ - ${tariffName}`, count: 1, price: amount };
  const paymentData = {
    storeId: STORE_ID,
    orderId,
    amount,
    partsCount,
    merchantType: "PP",
    products: [product],
    responseUrl: RESPONSE_URL,
    redirectUrl: REDIRECT_URL,
    signature: generateSignature({ orderId, amount, partsCount, merchantType: "PP", product })
  };

  try {
    const response = await axios.post("https://payparts2.privatbank.ua/ipp/v2/payment/create", paymentData, {
      headers: { "Content-Type": "application/json", "Accept": "application/json" }
    });
    console.log("✅ Ответ от ПриватБанка:", response.data);
    res.json({ success: true, token: response.data.token });
  } catch (error) {
    console.error("❌ Ошибка при создании оплаты:", error.response?.data || error.message);
    res.status(500).json({ success: false, error: "Ошибка создания оплаты" });
  }
});

// Payment callback endpoint
app.post("/payment/callback", async (req, res) => {
  const data = req.body;
  try {
    // Validate signature
    const baseSig = PRIVAT_PASSWORD + data.storeId + data.orderId + data.paymentState + (data.message || "") + PRIVAT_PASSWORD;
    const expectedSig = crypto.createHash("sha1").update(baseSig).digest("base64");
    if (expectedSig !== data.signature) return res.status(403).send("Invalid signature");

    if (data.paymentState === "SUCCESS") {
      console.log(`🎉 Оплата прошла от пользователя ${data.orderId}`);
      const userId = data.orderId.split("_")[0];
      const token = await getSendPulseToken();
      const contactId = await getContactIdByUserId(userId, token);
      if (!contactId) {
        console.error("❌ Contact not found for user_id:", userId);
        return res.send("OK");
      }
      await grantAccess(contactId, token);
      console.log("✅ Доступ предоставлен contact_id:", contactId);
    }
    res.send("OK");
  } catch (err) {
    console.error("❌ Ошибка при обработке callback:", err.response?.data || err.message);
    res.status(500).send("Internal Server Error");
  }
});

// Start server
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
