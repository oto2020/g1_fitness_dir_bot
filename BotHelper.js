const crypto = require('crypto');
const fs = require('fs');
const axios = require('axios');
const path = require('path');

class BotHelper {

    // Работает с API, выдает анкету клиента по номеру телефона
    static async apiClientData(phone) {
        console.log(`Получаю данные клиента по телефону ${phone}`);

        const sign = crypto.createHash('sha256')
            .update(`phone:${phone};key:${process.env.SECRET_KEY}`)
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

            if (!passTokenResponse.data.result || !passTokenResponse.data.data.pass_token) {
                throw new Error('Ошибка получения pass_token');
            }

            const passToken = passTokenResponse.data.data.pass_token;
            const ticketsText = await this.getTicketsText(passToken);
            const clientResponse = await this.getClientResponse(passToken);

            if (!clientResponse.data.result) {
                throw new Error('Ошибка получения данных клиента');
            }

            const client = clientResponse.data.data;
            return {
                passToken,
                ticketsText,
                client: {
                    id: client.id,
                    name: `${client.name} ${client.last_name}`,
                    birthDate: new Date(client.birthday).toLocaleDateString("ru-RU"),
                    phone: phone,
                    photoUrl: client.photo,
                    tags: client.tags.map(tag => `${tag.title}`).join('\n')
                }
            };
        } catch (error) {
            console.error(error);
            return null;
        }
    }

    static async anketaByPhoneSearchAndGoalChoosing(phone, bot, chatId, comment) {
        const clientData = await this.apiClientData(phone);
        if (!clientData) {
            return bot.sendMessage(chatId, 'Ошибка при получении данных клиента.');
        }

        const { ticketsText, client } = clientData;
        let anketa = `${ticketsText}\n${client.name} (${client.birthDate})\n+${client.phone}`;
        let captionText = `${client.tags}\n\n` +
            `${anketa}\n\n` +
            `Ваш комментарий к заявке на ВПТ:\n✍️ ${comment}\n\n` +
            `✅ Чтобы отправить клиента на ВПТ используйте кнопки под этим сообщением 🙂`;

        let apiSendPhotoObj = await this.apiSendPhotoUrl(bot, chatId, client.photoUrl, captionText);
        if (!apiSendPhotoObj) {
            bot.sendMessage(chatId, 'Ошибка при получении фото');
            return;
        }
        const { fileId, messageId } = apiSendPhotoObj;

        let inline_keyboard = [
            [
                { text: "ТЗ 🏋🏼‍♂️", callback_data: `vc_goal@tz@${messageId}@${phone}` },
                { text: "ГП 🤸🏻‍♀️", callback_data: `vc_goal@gp@${messageId}@${phone}` },
                { text: "Аква 🏊", callback_data: `vc_goal@aq@${messageId}@${phone}` }
            ],
            [{ text: "✖️ Закрыть", callback_data: `vc_goal@cancel@${messageId}@${phone}` }]
        ];
        await this.updateInlineKeyboard(bot, chatId, messageId, inline_keyboard);

        return { comment, tags: client.tags, anketa, fileId };
    }

    static captionTextForFitDir(firstRow, vptRequest, screenshotUser, lastRow) {
        const statusText =
            vptRequest.status === 'none' ? 'неразобрано'
                : vptRequest.status === 'accepted' ? 'принято'
                    : vptRequest.status === 'rejected' ? 'отклонено'
                        : 'нет статуса';

        let result = firstRow +
            `${vptRequest.tags}\n\n` +
            `${vptRequest.anketa}\n\n` +
            `✍️  \"${vptRequest.comment}\"\n` +
            `${this.goalRusWithEmojii(vptRequest.goal)}\n` +
            `${this.visitTimeWithEmojii(vptRequest.visitTime)}\n\n` +
            `Автор: ${screenshotUser?.sender}\n\n` +
            `${vptRequest.history}\n\n` +
            `Текущий статус #${vptRequest.id}: ${statusText}` +
            lastRow;

        if (result.length > 1000) {
            const anketaLines = vptRequest.anketa.split('\n');
            const shortenedAnketa = anketaLines.length > 2 ? `...\n${anketaLines.slice(-2).join('\n')}` : '...';
            result = result.replace(vptRequest.anketa, shortenedAnketa);
        }
        if (result.length > 1000) {
            result = result.replace(vptRequest.history, '...');
        }

        return result;
    }

    static captionTextForTrainer(firstRow, vptRequest, lastRow) {
        const statusText =
            vptRequest.status === 'none' ? 'неразобрано'
                : vptRequest.status === 'accepted' ? 'принято'
                    : vptRequest.status === 'rejected' ? 'отклонено'
                        : 'нет статуса';

        let result = firstRow +
            `${vptRequest.anketa}\n\n` +
            `✍️ Комментарий:  ${vptRequest.comment}\n` +
            `${this.goalRusWithEmojii(vptRequest.goal)}\n` +
            `${this.visitTimeWithEmojii(vptRequest.visitTime)}\n\n` +
            lastRow;

        if (result.length > 1000) {
            const anketaLines = vptRequest.anketa.split('\n');
            const shortenedAnketa = anketaLines.length > 2 ? `...\n${anketaLines.slice(-2).join('\n')}` : '...';
            result = result.replace(vptRequest.anketa, shortenedAnketa);
        }
        if (result.length > 1000) {
            result = result.replace(vptRequest.history, '...');
        }

        return result;
    }



    // Удаляет тег тренера из 1С
    static async deleteTagForVptRequest(bot, chatId, prisma, vptRequest) {
        try {
            let phoneWithoutPlus = this.parseMessage(vptRequest.phoneNumber)?.phone;

            let trainerId = vptRequest.userId;
            if (trainerId) {
                let trainer = await this.getUserById(prisma, trainerId);

                // Получаем анкету по API
                let clientData = await this.apiClientData(phoneWithoutPlus);
                if (!clientData) {
                    return bot.sendMessage(chatId, 'Ошибка при получении данных клиента.');
                }

                // Собираем ТЕГ ТРЕНЕРА
                let newTag = BotHelper.getTag(trainer.name, vptRequest.goal);
                // Отправка POST-запроса на /tag
                const tagUrl = `https://${process.env.API_HOSTNAME}:${process.env.API_PORT}${process.env.API_PATH}/tag?tag=${newTag}&client_id=${clientData.client.id}`;
                await axios.delete(tagUrl, {
                    headers: {
                        'Content-Type': 'application/json',
                        apikey: process.env.API_KEY,
                        Authorization: process.env.AUTHORIZATION,
                        usertoken: clientData.passToken
                    }
                });

                // Обновляем данные, чтобы иметь актуальные теги
                clientData = await this.apiClientData(phoneWithoutPlus);
                if (!clientData) {
                    return bot.sendMessage(chatId, 'Ошибка при получении данных клиента.');
                }
                // актуализируем данные в заявке
                await this.updateVptRequestTags(prisma, vptRequest.id, clientData.client.tags);

                console.log(`Обновлены данные заявки #${vptRequest.id} Удален тег: ${newTag}`);
            }
        } catch (e) {
            console.error('Не удалось удалить тег тренера из 1С', e);
        }

    }

    // Отправляет анкету тренеру, ставит тег тренера в 1С
    static async anketaToTrainer(bot, chatId, prisma, trainer, vptRequest) {
        let phoneWithoutPlus = this.parseMessage(vptRequest.phoneNumber)?.phone;
        // Получаем анкету по API
        let clientData = await this.apiClientData(phoneWithoutPlus);
        if (!clientData) {
            return bot.sendMessage(chatId, 'Ошибка при получении данных клиента.');
        }

        //  Задел на будущее. Не трогать! Пока что не работает this.deleteTag
        // // УДАЛЯЕМ ВСЕ ТЕГИ для goal
        // let tags = clientData.client.tags.split("\n");
        // for (let tag of tags) {
        //     if (tag.startsWith(`ВПТ ${vptRequest.goal}`)) {
        //         console.log(`Удаляем тег ${tag}`);
        //         try {
        //             await this.deleteTag(clientData.passToken, clientData.client.id, tag);
        //         } catch (e) {
        //             console.error(e);
        //         }
        //     } else {
        //         console.log(`Оставляем тег ${tag}`);
        //     }
        // }

        // Ставим нужный ТЕГ ТРЕНЕРА
        let newTag = BotHelper.getTag(trainer.name, vptRequest.goal);
        try {
            console.log(`Ставим тег ${newTag}`);
            await this.addTag(clientData.passToken, clientData.client.id, newTag);
        } catch (e) {
            console.error(e);
        }
        console.log(`Обновлены данные заявки #${vptRequest.id}, новый userId: ${trainer.id}, новый тег: ${newTag}`);

        // Обновляем данные, чтобы иметь актуальные теги
        clientData = await this.apiClientData(phoneWithoutPlus);
        if (!clientData) {
            return bot.sendMessage(chatId, 'Ошибка при получении данных клиента.');
        }

        // актуализируем данные в анкете
        await this.updateVptRequestAnketa(prisma, vptRequest.id, clientData.client.anketa);
        await this.updateVptRequestTags(prisma, vptRequest.id, clientData.client.tags);
        let newHistory = `${vptRequest.history}\n\n${this.nowDateTime()}\n🎯 Отправлено '${newTag}'`;
        await this.updateVptRequestHistory(prisma, vptRequest.id, newHistory);

        const { client } = clientData;

        let firstRow = `Тренер @${trainer.nick} взять клиента на ВПТ\n\n`;
        let lastRow = `\n\n⚠️ Если не нажать на кнопку "Беру" / "Не беру" в течение двух суток (до ${this.nowPlus48Hours()}), клиент будет передан другому тренеру, а ваша эффективность будет снижена. Заинтересованный клиент ждёт.`
        let captionText = this.captionTextForTrainer(firstRow, vptRequest, lastRow);
        let apiSendPhotoObj = await this.apiSendPhotoUrl(bot, trainer.chatId, client.photoUrl, captionText);
        if (!apiSendPhotoObj) {
            bot.sendMessage(chatId, 'Ошибка при получении фото');
            return;
        }
        const { messageId } = apiSendPhotoObj;

        // Обновляем кнопки
        let inline_keyboard_for_trainer = [
            [
                {
                    text: '✅ Беру',
                    callback_data: [`vpt_status`, `accepted`, vptRequest.id].join('@')
                },
                {
                    text: '❌ Не беру',
                    callback_data: [`vpt_status`, `rejected`, vptRequest.id].join('@')
                }
            ]
        ];
        await this.updateInlineKeyboard(bot, trainer.chatId, messageId, inline_keyboard_for_trainer);

        // Чтобы потом можно было удалить сообщение вместе с заявкой
        // Обновляем в vptRequest добавляем "|chatId@messageId" в vptRequest.tgChatIdMessageId
        let newTgChatMessageId = `${vptRequest.tgChatMessageId}|${trainer.chatId}@${messageId}`;
        await this.updateVptRequestTgChatMessageId(prisma, vptRequest.id, newTgChatMessageId);
        
        await this.updateVptRequestUserId(prisma, vptRequest.id, trainer.id);
        await this.updateVptRequestCreatedAt(prisma, vptRequest.id);

        bot.sendMessage(chatId, `Отправлено ${newTag}\nПросмотр: /vpt_request_show${vptRequest.id}`);

        return messageId;
    }


    // Передаем анкету фитнес-директору
    static async anketaToFitDir(bot, prisma, vptRequest) {
        // Когда передаем фитдиру тренер обнуляется
        vptRequest = await this.updateVptRequestUserId(prisma, vptRequest.id, null);
        let requestVptPhotoId = vptRequest.photo;
        let screenshotUser = await this.getScreenshotUserById(prisma, vptRequest.screenshotUserId);
        console.log('Ща отправим фото и мегакоммент с кнопками выбора тренеров');

        let fitDirUser = await this.getFitDirUser(prisma);
        if (!fitDirUser) {
            bot.sendMessage('ФитДир не найден, проверьте настройки .env');
            return;
        }
        let fitDirChatId = fitDirUser.chatId;

        // отправляем ФИТДИРУ сообщение с фото, пока без кнопок
        let firstRow = `ФД @${fitDirUser.nick} назначить тренера \n\n`;
        const sentMessage = await bot.sendPhoto(fitDirChatId, requestVptPhotoId, {
            caption: this.captionTextForFitDir(firstRow, vptRequest, screenshotUser, '')
        });
        let messageId = sentMessage.message_id; // Возвращаем ID отправленного сообщения

        // Чтобы потом можно было удалить сообщение вместе с заявкой
        // Обновляем в vptRequest добавляем "|chatId@messageId" в vptRequest.tgChatIdMessageId
        let newTgChatMessageId = `${vptRequest.tgChatMessageId}|${fitDirChatId}@${messageId}`;
        await this.updateVptRequestTgChatMessageId(prisma, vptRequest.id, newTgChatMessageId);

        // Добавляем клавиатуру с тренерами
        await this.addKeyboard(prisma, bot, messageId, vptRequest, fitDirUser);
    }

    static async addKeyboard(prisma, bot, messageId, vptRequest, fitDirUser) {
        let fitDirChatId = fitDirUser.chatId;
        let goalRus = vptRequest.goal;

        // генерируем клавиатуру с тренерами
        let trainersWithGoal = await this.getUsersByGoal(prisma, goalRus);
        trainersWithGoal = trainersWithGoal.map(el => { return { name: el.name, chatId: el.chatId, telegramID: el.telegramID }; });
        let buttonsPerRow = 3;
        let inline_keyboard = [];
        let row = [];
        trainersWithGoal.forEach((trainer, index) => {
            row.push({
                text: trainer.name,
                callback_data: ['vs', messageId, trainer.chatId, vptRequest.id].join('@')
            });
            if (row.length === buttonsPerRow || index === trainersWithGoal.length - 1) {
                inline_keyboard.push(row);
                row = [];
            }
        });

        // Добавляем кнопку закрытия в отдельный ряд
        inline_keyboard.push([
            { text: "🗑 Удалить заявку", callback_data: ['vpt_delete', vptRequest.id].join('@') } // Удаление заявки ВПТ 
        ]);

        await this.updateInlineKeyboard(bot, fitDirChatId, messageId, inline_keyboard);
        console.log('keyboard with trainers updated!');
    }


    static async fetchPhotoWithRetry(photoUrl, retries = 5, delay = 1000) {
        const headers = {
            'Authorization': process.env.AUTHORIZATION,
            'apikey': process.env.API_KEY
        };

        for (let i = 0; i < retries; i++) {
            try {
                const response = await axios.get(photoUrl, {
                    headers,
                    responseType: 'arraybuffer'
                });

                const filePath = path.join(__dirname, 'photo.jpg');
                fs.writeFileSync(filePath, response.data);
                console.log('Файл успешно загружен:', filePath);
                return filePath;
            } catch (error) {
                console.error(`Попытка ${i + 1} не удалась:`, error.message);
                if (i < retries - 1) {
                    const waitTime = delay * Math.pow(2, i);
                    console.log(`Ожидание ${waitTime} мс перед следующей попыткой...`);
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                } else {
                    console.error('Все попытки исчерпаны. Не удалось загрузить фото.');
                }
            }
        }
    }
    // Функция отправки изображения с captionText в чат cahtId и возвращает fileId (фото телеграм)  и messageId (id сообщения в чате)
    static async apiSendPhotoUrl(bot, chatId, photoUrl, captionText) {
        try {
            let filePath;

            if (!photoUrl) {
                // Если URL пустой, используем локальный файл g1.jpeg
                filePath = path.join(__dirname, 'g1.jpeg');
            } else {
                let apiFilePath = await this.fetchPhotoWithRetry(photoUrl);
                filePath = apiFilePath || filePath;
            }

            const sentMessage = await bot.sendPhoto(chatId, filePath, {
                caption: captionText
            });

            const messageId = sentMessage.message_id;
            const fileId = sentMessage.photo[sentMessage.photo.length - 1].file_id;

            // Удаляем временный файл, если загружали его
            if (photoUrl) {
                fs.unlinkSync(filePath);
            }

            return { fileId, messageId };
        } catch (error) {
            bot.sendMessage(chatId, 'Не удалось загрузить фото.');
            console.error('Ошибка загрузки фото:', error);
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
        const tagUrl = `https://${process.env.API_HOSTNAME}:${process.env.API_PORT}${process.env.API_PATH}/tag?tag=${tag}&client_id=${clientId}`;
        await axios.delete(tagUrl, {
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
            return (el.type === 'membership' && el.service_list && el.service_list.length > 0)
                ? 'Не использовано:\n' + el.service_list
                    .map(ss => `🔥 ${ss.title}\nОстаток: ${ss.count}, резерв: ${ss.count_reserves}`).join('\n') + '\n'
                : '';
        }

        function getEndDate(el) {
            return el.end_date
                ? `(до ${new Date(el.end_date).toLocaleDateString("ru-RU")})\n`
                : '';
        }

        function getPackageCount(el) {
            return (el.type === 'package' && el.count)
                ? `Остаток: ${el.count}\n`
                : '';
        }

        if (ticketsResponse.data) {
            // Фильтруем только package и membership
            const filteredData = ticketsResponse.data.data.filter(el =>
                el.type === 'package' || el.type === 'membership'
            );

            let txt = filteredData.map(el =>
                `${this.translateStatus(el.status)}: ${el.title}\n${getEndDate(el)}${getPackageCount(el)}${getMembershipServices(el)}`
            ).join('\n');

            return txt || "Нет информации о доступных услугах.";
        } else {
            return "Нет информации о доступных услугах.";
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

    static nowDateTime() {
        let nowdatetime = new Date().toLocaleString('ru-RU', {
            timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });
        return nowdatetime;
    }

    static nowPlus48Hours() {
        let now = new Date();
        now.setHours(now.getHours() + 48); // Добавляем 48 часов
    
        let newDateTime = now.toLocaleString('ru-RU', {
            timeZone: 'Europe/Moscow',
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });
    
        return newDateTime;
    }
    
    
    static async getExpiredRequests(prisma) {
        const twoDaysAgo = new Date();
        twoDaysAgo.setHours(twoDaysAgo.getHours() - 48); // Отнимаем 48 часов

        return await prisma.vPTRequest.findMany({
            where: {
                status: 'none',
                createdAt: { lt: twoDaysAgo }
            }
        });
    }


    static tomorrowDateTime14h00m() {
        let now = new Date();
    
        // Добавляем 1 день
        now.setDate(now.getDate() + 1);
    
        // Устанавливаем время на 14:00
        now.setHours(14, 0, 0, 0);
    
        let formattedDateTime = now.toLocaleString('ru-RU', {
            timeZone: 'Europe/Moscow', 
            day: '2-digit', 
            month: '2-digit', 
            year: 'numeric',
            hour: '2-digit', 
            minute: '2-digit'
        });
    
        return formattedDateTime;
    }

    
    static async getFitDirUser(prisma) {
        const fitDirPhone = process.env.FIT_DIR_PHONE;
        if (!fitDirPhone) {
            console.error("FIT_DIR_PHONE не задан в .env");
            return null;
        }

        const user = await prisma.user.findUnique({
            where: { phoneNumber: fitDirPhone }
        });

        return user ? user : null;
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

    static async getUserById(prisma, id) {
        if (!id) {
            console.error("ID не задан");
            return null;
        }

        const user = await prisma.user.findUnique({
            where: { id }
        });

        return user;
    }

    static async getScreenshotUserById(prisma, id) {
        if (!id) {
            console.error("ID не задан");
            return null;
        }

        const user = await prisma.screenshotUser.findUnique({
            where: { uniqueId: id }
        });

        return user;
    }

    static async getVPTRequestById(prisma, id) {
        try {
            const vptRequest = await prisma.vPTRequest.findUnique({
                where: { id }
            });

            return vptRequest;
        } catch (error) {
            console.error(`Ошибка получения vPTRequest с id ${id}:`, error);
            return null;
        }
    }

    static async deleteVPTRequestById(prisma, id) {
        try {
            const deletedRequest = await prisma.vPTRequest.delete({
                where: { id }
            });

            return deletedRequest;
        } catch (error) {
            console.error(`Ошибка удаления vPTRequest с id ${id}:`, error);
            return null;
        }
    }


    static async createVPTRequest(prisma, userId, screenshotUserId, visitTime, phoneNumber, photo, comment, anketa, history, tags, goal, tgChatMessageId) {
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
                anketa,
                history,
                tags,
                goal,
                tgChatMessageId
            }
        });

        return vptRequest;
    }

    // Отправляет сообщение и обновляет историю
    static async anketaForVptRequest (bot, prisma, vptRequest, chatId, captionText) {
        try {
            let sentMessage = await bot.sendPhoto(chatId, vptRequest.photo, { caption: captionText });   
            // Чтобы потом можно было удалить сообщение вместе с заявкой
            // Обновляем в vptRequest добавляем "|chatId@messageId" в vptRequest.tgChatIdMessageId
            let newTgChatMessageId = `${vptRequest.tgChatMessageId}|${chatId}@${sentMessage.message_id}`;
            vptRequest = await this.updateVptRequestTgChatMessageId(prisma, vptRequest.id, newTgChatMessageId);
            return { sentMessage, vptRequest }
        } catch (e) {
            console.error(e);
            return null;
        }

    }
    // обновляет поле tgChatMessageId для заявки на ВПТ
    static async updateVptRequestTgChatMessageId(prisma, id, tgChatMessageId) {
        try {
            const updatedRequest = await prisma.vPTRequest.update({
                where: { id },
                data: { tgChatMessageId }
            });

            return updatedRequest;
        } catch (error) {
            console.error(`Ошибка обновления tgChatMessageId для vPTRequest с id ${id}:`, error);
            return null;
        }
    }


    static async updateVptRequestAnketa(prisma, id, anketa) {
        try {
            const updatedRequest = await prisma.vPTRequest.update({
                where: { id },
                data: { anketa }
            });

            return updatedRequest;
        } catch (error) {
            console.error(`Ошибка обновления anketa для vPTRequest с id ${id}:`, error);
            return null;
        }
    }
    static async updateVptRequestTags(prisma, id, tags) {
        try {
            const updatedRequest = await prisma.vPTRequest.update({
                where: { id },
                data: { tags }
            });

            return updatedRequest;
        } catch (error) {
            console.error(`Ошибка обновления tags для vPTRequest с id ${id}:`, error);
            return null;
        }
    }
    static async updateVptRequestHistory(prisma, id, history) {
        try {
            const updatedRequest = await prisma.vPTRequest.update({
                where: { id },
                data: { history }
            });

            return updatedRequest;
        } catch (error) {
            console.error(`Ошибка обновления history для vPTRequest с id ${id}:`, error);
            return null;
        }
    }

    static async updateVPTRequestPhoto(prisma, id, photoUrl) {
        try {
            const updatedRequest = await prisma.vPTRequest.update({
                where: { id },
                data: { photo: photoUrl }
            });

            return updatedRequest;
        } catch (error) {
            console.error(`Ошибка обновления photoUrl для vPTRequest с id ${id}:`, error);
            return null;
        }
    }

    static async updateVptRequestCreatedAt(prisma, id) {
        try {
            const updatedRequest = await prisma.vPTRequest.update({
                where: { id },
                data: { createdAt: new Date() }
            });
    
            return updatedRequest;
        } catch (error) {
            console.error(`Ошибка обновления created_at для vPTRequest с id ${id}:`, error);
            return null;
        }
    }

    
    static async updateVptRequestUserId(prisma, id, userId) {
        try {
            const updatedRequest = await prisma.vPTRequest.update({
                where: { id },
                data: { userId: userId }
            });

            return updatedRequest;
        } catch (error) {
            console.error(`Ошибка обновления userId для vPTRequest с id ${id}:`, error);
            return null;
        }
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

    static getQueryTelegramUserInfo(query) {
        return '@' + (query?.from?.username || 'НетНикнейма') + ' (' + (query?.from?.first_name || 'НетИмени ') + ' ' + (query?.from?.last_name || 'НетФамилии') + ')'; // Никнейм (может отсутствовать)
    }

    static goalRus(goal) {
        let goalRus = goal;
        if (goal === 'tz') { goalRus = 'ТЗ'; }
        if (goal === 'gp') { goalRus = 'ГП'; }
        if (goal === 'aq') { goalRus = 'Аква'; }
        return goalRus;
    }

    static goalRusWithEmojii(goal) {
        let goalRus = goal;
        if (goal === 'tz' || goal === 'ТЗ') { goalRus = '🏋🏼‍♂️ ТЗ'; }
        if (goal === 'gp' || goal === 'ГП') { goalRus = '🤸🏻‍♀️ ГП'; }
        if (goal === 'aq' || goal === 'Аква') { goalRus = '🏊 Аква'; }
        return goalRus;
    }

    static visitTimeWithEmojii(visitTime) {
        let result = visitTime;
        if (visitTime === 'Утро') { result = '🌅 Утро'; }
        if (visitTime === 'Обед') { result = '☀️ Обед'; }
        if (visitTime === 'Вечер') { result = '🌙 Вечер'; }
        if (visitTime === 'Весь день') { result = '🌍 Весь день'; }
        return result;
    }

    static getTag(tarinerName, goalRus) {
        if (!tarinerName) return '';
        const parts = tarinerName.trim().split(/\s+/);
        if (parts.length === 0) return '';

        const lastName = parts[0]; // Первая часть - фамилия
        const initials = parts.slice(1).map(name => name[0] + '.').join(''); // Первые буквы остальных имен

        return `ВПТ ${goalRus} ${lastName} ${initials}`;
    }

}

module.exports = BotHelper;