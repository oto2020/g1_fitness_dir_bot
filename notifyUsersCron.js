/**
 * notifyUsers.js
 * 
 * Запуск через PM2:
 *   pm2 start notifyUsers.js --name "daily-vpt-bot"
 *
 * Скрипт будет "висеть" в памяти и каждый день в 12:00 (по локальному времени) 
 * выполнять рассылку, вызывая функцию main().
 */

require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { PrismaClient } = require('@prisma/client');
const cron = require('node-cron');

// Инициализируем Prisma
const prisma = new PrismaClient();

// Инициализируем бота (polling = false, т.к. принимаем только исходящие)
const bot = new TelegramBot(process.env.TOKEN, { polling: false });
const GROUP_ID = process.env.GROUP_ID;

main();
// -------------------------------------------------------
// 1. Расписание cron: Каждый день в 12:00
// -------------------------------------------------------
cron.schedule('0 12 * * *', () => {
  console.log('Cron: Запускаем main() в 12:00');
  main();
});

// -------------------------------------------------------
// 2. Вспомогательная функция: отправка сообщения с бэкоффом
// -------------------------------------------------------
async function sendMessageWithRetry(chatId, text, attempt = 1) {
  const maxAttempts = 5; // Максимальное число повторов

  try {
    await bot.sendMessage(chatId, text);
  } catch (error) {
    // Проверяем код ошибки 429 (Too Many Requests)
    if (
      (error.response && error.response.statusCode === 429) ||
      error.code === 'ETELEGRAM'
    ) {
      console.error('Получен ответ 429 или похожая ошибка:', error.message);
      const delay = Math.pow(2, attempt) * 1000; // 2^attempt * 1000 мс
      console.log(`[Rate-limit] Ждём ${delay / 1000} c перед повтором #${attempt}...`);
      await new Promise((resolve) => setTimeout(resolve, delay));

      if (attempt < maxAttempts) {
        return sendMessageWithRetry(chatId, text, attempt + 1);
      }
      throw new Error(
        `Не удалось отправить сообщение в чат ${chatId} после ${maxAttempts} попыток.`
      );
    } else {
      console.error(`Ошибка при отправке в чат ${chatId}:`, error.message);
      throw error;
    }
  }
}

// -------------------------------------------------------
// 3. Основная функция рассылки (main)
// -------------------------------------------------------
async function main() {
  try {
    // 3.1 Определяем начало и конец текущего месяца
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const endOfMonth = new Date(startOfMonth);
    endOfMonth.setMonth(endOfMonth.getMonth() + 1);
    endOfMonth.setDate(0);
    endOfMonth.setHours(23, 59, 59, 999);

    // 3.2 Получаем всех пользователей
    const targetUsers = await prisma.user.findMany();

    // Будем собирать тех, у кого есть неразобранные заявки — для отправки в группу
    const trainersWithNoneCount = [];

    for (const user of targetUsers) {
      // 3.3 Считаем общее число заявок в этом месяце (любого статуса)
      const totalCount = await prisma.vPTRequest.count({
        where: {
          userId: user.id,
          createdAt: {
            gte: startOfMonth,
            lte: endOfMonth,
          },
        },
      });

      // Если нет заявок за месяц — пропускаем
      if (totalCount === 0) {
        continue;
      }

      // 3.4 Подсчитываем заявки по статусам
      const noneCount = await prisma.vPTRequest.count({
        where: {
          userId: user.id,
          status: 'none',
          createdAt: {
            gte: startOfMonth,
            lte: endOfMonth,
          },
        },
      });

      const acceptedCount = await prisma.vPTRequest.count({
        where: {
          userId: user.id,
          status: 'accepted',
          createdAt: {
            gte: startOfMonth,
            lte: endOfMonth,
          },
        },
      });

      const rejectedCount = await prisma.vPTRequest.count({
        where: {
          userId: user.id,
          status: 'rejected',
          createdAt: {
            gte: startOfMonth,
            lte: endOfMonth,
          },
        },
      });

      // 3.5 Формируем сообщение каждому пользователю
      let personalMessage = `${user.name ?? ''} @${user.nick ?? ''},\nСтатистика по заявкам ВПТ за текущий месяц:`;
      personalMessage += `\n⏳ ${noneCount} | неразобранные`;
      personalMessage += `\n✅ ${acceptedCount} | принятые`;
      personalMessage += `\n❌ ${rejectedCount} | отклоненные`;

      // если noneCount = 0 — все разобраны
      if (noneCount === 0) {
        personalMessage += `\nВсе ВПТ разобраны, так держать! 🎉`;
      } else {
        personalMessage += `\n\n⚠️ У вас ${noneCount} неразобранных заявок на ВПТ.\nПросмотреть: /vpt_none${user.telegramID}`;
      }

      // Отправляем личное сообщение (если есть telegramID)
      if (user.telegramID) {
        await sendMessageWithRetry(user.telegramID, personalMessage);
      }

      // 3.6 Формируем сводку для группы
      // Допустим, нам нужны все, у кого есть неразобранные заявки (noneCount > 0)
      // (или только 'тренеры' — смотрите сами).
      if (noneCount > 0) {
        trainersWithNoneCount.push({ user, noneCount });
      }
    }

    // 3.7 Если есть пользователи с неразобранными заявками — отправляем сводку в группу
    if (trainersWithNoneCount.length > 0) {
      // Сортируем по убыванию
      trainersWithNoneCount.sort((a, b) => b.noneCount - a.noneCount);

      let groupMessage = 'Список пользователей с неразобранными заявками (⏳) за текущий месяц:\n';
      for (const item of trainersWithNoneCount) {
        const { user, noneCount } = item;
        groupMessage += `\n- ${user.name ?? ''} @${user.nick ?? ''}: ${noneCount}`;
      }

      await sendMessageWithRetry(GROUP_ID, groupMessage);
    }

    console.log('[main()] Рассылка завершена!');
  } catch (error) {
    console.error('[main()] Ошибка:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// -------------------------------------------------------
// 4. ВАЖНО: не вызываем main() напрямую, чтобы скрипт не завершался.
//    cron.schedule() выше сам будет вызывать main() в 12:00.
// -------------------------------------------------------

// Оставляем пустую «петлю» (невызываемый код), чтобы процесс не завершался.
// Если запустить просто `node notifyUsers.js`, 
// NodeJS увидит, что есть активный cron.schedule, и «не умрёт» сразу.
// Но в продакшене обычно делают:
//    pm2 start notifyUsers.js --name "daily-vpt-bot"
// чтобы процесс «жил» постоянно.
