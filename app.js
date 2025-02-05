const express = require('express');
const cors = require('cors');
const { PrismaClient } = require('@prisma/client');

const bodyParser = require('body-parser');

const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();

const app = express();
const port = process.env.PORT;
app.use(express.json());
app.use(cors());

// Middleware для парсинга JSON и формы
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Инициализация Prisma Client
const prisma = new PrismaClient();

// Инициализация Telegram Bot
const bot = new TelegramBot(process.env.TOKEN, { polling: true });

// Функция для преобразования BigInt в строку
const serializeBigInt = (obj) => {
    return JSON.parse(JSON.stringify(obj, (key, value) =>
        typeof value === 'bigint' ? value.toString() : value
    ));
};
// Эндпоинт для получения всех пользователей
app.get('/fitdirusers', async (req, res) => {
    try {
        const users = await prisma.user.findMany();
        res.json(serializeBigInt(users));
    } catch (error) {
        console.error('Ошибка при получении пользователей:', error);
        res.status(500).json({ error: 'Не удалось получить пользователей' });
    }
});

// Установка команд бота в меню
bot.setMyCommands([
    { command: '/start', description: 'Начать регистрацию / Показать анкету' },
    // { command: '/user_edit', description: 'Изменить информацию о себе' },
    { command: '/users', description: 'Список всех тренеров' }
]);

// Временное хранилище для шагов регистрации
const userSteps = {};
const userMode = []

// Проверка наличия тренера в базе данных
async function getUserByChatId(chatId) {
    // Получаем пользователя по chatId и добавляем счетчик
    const user = await prisma.$queryRaw`
    SELECT
      u.*,
      COUNT(v.id) AS factVptCount
    FROM 
      User u
    LEFT JOIN 
      VPTRequest v 
      ON u.id = v.userId
      AND YEAR(v.createdAt) = YEAR(CURRENT_DATE())
      AND MONTH(v.createdAt) = MONTH(CURRENT_DATE())
    WHERE 
      u.chatId = ${chatId}
    GROUP BY 
      u.id
  `;
    return user.length ? user[0] : null; // Возвращаем первый найденный элемент или null
}

async function getUserByTelegramID(telegramID) {
    // Получаем пользователя по chatId и добавляем счетчик
    const user = await prisma.$queryRaw`
    SELECT
      u.*,
      COUNT(v.id) AS factVptCount
    FROM 
      User u
    LEFT JOIN 
      VPTRequest v 
      ON u.id = v.userId
      AND YEAR(v.createdAt) = YEAR(CURRENT_DATE())
      AND MONTH(v.createdAt) = MONTH(CURRENT_DATE())
    WHERE 
      u.telegramID = ${telegramID}
    GROUP BY 
      u.id
  `;
    return user.length ? user[0] : null; // Возвращаем первый найденный элемент или null
}


// Проверка наличия тренера в базе данных
async function getUserByTelegramID(telegramID) {
    const user = await prisma.user.findUnique({
        where: { telegramID: parseInt(telegramID) },
    });
    return user;
}

async function getUsers() {
    // Получаем всех пользователей и добавляем счетчик
    const users = await prisma.$queryRaw`
    SELECT
      u.*,
      COUNT(v.id) AS factVptCount
    FROM 
      User u
    LEFT JOIN 
      VPTRequest v 
      ON u.id = v.userId
      AND YEAR(v.createdAt) = YEAR(CURRENT_DATE())
      AND MONTH(v.createdAt) = MONTH(CURRENT_DATE())
    GROUP BY 
      u.id
  `;

    // Теперь можно использовать usersWithCounts
    return users;
}

// Обработка команды /profiletelegramID
bot.onText(/\/profile(.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const telegramID = match[1]; // Получаем никнейм из команды
    
    userMode[chatId] = 'oneField';
    

    // Проверяем, если тренер отправил команду с никнеймом
    if (!telegramID) {
        bot.sendMessage(chatId, 'telegramID тренера не указан. Пожалуйста, используйте формат: /profiletelegramID');
        return;
    }

    // Ищем тренера по telegramID
    const user = await getUserByTelegramID(telegramID);

    if (!user) {
        bot.sendMessage(chatId, `тренер с telegramID ${telegramID} не найден.`);
        return;
    }

    // Генерируем информацию о тренере
    const userInfo = generateUserInfo(user);

    // Отправляем информацию о тренере
    if (user.photo) {
        bot.sendPhoto(chatId, user.photo, { caption: userInfo });
    } else {
        bot.sendMessage(chatId, userInfo);
    }
});

