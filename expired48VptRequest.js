const { PrismaClient } = require('@prisma/client');
const cron = require('node-cron');
const BotHelper = require('./BotHelper'); // Подключаем BotHelper
const TelegramBot = require('node-telegram-bot-api');

const prisma = new PrismaClient();
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: false });

// Функция для поиска просроченных заявок и отправки фитнес-директору
async function processExpiredRequests() {
    const cutoffDate = new Date();
    cutoffDate.setHours(cutoffDate.getHours() - 48); // Отнимаем 48 часов

    try {
        const expiredRequests = await prisma.vPTRequest.findMany({
            where: {
                createdAt: { lt: cutoffDate }, // createdAt < (текущая дата - 48 часов)
                status: "none", // Фильтр по статусу
            },
        });

        if (expiredRequests.length === 0) {
            console.log(`[${new Date().toLocaleString()}] Нет просроченных заявок со статусом "none".`);
            return;
        }

        console.log(`[${new Date().toLocaleString()}] Найдено ${expiredRequests.length} просроченных заявок. Отправляем фитнес-директору...`);

        for (const vptRequest of expiredRequests) {
            try {
                await BotHelper.anketaToFitDir(bot, prisma, vptRequest);
                console.log(`✅ Заявка ID ${vptRequest.id} успешно отправлена фитнес-директору.`);
            } catch (error) {
                console.error(`❌ Ошибка при отправке заявки ID ${vptRequest.id}:`, error);
            }
        }
    } catch (error) {
        console.error("❌ Ошибка при получении просроченных заявок:", error);
    }
}

// Запуск cron-задачи каждый час
cron.schedule('0 * * * *', async () => {
    console.log("🔄 Запуск проверки и отправки просроченных заявок...");
    await processExpiredRequests();
});

// Запуск сразу при старте (для отладки)
processExpiredRequests();
