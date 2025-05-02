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

// ✅ Функция, из-за которой была ошибка
function buildProductStringPlain(product) {
  return `[{"name":"${product.name}","count":${product.count},"price":${product.price}}]`;
}

// 🔐 Подпись запроса
function generateSignature({ orderId, amount, partsCount, merchantType, product }) {
  const amountStr = String(amount * 100); // например, 16600 => 1660000 копеек, но скорее всего 16600 уже в копейках
  const priceStr = String(product.price * 100); // без плавающей точки

  const productString =
    product.name +
    product.count +
    priceStr;

  const baseString =
    PASSWORD +
    STORE_ID +
    orderId +
    amountStr +
    partsCount +
    merchantType +
    RESPONSE_URL +
    REDIRECT_URL +
    productString +
    PASSWORD;

  const signature = crypto.createHash("sha1").update(baseString).digest("base64");
  return signature;
}

// 🔁 Создание платежа
app.post("/create-payment", async (req, res) => {
  console.log("⏳ Запрос получен на /create-payment");

  const { orderId, amount, partsCount, tariffName } = req.body;

  if (!orderId || !amount || !partsCount || !tariffName) {
    console.error("❌ Не хватает параметров");
    return res.status(400).json({ success: false, error: "Missing parameters" });
  }

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

// 🔔 Callback от ПриватБанка
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

    // 🟢 Обновляем переменную access_granted в SendPulse
    const [telegramId] = data.orderId.split("_"); // достаём Telegram ID из orderId

    try {
      // получаем access_token от SendPulse
      const authResponse = await axios.post('https://api.sendpulse.com/oauth/access_token', {
        grant_type: 'client_credentials',
        client_id: 'd5615cc69aee8a5f67251bb12bf8231c',
        client_secret: '2a0579a6ac7705c341a86b92f8a8bac9'
      });

      const access_token = authResponse.data.access_token;

      // обновляем переменную access_granted=true для user_id = telegramId
      await axios.put(
  `https://api.sendpulse.com/bot/6810f00c85e77658ef0b4a45/contacts/variables`,
  {
    user_id: telegramId,
    variables: {
      access_granted: true
    }
  },
  {
    headers: {
      Authorization: `Bearer ${access_token}`,
      'Content-Type': 'application/json'
    }
  }
);


      console.log("✅ Переменная access_granted обновлена в SendPulse");
    } catch (err) {
      console.error("❌ Ошибка при обновлении переменной access_granted:", err.response?.data || err.message);
    }
  }

  res.send("OK");
});



// 🌐 Запуск сервера
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log("🚀 Server running on port", PORT));