bot.onText(/\/name(.*)/, async (msg, match) => {
    const chatId = msg.chat.id;
    userMode[chatId] = 'oneField';
    const telegramID = match[1].trim(); // Получаем telegramID из команды

    // Проверяем, если тренер отправил команду с telegramID
    if (!telegramID) {
        bot.sendMessage(chatId, 'telegramID тренера не указан. Пожалуйста, используйте формат: /updateName telegramID');
        return;
    }

    // Ищем тренера по telegramID
    const user = await getUserByTelegramID(telegramID);

    if (!user) {
        bot.sendMessage(chatId, `тренер с telegramID ${telegramID} не найден.`);
        return;
    }

    // Запрашиваем новое ФИО у тренера
    bot.sendMessage(chatId, `Пожалуйста, введите новое ФИО для тренера ${user.name}.`);

    // Ожидаем получения текста с новым ФИО
    const nameHandler = (msg) => {
        if (msg.chat.id !== chatId) return; // Игнорируем сообщения от других тренерей

        const newName = msg.text.trim(); // Получаем новое имя из сообщения

        // Проверяем, что новое ФИО не пустое
        if (!newName) {
            bot.sendMessage(chatId, 'ФИО не может быть пустым. Попробуйте снова.');
            return;
        }

        // Удаляем обработчик после первого срабатывания
        bot.removeListener('message', nameHandler);

        // Обновляем ФИО тренера
        prisma.user.update({
            where: { telegramID: parseInt(telegramID) },
            data: {
                name: newName, // Обновляем поле `name`
            },
        })
            .then(() => {
                bot.sendMessage(chatId, `ФИО тренера ${user.name} успешно обновлено на "${newName}".\nПросмотр: /profile${parseInt(user.telegramID)}`);
                bot.sendMessage(process.env.GROUP_ID, `Обновлено ФИО тренера ${user.name}:\nНовое ФИО: "${newName}"\nПросмотр: /profile${parseInt(user.telegramID)}`);
            })
            .catch((error) => {
                console.error('Ошибка при обновлении ФИО:', error);
                bot.sendMessage(chatId, 'Произошла ошибка при обновлении ФИО.');
            });
    };

    // Добавляем обработчик для получения нового ФИО
    bot.on('message', nameHandler);
});

bot.onText(/\/role(.*)/, async (msg, match) => {
    const chatId = msg.chat.id;
    userMode[chatId] = 'updateRole';
    const telegramID = match[1].trim(); // Получаем telegramID из команды

    // Проверяем, если тренер отправил команду с telegramID
    if (!telegramID) {
        bot.sendMessage(chatId, 'telegramID тренера не указан. Пожалуйста, используйте формат: /updateRole telegramID');
        return;
    }

    // Ищем тренера по telegramID
    const user = await getUserByTelegramID(telegramID);

    if (!user) {
        bot.sendMessage(chatId, `тренер с telegramID ${telegramID} не найден.`);
        return;
    }

    let currentUser = await getUserByChatId(chatId);
    // Проверяем роль тренера
    if (!currentUser || currentUser.role !== 'админ') {
        bot.sendMessage(chatId, '❌ ' + currentUser.name + ', у вас недостаточно прав для выполнения этой команды.\n' + 'Ваша роль: ' + currentUser.role);
        return;
    }

    // Запрашиваем новую роль у тренера
    bot.sendMessage(chatId, `Пожалуйста, введите новую роль для тренера ${user.name}. Возможные варианты: тренер, редактор, админ.`);

    // Ожидаем получения текста с новой ролью
    const roleHandler = (msg) => {
        if (msg.chat.id !== chatId) return; // Игнорируем сообщения от других тренерей

        const newRole = msg.text.trim().toLowerCase(); // Получаем новую роль из сообщения и переводим в нижний регистр

        // Список допустимых ролей
        const validRoles = ['тренер', 'редактор', 'админ'];

        // Проверяем, что роль является корректной
        if (!validRoles.includes(newRole)) {
            bot.sendMessage(chatId, 'Указана некорректная роль. Допустимые варианты: тренер, редактор, админ. Попробуйте снова.');
            return;
        }

        // Удаляем обработчик после первого срабатывания
        bot.removeListener('message', roleHandler);

        // Обновляем роль тренера
        prisma.user.update({
            where: { telegramID: parseInt(telegramID) },
            data: {
                role: newRole, // Обновляем поле `role`
            },
        })
            .then(() => {
                bot.sendMessage(chatId, `Роль тренера ${user.name} успешно обновлена на "${newRole}".`);
                bot.sendMessage(process.env.GROUP_ID, `Обновлена роль тренера ${user.name}:
Новая роль: "${newRole}".`);
            })
            .catch((error) => {
                console.error('Ошибка при обновлении роли:', error);
                bot.sendMessage(chatId, 'Произошла ошибка при обновлении роли.');
            });
    };

    // Добавляем обработчик для получения новой роли
    bot.on('message', roleHandler);
});


