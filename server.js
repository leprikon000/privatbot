// server.js

const express = require("express");
const crypto  = require("crypto");
const axios   = require("axios");

const app = express();
app.use(express.json());

// === Configuration ===
const PRIVAT_PASSWORD         = "9a2d8957ab524df2889c0cca0f288f5e";
const STORE_ID                = "83B07D9AFC5046A9A45E";
const RESPONSE_URL            = "https://privatbot.onrender.com/payment/callback";
const REDIRECT_URL            = "https://t.me/master_izobiliia_bot";
const SENDPULSE_CLIENT_ID     = "d5615cc69aee8a5f67251bb12bf8231c";
const SENDPULSE_CLIENT_SECRET = "2a0579a6ac7705c341a86b92f8a8bac9";
const BOT_ID                  = "6810f00c85e77658ef0b4a45";

// Caching OAuth token
let cachedToken   = null;
let tokenExpiresAt = 0;

// Generate signature for PrivatBank create-payment (partial payment)
function generateSignature({ orderId, amount, partsCount, merchantType, product }) {
  const amountStr   = String(Math.round(amount * 100));
  const priceStr    = String(Math.round(product.price * 100));
  const productStr  = product.name + product.count + priceStr;
  // according to PP doc: include partsCount, merchantType, urls and product
  const raw = PRIVAT_PASSWORD
    + STORE_ID
    + orderId
    + amountStr
    + partsCount
    + merchantType
    + RESPONSE_URL
    + REDIRECT_URL
    + productStr
    + PRIVAT_PASSWORD;
  return crypto.createHash("sha1").update(raw).digest("base64");
}

// Get OAuth token from SendPulse (cached)
async function getSendPulseToken() {
  const now = Date.now();
  if (cachedToken && now < tokenExpiresAt) return cachedToken;

  const res = await axios.post("https://api.sendpulse.com/oauth/access_token", {
    grant_type:    "client_credentials",
    client_id:     SENDPULSE_CLIENT_ID,
    client_secret: SENDPULSE_CLIENT_SECRET
  });
  cachedToken   = res.data.access_token;
  tokenExpiresAt = now + (res.data.expires_in - 60) * 1000;
  return cachedToken;
}

// Find contact_id by user_id via getByVariable
async function getContactId(userId, token) {
  const res = await axios.get("https://api.sendpulse.com/telegram/contacts/getByVariable", {
    params: { bot_id: BOT_ID, variable_name: "user_id", variable_value: userId },
    headers: { Authorization: `Bearer ${token}` }
  });
  return res.data.data?.[0]?.id || null;
}

// Set variable access_granted = true
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
  console.log("✅ access_granted set for", contactId);
}

// Create payment endpoint for partial payment
app.post("/create-payment", async (req, res) => {
  const { orderId, amount, partsCount, tariffName } = req.body;
  if (!orderId || !amount || !partsCount || !tariffName) {
    return res.status(400).json({ success: false, error: "Missing parameters" });
  }

  const product = { name: `Курс МАСТЕР ИЗОБИЛИЯ - ${tariffName}`, count: 1, price: amount };
  const signature = generateSignature({ orderId, amount, partsCount, merchantType: "PP", product });
  const payload = { storeId: STORE_ID, orderId, amount, partsCount, merchantType: "PP", products: [product], responseUrl: RESPONSE_URL, redirectUrl: REDIRECT_URL, signature };

  try {
    const { data } = await axios.post(
      "https://payparts2.privatbank.ua/ipp/v2/payment/create",
      payload,
      { headers: { "Content-Type": "application/json" } }
    );
    console.log("✅ PrivatBank response:", data);
    return res.json({ success: true, token: data.token });
  } catch (e) {
    console.error("❌ Error creating payment:", e.response?.data || e.message);
    return res.status(500).json({ success: false, error: e.response?.data || e.message });
  }
});

// Payment callback endpoint
app.post("/payment/callback", async (req, res) => {
  const data = req.body;
  // Validate signature
  const rawSig = PRIVAT_PASSWORD + data.storeId + data.orderId + data.paymentState + (data.message || "") + PRIVAT_PASSWORD;
  const expected = crypto.createHash("sha1").update(rawSig).digest("base64");
  if (expected !== data.signature) {
    console.error("Invalid callback signature", data.signature);
    return res.status(403).send("Invalid signature");
  }

  // Respond immediately
  res.send("OK");

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
      console.error("❌ Error granting access:", e.response?.data || e.message);
    }
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
