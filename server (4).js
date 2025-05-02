
const express = require("express");
const crypto = require("crypto");
const axios = require("axios");

const app = express();
app.use(express.json());

const PASSWORD = "9a2d8957ab524df2889c0cca0f288f5e";
const STORE_ID = "83B07D9AFC5046A9A45E";
const RESPONSE_URL = "https://privatbot.onrender.com/payment/callback";
const REDIRECT_URL = "https://t.me/master_izobiliia_bot";

// 🔐 Подпись запроса
function generateSignature({ orderId, amount, partsCount, merchantType, product }) {
  const amountStr = String(amount * 100);
  const priceStr = String(product.price * 100);
  const productString = product.name + product.count + priceStr;

  const baseString = PASSWORD + STORE_ID + orderId + amountStr + partsCount + merchantType + RESPONSE_URL + REDIRECT_URL + productString + PASSWORD;
  return crypto.createHash("sha1").update(baseString).digest("base64");
}

// 🔁 Создание платежа
app.post("/create-payment", async (req, res) => {
  const { orderId, amount, partsCount, tariffName } = req.body;

  if (!orderId || !amount || !partsCount || !tariffName) {
    return res.status(400).json({ success: false, error: "Missing parameters" });
  }

  const product = {
    name: `Курс МАСТЕР ИЗОБИЛИЯ - ${tariffName}`,
    count: 1,
    price: amount
  };

  const paymentData = {
    storeId: STORE_ID,
    orderId,
    amount,
    partsCount,
    merchantType: "PP",
    products: [product],
    responseUrl: RESPONSE_URL,
    redirectUrl: REDIRECT_URL,
    signature: generateSignature({
      orderId,
      amount,
      partsCount,
      merchantType: "PP",
      product
    })
  };

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

  const userId = data.orderId.split("_")[0];

  if (data.paymentState === "SUCCESS") {
    console.log(`🎉 Оплата прошла от пользователя ${data.orderId}`);

    try {
      const tokenResponse = await axios.post("https://api.sendpulse.com/oauth/access_token", {
        grant_type: "client_credentials",
        client_id: "d5615cc69aee8a5f67251bb12bf8231c",
        client_secret: "2a0579a6ac7705c341a86b92f8a8bac9"
      });

      const accessToken = tokenResponse.data.access_token;

      // Найти контакт по переменной user_id
      const searchResponse = await axios.get("https://api.sendpulse.com/customers?limit=100", {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      });

      const contactList = searchResponse.data.data;
      const contact = contactList.find(c => c.variables?.user_id == userId);

      if (!contact) {
        console.error("❌ Контакт с таким user_id не найден");
        return res.status(404).send("Contact not found");
      }

      const contactId = contact.id;

      // Обновление переменной
      await axios.post("https://api.sendpulse.com/customers/set-variable", {
        contact_id: contactId,
        variable: {
          name: "access_granted",
          value: "true"
        }
      }, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        }
      });

      console.log("✅ Переменная access_granted обновлена для contact_id:", contactId);
    } catch (error) {
      console.error("❌ Ошибка при обновлении переменной access_granted:", error.response?.data || error.message);
    }
  }

  res.send("OK");
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log("🚀 Server running on port", PORT));