bot.onText(/\/position(.*)/, async (msg, match) => {
    const chatId = msg.chat.id;
    userMode[chatId] = 'oneField';
    const telegramID = match[1].trim(); // Получаем telegramID из команды

    // Проверяем, если тренер отправил команду с telegramID
    if (!telegramID) {
        bot.sendMessage(chatId, 'telegramID тренера не указан. Пожалуйста, используйте формат: /position telegramID');
        return;
    }

    // Ищем тренера по telegramID
    const user = await getUserByTelegramID(telegramID);

    if (!user) {
        bot.sendMessage(chatId, `тренер с telegramID ${telegramID} не найден.`);
        return;
    }

    // Запрашиваем новую должность у тренера
    bot.sendMessage(chatId, `Пожалуйста, введите новую должность для тренера ${user.name}.`);

    // Ожидаем получения текста с новой должностью
    const positionHandler = (msg) => {
        if (msg.chat.id !== chatId) return; // Игнорируем сообщения от других тренерей

        const newPosition = msg.text.trim(); // Получаем новую должность из сообщения

        // Проверяем, что должность не пустая
        if (!newPosition) {
            bot.sendMessage(chatId, 'Должность не может быть пустой. Попробуйте снова.');
            return;
        }

        // Удаляем обработчик после первого срабатывания
        bot.removeListener('message', positionHandler);

        // Обновляем должность тренера
        prisma.user.update({
            where: { telegramID: parseInt(telegramID) },
            data: {
                position: newPosition, // Обновляем поле `position`
            },
        })
            .then(() => {
                bot.sendMessage(chatId, `Должность тренера ${user.name} успешно обновлена на "${newPosition}".\nПросмотр: /profile${parseInt(user.telegramID)}`);
                bot.sendMessage(process.env.GROUP_ID, `Обновлена должность тренера ${user.name}:\nНовая должность: "${newPosition}"\nПросмотр: /profile${parseInt(user.telegramID)}`);
            })
            .catch((error) => {
                console.error('Ошибка при обновлении должности:', error);
                bot.sendMessage(chatId, 'Произошла ошибка при обновлении должности.');
            });
    };

    // Добавляем обработчик для получения новой должности
    bot.on('message', positionHandler);
});

bot.onText(/\/vpt_list(.*)/, async (msg, match) => {
    const chatId = msg.chat.id;
    userMode[chatId] = 'oneField';
    const telegramID = match[1].trim(); // Получаем telegramID из команды

    // Проверяем, если тренер отправил команду с telegramID
    if (!telegramID) {
        bot.sendMessage(chatId, 'telegramID тренера не указан. Пожалуйста, используйте формат: /position telegramID');
        return;
    }

    // Ищем тренера по telegramID
    const user = await getUserByTelegramID(telegramID);

    if (!user) {
        bot.sendMessage(chatId, `тренер с telegramID ${telegramID} не найден.`);
        return;
    }

    // Запрашиваем новую должность у тренера
    bot.sendMessage(chatId, `Пожалуйста, выберите проводимые ВПТ из списка ниже для ${user.name}.`);

    // chatId это в каком чате нажата кнопка, telegramID это к какому тренеру относится
    sendVptListInlineKeyboard(bot, chatId, telegramID);

});

