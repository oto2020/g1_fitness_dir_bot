const crypto = require('crypto');
const fs = require('fs');
const axios = require('axios');
const path = require('path');

class BotHelper {
    //  В момент создания заявки: Обращается к API, по номеру телефона в формате 79785667199 и отправляет в chatId анкету с кнопками для создателя заявки ТЗ ГП Аква
    static async anketaByPhoneSearchAndGoalChoosing(phone, bot, chatId) {
        console.log(`Подготавливаю анкету, ищу для телефона ${phone}`);
        // Генерация подписи
        const sign = crypto.createHash('sha256')
            .update('phone:' + phone + ";key:" + process.env.SECRET_KEY)
            .digest('hex');

        const passTokenUrl = `https://${process.env.API_HOSTNAME}:${process.env.API_PORT}${process.env.API_PATH}/pass_token/?phone=${phone}&sign=${sign}`;

        try {
            const passTokenResponse = await axios.get(passTokenUrl, {
                headers: {
                    'Content-Type': 'application/json',
                    apikey: process.env.API_KEY,
                    Authorization: process.env.AUTHORIZATION
                }
            });

            if (passTokenResponse.data.result && passTokenResponse.data.data.pass_token) {
                const passToken = passTokenResponse.data.data.pass_token;

                let ticketsText = await this.getTicketsText(passToken);

                let clientResponse = await this.getClientResponse(passToken);

                if (clientResponse.data.result) {
                    const client = clientResponse.data.data;
                    const id = client.id;
                    const name = `${client.name} ${client.last_name}`;
                    // const phone = `${client.phone}`;
                    const birthDate = new Date(client.birthday).toLocaleDateString("ru-RU");
                    const photoUrl = client.photo;
                    const tags = client.tags.map(tag => `#${tag.title}`).join('\n');

                    // let tag = "ХОЧЕТ НА ВПТ";
                    // try {
                    //   await this.addTag(passToken, id, tag);
                    //   await bot.sendMessage(chatId, `Установлен тег: "${tag}"`);
                    // } catch (e) {
                    //   await bot.sendMessage(chatId, `Не удалось установить тег "${tag}"`);
                    // }

                    // try {
                    //   await this.deleteTag(passToken, id, tag);
                    //   await bot.sendMessage(chatId, `Удален тег "${tag}"`);
                    // } catch (e) {
                    //   console.error(e);
                    //   await bot.sendMessage(chatId, `Не удалось удалить тег "${tag}"`);
                    // }

                    let captionText = `Имя: ${name}\nТелефон: +${phone}\nДата рождения: ${birthDate}\n${tags}\n\nБилеты:\n${ticketsText}`;
                    const { fileId, messageId } = await this.sendPhotoCaptionTextKeyboard(bot, chatId, photoUrl, captionText);

                    let inline_keyboard = [
                        [
                            { text: "ТЗ 🏋🏼‍♂️", callback_data: ['vc_goal', 'tz', messageId, phone].join('@') },
                            { text: "ГП 🤸🏻‍♀️", callback_data: ['vc_goal', 'gp', messageId, phone].join('@') },
                            { text: "Аква 🏊", callback_data: ['vc_goal', 'aq', messageId, phone].join('@') }
                        ],
                        [
                            { text: "✖️ Закрыть", callback_data: ['vc_goal', 'cancel', messageId, phone].join('@') }
                        ]
                    ];
                    await this.updateInlineKeyboard(bot, chatId, messageId, inline_keyboard);

                    if (fileId) {
                        console.log(`Photo file_id: ${fileId}`);
                    }
                    // let messageForTrainer = `Имя: ${name}\nТелефон: +${phone}\nДата рождения: ${birthDate}\n\nБилеты:\n${ticketsText}`;
                    // return { fileId, messageForTrainer };
                } else {
                    bot.sendMessage(chatId, 'Ошибка при получении данных клиента.');
                }
            } else {
                bot.sendMessage(chatId, 'Ошибка при получении токена, попробуйте позже.');
            }
        } catch (error) {
            bot.sendMessage(chatId, 'Ошибка соединения с сервером.');
            console.error(error);
        }

    }


