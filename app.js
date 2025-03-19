const express = require('express');
const cors = require('cors');
const { PrismaClient } = require('@prisma/client');

const bodyParser = require('body-parser');

const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();

// Тот, который умеет работать с API
const BotHelper = require('./BotHelper');
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

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

// Временное хранилище для шагов регистрации
const userSteps = {};
const userMode = []

/////// КОМАНДЫ БОТА ////////

// Установка команд бота в меню
bot.setMyCommands([
    { command: '/start', description: 'Начать регистрацию / Показать анкету' },
    // { command: '/user_edit', description: 'Изменить информацию о себе' },
    { command: '/users', description: 'Список всех тренеров' }
]);

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
        if (msg.chat.id !== chatId) return; // Игнорируем сообщения от других тренеров

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
        if (msg.chat.id !== chatId) return; // Игнорируем сообщения от других тренеров

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
        if (msg.chat.id !== chatId) return; // Игнорируем сообщения от других тренеров

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
        if (msg.chat.id !== chatId) return; // Игнорируем сообщения от других тренеров

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
        if (msg.chat.id !== chatId) return; // Игнорируем фотографии от других тренеров

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

// Команда /users для вывода всех тренеров
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
    users = users.filter(user => user.telegramID)
        .sort((a, b) => a.name.localeCompare(b.name));// оставляем только тех, у кого есть telegramID и сортируем
    if (users.length === 0) {
        bot.sendMessage(chatId, 'Нет зарегистрированных тренеров.');
        return;
    }

    // Разбиваем список тренеров на группы по 30
    const usersInGroups = [];
    while (users.length > 0) {
        usersInGroups.push(users.splice(0, 30));
    }


    // Функция для отправки сообщений с задержкой
    async function sendUsersInfo(groups) {
        const totalGroups = groups.length;

        for (let i = 0; i < totalGroups; i++) {
            const group = groups[i];
            const usersInfo = group.map((user) => (
                `${user.name}\n(⏳ ${user.noneStatusVptCount} | ✅ ${user.acceptedStatusVptCount} | ❌ ${user.rejectedStatusVptCount} / 🎯: ${user.wishVptCount})\nАнкета /profile${user.telegramID}\n@${user.nick}\n`
            )).join('\n');


            // Отправляем сообщение с информацией о части группы
            const part = `${i + 1}/${totalGroups}`;
            await bot.sendMessage(chatId, `Часть ${part} тренеров:\n\n${usersInfo}\nЧасть ${part} тренеров.`);

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
    userSteps[chatId] = { step: 0, telegramID, nick };
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

// Обработка ввода текста
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;

    // Попробуем распарсить телефон и коммент
    console.log(msg.text);

    let parsedMessage = BotHelper.parseMessage(msg.text);

    if (parsedMessage?.phone) {
        const { phone, comment } = parsedMessage;
        console.log(`phone: ${phone}, comment: ${comment}`);
        await BotHelper.anketaByPhoneSearchAndGoalChoosing(phone, bot, chatId);
        return;
    }

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


// Обработка кнопок
bot.on('callback_query', async (query) => {
    let nowdatetime = new Date().toLocaleString('ru-RU', {
        timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });

    const chatId = query.message.chat.id;
    let user = await getUserByChatId(chatId);

    let [queryTheme, queryValue, queryId, clientPhone, param5] = query.data.split('@');
    // vpt request send
    if (queryTheme === 'vs') {
        // ['vs', goal, messageId, phone, trainerChatId].join('@') 
        let goal = queryValue;
        let messageId = queryId;
        let phone = clientPhone;
        let trainerChatId = param5;

        // const keyboard = query.message.reply_markup?.inline_keyboard;
        // clientPhone = '+' + BotHelper.parseMessage(clientPhone).phone;

        
        console.log(queryTheme, goal, messageId, phone, trainerChatId);

        if (goal === 'cancel') {
            await BotHelper.deleteMessage(bot, chatId, messageId);
            bot.sendMessage(chatId, `Закрыта анкета клиента +${phone}`);
        } else {
            let trainer = await BotHelper.getUserByChatId(prisma, trainerChatId);
            let inline_keyboard = [];
            inline_keyboard.push(
                [
                    { text: `✅ Отправлено ${goal} ${trainer.name}`, callback_data: 'okay' } // Здесь должена быть ссылка на заявку
                ],
                [
                    { text: "✖️ Закрыть", callback_data: ['vs', 'cancel', messageId, phone].join('@') }
                ]
            );
            await BotHelper.updateInlineKeyboard(bot, chatId, messageId, inline_keyboard);
        }
    }

    // vpt request create
    if (queryTheme === 'vc') {
        const messageId = query.message.message_id;
        const keyboard = query.message.reply_markup?.inline_keyboard;
        clientPhone = '+' + BotHelper.parseMessage(clientPhone).phone;
        console.log(queryTheme, queryValue, queryId, clientPhone);

        if (queryValue === 'cancel') {
            await BotHelper.deleteMessage(bot, chatId, messageId);
            bot.sendMessage(chatId, `Закрыта анкета клиента ${clientPhone}`);
        } else {
            let goal;
            if (queryValue === 'tz') { goal = 'ТЗ'; }
            if (queryValue === 'gp') { goal = 'ГП'; }
            if (queryValue === 'aq') { goal = 'Аква'; }

            if (goal) {
                try {
                    let phoneWithoutPlus = BotHelper.parseMessage(clientPhone)?.phone;
                    await BotHelper.anketaByPhoneTrainerChoosingToFitDir(phoneWithoutPlus, bot, chatId, prisma, goal);
                    await BotHelper.updateButtonText(bot, chatId, messageId, keyboard, query.data, `✅ ${goal} отправлена`);
                    bot.sendMessage(chatId, `Заявка клиента ${clientPhone} по ${goal} отправлена фитдиру`);
                } catch (e) {
                    bot.sendMessage(chatId, `Ошибка при отправке заявки клиента ${clientPhone}. Попробуйте позже.\n\n${e.message}`);
                }                
            }
        }
    }
    

    // перед . тема нажатой кнопки, после . значение нажатой кнопки
    if (queryTheme === 'vpt_request') {
        // Внутри любого хендлера, когда нужно проверить заявку:
        const request = await checkRequestExistence(bot, chatId, queryId);
        // Если функция вернула false — значит заявки нет или произошла ошибка
        if (!request) {
            return; // «тормозим» дальнейшее выполнение кода
        }

        if (queryValue === 'povtorno') {
            try {
                // 1. Парсим requestId
                const requestId = parseInt(queryId, 10);

                // 2. Находим заявку
                let request = await prisma.vPTRequest.findUnique({
                    where: { id: requestId },
                });
                if (!request) {
                    bot.sendMessage(chatId, 'Заявка не найдена или уже удалена.');
                    return;
                }

                // 3. Дописываем к комментарию отметку о повторе
                const updatedComment = `${request.comment}\n\n${nowdatetime}\n⚠️ Повторно!`;

                // Обновляем в базе
                request = await prisma.vPTRequest.update({
                    where: { id: requestId },
                    data: { comment: updatedComment },
                });

                // 4. Ищем владельца заявки (User), чтобы отправить ему
                const requestOwner = await prisma.user.findUnique({
                    where: { id: request.userId },
                });
                if (!requestOwner || !requestOwner.chatId) {
                    bot.sendMessage(chatId, 'Владелец заявки не найден или отсутствует chatId.');
                    return;
                }

                // 5. Отправляем заявку владельцу
                await sendSingleVPTRequestMessage(bot, requestOwner.chatId, requestOwner, requestOwner, request);

                // 5.b. Дублируем сообщение в группу без кнопок // <-- новое
                const statusText =
                    request.status === 'none'
                        ? 'неразобрано'
                        : request.status === 'accepted'
                            ? 'принято'
                            : 'отклонено';

                // Составим текст для группы (произвольно, как вам нужно)
                const groupCaption =
                    `Повторная заявка #${request.id}\n` +
                    `Цель/отдел: ${request.goal}\n` +
                    `Дата создания: ${nowdatetime}\n` +
                    `Тренер: ${requestOwner.name} (@${requestOwner.nick})\n\n` +
                    `Статус: ${statusText}\n\n` +
                    `Комментарий:\n${request.comment ?? '—'}`;

                if (request.photo) {
                    await bot.sendPhoto(process.env.GROUP_ID, request.photo, { caption: groupCaption });
                } else {
                    await bot.sendMessage(process.env.GROUP_ID, groupCaption);
                }

                // 6. Сообщаем тому, кто нажал «Повторно», что заявка отправлена
                bot.sendMessage(chatId, `Заявка #${request.id} повторно отправлена владельцу (chatId: ${requestOwner.chatId}) и продублирована в группу.`);
            } catch (err) {
                console.error('Ошибка при повторной отправке заявки:', err);
                bot.sendMessage(chatId, 'Произошла ошибка при повторной отправке заявки.');
            }
        }

        else if (queryValue === 'remove') {
            try {
                // Проверяем, что текущий пользователь (user) — админ
                if (user.role != 'админ') {
                    bot.sendMessage(chatId, 'У вас нет прав на удаление заявок.');
                    return;
                }

                // Преобразуем ID заявки
                const requestId = parseInt(queryId, 10);

                // Ищем заявку в БД
                const existingRequest = await prisma.vPTRequest.findUnique({
                    where: { id: requestId },
                });

                if (!existingRequest) {
                    bot.sendMessage(chatId, `Заявка #${requestId} не найдена или уже удалена.`);
                    return;
                }

                // Удаляем заявку
                await prisma.vPTRequest.delete({
                    where: { id: requestId },
                });

                // Уведомляем в чат, что заявка удалена
                bot.sendMessage(chatId, `Заявка #${requestId} (${existingRequest.goal}) успешно удалена администратором.`);

                // При желании можно уведомить общий чат или журнал
                // bot.sendMessage(process.env.GROUP_ID, `Админ ${user.name} удалил заявку #${requestId} (${existingRequest.goal}).`);

            } catch (error) {
                console.error('Ошибка при удалении заявки:', error);
                bot.sendMessage(chatId, 'Произошла ошибка при удалении заявки.');
            }
        }
    }
    if (queryTheme === 'vpt_status') {
        console.log(queryId);
        // Внутри любого хендлера, когда нужно проверить заявку:
        const request = await checkRequestExistence(bot, chatId, queryId);
        // Если функция вернула false — значит заявки нет или произошла ошибка
        if (!request) {
            return false; // «тормозим» дальнейшее выполнение кода
        }

        if (queryValue === 'accepted') {
            let updatedVptRequest = await updateVPTRequestStatus(queryId, 'accepted');
            console.log(updatedVptRequest);
            updatedVptRequest = await updateVPTRequestComment(queryId, `${updatedVptRequest.comment}\n\n${nowdatetime}\n✅ Взято в работу`);
            let captionText = `Отдел: ${updatedVptRequest.goal}\nКомментарий:\n${updatedVptRequest.comment}\n\nТренер: ${user.name}`;
            bot.sendPhoto(chatId, updatedVptRequest.photo, { caption: captionText });
            bot.sendPhoto(process.env.GROUP_ID, updatedVptRequest.photo, { caption: captionText });
        }
        if (queryValue === 'rejected') {
            bot.sendMessage(chatId, 'Кажется вы промахнулись... \nВы всё ещё можете принять заявку, нажав на соответствующую кнопку ✅ выше.\n\nЕсли желаете отклонить заявку -- опишите причину, почему вы отказываетесь 🙂');

            // Ожидаем ввод причины отказа
            const rejectionHandler = async (msg) => {
                if (msg.chat.id !== chatId) return; // Игнорируем сообщения от других пользователей

                const rejectionReason = msg.text.trim(); // Получаем текст отказа
                let updatedVptRequest = await updateVPTRequestStatus(queryId, 'rejected');
                updatedVptRequest = await updateVPTRequestComment(queryId, `${updatedVptRequest.comment}\n\n${nowdatetime}\n@Nadya28_97\n❌ Причина отказа: \n"${rejectionReason}"`);

                // Удаляем обработчик после получения причины
                bot.removeListener('message', rejectionHandler);

                let captionText = `Отдел: ${updatedVptRequest.goal}\nКомментарий:\n${updatedVptRequest.comment}\n\nТренер: ${user.name}`;
                bot.sendPhoto(chatId, updatedVptRequest.photo, { caption: captionText });
                bot.sendPhoto(process.env.GROUP_ID, updatedVptRequest.photo, { caption: captionText });
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
                        where: { telegramID: queryId },
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

                    bot.sendMessage(chatId, `Ваши данные успешно сохранены!\nДоступные команды:\n/profile${telegramID}, чтобы увидеть свою анкету\nТам можно будет: \n- редактировать анкету\n- обновить фото \n- установить количество желаемых ВПТ на месяц.`);
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



/// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ///

function sendVptListInlineKeyboard(bot, chatId, telegramID) {
    bot.sendMessage(chatId, 'Если вы тренер, выберите подразделения, в которых работаете и планируете проводить ВПТ.\nЕсли вы не тренер -- просто нажмите "Завершить выбор":', {
        reply_markup: {
            inline_keyboard: [
                [{ text: 'ТЗ', callback_data: [`vpt_list`, `tz`, telegramID].join('@') }],
                [{ text: 'ГП', callback_data: [`vpt_list`, `gp`, telegramID].join('@') }],
                [{ text: 'Аква', callback_data: [`vpt_list`, `aq`, telegramID].join('@') }],
                [{ text: 'Завершить регистрацию', callback_data: [`vpt_list`, `done`, telegramID].join('@') }],
            ],
        },
    });
}

// Функция для преобразования BigInt в строку
const serializeBigInt = (obj) => {
    return JSON.parse(JSON.stringify(obj, (key, value) =>
        typeof value === 'bigint' ? value.toString() : value
    ));
};

// Один общий метод
async function getAggregatedUsers({ chatId, telegramID } = {}) {
    // Формируем WHERE-условия на лету
    let conditions = [];

    if (chatId) {
        // chatId - тип number, можно обернуть в parseInt
        conditions.push(`u.chatId = ${parseInt(chatId)}`);
    }

    if (telegramID) {
        conditions.push(`u.telegramID = ${parseInt(telegramID)}`);
    }

    // Если есть условия, добавляем WHERE + объединяем через AND
    let whereClause = '';
    if (conditions.length > 0) {
        whereClause = `WHERE ${conditions.join(' AND ')}`;
    }

    // Выполняем «сырой» запрос
    // Обратите внимание: используем prisma.$queryRawUnsafe
    // или формируем «шаблонными строками» с учётом экранирования
    const results = await prisma.$queryRawUnsafe(`
      SELECT
        u.*,
        COUNT(v.id) AS factVptCount,
        SUM(CASE WHEN v.status = 'accepted' THEN 1 ELSE 0 END) AS acceptedStatusVptCount,
        SUM(CASE WHEN v.status = 'rejected' THEN 1 ELSE 0 END) AS rejectedStatusVptCount,
        SUM(
          CASE 
            WHEN v.status <> 'accepted'
              AND v.status <> 'rejected'
            THEN 1
            ELSE 0
          END
        ) AS noneStatusVptCount
      FROM User u
      LEFT JOIN VPTRequest v
        ON u.id = v.userId
        AND YEAR(v.createdAt) = YEAR(CURRENT_DATE())
        AND MONTH(v.createdAt) = MONTH(CURRENT_DATE())
      ${whereClause}
      GROUP BY u.id
    `);

    // Возвращаем массив записей (могут быть 0,1 или несколько)
    return results;
}

// «Обёртка» для получения всех пользователей:
async function getUsers() {
    // Без аргументов => нет WHERE => вернутся все пользователи
    return await getAggregatedUsers();
}

// «Обёртка» для получения одного пользователя по chatId:
async function getUserByChatId(chatId) {
    // Вызываем общий метод с параметром chatId
    const results = await getAggregatedUsers({ chatId });
    // Возвращаем 1-го, если есть
    return results.length ? results[0] : null;
}

// «Обёртка» для получения одного пользователя по telegramID:
async function getUserByTelegramID(telegramID) {
    // Вызываем общий метод
    const results = await getAggregatedUsers({ telegramID });
    // Возвращаем 1-го, если есть
    return results.length ? results[0] : null;
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

// Генерация информации о тренере
function generateUserInfo(user) {
    return `Анкета: /profile${parseInt(user.telegramID)}\n\n` +
        `${user.name} ${"@" + user.nick}\n` + `Изменить /name${parseInt(user.telegramID)}\n\n` +
        `- Дата рождения: ${user.birthday ? user.birthday.toLocaleDateString('ru-RU') : 'не указан'}\nИзменить /birthday${parseInt(user.telegramID)}\n\n` +
        `- Телефон: \n${user.phoneNumber}\n\n` +
        `- Должность: ${user.position}\nИзменить: /position${parseInt(user.telegramID)}\n\n` +
        // `- Роль: ${user.role}\nИзменить /role${parseInt(user.telegramID)}\n\n` +
        `- Подразделение: ${user.vpt_list}\nИзменить: /vpt_list${parseInt(user.telegramID)}\n\n` +

        `ЗАЯВКИ ЗА ЭТОТ МЕСЯЦ:\n` +
        `⏳ ${user.noneStatusVptCount} | неразобранные\nпросмотр: /vpt_none${parseInt(user.telegramID)}\n` +
        `✅ ${user.acceptedStatusVptCount} | принятые\nпросмотр: /vpt_accepted${parseInt(user.telegramID)}\n` +
        `❌ ${user.rejectedStatusVptCount} | отклоненные\nпросмотр: /vpt_rejected${parseInt(user.telegramID)}\n\n` +
        `🎯 ${user.wishVptCount} | запланировано ВПТ на месяц\nИзменить: /wishvptcount${parseInt(user.telegramID)}\n\n` +
        `- Фото: ${user.photo ? 'есть' : 'нет'}\nЗагрузить: /photo${parseInt(user.telegramID)}\n-------------------------\n\n`;
}


/**
 * Отправляет одно сообщение с заявкой (request) в указанный чат (chatId).
 * - Формирует текст заявки (captionText)
 * - Формирует inline-кнопки (row1, row2)
 * - Проверяет роль текущего пользователя (currentUser)
 * - Если есть фото, вызывает sendPhotoWithRetry (или bot.sendPhoto)
 * - Если нет фото, вызывает bot.sendMessage
 *
 * @param {TelegramBot} bot - Инстанс TelegramBot
 * @param {Number} chatId - Куда отправлять сообщение
 * @param {Object} currentUser - Текущий пользователь (свойства: id, role, ...)
 * @param {Object} targetUser - Владелец заявки (или тренер, чьё это объявление), поля: name, nick
 * @param {Object} request - Объект заявки (VPTRequest). Поля: id, goal, photo, comment, ...
 * @param {Function} sendPhotoWithRetry - (необязательно) функция для отправки фото с повтором при 429
 * @returns {Promise<void>}
 */
async function sendSingleVPTRequestMessage(bot, chatId, currentUser, targetUser, request, sendPhotoWithRetry = null) {
    // Шаг 1: Собираем текст сообщения
    const nowdatetime = request.createdAt.toLocaleString('ru-RU', {
        timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });

    const statusText =
        request.status === 'none'
            ? 'неразобрано'
            : request.status === 'accepted'
                ? 'принято'
                : 'отклонено';

    const captionText =
        `Заявка ${request.goal} #${request.id}\n` +
        `Тренер: ${targetUser.name} (@${targetUser.nick})\n\n` +
        `Дата создания: ${nowdatetime}\n` +
        `📞: ${request.phoneNumber}\n` +
        `Комментарий:\n${request.comment ?? '—'}\n\n` +
        `Текущий статус: ${statusText}`;

    // Шаг 2: Формируем список кнопок
    const row1 = [
        {
            text: '✅ Беру',
            callback_data: [`vpt_status`, `accepted`, request.id].join('@')
        },
        {
            text: '❌ Не беру',
            callback_data: [`vpt_status`, `rejected`, request.id].join('@')
        }
    ];
    const row2 = [
        {
            text: '⚠️ Повторно',
            callback_data: [`vpt_request`, `povtorno`, request.id].join('@')
        },
        {
            text: '🗑 Удалить',
            callback_data: [`vpt_request`, `remove`, request.id].join('@')
        }
    ];

    // Шаг 3: В зависимости от текущего пользователя (currentUser)
    // формируем окончательную inline-клавиатуру
    let inline_keyboard = [];

    // row1 — только если currentUser.id == request.userId (владелец заявки)
    if (currentUser.id == request.userId) {
        inline_keyboard.push(row1);
    }

    // row2 — только если текущий пользователь админ
    if (currentUser.role == 'админ') {
        inline_keyboard.push(row2);
    }

    // Шаг 4: Отправляем сообщение
    try {
        if (request.photo) {
            // Если есть фото и функция sendPhotoWithRetry передана —
            // используем её, иначе стандартное bot.sendPhoto
            if (typeof sendPhotoWithRetry === 'function') {
                await sendPhotoWithRetry(chatId, request.photo, captionText, {
                    reply_markup: { inline_keyboard }
                });
            } else {
                // Стандартная отправка
                await bot.sendPhoto(chatId, request.photo, {
                    caption: captionText,
                    reply_markup: { inline_keyboard }
                });
            }
        } else {
            // Если нет фото, просто sendMessage
            await bot.sendMessage(chatId, captionText, {
                reply_markup: { inline_keyboard }
            });
        }
    } catch (error) {
        console.error('Ошибка при отправке заявки:', error);
        // Можно дополнительно отправлять уведомление об ошибке
        // bot.sendMessage(chatId, 'Ошибка при отправке сообщения с заявкой.');
    }
}


// Регулярка отлавливает три варианта команд:
// /vpt_none12345, /vpt_accepted12345, /vpt_rejected12345
bot.onText(/\/vpt_(none|accepted|rejected)(\d+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const statusFromCommand = match[1];    // none|accepted|rejected
    const telegramID = match[2];          // например 5530746845

    // Получаем пользователя (кто вызывает команду)
    const currentUser = await getUserByChatId(chatId);
    if (!currentUser) {
        bot.sendMessage(chatId, 'Вы не зарегистрированы или отсутствуете в базе. Используйте /start');
        return;
    }

    // Ищем тренера, у которого заявки
    const targetUser = await getUserByTelegramID(telegramID);
    if (!targetUser) {
        bot.sendMessage(chatId, `Пользователь c telegramID ${telegramID} не найден.`);
        return;
    }

    // Получаем заявки
    let vptRequests;
    try {
        vptRequests = await prisma.vPTRequest.findMany({
            where: {
                userId: targetUser.id,
                status: statusFromCommand
            },
            orderBy: { createdAt: 'desc' }
        });
    } catch (error) {
        console.error('Ошибка при получении заявок:', error);
        bot.sendMessage(chatId, 'Произошла ошибка при получении заявок.');
        return;
    }

    if (!vptRequests || vptRequests.length === 0) {
        bot.sendMessage(chatId, `Нет заявок со статусом "${statusFromCommand}" для тренера ${targetUser.name}.`);
        return;
    }

    // Функция с экспоненциальной задержкой при 429
    async function sendPhotoWithRetry(chatId, photoFileIdOrUrl, caption, extra, maxAttempts = 5) {
        let attempt = 0;
        while (attempt < maxAttempts) {
            try {
                return await bot.sendPhoto(chatId, photoFileIdOrUrl, { caption, ...extra });
            } catch (err) {
                if (err.response && err.response.statusCode === 429) {
                    const retryAfter = err.response.body.parameters?.retry_after ?? (2 ** attempt);
                    console.warn(`Превышен лимит: повтор через ${retryAfter} секунд (попытка ${attempt + 1}/${maxAttempts})`);
                    await new Promise(res => setTimeout(res, (retryAfter + 1) * 1000));
                    attempt++;
                } else {
                    console.error('Ошибка при отправке фото:', err);
                    break; // прерываем
                }
            }
        }
        // Если все попытки исчерпаны
        bot.sendMessage(chatId, 'Не удалось отправить фото из-за лимитов или ошибок сети.');
    }

    // Отправляем заявки по одной
    for (const request of vptRequests) {
        // Внутри любого хендлера, когда нужно проверить заявку:
        const req = await checkRequestExistence(bot, chatId, request.id);
        // Если функция вернула false — значит заявки нет или произошла ошибка
        if (!req) {
            continue; // «тормозим» дальнейшее выполнение кода
        }

        await sendSingleVPTRequestMessage(bot, chatId, currentUser, targetUser, request, sendPhotoWithRetry);

        // Небольшая пауза между сообщениями, чтобы Telegram не ругался
        await new Promise(r => setTimeout(r, 500));
    }
});

async function checkRequestExistence(bot, chatId, requestId) {
    try {
        const existingRequest = await prisma.vPTRequest.findUnique({
            where: { id: parseInt(requestId) },
        });

        if (!existingRequest) {
            // Сообщаем пользователю об ошибке
            bot.sendMessage(chatId, `Заявка #${requestId} не найдена или уже удалена.`);
            return false; // Сигнализируем, что заявки нет
        }

        // Если заявка существует — возвращаем сам объект
        return existingRequest;
    } catch (error) {
        console.error('Ошибка при проверке заявки:', error);
        bot.sendMessage(chatId, `Произошла ошибка при проверке заявки #${requestId}.`);
        return false;
    }
}

app.post('/vptrequests', async (req, res) => {
    try {
        const { year, month } = req.body;
        const parsedYear = parseInt(year, 10);
        const parsedMonth = parseInt(month, 10);

        // Простая проверка корректности year и month
        if (isNaN(parsedYear) || isNaN(parsedMonth)) {
            return res.status(400).json({ error: 'Неверно указаны year или month' });
        }

        // Формируем временные границы для поиска
        const startDate = new Date(parsedYear, parsedMonth - 1, 1); // 1 число запрошенного месяца
        const endDate = new Date(parsedYear, parsedMonth, 1);       // 1 число следующего месяца (не включая)

        // Находим заявки за указанный период
        const requests = await prisma.vPTRequest.findMany({
            where: {
                createdAt: {
                    gte: startDate,
                    lt: endDate,
                },
            },
            select: {
                createdAt: true,
                goal: true,
                phoneNumber: true,
                comment: true,
                status: true,
                user: {
                    select: {
                        name: true
                    }
                }
            }
        });

        // Формируем итоговый массив для ответа
        const data = requests.map(r => ({
            createdAt: r.createdAt,
            goal: r.goal,
            name: r.user?.name ?? null, // user может быть null, если удалён/не найден
            phoneNumber: r.phoneNumber,
            comment: r.comment,
            status: r.status,
        }));

        // Отправляем массив заявок
        res.json(data);

    } catch (error) {
        console.error('Ошибка при получении VPTRequest:', error);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

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


// Стартуем сервер Express
app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});