bot.onText(/\/birthday(.*)/, async (msg, match) => {
    const chatId = msg.chat.id;
    userMode[chatId] = 'oneField';
    const telegramID = match[1].trim(); // Получаем telegramID из команды

    // Проверяем, если тренер отправил команду с telegramID
    if (!telegramID) {
        bot.sendMessage(chatId, 'telegramID тренера не указан. Пожалуйста, используйте формат: /birthday telegramID');
        return;
    }

    // Ищем тренера по telegramID
    const user = await getUserByTelegramID(telegramID);

    if (!user) {
        bot.sendMessage(chatId, `тренер с telegramID ${telegramID} не найден.`);
        return;
    }

    // Запрашиваем новую дату рождения у тренера
    bot.sendMessage(chatId, `Пожалуйста, введите новую дату рождения для тренера ${user.name} в формате: dd.mm.yyyy`);

    // Ожидаем получения текста с новой датой рождения
    const birthdayHandler = (msg) => {
        if (msg.chat.id !== chatId) return; // Игнорируем сообщения от других тренерей

        const birthday = msg.text.trim(); // Получаем дату рождения из сообщения

        // Проверяем формат даты рождения
        const birthdayRegex = /^(\d{2})\.(\d{2})\.(\d{4})$/;
        if (!birthdayRegex.test(birthday)) {
            bot.sendMessage(chatId, 'Некорректный формат даты. Пожалуйста, введите дату в формате: dd.mm.yyyy');
            return; // Оставляем обработчик активным для повторного ввода
        }

        // Удаляем обработчик после успешной проверки
        bot.removeListener('message', birthdayHandler);

        const [day, month, year] = birthday.split('.'); // Разделяем дату
        const isoBirthday = new Date(`${year}-${month}-${day}`).toISOString(); // Преобразуем в формат ISO
        // Обновляем дату рождения тренера
        prisma.user.update({
            where: { telegramID: parseInt(telegramID) },
            data: {
                birthday: isoBirthday, // Обновляем поле `birthday`
            },
        })
            .then(() => {
                bot.sendMessage(chatId, `Дата рождения тренера ${user.name} успешно обновлена на "${birthday}".\nПросмотр: /profile${parseInt(user.telegramID)}`);
                bot.sendMessage(process.env.GROUP_ID, `Обновлена дата рождения тренера ${user.name}:\nНовая дата: "${birthday}"\nПросмотр: /profile${parseInt(user.telegramID)}`);
            })
            .catch((error) => {
                console.error('Ошибка при обновлении даты рождения:', error);
                bot.sendMessage(chatId, 'Произошла ошибка при обновлении даты рождения.');
            });
    };

    // Добавляем обработчик для получения новой даты рождения
    bot.on('message', birthdayHandler);
});

bot.onText(/\/photo(.*)/, async (msg, match) => {
    const chatId = msg.chat.id;
    userMode[chatId] = 'oneField';
    const telegramID = match[1]; // Получаем тг ид из команды

    // Проверяем, если тренер отправил команду с никнеймом
    if (!telegramID) {
        bot.sendMessage(chatId, 'telegramID тренера не указан. Пожалуйста, используйте формат: /phototelegramID');
        return;
    }

    // Ищем тренера по telegramID
    const user = await getUserByTelegramID(telegramID);

    if (!user) {
        bot.sendMessage(chatId, `тренер с telegramID ${telegramID} не найден.`);
        return;
    }

    // Запрашиваем новое фото у тренера
    bot.sendMessage(chatId, `Пожалуйста, отправьте новое фото для тренера ${user.name}.`);

    // Ожидаем получения фотографии, только если сообщение от того же тренера, который запросил обновление
    const photoHandler = (msg) => {
        if (msg.chat.id !== chatId) return; // Игнорируем фотографии от других тренерей

        const fileId = msg.photo[msg.photo.length - 1].file_id; // Получаем file_id самой большой фотографии

        // Удаляем обработчик после первого срабатывания
        bot.removeListener('photo', photoHandler);

        // Обновляем фото тренера
        prisma.user.update({
            where: { chatId: user.chatId },
            data: {
                photo: fileId, // Сохраняем новое фото (file_id)
            },
        })
            .then(() => {
                bot.sendMessage(chatId, `Обновлено фото тренера ${user.name} успешно обновлено!\nПросмотр: /profile${parseInt(user.telegramID)}`);
                bot.sendMessage(process.env.GROUP_ID, `Обновлено фото тренера ${user.name}:\nПросмотр: /profile${parseInt(user.telegramID)}`);
            })
            .catch((error) => {
                console.error('Ошибка при обновлении фото:', error);
                bot.sendMessage(chatId, 'Произошла ошибка при обновлении фото.');
            });
    };

    // Добавляем обработчик для получения фото
    bot.on('photo', photoHandler);
});

