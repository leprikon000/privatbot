
const express = require("express");
const crypto = require("crypto");
const axios = require("axios");

const app = express();
app.use(express.json());

const TELEGRAM_BOT_TOKEN = "ТУТ_ТВОЙ_ТОКЕН_БОТА";
const PASSWORD = "9a2d8957ab524df2889c0cca0f288f5e";

function validateSignature(data, signatureFromBank) {
  const signatureBase = PASSWORD +
    data.storeId + data.orderId + data.paymentState + data.message + PASSWORD;

  const sha1 = crypto.createHash("sha1");
  sha1.update(signatureBase);
  const expectedSignature = sha1.digest("base64");

  return expectedSignature === signatureFromBank;
}

app.post("/payment/callback", async (req, res) => {
  const data = req.body;

  if (!validateSignature(data, data.signature)) {
    console.log("❌ Неверная подпись. Запрос отклонён.");
    return res.status(403).send("Invalid signature");
  }

  if (data.paymentState === "SUCCESS") {
    const telegramId = data.orderId; // мы передавали Telegram ID как orderId

    console.log(`✅ Оплата прошла от пользователя ${telegramId}`);

    // Отправка в Telegram
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      chat_id: telegramId,
      text: "✅ Оплата прошла успешно! Вот доступ к курсу: https://ссылка-на-курс"
    });

    return res.send("OK");
  }

  console.log("⚠️ Оплата не прошла.");
  return res.status(200).send("No action needed");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server started on port ${PORT}`));
