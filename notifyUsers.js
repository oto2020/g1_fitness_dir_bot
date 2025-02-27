/**
 * notifyUsers.js
 * Запуск: node notifyUsers.js
 */

require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// Инициализируем бота (polling = false, т.к. скрипт запускается один раз)
const bot = new TelegramBot(process.env.TOKEN, { polling: false });
const GROUP_ID = process.env.GROUP_ID;


/**
 * Асинхронная функция отправки сообщения с экспоненциальным бэкоффом.
 *
 * @param {number|string} chatId - куда отправлять
 * @param {string} text - текст сообщения
 * @param {number} attempt - счётчик попыток
 * @returns {Promise<void>}
 */
async function sendMessageWithRetry(chatId, text, attempt = 1) {
  const maxAttempts = 5; // Максимальное количество повторных попыток

  try {
    await bot.sendMessage(chatId, text);
  } catch (error) {
    // Проверяем, не вернулся ли код 429 (Too Many Requests)
    if (
      (error.response && error.response.statusCode === 429) ||
      error.code === 'ETELEGRAM'
    ) {
      // ETELEGRAM может означать ряд Telegram-ошибок; для 429 обычно будет statusCode
      console.error('Получен ответ 429 или похожая ошибка:', error.message);
      const delay = Math.pow(2, attempt) * 1000; // 2^attempt * 1000 мс
      console.log(`[Rate-limit] Ждём ${delay / 1000} c перед повтором #${attempt}...`);
      await new Promise((resolve) => setTimeout(resolve, delay));

      // Если не превышен лимит попыток — повторяем
      if (attempt < maxAttempts) {
        return sendMessageWithRetry(chatId, text, attempt + 1);
      }

      // Если попыток слишком много, выбрасываем ошибку
      throw new Error(
        `Не удалось отправить сообщение в чат ${chatId} после ${maxAttempts} попыток.`
      );
    } else {
      // Любая другая ошибка — можно повторить или просто бросить исключение
      console.error(`Ошибка при отправке в чат ${chatId}:`, error.message);
      throw error;
    }
  }
}

async function main() {
  try {
    // Находим начало и конец текущего месяца
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const endOfMonth = new Date(startOfMonth);
    endOfMonth.setMonth(endOfMonth.getMonth() + 1);
    endOfMonth.setDate(0); // Возвращается к последнему дню текущего месяца
    endOfMonth.setHours(23, 59, 59, 999);

    // // Временное условие: только для пользователей с id = 45 и 57
    // const targetUsers = await prisma.user.findMany({
    //   where: {
    //     id: { in: [45, 57] },
    //   },
    // });
    const targetUsers = await prisma.user.findMany();


    // Массив для сбора "тренеров" и их количества НЕразобранных заявок
    const trainersWithNoneCount = [];

    for (const user of targetUsers) {
      // Считаем общее количество заявок (все статусы) за текущий месяц
      const totalCount = await prisma.vPTRequest.count({
        where: {
          userId: user.id,
          createdAt: {
            gte: startOfMonth,
            lte: endOfMonth,
          },
        },
      });

      // Пропускаем пользователей, у кого 0 заявок за месяц
      if (totalCount === 0) {
        continue;
      }

      // Подсчитываем по разным статусам:
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

      // Формируем сообщение с учётом найденных данных
      let personalMessage = `${user.name ?? ''} @${user.nick ?? ''},\nСтатистика по заявкам ВПТ за текущий месяц:`;
      personalMessage += `\n⏳ ${noneCount} | неразобранные`;
      personalMessage += `\n✅ ${acceptedCount} | принятые`;
      personalMessage += `\n❌ ${rejectedCount} | отклоненные`;

      // Дополнительно: если noneCount = 0, добавляем "Так держать!", иначе — "Просмотреть..."
      if (noneCount === 0) {
        personalMessage += `\nВсе ВПТ разобраны, так держать! 🎉`;
      } else {
        personalMessage += `\n\n⚠️ У вас ${noneCount} неразобранных заявок на ВПТ.\nПросмотреть и исправить: \n/vpt_none${user.telegramID}`;
      }

      // Если у пользователя есть telegramID, отправим личное сообщение
      if (user.telegramID) {
        await sendMessageWithRetry(user.telegramID, personalMessage);
      }

      // Если нужна сводка в группу для "тренеров" с ненулевым noneCount:
      if (noneCount > 0) {
        trainersWithNoneCount.push({ user, noneCount });
      }
    }

    // Сортируем "тренеров" по убыванию неразобранных заявок
    trainersWithNoneCount.sort((a, b) => b.noneCount - a.noneCount);

    // Отправляем сводку в группу, если есть хотя бы один тренер с noneCount > 0
    if (trainersWithNoneCount.length > 0) {
      let groupMessage = 'Список тренеров с ⏳ неразобранными заявками за текущий месяц:\n';
      for (const item of trainersWithNoneCount) {
        const { user, noneCount } = item;
        groupMessage += `\n- ${user.name ?? ''} @${user.nick ?? ''}: ${noneCount}`;
      }

      await sendMessageWithRetry(GROUP_ID, groupMessage);
    }

    console.log('Рассылка завершена!');
  } catch (error) {
    console.error('Ошибка в процессе рассылки:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
