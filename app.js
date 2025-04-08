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
                `${user.name}\n(⏳ ${user.currentMonthNone} | ✅ ${user.currentMonthAccepted} | ❌ ${user.currentMonthRejected} / 🎯: ${user.wishVptCount})\nАнкета /profile${user.telegramID}\n@${user.nick}\n`
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


// Хранение в памяти по ключу номера телефона
const anketas = {}; // текст анкеты
const comments = {}; // комментарий пользователя
const tags = {}; // теги клиента
const photoIds = {}; // Хранение в памяти id файла фото тг по ключу номера телефона

// Обработка ввода текста
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;

    // Попробуем распарсить телефон и коммент
    console.log(msg.text);
    if (msg.text?.startsWith('/')) {
        return;
    }

    let parsedMessage = BotHelper.parseMessage(msg.text);

    if (parsedMessage?.phone) {
        const { phone, comment } = parsedMessage;
        console.log(`phone: ${phone}, comment: ${comment}`);
        let anketaObj = await BotHelper.anketaByPhoneSearchAndGoalChoosing(prisma, phone, bot, chatId, comment);

        // после получения анкеты если уже есть заявки по этому номеру -- нужно во всех обновить фото
        let vptRequests = await BotHelper.getRequestsByPhone(prisma, '+' + phone);
        if (anketaObj && vptRequests) {
            for (let v of vptRequests) {
                BotHelper.updateVPTRequestPhoto(prisma, v.id, anketaObj.fileId);
            }
        }

        // Эти данные будут далее использованы после выбора подразделения/времени в анкете передаваемой фитдиру в vc goal и vc time
        anketas[phone] = anketaObj?.anketa
        comments[phone] = anketaObj?.comment;
        tags[phone] = anketaObj?.tags;
        photoIds[phone] = anketaObj?.fileId;
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
    let nowdatetime = BotHelper.nowDateTime();

    const chatId = query.message.chat.id;
    let user = await getUserByChatId(chatId);

    let [queryTheme, queryValue, queryId, param4, param5, param6] = query.data.split('@');


    // Рядовой юзер выбрал подразделение "ГП" "ТЗ" "Аква" (vpt request create)
    if (queryTheme === 'vc_goal') {
        const messageId = query.message.message_id;
        // const keyboard = query.message.reply_markup?.inline_keyboard; // для изменения только одной кнопки
        let clientPhone = '+' + BotHelper.parseMessage(param4).phone;
        console.log(queryTheme, queryValue, queryId, clientPhone);

        if (queryValue === 'cancel') {
            await BotHelper.deleteMessage(bot, chatId, messageId);
            bot.sendMessage(chatId, `Закрыта анкета клиента ${clientPhone}`);
        } else {
            let goal = queryValue;
            let inline_keyboard = [
                [
                    { text: "🌅 Утро", callback_data: ['vc_time', goal, messageId, param4, 'u'].join('@') },
                    { text: "☀️ Обед", callback_data: ['vc_time', goal, messageId, param4, 'o'].join('@') },
                    { text: "🌙 Вечер", callback_data: ['vc_time', goal, messageId, param4, 'v'].join('@') },
                    { text: "🌍 Весь день", callback_data: ['vc_time', goal, messageId, param4, 'all'].join('@') }
                ],
                [
                    { text: "✖️ Закрыть", callback_data: ['vc_time', 'cancel', messageId, param4].join('@') }
                ]
            ];
            await BotHelper.updateInlineKeyboard(bot, chatId, messageId, inline_keyboard);

        }
    }

    // Рядовой юзер выбрал время "Утро" "Обед" "Вечер" (vpt request create)
    if (queryTheme === 'vc_time') {
        const messageId = query.message.message_id;
        // const keyboard = query.message.reply_markup?.inline_keyboard; // для изменения только одной кнопки
        let clientPhone = '+' + param4;

        if (queryValue === 'cancel') {
            await BotHelper.deleteMessage(bot, chatId, messageId);
            bot.sendMessage(chatId, `Закрыта анкета клиента ${clientPhone}`);
        } else {
            let goal = queryValue;
            let goalRus = BotHelper.goalRus(goal);
            let goalRusWithEmojii = BotHelper.goalRusWithEmojii(goal);

            if (queryValue) {
                let visitTime;
                if (param5 === 'u') { visitTime = 'Утро' }
                if (param5 === 'o') { visitTime = 'Обед' }
                if (param5 === 'v') { visitTime = 'Вечер' }
                if (param5 === 'all') { visitTime = 'Весь день' }

                if (visitTime) {
                    try {
                        let phoneWithoutPlus = param4;
                        let existingVptRequest = await BotHelper.checkVPTRequestExists(prisma, '+' + phoneWithoutPlus, goalRus);
                        if (existingVptRequest) {
                            bot.sendMessage(chatId, `Заявка уже существует для +${phoneWithoutPlus}, ${goalRus}\nПросмотр: /vpt${existingVptRequest.id}`);
                            return;
                        }
                        // Никнейми и ФИО того, кто нажал на кнопку
                        const authorTelegramUserInfo = BotHelper.getQueryTelegramUserInfo(query);

                        // из массива получаем данные
                        let anketa = anketas[phoneWithoutPlus] || '';
                        let comment = comments[phoneWithoutPlus] || '';
                        let tag = tags[phoneWithoutPlus] || '';
                        let photoId = photoIds[phoneWithoutPlus] || '';

                        // Записываем заявку в БД
                        let trainerTelegramID = null;
                        let vptRequest;
                        try {
                            // пробуем создать если не существует ScreenshotUser 
                            const telegramID = query.from.id;  // Уникальный Telegram ID
                            // Создаем и/или получаем автора заявки
                            let screenshotUser = await BotHelper.checkOrCreateScreenshotUser(prisma, telegramID, authorTelegramUserInfo);
                            // Телеграм ИД автора заявки
                            let authorTelegramID = screenshotUser.uniqueId;
                            // Начало истории заявки: создание заявки
                            let history = `${BotHelper.nowDateTime()}\n🎯 Отправлено на распределение ФД`;

                            // СОЗДАНИЕ ЗАЯВКИ ЗАПИСЬ В БД 
                            vptRequest = await BotHelper.createVPTRequest(prisma, trainerTelegramID, authorTelegramID, visitTime, clientPhone, photoId, comment, anketa, history, tag, goalRus, `${chatId}@${messageId}`);

                            // Направляем заявку ФитДиру
                            await BotHelper.anketaToFitDir(bot, prisma, vptRequest);

                        } catch (e) {
                            bot.sendMessage(chatId, 'Ошибка при сохранении заявки в БД');
                            console.error(e);
                            return;
                        }


                        // await BotHelper.updateButtonText(bot, chatId, messageId, keyboard, query.data, `✅ ${goal} отправлена`);
                        let inline_keyboard = [];
                        inline_keyboard.push(
                            [
                                { text: `✅ Отправлен в ${goalRusWithEmojii} на ${visitTime}`, callback_data: `send_text@+${phoneWithoutPlus}` } // при нажатии бот выплюнет обратно текст во втором параметре
                            ]
                        );
                        inline_keyboard.push(
                            [
                                { text: `🗑 Удалить заявку`, callback_data: ['vpt_delete', vptRequest.id].join('@') } // Удаление заявки на ВПТ Татьяной
                            ]
                        );
                        await BotHelper.updateInlineKeyboard(bot, chatId, messageId, inline_keyboard);
                    } catch (e) {
                        bot.sendMessage(chatId, `Ошибка при отправке заявки клиента ${clientPhone}. Попробуйте позже.\n\n${e.message}`);
                    }
                }
            }
        }
    }

    // ФитДир выбрал тренера vpt request send
    if (queryTheme === 'vs') {
        let [, messageId, trainerChatId, vptRequestId] = query.data.split('@');

        // инфа из БД
        let vptRequest = await BotHelper.getVPTRequestById(prisma, vptRequestId);
        let trainer = await BotHelper.getUserByChatId(prisma, trainerChatId);

        // Отправляем анкету тренеру, ставим тег в 1С, обновляем заявку в БД
        await BotHelper.anketaToTrainer(bot, chatId, prisma, trainer, vptRequest);

        let inline_keyboard = [];
        inline_keyboard.push(
            [
                { text: `✅ Отправлено ${trainer.name}`, callback_data: 'okay' } // Здесь должена быть ссылка на заявку
            ]
        );
        inline_keyboard.push(
            [
                { text: `🗑 Удалить заявку`, callback_data: ['vpt_delete', vptRequest.id].join('@') } // Удаление заявки на ВПТ
            ]
        );
        await BotHelper.updateInlineKeyboard(bot, chatId, messageId, inline_keyboard);
    }

    // Удаление заявки из БД и всех сообщений с ней связанных
    if (queryTheme === 'vpt_delete') {
        let vptRequestId = queryValue;
        console.log(`vpt_delete #${vptRequestId}`);

        let vptRequest = await BotHelper.getVPTRequestById(prisma, vptRequestId);
        if (!vptRequest) {
            bot.sendMessage(chatId, `Не найдена заявка #${vptRequestId}`);
            try {
                await bot.deleteMessage(query.message.chat.id, query.message.message_id);
            } catch (error) {
                console.error("Ошибка при удалении сообщения:", error);
            }
            return;
        }
        let tgVptChatMessages = vptRequest.tgChatMessageId?.split('|');
        for (const vptTgChatMessage of tgVptChatMessages) {
            let [chatId, messageId] = vptTgChatMessage.split('@');
            await BotHelper.deleteMessage(bot, chatId, messageId);
            console.log(`Удалено сообщение ${chatId}@${messageId}`);
        }
        await BotHelper.deleteTagForVptRequest(prisma, vptRequest);
        await BotHelper.deleteVPTRequestById(prisma, vptRequestId);
        bot.sendMessage(chatId, `⚠️ Удалена заявка\n${vptRequest.phoneNumber} ${vptRequest.comment}\nЦель: ${vptRequest.goal}\nВремя: ${vptRequest.visitTime}`);
    }


    // Тренер берет либо отклоняет заявку: accepted rejected "Беру" "Не беру"
    if (queryTheme === 'vpt_status') {
        // Внутри любого хендлера, когда нужно проверить заявку:
        const request = await checkRequestExistence(bot, chatId, queryId);
        // Если функция вернула false — значит заявки нет или произошла ошибка
        if (!request) {
            return false; // «тормозим» дальнейшее выполнение кода
        }
        let trainer = await prisma.user.findUnique({
            where: { id: request.userId },
        });

        if (queryValue === 'accepted') {
            let vptRequest = request;

            // Уведомление тренеру 
            let vptStatusNotAccepted = vptRequest.status !== 'accepted';
            let alertText = vptStatusNotAccepted ?
                `✅ Спасибо! Заявка #${vptRequest.id} взята в работу` :
                `✅ Вы уже взяли заявку #${vptRequest.id} в работу...`;
            bot.answerCallbackQuery(query.id, {
                text: alertText,
                show_alert: true // true - показывает всплывающее окно
            });
            // заявка уже принята
            if (!vptStatusNotAccepted) {
                return;
            }

            // обновляем статус и историю заявки
            vptRequest = await updateVPTRequestStatus(prisma, queryId, 'accepted');
            vptRequest = await BotHelper.updateVptRequestHistory(prisma, queryId, `${vptRequest.history}\n\n${BotHelper.nowDateTime()}\n✅ Взято в работу ${BotHelper.getTag(trainer.name, vptRequest.goal)}`);

            // Отправляем в чат группы
            // let firstRow = `✅ Заявка взята в работу\n\n`;
            // let lastRow = `\n\nТренер: ${trainer.name}`;
            // let screenshotUser = await BotHelper.getScreenshotUserById(prisma, vptRequest.screenshotUserId);
            // let captionText = await BotHelper.captionTextForFitDir(prisma, firstRow, vptRequest, screenshotUser, lastRow);
            let goalRusWithEmojii = BotHelper.goalRusWithEmojii(vptRequest.goal);
            let visitTimeWithEmojii = BotHelper.visitTimeWithEmojii(vptRequest.visitTime);
            let captionText = 
                `✅ Заявка #${vptRequest.id} взята в работу\n\n` + 
                `Тренер: ${trainer.name}\n\n` +
                `Цель: ${goalRusWithEmojii}\n\n` +
                `Время: ${visitTimeWithEmojii}\n\n` +
                `Телефон клиента: ${vptRequest.phoneNumber}`;
            // Отправляем, сохраняем сообщение для удаления
            await BotHelper.anketaForVptRequest(bot, prisma, vptRequest, process.env.GROUP_ID, captionText);
        }
        if (queryValue === 'rejected') {
            bot.sendMessage(chatId, 'Кажется вы промахнулись... \nВы всё ещё можете принять заявку, нажав на соответствующую кнопку ✅ выше.\n\nЕсли желаете отклонить заявку опишите причину, почему вы отказываетесь 🙂');

            let vptRequest = request;

            // Ожидаем ввод причины отказа
            const rejectionHandler = async (msg) => {
                if (msg.chat.id !== chatId) return; // Игнорируем сообщения от других пользователей

                // Получаем текст отказа
                const rejectionReason = msg.text.trim();

                try {
                    // обновляем статус и историю заявки
                    vptRequest = await updateVPTRequestStatus(prisma, queryId, 'rejected');
                    vptRequest = await BotHelper.updateVptRequestHistory(prisma, queryId, `${vptRequest.history}\n\n${BotHelper.nowDateTime()}\n❌ ${BotHelper.getTag(trainer.name, vptRequest.goal)}\nПричина отказа: "${rejectionReason}"`);

                    // удаляем тег тренера из 1С и актуализируем теги в vptRequest
                    await BotHelper.deleteTagForVptRequest(prisma, vptRequest);

                    // Отправляем в чат группы
                    let goalRusWithEmojii = BotHelper.goalRusWithEmojii(vptRequest.goal);
                    let visitTimeWithEmojii = BotHelper.visitTimeWithEmojii(vptRequest.visitTime);
                    let captionText = 
                        `❌ ${BotHelper.getTag(trainer.name, vptRequest.goal)}\nПричина отказа: "${rejectionReason}"\n⚠️ Отправлено ФитДиру назначить другого тренера\n\n` + 
                        `Тренер: ${trainer.name}\n\n` +
                        `Цель: ${goalRusWithEmojii}\n\n` +
                        `Время: ${visitTimeWithEmojii}\n\n` +
                        `Телефон клиента: ${vptRequest.phoneNumber}`;
                    await BotHelper.anketaForVptRequest(bot, prisma, vptRequest, process.env.GROUP_ID, captionText);

                    // Отправляем ФитДиру
                    let screenshotUser = await BotHelper.getScreenshotUserById(prisma, vptRequest.screenshotUserId);
                    let fitDirUser = await BotHelper.getFitDirUser(prisma);
                    firstRow = `❌ ${BotHelper.getTag(trainer.name, vptRequest.goal)}\nПричина отказа: "${rejectionReason}"\nФД @${fitDirUser.nick}\n⚠️ Назначить другого тренера\n\n`;
                    captionText = await BotHelper.captionTextForFitDir(prisma, firstRow, vptRequest, screenshotUser, ``);
                    // Отправляем, сохраняем сообщение для удаления
                    let { sentMessage } = await BotHelper.anketaForVptRequest(bot, prisma, vptRequest, fitDirUser.chatId, captionText);
                    // Добавляем клавиатуру с тренерами
                    await BotHelper.addKeyboard(prisma, bot, sentMessage.message_id, vptRequest, fitDirUser);

                    bot.answerCallbackQuery(query.id, {
                        text: `❌ Заявка #${vptRequest.id} отклонена\nПричина: "${rejectionReason}"`,
                        show_alert: true // true - показывает всплывающее окно
                    });

                    // Удаляем сообщение у тренера, отклонившего заявку
                    try {
                        const chatIdDel = query.message.chat.id;
                        const messageIdDel = query.message.message_id;
                        await bot.deleteMessage(chatIdDel, messageIdDel);
                    } catch (error) {
                        console.error('Ошибка при удалении сообщения:', error);
                    }

                    // Удаляем обработчик после получения причины
                    bot.removeListener('message', rejectionHandler);
                } catch (e) {
                    console.error(e);
                    bot.sendMessage(chatId, 'Ошибка при отклонении заявки');
                }
            }

            // Добавляем обработчик для получения причины отказа
            bot.on('message', rejectionHandler);

        }
    }

    // Тренер выбирает подразделение: "ТЗ" "ГП" "Аква" "Завершить регистрацию"
    if (queryTheme === 'vpt_list') {
        let selection = BotHelper.goalRus(queryValue);

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

    -- Заявки за текущий месяц
    COUNT(CASE 
      WHEN YEAR(v.createdAt) = YEAR(CURRENT_DATE()) 
      AND MONTH(v.createdAt) = MONTH(CURRENT_DATE()) 
      THEN 1 
      ELSE NULL 
    END) AS currentMonthVptCount,

    SUM(CASE 
      WHEN v.status = 'accepted' 
      AND YEAR(v.createdAt) = YEAR(CURRENT_DATE()) 
      AND MONTH(v.createdAt) = MONTH(CURRENT_DATE()) 
      THEN 1 ELSE 0 
    END) AS currentMonthAccepted,

    SUM(CASE 
      WHEN v.status = 'rejected' 
      AND YEAR(v.createdAt) = YEAR(CURRENT_DATE()) 
      AND MONTH(v.createdAt) = MONTH(CURRENT_DATE()) 
      THEN 1 ELSE 0 
    END) AS currentMonthRejected,

    SUM(CASE 
      WHEN v.status <> 'accepted' 
      AND v.status <> 'rejected' 
      AND YEAR(v.createdAt) = YEAR(CURRENT_DATE()) 
      AND MONTH(v.createdAt) = MONTH(CURRENT_DATE()) 
      THEN 1 ELSE 0 
    END) AS currentMonthNone,

    -- Заявки за прошлый месяц
    COUNT(CASE 
      WHEN YEAR(v.createdAt) = YEAR(DATE_SUB(CURRENT_DATE(), INTERVAL 1 MONTH)) 
      AND MONTH(v.createdAt) = MONTH(DATE_SUB(CURRENT_DATE(), INTERVAL 1 MONTH)) 
      THEN 1 
      ELSE NULL 
    END) AS lastMonthVptCount,

    SUM(CASE 
      WHEN v.status = 'accepted' 
      AND YEAR(v.createdAt) = YEAR(DATE_SUB(CURRENT_DATE(), INTERVAL 1 MONTH)) 
      AND MONTH(v.createdAt) = MONTH(DATE_SUB(CURRENT_DATE(), INTERVAL 1 MONTH)) 
      THEN 1 ELSE 0 
    END) AS lastMonthAccepted,

    SUM(CASE 
      WHEN v.status = 'rejected' 
      AND YEAR(v.createdAt) = YEAR(DATE_SUB(CURRENT_DATE(), INTERVAL 1 MONTH)) 
      AND MONTH(v.createdAt) = MONTH(DATE_SUB(CURRENT_DATE(), INTERVAL 1 MONTH)) 
      THEN 1 ELSE 0 
    END) AS lastMonthRejected,

    SUM(CASE 
      WHEN v.status <> 'accepted' 
      AND v.status <> 'rejected' 
      AND YEAR(v.createdAt) = YEAR(DATE_SUB(CURRENT_DATE(), INTERVAL 1 MONTH)) 
      AND MONTH(v.createdAt) = MONTH(DATE_SUB(CURRENT_DATE(), INTERVAL 1 MONTH)) 
      THEN 1 ELSE 0 
    END) AS lastMonthNone

  FROM User u
  LEFT JOIN VPTRequest v
    ON u.id = v.userId
    AND (
      (YEAR(v.createdAt) = YEAR(CURRENT_DATE()) AND MONTH(v.createdAt) = MONTH(CURRENT_DATE()))
      OR 
      (YEAR(v.createdAt) = YEAR(DATE_SUB(CURRENT_DATE(), INTERVAL 1 MONTH)) AND MONTH(v.createdAt) = MONTH(DATE_SUB(CURRENT_DATE(), INTERVAL 1 MONTH)))
    )
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

async function updateVPTRequestStatus(prisma, requestId, newStatus) {
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
        `⏳ ${user.currentMonthNone} | неразобранные\nпросмотр: /vpt_none${parseInt(user.telegramID)}\n` +
        `✅ ${user.currentMonthAccepted} | принятые\nпросмотр: /vpt_accepted${parseInt(user.telegramID)}\n` +
        `❌ ${user.currentMonthRejected} | отклоненные\nпросмотр: /vpt_rejected${parseInt(user.telegramID)}\n\n` +
        `ЗАЯВКИ ЗА ПРОШЛЫЙ МЕСЯЦ:\n` +
        `⏳ ${user.lastMonthNone} | неразобранные\n` +
        `✅ ${user.lastMonthAccepted} | принятые\n` +
        `❌ ${user.lastMonthRejected} | отклоненные\n\n` +
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
 * @param {Boolean} fitDirFlag - true если нужно отображать теги и историю
 * @param {TelegramBot} bot - Инстанс TelegramBot
 * @param {Number} chatId - Куда отправлять сообщение
 * @param {Object} currentUser - Текущий пользователь (свойства: id, role, ...)
 * @param {Object} targetUser - Владелец заявки (или тренер, чьё это объявление), поля: name, nick
 * @param {Object} request - Объект заявки (VPTRequest). Поля: id, goal, photo, comment, ...
 * @param {Function} sendPhotoWithRetry - (необязательно) функция для отправки фото с повтором при 429
 * @returns {Promise<void>}
 */
async function sendSingleVPTRequestMessage(fitDirFlag, bot, chatId, currentUser, targetUser, request, sendPhotoWithRetry = null) {
    // Шаг 1: Собираем текст сообщения
    let captionText = '';
    if (fitDirFlag) {
        let screenshotUser = await BotHelper.getScreenshotUserById(prisma, request.screenshotUserId);
        captionText = await BotHelper.captionTextForFitDir(prisma, ``, request, screenshotUser, ``);
    }
    else {
        captionText = BotHelper.captionTextForTrainer(``, request, ``);
    }

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
            text: '🗑 Удалить',
            callback_data: [`vpt_delete`, request.id].join('@')
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

    let sentMessage;
    // Шаг 4: Отправляем сообщение
    try {
        try {
            console.log(request.photo);

            // Если есть фото и функция sendPhotoWithRetry передана —
            // используем её, иначе стандартное bot.sendPhoto
            if (typeof sendPhotoWithRetry === 'function') {
                sentMessage = await sendPhotoWithRetry(chatId, request.photo, captionText, {
                    reply_markup: { inline_keyboard }
                });
            } else {
                console.log(`Отправлено сообщение с фото:\n${request.photo}`);
                // Стандартная отправка
                sentMessage = await bot.sendPhoto(chatId, request.photo, {
                    caption: captionText,
                    reply_markup: { inline_keyboard }
                });
            }
        } catch (e) {
            console.error(`Не удалось отправить фото:\n${request.photo}`);
            // Если не получилось отправить фото, просто sendMessage
            sentMessage = await bot.sendMessage(chatId, '[Не удалось отправить фото]\n\n' + captionText, {
                reply_markup: { inline_keyboard }
            });
        }
    } catch (error) {
        bot.sendMessage(chatId, `Ошибка при отправке заявки`);
        console.error('Ошибка при отправке заявки:', error);
        // Можно дополнительно отправлять уведомление об ошибке
        // bot.sendMessage(chatId, 'Ошибка при отправке сообщения с заявкой.');
    }
    return sentMessage?.message_id;
}

// показывает заявку по команде
bot.onText(/\/vpt(\d+)/, async (msg, match) => {

    const chatId = msg.chat.id;
    const vptRequestId = match[1];    // 56

    let user = await getUserByChatId(chatId);
    if (!user) {
        bot.sendMessage(chatId, `Пользователь c chatId ${chatId} не найден.`);
        return;
    }

    let vptRequest = await BotHelper.getVPTRequestById(prisma, vptRequestId);
    if (!vptRequest) {
        bot.sendMessage(chatId, `Заявка c id ${vptRequestId} не найдена.`);
        return;
    }
    // отправляем анкету себе тому, кто использовал эту команду
    let fitDirFlag = false;
    if (user.role === 'админ') fitDirFlag = true;
    let messageId = await sendSingleVPTRequestMessage(fitDirFlag, bot, chatId, user, user, vptRequest);
    if (messageId) {
        try {
            // Чтобы потом можно было удалить сообщение вместе с заявкой
            // Обновляем в vptRequest добавляем "|chatId@messageId" в vptRequest.tgChatIdMessageId
            let newTgChatMessageId = `${vptRequest.tgChatMessageId}|${chatId}@${messageId}`;
            await BotHelper.updateVptRequestTgChatMessageId(prisma, vptRequest.id, newTgChatMessageId);
        } catch (e) { console.error(e); }
    }
})

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

        let fitDirFlag = false;
        let messageId = await sendSingleVPTRequestMessage(fitDirFlag, bot, chatId, currentUser, targetUser, request, sendPhotoWithRetry);
        try {
            if (messageId) {
                // Чтобы потом можно было удалить сообщение вместе с заявкой
                // Обновляем в vptRequest добавляем "|chatId@messageId" в vptRequest.tgChatIdMessageId
                let newTgChatMessageId = `${request.tgChatMessageId}|${chatId}@${messageId}`;
                await BotHelper.updateVptRequestTgChatMessageId(prisma, request.id, newTgChatMessageId);
            }
        } catch (e) { console.error(e); }

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