    // В момент выбора тренера: Обращается к API, по номеру телефона в формате 79785667199 и отправляет в chatId анкету с кнопками для выбора тренера
    static async anketaByPhoneTrainerChoosingToFitDir(phone, bot, chatId, prisma, goal) {
        console.log(`Подготавливаю анкету, ищу для телефона ${phone}`);
        // Генерация подписи
        const sign = crypto.createHash('sha256')
            .update('phone:' + phone + ";key:" + process.env.SECRET_KEY)
            .digest('hex');

        const passTokenUrl = `https://${process.env.API_HOSTNAME}:${process.env.API_PORT}${process.env.API_PATH}/pass_token/?phone=${phone}&sign=${sign}`;

        try {
            const passTokenResponse = await axios.get(passTokenUrl, {
                headers: {
                    'Content-Type': 'application/json',
                    apikey: process.env.API_KEY,
                    Authorization: process.env.AUTHORIZATION
                }
            });

            if (passTokenResponse.data.result && passTokenResponse.data.data.pass_token) {
                const passToken = passTokenResponse.data.data.pass_token;

                let ticketsText = await this.getTicketsText(passToken);

                let clientResponse = await this.getClientResponse(passToken);

                if (clientResponse.data.result) {
                    const client = clientResponse.data.data;
                    const id = client.id;
                    const name = `${client.name} ${client.last_name}`;
                    // const phone = `${client.phone}`;
                    const birthDate = new Date(client.birthday).toLocaleDateString("ru-RU");
                    const photoUrl = client.photo;
                    const tags = client.tags.map(tag => `#${tag.title}`).join('\n');

                    // let tag = "ХОЧЕТ НА ВПТ";
                    // try {
                    //   await this.addTag(passToken, id, tag);
                    //   await bot.sendMessage(chatId, `Установлен тег: "${tag}"`);
                    // } catch (e) {
                    //   await bot.sendMessage(chatId, `Не удалось установить тег "${tag}"`);
                    // }

                    // try {
                    //   await this.deleteTag(passToken, id, tag);
                    //   await bot.sendMessage(chatId, `Удален тег "${tag}"`);
                    // } catch (e) {
                    //   console.error(e);
                    //   await bot.sendMessage(chatId, `Не удалось удалить тег "${tag}"`);
                    // }

                    let captionText = `ОТПРАВЛЕНО ФИТДИРУ на ${goal}\n\nИмя: ${name}\nТелефон: +${phone}\nДата рождения: ${birthDate}\n${tags}\n\nБилеты:\n${ticketsText}`;
                    let fitDirChatId = await this.getFitDirChatId(prisma);
                    // console.log(fitDirChatId);
                    // return;
                    if (!fitDirChatId) {
                        bot.sendMessage('ФитДир не найден');
                        return;
                    }

                    const { fileId, messageId } = await this.sendPhotoCaptionTextKeyboard(bot, fitDirChatId, photoUrl, captionText);

                    // генерируем клаиатуру с тренерами
                    let trainersWithGoal = await this.getUsersByGoal(prisma, goal);
                    trainersWithGoal = trainersWithGoal.map(el => { return { name: el.name, chatId: el.chatId, telegramID: el.telegramID }; });
                    let buttonsPerRow = 3;
                    let inline_keyboard = [];
                    let row = [];
                    trainersWithGoal.forEach((trainer, index) => {
                        row.push({
                            text: trainer.name,
                            callback_data: ['vs', goal, messageId, phone, trainer.chatId].join('@')
                        });

                        if (row.length === buttonsPerRow || index === trainersWithGoal.length - 1) {
                            inline_keyboard.push(row);
                            row = [];
                        }
                    });

                    // Добавляем кнопку закрытия в отдельный ряд
                    inline_keyboard.push([
                        { text: "✖️ Закрыть", callback_data: ['vs', 'cancel', messageId, phone].join('@') }
                    ]);

                    await this.updateInlineKeyboard(bot, fitDirChatId, messageId, inline_keyboard);

                    return fileId ? fileId : null;
                    // let messageForTrainer = `Имя: ${name}\nТелефон: +${phone}\nДата рождения: ${birthDate}\n\nБилеты:\n${ticketsText}`;
                    // return { fileId, messageForTrainer };
                } else {
                    bot.sendMessage(chatId, 'Ошибка при получении данных клиента.');
                }
            } else {
                bot.sendMessage(chatId, 'Ошибка при получении токена, попробуйте позже.');
            }
        } catch (error) {
            bot.sendMessage(chatId, 'Ошибка соединения с сервером.');
            console.error(error);
        }

    }


