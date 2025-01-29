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
    // { command: '/user_edit', description: 'Изменить информацию о себе' },
    { command: '/users', description: 'Список всех пользователей' }
]);

// Временное хранилище для шагов регистрации
const userSteps = {};
const userMode = []

// Проверка наличия пользователя в базе данных
async function checkUser(chatId) {
    const user = await prisma.user.findUnique({
        where: { chatId: chatId },
    });
    return user;
}

// Обработка команды /profiletelegramID
bot.onText(/\/profile(.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const telegramID = match[1]; // Получаем никнейм из команды
    
    userMode[chatId] = 'oneField';
    

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

bot.onText(/\/name(.*)/, async (msg, match) => {
    const chatId = msg.chat.id;
    userMode[chatId] = 'oneField';
    const telegramID = match[1].trim(); // Получаем telegramID из команды

    // Проверяем, если пользователь отправил команду с telegramID
    if (!telegramID) {
        bot.sendMessage(chatId, 'telegramID пользователя не указан. Пожалуйста, используйте формат: /updateName telegramID');
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

    // Запрашиваем новое ФИО у пользователя
    bot.sendMessage(chatId, `Пожалуйста, введите новое ФИО для пользователя ${user.name}.`);

    // Ожидаем получения текста с новым ФИО
    const nameHandler = (msg) => {
        if (msg.chat.id !== chatId) return; // Игнорируем сообщения от других пользователей

        const newName = msg.text.trim(); // Получаем новое имя из сообщения

        // Проверяем, что новое ФИО не пустое
        if (!newName) {
            bot.sendMessage(chatId, 'ФИО не может быть пустым. Попробуйте снова.');
            return;
        }

        // Удаляем обработчик после первого срабатывания
        bot.removeListener('message', nameHandler);

        // Обновляем ФИО пользователя
        prisma.user.update({
            where: { telegramID: parseInt(telegramID) },
            data: {
                name: newName, // Обновляем поле `name`
            },
        })
            .then(() => {
                bot.sendMessage(chatId, `ФИО пользователя ${user.name} успешно обновлено на "${newName}".\nПросмотр: /profile${parseInt(user.telegramID)}`);
                bot.sendMessage(process.env.GROUP_ID, `Обновлено ФИО пользователя ${user.name}:\nНовое ФИО: "${newName}"\nПросмотр: /profile${parseInt(user.telegramID)}`);
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

    // Проверяем, если пользователь отправил команду с telegramID
    if (!telegramID) {
        bot.sendMessage(chatId, 'telegramID пользователя не указан. Пожалуйста, используйте формат: /updateRole telegramID');
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

    let currentUser = checkUser(chatId);
    // Проверяем роль пользователя
    if (!currentUser && currentUser.role !== 'админ') {
        bot.sendMessage(chatId, '❌ У вас недостаточно прав для выполнения этой команды');
        return;
    }

    // Запрашиваем новую роль у пользователя
    bot.sendMessage(chatId, `Пожалуйста, введите новую роль для пользователя ${user.name}. Возможные варианты: пользователь, редактор, админ.`);

    // Ожидаем получения текста с новой ролью
    const roleHandler = (msg) => {
        if (msg.chat.id !== chatId) return; // Игнорируем сообщения от других пользователей

        const newRole = msg.text.trim().toLowerCase(); // Получаем новую роль из сообщения и переводим в нижний регистр

        // Список допустимых ролей
        const validRoles = ['пользователь', 'редактор', 'админ'];

        // Проверяем, что роль является корректной
        if (!validRoles.includes(newRole)) {
            bot.sendMessage(chatId, 'Указана некорректная роль. Допустимые варианты: пользователь, редактор, админ. Попробуйте снова.');
            return;
        }

        // Удаляем обработчик после первого срабатывания
        bot.removeListener('message', roleHandler);

        // Обновляем роль пользователя
        prisma.user.update({
            where: { telegramID: parseInt(telegramID) },
            data: {
                role: newRole, // Обновляем поле `role`
            },
        })
            .then(() => {
                bot.sendMessage(chatId, `Роль пользователя ${user.name} успешно обновлена на "${newRole}".`);
                bot.sendMessage(process.env.GROUP_ID, `Обновлена роль пользователя ${user.name}:
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

    // Проверяем, если пользователь отправил команду с telegramID
    if (!telegramID) {
        bot.sendMessage(chatId, 'telegramID пользователя не указан. Пожалуйста, используйте формат: /position telegramID');
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

    // Запрашиваем новую должность у пользователя
    bot.sendMessage(chatId, `Пожалуйста, введите новую должность для пользователя ${user.name}.`);

    // Ожидаем получения текста с новой должностью
    const positionHandler = (msg) => {
        if (msg.chat.id !== chatId) return; // Игнорируем сообщения от других пользователей

        const newPosition = msg.text.trim(); // Получаем новую должность из сообщения

        // Проверяем, что должность не пустая
        if (!newPosition) {
            bot.sendMessage(chatId, 'Должность не может быть пустой. Попробуйте снова.');
            return;
        }

        // Удаляем обработчик после первого срабатывания
        bot.removeListener('message', positionHandler);

        // Обновляем должность пользователя
        prisma.user.update({
            where: { telegramID: parseInt(telegramID) },
            data: {
                position: newPosition, // Обновляем поле `position`
            },
        })
            .then(() => {
                bot.sendMessage(chatId, `Должность пользователя ${user.name} успешно обновлена на "${newPosition}".\nПросмотр: /profile${parseInt(user.telegramID)}`);
                bot.sendMessage(process.env.GROUP_ID, `Обновлена должность пользователя ${user.name}:\nНовая должность: "${newPosition}"\nПросмотр: /profile${parseInt(user.telegramID)}`);
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

    // Проверяем, если пользователь отправил команду с telegramID
    if (!telegramID) {
        bot.sendMessage(chatId, 'telegramID пользователя не указан. Пожалуйста, используйте формат: /position telegramID');
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

    // Запрашиваем новую должность у пользователя
    bot.sendMessage(chatId, `Пожалуйста, выберите проводимые ВПТ из списка ниже для ${user.name}.`);

    // chatId это в каком чате нажата кнопка, telegramID это к какому пользователю относится
    sendVptListInlineKeyboard(bot, chatId, telegramID);

});

bot.onText(/\/birthday(.*)/, async (msg, match) => {
    const chatId = msg.chat.id;
    userMode[chatId] = 'oneField';
    const telegramID = match[1].trim(); // Получаем telegramID из команды

    // Проверяем, если пользователь отправил команду с telegramID
    if (!telegramID) {
        bot.sendMessage(chatId, 'telegramID пользователя не указан. Пожалуйста, используйте формат: /birthday telegramID');
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

    // Запрашиваем новую дату рождения у пользователя
    bot.sendMessage(chatId, `Пожалуйста, введите новую дату рождения для пользователя ${user.name} в формате: dd.mm.yyyy`);

    // Ожидаем получения текста с новой датой рождения
    const birthdayHandler = (msg) => {
        if (msg.chat.id !== chatId) return; // Игнорируем сообщения от других пользователей

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
        // Обновляем дату рождения пользователя
        prisma.user.update({
            where: { telegramID: parseInt(telegramID) },
            data: {
                birthday: isoBirthday, // Обновляем поле `birthday`
            },
        })
            .then(() => {
                bot.sendMessage(chatId, `Дата рождения пользователя ${user.name} успешно обновлена на "${birthday}".\nПросмотр: /profile${parseInt(user.telegramID)}`);
                bot.sendMessage(process.env.GROUP_ID, `Обновлена дата рождения пользователя ${user.name}:\nНовая дата: "${birthday}"\nПросмотр: /profile${parseInt(user.telegramID)}`);
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

    // Ожидаем получения фотографии, только если сообщение от того же пользователя, который запросил обновление
    const photoHandler = (msg) => {
        if (msg.chat.id !== chatId) return; // Игнорируем фотографии от других пользователей

        const fileId = msg.photo[msg.photo.length - 1].file_id; // Получаем file_id самой большой фотографии

        // Удаляем обработчик после первого срабатывания
        bot.removeListener('photo', photoHandler);

        // Обновляем фото пользователя
        prisma.user.update({
            where: { chatId: user.chatId },
            data: {
                photo: fileId, // Сохраняем новое фото (file_id)
            },
        })
            .then(() => {
                bot.sendMessage(chatId, `Обновлено фото пользователя ${user.name} успешно обновлено!\nПросмотр: /profile${parseInt(user.telegramID)}`);
                bot.sendMessage(process.env.GROUP_ID, `Обновлено фото пользователя ${user.name}:\nПросмотр: /profile${parseInt(user.telegramID)}`);
            })
            .catch((error) => {
                console.error('Ошибка при обновлении фото:', error);
                bot.sendMessage(chatId, 'Произошла ошибка при обновлении фото.');
            });
    };

    // Добавляем обработчик для получения фото
    bot.on('photo', photoHandler);
});

// Команда /users для вывода всех пользователей
bot.onText(/\/users/, async (msg) => {
    const chatId = msg.chat.id;

    const user = await checkUser(chatId);

    // Проверяем роль пользователя
    if (user.role !== 'админ') {
        bot.sendMessage(chatId, '❌ У вас недостаточно прав для выполнения этой команды');
        return;
    }
    if (!user) {
        bot.sendMessage(chatId, 'Вы не зарегистрированы. Используйте /start для регистрации.');
        return;
    }

    let users = await prisma.user.findMany();
    users = users.filter(user => user.telegramID);// оставляем только тех, у кого есть telegramID
    if (users.length === 0) {
        bot.sendMessage(chatId, 'Нет зарегистрированных пользователей.');
        return;
    }

    // Разбиваем список пользователей на группы по 15
    const usersInGroups = [];
    while (users.length > 0) {
        usersInGroups.push(users.splice(0, 15));
    }


    // Функция для отправки сообщений с задержкой
    async function sendUsersInfo(groups) {
        const totalGroups = groups.length;

        for (let i = 0; i < totalGroups; i++) {
            const group = groups[i];
            const usersInfo = group.map((user) => (`${user.name} @${user.nick}\nАнкета /profile${user.telegramID}\n`)).join('\n');

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

    // нет пользователя или отсутствуют его telegramID или отсутствует его ДР - заново запускаем процесс регистрации
    if (user && user.telegramID && user.birthday) {
        console.log(user);

        // Генерация информации о пользователе
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
    // Сохраняем временные данные о пользователе
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

// Обработка выбора должностей
bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    let user = await checkUser(chatId);

    let queryTheme = query.data.split('@')[0];
    let queryValue = query.data.split('@')[1];
    let queryTelegramID = query.data.split('@')[2];
    // перед @ тема нажатой кнопки, после @ значение нажатой кнопки
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
                // Обновляем проводимые ВПТ пользователя
                prisma.user.update({
                    where: { telegramID: parseInt(queryTelegramID) },
                    data: {
                        vpt_list: vpt_list, // Обновляем поле `vpt_list`
                    },
                })
                    .then(async () => {

                        let modifiedUser = await prisma.user.findUnique({
                            where: { telegramID: parseInt(queryTelegramID) },
                        });

                        bot.sendMessage(chatId, `Проводимые ВПТ пользователя ${modifiedUser.name} успешно обновлены на "${vpt_list}".\nПросмотр: /profile${parseInt(queryTelegramID)}`);
                        bot.sendMessage(process.env.GROUP_ID, `Обновлены проводимые ВПТ пользователя ${modifiedUser.name}:\nНовые проводимые ВПТ: "${vpt_list}"\nПросмотр: /profile${parseInt(queryTelegramID)}`);
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
                        where: { telegramID:queryTelegramID },
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
                    bot.sendMessage(process.env.GROUP_ID, `Сохранена анкета пользователя ${name}:\n Просмотр: /profile${telegramID}`);

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

// Генерация информации о пользователе
function generateUserInfo(user) {
    return `Анкета: /profile${parseInt(user.telegramID)}\n\n` +
        `${user.name} ${"@" + user.nick}\n` + `Изменить /name${parseInt(user.telegramID)}\n\n` +
        `- Телефон: \n${user.phoneNumber}\n\n` +
        `- Должность: ${user.position}\nИзменить /position${parseInt(user.telegramID)}\n\n` +
        `- Роль: ${user.role}\nИзменить /role${parseInt(user.telegramID)}\n\n` +
        `- Проводимые ВПТ: ${user.vpt_list}\nИзменить /vpt_list${parseInt(user.telegramID)}\n\n` +
        `- Дата рождения: ${user.birthday ? user.birthday.toLocaleDateString('ru-RU') : 'не указан'}\nИзменить /birthday${parseInt(user.telegramID)}\n\n` +
        `- Фото: ${user.photo ? 'есть' : 'нет'}\nИзменить /photo${parseInt(user.telegramID)}\n-------------------------\n\n`;
}




// Стартуем сервер Express
app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});