bot.onText(/\/wishvptcount(.*)/, async (msg, match) => {
    const chatId = msg.chat.id;
    userMode[chatId] = 'oneField';
    const telegramID = match[1].trim();

    // Проверка наличия telegramID в команде
    if (!telegramID) {
        bot.sendMessage(chatId, 'Укажите telegramID тренера в формате: /wishvptcount123456');
        return;
    }

    // Поиск целевого тренера
    const targetUser = await getUserByTelegramID(telegramID);

    if (!targetUser) {
        bot.sendMessage(chatId, `тренер с ID ${telegramID} не найден`);
        return;
    }

    // Запрос нового значения
    bot.sendMessage(chatId, `Введите новое количество желаемых ВПТ на месяц для тренера ${targetUser.name} (целое число):`);

    // Обработчик ответа
    const wishHandler = async (msg) => {
        if (msg.chat.id !== chatId) return;

        const newValue = msg.text.trim();
        
        // Валидация числа
        if (!/^\d+$/.test(newValue)) {
            bot.sendMessage(chatId, 'Некорректный формат. Введите целое число (например: 5)');
            return;
        }

        bot.removeListener('message', wishHandler);

        try {
            // Обновление записи
            await prisma.user.update({
                where: { telegramID: parseInt(telegramID) },
                data: { wishVptCount: parseInt(newValue) },
            });

            // Отправка подтверждения
            bot.sendMessage(chatId, `Желаемое количество ВПТ на месяц для ${targetUser.name} обновлено на: ${newValue}\nПросмотр: /profile${telegramID}`);
            bot.sendMessage(process.env.GROUP_ID, `Обновлено желаемое количество ВПТ на месяц для ${targetUser.name}:\nНовое значение: ${newValue}\nПросмотр: /profile${telegramID}`);
        } catch (error) {
            console.error('Ошибка обновления:', error);
            bot.sendMessage(chatId, '❌ Ошибка при обновлении данных');
        }
    };

    bot.on('message', wishHandler);
});

// Команда /users для вывода всех тренерей
bot.onText(/\/users/, async (msg) => {
    const chatId = msg.chat.id;

    const user = await getUserByChatId(chatId);

    // Проверяем роль тренера
    if (!user || user.role !== 'админ') {
        bot.sendMessage(chatId, '❌ ' + user.name + ', у вас недостаточно прав для выполнения этой команды.\n' + 'Ваша роль: ' + user.role);
        return;
    }

    if (!user) {
        bot.sendMessage(chatId, 'Вы не зарегистрированы. Используйте /start для регистрации.');
        return;
    }

    let users = await getUsers();
    users = users.filter(user => user.telegramID);// оставляем только тех, у кого есть telegramID
    if (users.length === 0) {
        bot.sendMessage(chatId, 'Нет зарегистрированных тренерей.');
        return;
    }

    // Разбиваем список тренерей на группы по 15
    const usersInGroups = [];
    while (users.length > 0) {
        usersInGroups.push(users.splice(0, 15));
    }


    // Функция для отправки сообщений с задержкой
    async function sendUsersInfo(groups) {
        const totalGroups = groups.length;

        for (let i = 0; i < totalGroups; i++) {
            const group = groups[i];
            const usersInfo = group.map((user) => (`${user.name} (${user.factVptCount}/${user.wishVptCount}) @${user.nick}\nАнкета /profile${user.telegramID}\n`)).join('\n');

            // Отправляем сообщение с информацией о части группы
            const part = `${i + 1}/${totalGroups}`;
            await bot.sendMessage(chatId, `Часть ${part} тренерей:\n\n${usersInfo}\nЧасть ${part} тренерей.`);

            // Задержка между сообщениями (например, 2 секунды)
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }

    // Отправляем тренерам информацию в группах
    sendUsersInfo(usersInGroups);
});

bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const telegramID = msg.from.id; // ID тренера в Telegram
    const nick = msg.from.username || 'Нет никнейма'; // Никнейм тренера

    // console.log(msg);
    // Проверяем, зарегистрирован ли тренер
    const user = await getUserByChatId(chatId);

    // нет тренера или отсутствуют его telegramID или отсутствует его ДР - заново запускаем процесс регистрации
    if (user && user.telegramID && user.birthday) {
        // console.log(user);

        // Генерация информации о тренере
        const userInfo = generateUserInfo(user);

        // Отправка фото (если оно есть)
        if (user.photo) {
            bot.sendPhoto(chatId, user.photo, { caption: userInfo });
        } else {
            bot.sendMessage(chatId, userInfo);
        }
        bot.sendMessage(chatId, `Вы уже зарегистрированы.`);
        return;
    }

    // Начлао регистрации
    // Сохраняем временные данные о тренере
    userSteps[chatId] = { step: 0, telegramID, nick};
    userMode[chatId] = 'userEdit';
    bot.sendMessage(chatId, 'Для начала, пожалуйста, поделитесь своим контактом. Нужно нажать кнопку "Поделиться контактом" в клавиатуре бота ниже.', {
        reply_markup: {
            keyboard: [
                [{ text: 'Поделиться контактом', request_contact: true }]
            ],
            one_time_keyboard: true
        }
    });
});

