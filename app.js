const express = require('express');
const bodyParser = require('body-parser');
const { PrismaClient } = require('@prisma/client');
const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();

const app = express();
const port = 3000;

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
    { command: '/user_edit', description: 'Изменить информацию о пользователе' },
    { command: '/user_show_all', description: 'Показать информацию о всех пользователях' },
    { command: '/user_photo_new', description: 'Загрузить новое фото' },
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

bot.onText(/\/user_photo_new/, async (msg) => {
    const chatId = msg.chat.id;

    // Проверяем, зарегистрирован ли пользователь
    const user = await checkUser(chatId);
    if (!user) {
        bot.sendMessage(chatId, 'Вы не зарегистрированы. Используйте /start для регистрации.');
        return;
    }

    // Запросить фотографию у пользователя
    bot.sendMessage(chatId, 'Пожалуйста, отправьте вашу фотографию.');

    // Ожидаем получения фотографии
    bot.once('photo', async (msg) => {
        const fileId = msg.photo[msg.photo.length - 1].file_id; // Получаем file_id самой большой фотографии

        try {
            // Обновляем информацию о пользователе, добавляя file_id фотографии
            await prisma.user.update({
                where: { chatId },
                data: {
                    photo: fileId, // Сохраняем photo (file_id)
                },
            });

            bot.sendMessage(chatId, 'Ваша фотография успешно загружена!\nЧтобы увидеть свою анкету нажмите /start');
        } catch (error) {
            console.error('Ошибка при сохранении фотографии:', error);
            bot.sendMessage(chatId, 'Произошла ошибка при сохранении фотографии.');
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
    bot.sendMessage(chatId, 'Пожалуйста, поделитесь своим контактом для редактирования данных.', {
        reply_markup: {
            keyboard: [
                [{ text: 'Поделиться контактом', request_contact: true }]
            ],
            one_time_keyboard: true
        }
    });
});


// Команда /user_show_all для вывода всех пользователей
bot.onText(/\/user_show_all/, async (msg) => {
    const chatId = msg.chat.id;

    const user = await checkUser(chatId);
    if (!user) {
        bot.sendMessage(chatId, 'Вы не зарегистрированы. Используйте /start для регистрации.');
        return;
    }

    const users = await prisma.user.findMany();

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

    // Проверяем, зарегистрирован ли пользователь
    const user = await checkUser(chatId);

    if (user) {
        if (!user.nick || user.nick === 'Нет никнейма' || !user.birthday) {
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
            bot.sendMessage(chatId, `Вы уже зарегистрированы.\nДля редактирования анкеты нажмите /user_edit`);
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
        userSteps[chatId].nick = msg.from.username || 'Нет никнейма'; // Сохраняем nick
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

        bot.sendMessage(chatId, 'Теперь введите вашу должность:');
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

        bot.sendMessage(chatId, 'Теперь выберите должности (можно выбрать несколько):', {
            reply_markup: {
                inline_keyboard: [
                    [{ text: 'ТЗ', callback_data: 'ТЗ' }],
                    [{ text: 'ГП', callback_data: 'ГП' }],
                    [{ text: 'Аква', callback_data: 'Аква' }],
                    [{ text: 'Готово', callback_data: 'done' }],
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

        const [day, month, year] = userSteps[chatId].birthday.split('.'); // Разделяем дату
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
                    timestamp,
                },
            });

            bot.sendMessage(chatId, 'Ваши данные успешно сохранены!\nВы можете нажать /start, чтобы увидеть свою анкету.');
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
    return `- ФИО: ${user.name}\n` +
           `- Ник: ${"@" + user.nick}\n` +
           `- Телефон: ${user.phoneNumber}\n` +
           `- Должность: ${user.position}\n` +
           `- Дата рождения: ${user.birthday}\n` +
           `- Дата регистрации: ${new Date(user.timestamp).toLocaleString()}\n`;
}



// Стартуем сервер Express
app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});