    // Функция обновления текста кнопки
    static async updateButtonText(bot, chatId, messageId, inlineKeyboard, targetCallbackData, newText) {
        try {
            if (!inlineKeyboard) return;

            // Обновляем текст нужной кнопки
            let updatedKeyboard = inlineKeyboard.map(row =>
                row.map(button =>
                    button.callback_data === targetCallbackData ? { ...button, text: newText } : button
                )
            );

            // Редактируем клавиатуру
            await bot.editMessageReplyMarkup({ inline_keyboard: updatedKeyboard }, { chat_id: chatId, message_id: messageId });

        } catch (error) {
            console.error('Ошибка при изменении кнопки:', error);
        }
    }

    // Функция отправки изображения с captionText в чат cahtId и возвращает fileId (фото телеграм)  и messageId (id сообщения в чате)
    static async sendPhotoCaptionTextKeyboard(bot, chatId, photoUrl, captionText) {
        try {
            const headers = {
                'Authorization': process.env.AUTHORIZATION,
                'apikey': process.env.API_KEY
            };
            const response = await axios.get(photoUrl, {
                headers,
                responseType: 'arraybuffer'
            });

            const filePath = path.join(__dirname, 'photo.jpg');
            fs.writeFileSync(filePath, response.data);

            const sentMessage = await bot.sendPhoto(chatId, filePath, {
                caption: captionText,
                parse_mode: 'Markdown'
            });

            const messageId = sentMessage.message_id;
            const fileId = sentMessage.photo[sentMessage.photo.length - 1].file_id;

            fs.unlinkSync(filePath);

            return { fileId, messageId };
        } catch (error) {
            console.error('Ошибка загрузки фото:', error);
            bot.sendMessage(chatId, 'Не удалось загрузить фото.');
            return null;
        }
    }

    // Вспомогательные фукнции по работе с уже созданными сообщениями по chatId и messageId
    static async deleteMessage(bot, chatId, messageId) {
        try {
            await bot.deleteMessage(chatId, messageId);
        } catch (error) {
            console.error("Ошибка удаления сообщения:", error);
        }
    }
    // Зная обновляет клавиатуру под сообщением
    static async updateInlineKeyboard(bot, chatId, messageId, newKeyboard) {
        // console.log(newKeyboard);
        try {
            await bot.editMessageReplyMarkup(
                { inline_keyboard: newKeyboard },
                { chat_id: chatId, message_id: messageId }
            );
        } catch (error) {
            console.error("Ошибка обновления клавиатуры:", error);
        }
    }

    // Вспомогательная функция  
    static translateStatus(status) {
        const translations = {
            "active": "🟢 Активно",
            "not_active": "🟠 Не активно",
            "frozen": "❄️ Заморожено",
            "locked": "🔐 Заблокировано",
            "closed": "❌ Закрыто"
        };

        return translations[status] || "Неизвестный статус";
    }

    // добавить тег
    static async addTag(userToken, clientId, tag) {
        // Отправка POST-запроса на /tag
        const tagUrl = `https://${process.env.API_HOSTNAME}:${process.env.API_PORT}${process.env.API_PATH}/tag`;
        await axios.post(tagUrl, {
            tag: tag,
            client_id: clientId
        }, {
            headers: {
                'Content-Type': 'application/json',
                apikey: process.env.API_KEY,
                Authorization: process.env.AUTHORIZATION,
                usertoken: userToken
            }
        });
    }

    // удалить тег
    static async deleteTag(userToken, clientId, tag) {
        // Отправка POST-запроса на /tag
        const tagUrl = `https://${process.env.API_HOSTNAME}:${process.env.API_PORT}${process.env.API_PATH}/tag?tag=${tag}&client_id=${clientId}`;
        await axios.delete(tagUrl, {
            headers: {
                'Content-Type': 'application/json',
                apikey: process.env.API_KEY,
                Authorization: process.env.AUTHORIZATION,
                usertoken: userToken
            }
        });
    }

    // Текст с информацией о членствах/пакетах/услугах
    static async getTicketsText(passToken) {
        const ticketsUrl = `https://${process.env.API_HOSTNAME}:${process.env.API_PORT}${process.env.API_PATH}/tickets`;
        const ticketsResponse = await axios.get(ticketsUrl, {
            headers: {
                'Content-Type': 'application/json',
                apikey: process.env.API_KEY,
                Authorization: process.env.AUTHORIZATION,
                usertoken: passToken
            }
        });
        function getMembershipServices(el) {
            return (el.type == 'membership' && el.service_list && el.service_list.length > 0)
                ? 'Не использовано:\n' + el.service_list.map(ss => `➖${ss.title}\nОстаток: ${ss.count}(${ss.count_reserves})`).join('\n') + '\n'
                : '';
        }
        function getEndDate(el) {
            return (el.end_date) ? '(до ' + new Date(el.end_date).toLocaleDateString("ru-RU") + ')\n' : '';
        }
        function getPackageCount(el) {
            return (el.type == 'package' && el.count) ? `Остаток: ${el.count}\n` : '';
        }
        if (ticketsResponse.data) {
            let txt = ticketsResponse.data.data.map(el => `${this.translateStatus(el.status)}: ${el.title}\n${getEndDate(el)}${getPackageCount(el)}${getMembershipServices(el)}`).join('\n');
            return txt;
        } else {
            return "Нет информации о доступных услугах."
        }
    }