bot.on('contact', async (msg) => {
    const chatId = msg.chat.id;
    userMode[chatId] = 'userEdit';
    const contact = msg.contact;

    if (userSteps[chatId]?.step === 0) {
        const phoneNumber = contact.phone_number.replace('+', '');
        userSteps[chatId].phoneNumber = phoneNumber; // Сохраняем номер телефона
        userSteps[chatId].telegramID = msg.from.id; // Сохраняем telegramID
        userSteps[chatId].nick = msg.from.username || 'нет'; // Сохраняем nick
        userSteps[chatId].step = 1;

        bot.sendMessage(chatId, 'Спасибо за контакт! Теперь, пожалуйста, введите ваше ФИО:');
    }
});

// Обработка ввода должности
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;

    if (!userSteps[chatId]) {
        return;
    }

    const step = userSteps[chatId].step;

    if (step === 1 && msg.text) {
        userSteps[chatId].name = msg.text;
        userSteps[chatId].step = 2;

        bot.sendMessage(chatId, 'Теперь введите вашу должность\nТренер/Руководитель подразделения/Директор');
    } else if (step === 2 && msg.text) {
        userSteps[chatId].position = msg.text;
        userSteps[chatId].step = 3;

        bot.sendMessage(chatId, 'Введите вашу дату рождения (например, 01.01.2000):');
    } else if (step === 3 && msg.text) {
        const birthday = msg.text;

        // Проверяем формат даты рождения
        const birthdayRegex = /^(\d{2})\.(\d{2})\.(\d{4})$/;
        if (!birthdayRegex.test(birthday)) {
            bot.sendMessage(chatId, 'Некорректный формат даты. Пожалуйста, введите дату в формате: dd.mm.yyyy');
            return;
        }

        userSteps[chatId].birthday = birthday;
        userSteps[chatId].step = 4;

        sendVptListInlineKeyboard(bot, chatId, userSteps[chatId].telegramID);
    }
});

function sendVptListInlineKeyboard(bot, chatId, telegramID) {
    bot.sendMessage(chatId, 'Если вы тренер, выберите подразделения, в которых работаете и планируете проводить ВПТ.\nЕсли вы не тренер -- просто нажмите "Завершить выбор":', {
        reply_markup: {
            inline_keyboard: [
                [{ text: 'ТЗ', callback_data: `vpt_list@tz@${telegramID}` }],
                [{ text: 'ГП', callback_data: `vpt_list@gp@${telegramID}` }],
                [{ text: 'Аква', callback_data: `vpt_list@aq@${telegramID}` }],
                [{ text: 'Завершить выбор', callback_data: `vpt_list@done@${telegramID}` }],
            ],
        },
    });
}


