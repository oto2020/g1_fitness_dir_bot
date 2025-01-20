const express = require('express');
const bodyParser = require('body-parser');
const { PrismaClient } = require('@prisma/client');
const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();

const app = express();
const port = process.env.PORT;

// Middleware для парсинга JSON и формы
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Инициализация Prisma Client
const prisma = new PrismaClient();

// Инициализация Telegram Bot
const bot = new TelegramBot(process.env.TOKEN, { polling: true });

// Установка команд бота в меню
bot.setMyCommands([
    { command: '/start', description: 'Начать регистрацию / Показать анкету' },
    { command: '/user_edit', description: 'Изменить информацию о себе' },
    { command: '/users', description: 'Список всех пользователей' }
]);

// Временное хранилище для шагов регистрации
const userSteps = {};

// Проверка наличия пользователя в базе данных
async function checkUser(chatId) {
    const user = await prisma.user.findUnique({
        where: { chatId: chatId },
    });
    return user;
}

bot.onText(/\/photo(.*)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const telegramID = match[1]; // Получаем тг ид из команды

    // Проверяем, если пользователь отправил команду с никнеймом
    if (!telegramID) {
        bot.sendMessage(chatId, 'telegramID пользователя не указан. Пожалуйста, используйте формат: /phototelegramID');
        return;
    }

    // Ищем пользователя по telegramID
    const user = await prisma.user.findUnique({
        where: { telegramID: parseInt(telegramID) },
    });

    if (!user) {
        bot.sendMessage(chatId, `Пользователь с telegramID ${telegramID} не найден.`);
        return;
    }

    // Запрашиваем новое фото у пользователя
    bot.sendMessage(chatId, `Пожалуйста, отправьте новое фото для пользователя ${user.name}.`);

    // Ожидаем получения фотографии
    bot.once('photo', async (msg) => {
        const fileId = msg.photo[msg.photo.length - 1].file_id; // Получаем file_id самой большой фотографии

        try {
            // Обновляем фото пользователя
            await prisma.user.update({
                where: { chatId: user.chatId },
                data: {
                    photo: fileId, // Сохраняем новое фото (file_id)
                },
            });

            bot.sendMessage(chatId, `Фото для пользователя ${user.name} успешно обновлено!`);
            bot.sendMessage(process.env.GROUP_ID, `Обновлено фото пользователя ${user.name}:\n Просмотр: /profile${parseInt(user.telegramID)}`);
        } catch (error) {
            console.error('Ошибка при обновлении фото:', error);
            bot.sendMessage(chatId, 'Произошла ошибка при обновлении фото.');
        }
    });
});




// Команда /user_edit
bot.onText(/\/user_edit/, async (msg) => {
    const chatId = msg.chat.id;

    // Проверяем, зарегистрирован ли пользователь
    const user = await checkUser(chatId);
    
    if (!user) {
        bot.sendMessage(chatId, 'Вы не зарегистрированы. Используйте /start для регистрации.');
        return;
    }

    // Инициализация шагов редактирования пользователя
    userSteps[chatId] = { step: 0, name: user.name, position: user.position, phoneNumber: user.phoneNumber };

    // Запросить контакт
    bot.sendMessage(chatId, 'Нажмите на кнопку "☎️ Поделиться контактом"\n\nОна большая, снизу, в клавиатуре бота. Если клавиатура бота скрыта её можно раскрыть, нажав на кнопку показа клавиатуры, слева от отправки голосовых сообщений и emojii.', {
        reply_markup: {
            keyboard: [
                [{ text: '☎️ Поделиться контактом', request_contact: true }]
            ],
            one_time_keyboard: true
        }
    });
});

// Обработка команды /profiletelegramID
bot.onText(/\/profile(.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const telegramID = match[1]; // Получаем никнейм из команды

    // Проверяем, если пользователь отправил команду с никнеймом
    if (!telegramID) {
        bot.sendMessage(chatId, 'telegramID пользователя не указан. Пожалуйста, используйте формат: /profiletelegramID');
        return;
    }

    // Ищем пользователя по telegramID
    const user = await prisma.user.findUnique({
        where: { telegramID: parseInt(telegramID) },
    });

    if (!user) {
        bot.sendMessage(chatId, `Пользователь с telegramID ${telegramID} не найден.`);
        return;
    }

    // Генерируем информацию о пользователе
    const userInfo = generateUserInfo(user);

    // Отправляем информацию о пользователе
    if (user.photo) {
        bot.sendPhoto(chatId, user.photo, { caption: userInfo });
    } else {
        bot.sendMessage(chatId, userInfo);
    }
});

