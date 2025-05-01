
const express = require("express");
const crypto = require("crypto");
const axios = require("axios");

const app = express();
app.use(express.json());

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const PASSWORD = "9a2d8957ab524df2889c0cca0f288f5e";
const STORE_ID = "83B07D9AFC5046A9A45E";
const RESPONSE_URL = "https://privatbot.onrender.com/payment/callback";
const REDIRECT_URL = "https://t.me/master_izobiliia_bot";

function buildProductStringPlain(product) {
  return `[{"name":"${product.name}","count":${product.count},"price":${product.price}}]`;
}

function generateSignature({ orderId, amount, partsCount, merchantType, product }) {
  const amountStr = String(amount * 100);
  const productStr = buildProductStringPlain(product);
  const base = PASSWORD +
    STORE_ID +
    orderId +
    amountStr +
    partsCount +
    merchantType +
    RESPONSE_URL +
    REDIRECT_URL +
    productStr +
    PASSWORD;

  const signature = crypto.createHash("sha1").update(base).digest("base64");
  return signature;
}

app.post("/create-payment", async (req, res) => {
  const { orderId, amount, partsCount, tariffName } = req.body;

  const product = {
    name: `Курс МАСТЕР ИЗОБИЛИЯ - ${tariffName}`,
    count: 1,
    price: amount
  };

  const productJson = JSON.parse(buildProductStringPlain(product));

  const paymentData = {
    storeId: STORE_ID,
    orderId,
    amount,
    partsCount,
    merchantType: "PP",
    products: productJson,
    responseUrl: RESPONSE_URL,
    redirectUrl: REDIRECT_URL
  };

  const signature = generateSignature({
    orderId,
    amount,
    partsCount,
    merchantType: "PP",
    product
  });

  paymentData.signature = signature;

  console.log("👉 Отправка данных в ПриватБанк:");
  console.log(JSON.stringify(paymentData, null, 2));

  try {
    const response = await axios.post("https://payparts2.privatbank.ua/ipp/v2/payment/create", paymentData, {
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json"
      }
    });

    console.log("✅ Ответ от ПриватБанка:");
    console.log(response.data);

    res.json({
      success: true,
      token: response.data.token
    });
  } catch (error) {
    console.error("❌ Ошибка при создании оплаты:", error.response?.data || error.message);
    res.status(500).json({ success: false, error: "Ошибка создания оплаты" });
  }
});

app.post("/payment/callback", async (req, res) => {
  const data = req.body;

  const signatureBase = PASSWORD + data.storeId + data.orderId + data.paymentState + data.message + PASSWORD;
  const expectedSignature = crypto.createHash("sha1").update(signatureBase).digest("base64");

  if (expectedSignature !== data.signature) {
    console.warn("❌ Неверная подпись от ПриватБанка");
    return res.status(403).send("Invalid signature");
  }

  if (data.paymentState === "SUCCESS") {
    console.log(`🎉 Оплата прошла от пользователя ${data.orderId}`);
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      chat_id: data.orderId,
      text: "✅ Оплата прошла успешно! Вот доступ к курсу: https://твой-сайт/доступ"
    });
  }

  res.send("OK");
});

const PORT = process.env.PORT;
app.listen(PORT, () => console.log("🚀 Server running on port", PORT));