async function updateVPTRequestStatus(requestId, newStatus) {
    try {  
      // Обновляем статус заявки
      const updatedRequest = await prisma.vPTRequest.update({
        where: { id: requestId },
        data: { status: newStatus },
      });
  
      console.log(`Статус заявки ID ${requestId} обновлен на ${newStatus}`);
      return updatedRequest;
    } catch (error) {
      console.error('Ошибка при обновлении статуса заявки:', error);
    }
  }

  async function updateVPTRequestComment(requestId, newComment) {
    try {  
      // Обновляем статус заявки
      const updatedRequest = await prisma.vPTRequest.update({
        where: { id: requestId },
        data: { comment: newComment },
      });
  
      console.log(`Комментарий заявки ID ${requestId} обновлен на ${newComment}`);
      return updatedRequest;
    } catch (error) {
      console.error('Ошибка при обновлении статуса заявки:', error);
    }
  }


// Обработка выбора должностей
bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    let user = await getUserByChatId(chatId);

    let queryTheme = query.data.split('@')[0];
    let queryValue = query.data.split('@')[1];
    let queryId = query.data.split('@')[2];
    // перед @ тема нажатой кнопки, после @ значение нажатой кнопки
    if (queryTheme === 'vpt_status') {
        console.log(queryId);
        if (queryValue === 'accepted') {
            let updatedVptRequest = await updateVPTRequestStatus(queryId, 'accepted');
            console.log(updatedVptRequest);
            updatedVptRequest = await updateVPTRequestComment(queryId, `Отдел: ${updatedVptRequest.goal}\nКомментарий: ${updatedVptRequest.comment}\n✅ Взято в работу\nТренер: ${user.name}`);
            bot.sendPhoto(chatId, updatedVptRequest.photo, { caption: updatedVptRequest.comment });
            bot.sendPhoto(process.env.GROUP_ID, updatedVptRequest.photo, { caption: updatedVptRequest.comment });
        }
        if (queryValue === 'rejected') {
            bot.sendMessage(chatId, 'Кажется вы промахнулись... \nВы всё ещё можете принять заявку, нажав на соответствующую кнопку ✅ выше.\n\nЕсли желаете отклонить заявку -- опишите причину, почему вы отказываетесь 🙂');
        
            // Ожидаем ввод причины отказа
            const rejectionHandler = async (msg) => {
                if (msg.chat.id !== chatId) return; // Игнорируем сообщения от других пользователей

                const rejectionReason = msg.text.trim(); // Получаем текст отказа
                let updatedVptRequest = await updateVPTRequestStatus(queryId, 'rejected');
                updatedVptRequest = await updateVPTRequestComment(queryId, `Отдел: ${updatedVptRequest.goal}\nКомментарий: ${updatedVptRequest.comment}\n❌ Причина отказа: \n"${rejectionReason}".\nТренер: ${user.name}`);

                // Удаляем обработчик после получения причины
                bot.removeListener('message', rejectionHandler);
                
                bot.sendPhoto(chatId, updatedVptRequest.photo, { caption: updatedVptRequest.comment });
                bot.sendPhoto(process.env.GROUP_ID, updatedVptRequest.photo, { caption: updatedVptRequest.comment });
            }

            // Добавляем обработчик для получения причины отказа
            bot.on('message', rejectionHandler);
        
        }
    }
    if (queryTheme === 'vpt_list') {
        let selection = '';
        if (queryValue === 'tz') {
            selection = 'ТЗ';
        }
        if (queryValue === 'gp') {
            selection = 'ГП';
        }
        if (queryValue === 'aq') {
            selection = 'Аква';
        }

        if (!userSteps[chatId]) {
            userSteps[chatId] = {};
        }
        if (!userSteps[chatId].selections) {
            userSteps[chatId].selections = [];
        }

        // Если выбор не сделан, добавляем его в список
        if (queryValue !== 'done' && !userSteps[chatId].selections.includes(selection)) {
            userSteps[chatId].selections.push(selection);
        }

        if (queryValue === 'done') {
            // кнопка "Завершить выбор" была нажата в режиме редактирования одного поля, а не завершения регистрации
            if (userMode[chatId] === 'oneField') {
                let vpt_list = userSteps[chatId].selections.join(', ');
                // Обновляем проводимые ВПТ тренера
                prisma.user.update({
                    where: { telegramID: parseInt(queryId) },
                    data: {
                        vpt_list: vpt_list, // Обновляем поле `vpt_list`
                    },
                })
                    .then(async () => {                        
                        let modifiedUser = await getUserByTelegramID(queryId);

                        bot.sendMessage(chatId, `Проводимые ВПТ тренера ${modifiedUser.name} успешно обновлены на "${vpt_list}".\nПросмотр: /profile${parseInt(queryId)}`);
                        bot.sendMessage(process.env.GROUP_ID, `Обновлены проводимые ВПТ тренера ${modifiedUser.name}:\nНовые проводимые ВПТ: "${vpt_list}"\nПросмотр: /profile${parseInt(queryId)}`);
                    })
                    .catch((error) => {
                        console.error('Ошибка при обновлении проводимых ВПТ:', error);
                        bot.sendMessage(chatId, 'Произошла ошибка при обновлении проводимых ВПТ.');
                    });
                    
                delete userMode[chatId]; 
                delete userSteps[chatId];
            } 
            if (userMode[chatId] === 'userEdit') {
                const { name, position, selections, phoneNumber, telegramID, nick, birthday } = userSteps[chatId];
                const vpt_list = `${selections.map((sel) => `${sel}`).join(', ')}`;
                const timestamp = new Date();

                const [day, month, year] = birthday.split('.'); // Разделяем дату
                const isoBirthday = new Date(`${year}-${month}-${day}`).toISOString(); // Преобразуем в формат ISO

                try {
                    await prisma.user.upsert({
                        where: { telegramID:queryId },
                        update: {
                            name,
                            phoneNumber,
                            position: position,
                            vpt_list: vpt_list,
                            nick,
                            telegramID,
                            timestamp,
                            birthday: isoBirthday, // Добавляем дату рождения
                        },
                        create: {
                            chatId,
                            telegramID,
                            nick,
                            name,
                            phoneNumber,
                            position: position,
                            vpt_list: vpt_list,
                            birthday: isoBirthday, // Добавляем дату рождения
                        },
                    });

                    bot.sendMessage(chatId, `Ваши данные успешно сохранены!\nДоступные команды:\n/profile${telegramID}, чтобы увидеть свою анкету,\n/photo${telegramID}, чтобы установить фотографию,\n/user_edit, чтобы редактировать профиль.`);
                    bot.sendMessage(process.env.GROUP_ID, `Сохранена анкета тренера ${name}:\n Просмотр: /profile${telegramID}`);

                } catch (error) {
                    console.error('Ошибка при сохранении данных:', error);
                    bot.sendMessage(chatId, 'Произошла ошибка при сохранении данных.');
                }

                delete userSteps[chatId];
            }

        } else {
            bot.sendMessage(chatId, `Вы выбрали: ${userSteps[chatId].selections.join(', ')}`);
        }
    }
});