// Команда /users для вывода всех пользователей
bot.onText(/\/users/, async (msg) => {
    const chatId = msg.chat.id;

    const user = await checkUser(chatId);

    if (user.nick!=="igo4ek"&& user.nick!=="Nadya28_97") {
        bot.sendMessage(chatId, `У вас недостаточно прав для выполнения этой команды.\nВы можете просмотреть только свою анкету: /profile${parseInt(user.telegramID)}`);
        return;
    }
    if (!user) {
        bot.sendMessage(chatId, 'Вы не зарегистрированы. Используйте /start для регистрации.');
        return;
    }

    let users = await prisma.user.findMany();
    users = users.filter(user=>user.telegramID);// оставляем только тех, у кого есть telegramID
    if (users.length === 0) {
        bot.sendMessage(chatId, 'Нет зарегистрированных пользователей.');
        return;
    }

    // Разбиваем список пользователей на группы по 10
    const usersInGroups = [];
    while (users.length > 0) {
        usersInGroups.push(users.splice(0, 10));
    }


    // Функция для отправки сообщений с задержкой
    async function sendUsersInfo(groups) {
        const totalGroups = groups.length;

        for (let i = 0; i < totalGroups; i++) {
            const group = groups[i];
            const usersInfo = group.map((user) => generateUserInfo(user)).join('\n');
            
            // Отправляем сообщение с информацией о части группы
            const part = `${i + 1}/${totalGroups}`;
            await bot.sendMessage(chatId, `Часть ${part} пользователей:\n\n${usersInfo}\nЧасть ${part} пользователей.`);
            
            // Задержка между сообщениями (например, 2 секунды)
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }

    // Отправляем пользователям информацию в группах
    sendUsersInfo(usersInGroups);
});



bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const telegramID = msg.from.id; // ID пользователя в Telegram
    const nick = msg.from.username || 'Нет никнейма'; // Никнейм пользователя

    console.log(msg);
    // Проверяем, зарегистрирован ли пользователь
    const user = await checkUser(chatId);

    if (user) {
        if (!user.telegramID || !user.birthday) {
            // Если никнейм отсутствует, запускаем процесс редактирования
            bot.sendMessage(chatId, 'Профиль вашего пользователя не до конца заполнен. Нажмите на /user_edit');
        } else {
                // Генерация информации о пользователе
                const userInfo = generateUserInfo(user);

                // Отправка фото (если оно есть)
                if (user.photo) {
                    bot.sendPhoto(chatId, user.photo, { caption: userInfo });
                } else {
                    bot.sendMessage(chatId, userInfo);
                }
            bot.sendMessage(chatId, `Вы уже зарегистрированы.\nНажмите /start, чтобы увидеть свою анкету,\n/photo${user.telegramID}, чтобы установить фотографию,\n/user_edit, чтобы редактировать профиль.`);
        }
        return;
    }

    // Сохраняем временные данные о пользователе
    userSteps[chatId] = { step: 0, telegramID, nick };

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

        bot.sendMessage(chatId, 'Если вы тренер, выберите подразделения, в которых работаете и планируете проводить ВПТ.\nЕсли вы не тренер -- просто нажмите "Завершить выбор":', {
            reply_markup: {
                inline_keyboard: [
                    [{ text: 'ТЗ', callback_data: 'ТЗ' }],
                    [{ text: 'ГП', callback_data: 'ГП' }],
                    [{ text: 'Аква', callback_data: 'Аква' }],
                    [{ text: 'Завершить выбор', callback_data: 'done' }],
                ],
            },
        });
    }
});

// Обработка выбора должностей
bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;

    if (!userSteps[chatId] || userSteps[chatId].step !== 4) {
        return;
    }

    const selection = query.data;

    if (!userSteps[chatId].selections) {
        userSteps[chatId].selections = [];
    }

    // Если выбор не сделан, добавляем его в список
    if (selection !== 'done' && !userSteps[chatId].selections.includes(selection)) {
        userSteps[chatId].selections.push(selection);
    }

    if (selection === 'done') {    
        const { name, position, selections, phoneNumber, telegramID, nick, birthday } = userSteps[chatId];
        const finalPosition = `${position}${selections.map((sel) => `|${sel}`).join('')}`;
        const timestamp = new Date();

        const [day, month, year] = birthday.split('.'); // Разделяем дату
        const isoBirthday = new Date(`${year}-${month}-${day}`).toISOString(); // Преобразуем в формат ISO

        try {
            await prisma.user.upsert({
                where: { chatId },
                update: {
                    name,
                    phoneNumber,
                    position: finalPosition,
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
                    position: finalPosition,
                    birthday: isoBirthday, // Добавляем дату рождения
                },
            });

            bot.sendMessage(chatId, `Ваши данные успешно сохранены!\nНажмите /start, чтобы увидеть свою анкету,\n/photo${telegramID}, чтобы установить фотографию,\n/user_edit, чтобы редактировать профиль.`);
            bot.sendMessage(process.env.GROUP_ID, `Сохранена анкета пользователя ${name}:\n Просмотр: /profile${telegramID}`);
            
        } catch (error) {
            console.error('Ошибка при сохранении данных:', error);
            bot.sendMessage(chatId, 'Произошла ошибка при сохранении данных.');
        }

        delete userSteps[chatId];
    } else {
        bot.sendMessage(chatId, `Вы выбрали: ${userSteps[chatId].selections.join(', ')}`);
    }
});

// Генерация информации о пользователе
function generateUserInfo(user) {
    return `${user.name} ${"@" + user.nick}\n` +
           `- Телефон: ${user.phoneNumber}\n` +
           `- Должность: ${user.position}\n` +
           `- Дата рождения: ${user.birthday ? user.birthday.toLocaleDateString('ru-RU'): 'не указан'}\n`+
           `- Фото: ${user.photo ? 'есть' : 'нет'}\n`+
           `Анкета: /profile${parseInt(user.telegramID)}\n`+ 
           `Новое фото: /photo${parseInt(user.telegramID)}\n`;
}



// Стартуем сервер Express
app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});
