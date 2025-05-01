
const express = require("express");
const crypto = require("crypto");
const axios = require("axios");

const app = express();
app.use(express.json());

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const PASSWORD = "9a2d8957ab524df2889c0cca0f288f5e";
const STORE_ID = "83B07D9AFC5046A9A45E";
const RESPONSE_URL = "https://privatbot.onrender.com/payment/callback";
const REDIRECT_URL = "https://t.me/ТВОЙ_БОТ"; // замени на своего бота

function generateSignature(data) {
  const productsString = JSON.stringify(data.products).replace(/\s+/g, "");
  const baseString = PASSWORD +
    STORE_ID +
    data.orderId +
    data.amount * 100 +
    data.partsCount +
    data.merchantType +
    RESPONSE_URL +
    REDIRECT_URL +
    productsString +
    PASSWORD;

  const sha1 = crypto.createHash("sha1").update(baseString).digest("base64");
  return sha1;
}

app.post("/create-payment", async (req, res) => {
  const { orderId, amount, partsCount, tariffName } = req.body;

  const paymentData = {
    storeId: STORE_ID,
    orderId,
    amount,
    partsCount,
    merchantType: "PP",
    products: [
      {
        name: `Курс МАСТЕР ИЗОБИЛИЯ - ${tariffName}`,
        count: 1,
        price: amount
      }
    ],
    responseUrl: RESPONSE_URL,
    redirectUrl: REDIRECT_URL
  };

  const signature = generateSignature(paymentData);
  paymentData.signature = signature;

  try {
    const response = await axios.post("https://payparts2.privatbank.ua/ipp/v2/payment/create", paymentData, {
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json"
      }
    });

    res.json({ success: true, token: response.data.token });
  } catch (error) {
    console.error("Ошибка при создании оплаты:", error.response?.data || error.message);
    res.status(500).json({ success: false, error: "Ошибка создания оплаты" });
  }
});

app.post("/payment/callback", async (req, res) => {
  const data = req.body;

  const signatureBase = PASSWORD + data.storeId + data.orderId + data.paymentState + data.message + PASSWORD;
  const expectedSignature = crypto.createHash("sha1").update(signatureBase).digest("base64");

  if (expectedSignature !== data.signature) {
    return res.status(403).send("Invalid signature");
  }

  if (data.paymentState === "SUCCESS") {
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      chat_id: data.orderId,
      text: "✅ Оплата прошла успешно! Вот доступ к курсу: https://твой-сайт/доступ"
    });
  }

  res.send("OK");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("🚀 Server running on port", PORT));