// Генерация информации о тренере
function generateUserInfo(user) {
    return `Анкета: /profile${parseInt(user.telegramID)}\n\n` +
        `${user.name} (${user.factVptCount}/${user.wishVptCount}) ${"@" + user.nick}\n` + `Изменить /name${parseInt(user.telegramID)}\n\n` +
        `- Телефон: \n${user.phoneNumber}\n\n` +
        `- Должность: ${user.position}\nИзменить /position${parseInt(user.telegramID)}\n\n` +
        `- Роль: ${user.role}\nИзменить /role${parseInt(user.telegramID)}\n\n` +
        `- Проводимые ВПТ: ${user.vpt_list}\nИзменить /vpt_list${parseInt(user.telegramID)}\n\n` +
        `- Дата рождения: ${user.birthday ? user.birthday.toLocaleDateString('ru-RU') : 'не указан'}\nИзменить /birthday${parseInt(user.telegramID)}\n\n` +
        `- Желаемых ВПТ на месяц: ${user.wishVptCount}\nИзменить /wishvptcount${parseInt(user.telegramID)}\n\n` +
        `- Фото: ${user.photo ? 'есть' : 'нет'}\nИзменить /photo${parseInt(user.telegramID)}\n-------------------------\n\n`;
}




// Стартуем сервер Express
app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});
