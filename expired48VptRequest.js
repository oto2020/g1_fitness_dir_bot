const { PrismaClient } = require('@prisma/client');
const cron = require('node-cron');
const BotHelper = require('./BotHelper'); // Подключаем BotHelper
const TelegramBot = require('node-telegram-bot-api');

const prisma = new PrismaClient();
const bot = new TelegramBot(process.env.TOKEN, { polling: false });

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

        console.table(expiredRequests.map(el=> { return {id: el.id, userId: el.userId, comment: el.comment, goal: el.goal, visitTime: el.visitTime}}));
        
        let nowDateTime = BotHelper.nowDateTime();
        if (expiredRequests.length === 0) {
            console.log(`[${nowDateTime}] Нет просроченных заявок со статусом "none".`);
            return;
        }

        console.log(`[${nowDateTime}] Найдено ${expiredRequests.length} просроченных заявок. Отправляем фитнес-директору...`);

        bot.sendMessage(process.env.GROUP_ID, `[${nowDateTime}] Найдено ${expiredRequests.length} просроченных заявок. Отправляем фитнес-директору...`);

        for (const vptRequest of expiredRequests) {
            try {
                // Нужно удалять все сообщения, а потом направлять ФитДиру
                let tgVptChatMessages = vptRequest.tgChatMessageId?.split('|');
                for (const vptTgChatMessage of tgVptChatMessages) {
                    let [chatId, messageId] = vptTgChatMessage.split('@');
                    await BotHelper.deleteMessage(bot, chatId, messageId);
                    console.log(`Удалено сообщение ${chatId}@${messageId}`);
                }

                // Уведомляем тренера с фото заявки
                try {
                    let badTrainer = await BotHelper.getUserById(prisma, vptRequest.userId);
                    await bot.sendPhoto(badTrainer.chatId, vptRequest.photo, { caption: `⚠️ Вы просрочили заявку #${vptRequest.id}\n\nОна возвращена на распределение и будет передана другому тренеру.\n\n${badTrainer.name} (@${badTrainer.nick}), ваша эффективность снижена, так как заинтересованный клиент вынужден ждать более 2 суток...`});
                } catch (e) {
                    console.error(e);
                }

                // Удалять тег тренера
                await BotHelper.deleteTagForVptRequest(prisma, vptRequest);

                // Обнулять тренера в заявке
                await BotHelper.updateVptRequestUserId(prisma, vptRequest.id, null);

                // Обновить историю
                let newHistory = `${vptRequest.history}\n\n${BotHelper.nowDateTime()}\n⚠️ ЗАЯВКА ПРОСРОЧЕНА`;
                await BotHelper.updateVptRequestHistory(prisma, vptRequest.id, newHistory);

                // Отправляем Анкету Фитдиру. Это будет первое сообщение
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

// Запуск cron-задачи каждый день в 14:00
cron.schedule('0 14 * * *', async () => {
    console.log("🔄 Запуск проверки и отправки просроченных заявок...");
    await processExpiredRequests();
});


// Запуск сразу при старте (для отладки)
processExpiredRequests();