    // получить клиента
    static async getClientResponse(passToken) {
        const clientUrl = `https://${process.env.API_HOSTNAME}:${process.env.API_PORT}${process.env.API_PATH}/client`;
        const clientResponse = await axios.get(clientUrl, {
            headers: {
                'Content-Type': 'application/json',
                apikey: process.env.API_KEY,
                Authorization: process.env.AUTHORIZATION,
                usertoken: passToken
            }
        });
        return clientResponse;
    }

    // +7(978) 566-71-99 хочет на ВПТ
    // переводит в phone: 79785667199, comment: "хочет на ВПТ"
    static parseMessage(message) {
        let match = message?.match(/([+8]?\d?[\s\-\(\)]*\d{3}[\s\-\(\)]*\d{3}[\s\-]*\d{2}[\s\-]*\d{2})([\s\S]*)/);

        if (!match) return null;

        let rawPhone = match[1];
        let comment = match[2].trim().replace(/\s+/g, " "); // Убираем лишние пробелы и переносы строк

        // Очищаем номер от лишних символов
        let phone = rawPhone.replace(/\D/g, "");

        // Приводим к стандартному формату (добавляем 7, если 10 цифр, но не трогаем если уже 11 и начинается на 7)
        if (phone.length === 10) {
            phone = "7" + phone;
        } else if (phone.length === 11 && phone.startsWith("8")) {
            phone = "7" + phone.slice(1);
        } else if (phone.length === 11 && phone.startsWith("+7")) {
            phone = "7" + phone.slice(2);
        }

        return { phone: phone, comment: comment };
    }

    static async getFitDirChatId(prisma) {
        const fitDirPhone = process.env.FIT_DIR_PHONE;
        if (!fitDirPhone) {
            console.error("FIT_DIR_PHONE не задан в .env");
            return null;
        }

        const user = await prisma.user.findUnique({
            where: { phoneNumber: fitDirPhone },
            select: { chatId: true }
        });

        return user ? user.chatId : null;
    }

    // список тренеров по "ТЗ" или "ГП" или "Аква"
    static async getUsersByGoal(prisma, goal) {
        if (!goal) {
            console.error("Goal не задан");
            return [];
        }

        const users = await prisma.user.findMany({
            where: {
                vpt_list: {
                    contains: goal
                }
            },
            orderBy: {
                name: "asc"
            }
        });

        return users;
    }

    static async getUserByChatId(prisma, chatId) {
        if (!chatId) {
            console.error("Chat ID не задан");
            return null;
        }

        const user = await prisma.user.findUnique({
            where: { chatId }
        });

        return user;
    }

    static async createVPTRequest(prisma, userId, screenshotUserId, visitTime, phoneNumber, photo, comment, goal) {
        const vptRequest = await prisma.vPTRequest.create({
            data: {
                user: userId ? { connect: { id: userId } } : undefined, // Связываем user, если userId указан
                screenshotUser: { 
                    connect: { uniqueId: screenshotUserId } // Связываем screenshotUser
                },
                visitTime,
                phoneNumber,
                photo,
                comment,
                goal
            }
        });
    
        return vptRequest;
    }
    


    // Создает отправителя заявки в БД
    static async checkOrCreateScreenshotUser(prisma, telegramID, telegramNickname) {
        try {
            let uniqueId = telegramID.toString();
            let sender = telegramNickname;
            // Проверяем, существует ли ScreenshotUser с таким uniqueId
            let screenshotUser = await prisma.screenshotUser.findUnique({
                where: { uniqueId }
            });

            // Если не найден, создаём нового пользователя
            if (!screenshotUser) {
                screenshotUser = await prisma.screenshotUser.create({
                    data: {
                        uniqueId,
                        sender
                    }
                });
            }

            return screenshotUser;
        } catch (error) {
            console.error("Ошибка при проверке/создании ScreenshotUser:", error);
            throw new Error("Не удалось обработать ScreenshotUser");
        }
    }
}

module.exports = BotHelper;