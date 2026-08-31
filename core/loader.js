javascript
(() => {
    "use strict";

    window.YaplaToolbox = window.YaplaToolbox || {};

    const loadedScripts = new Map();

    function getBaseUrl() {
        const baseUrl = window.YaplaToolbox.config?.baseUrl || "";

        if (!baseUrl) {
            throw new Error(
                "[Yapla Toolbox] baseUrl is not configured in core/config.js"
            );
        }

        return baseUrl.replace(/\/$/, "");
    }

    function buildScriptUrl(path) {
        const baseUrl = getBaseUrl();

        const cleanPath = String(path || "")
            .replace(/^\/+/, "")
            .trim();

        if (!cleanPath) {
            throw new Error("[Yapla Toolbox] Missing script path.");
        }

        let url = `${baseUrl}/${cleanPath}`;

        if (window.YaplaToolbox.config?.cacheBust) {
            const separator = url.includes("?") ? "&" : "?";
            url += `${separator}_=${Date.now()}`;
        }

        return url;
    }

    function loadScript(path, options = {}) {
        const {
            forceReload = false,
            id = null
        } = options;

        const cacheKey = id || path;

        if (!forceReload && loadedScripts.has(cacheKey)) {
            return loadedScripts.get(cacheKey);
        }

        const promise = new Promise((resolve, reject) => {
            let scriptUrl;

            try {
                scriptUrl = buildScriptUrl(path);
            } catch (error) {
                reject(error);
                return;
            }

            const script = document.createElement("script");

            script.src = scriptUrl;
            script.async = true;

            script.dataset.yaplaToolboxScript = cacheKey;

            script.onload = () => {
                if (window.YaplaToolbox.config?.debug) {
                    console.log(
                        `[Yapla Toolbox] Loaded script: ${path}`
                    );
                }

                resolve({
                    path,
                    url: scriptUrl
                });
            };

            script.onerror = () => {
                loadedScripts.delete(cacheKey);
                script.remove();

                reject(
                    new Error(
                        `[Yapla Toolbox] Failed to load script: ${scriptUrl}`
                    )
                );
            };

            document.head.appendChild(script);
        });

        loadedScripts.set(cacheKey, promise);

        return promise;
    }

    async function loadTool(toolDefinition) {
        if (!toolDefinition || typeof toolDefinition !== "object") {
            throw new Error(
                "[Yapla Toolbox] Invalid tool definition."
            );
        }

        if (!toolDefinition.id) {
            throw new Error(
                "[Yapla Toolbox] Tool definition requires an id."
            );
        }

        if (!toolDefinition.script) {
            throw new Error(
                `[Yapla Toolbox] Tool "${toolDefinition.id}" has no script path.`
            );
        }

        const existingTool =
            window.YaplaToolbox.registry?.getTool(toolDefinition.id);

        if (existingTool) {
            return existingTool;
        }

        await loadScript(toolDefinition.script, {
            id: `tool:${toolDefinition.id}`
        });

        const registeredTool =
            window.YaplaToolbox.registry?.getTool(toolDefinition.id);

        if (!registeredTool) {
            throw new Error(
                `[Yapla Toolbox] Script loaded for "${toolDefinition.id}", but the tool did not register itself.`
            );
        }

        return registeredTool;
    }

    async function runTool(toolDefinition) {
        const tool = await loadTool(toolDefinition);

        if (typeof tool.run !== "function") {
            throw new Error(
                `[Yapla Toolbox] Tool "${tool.id}" has no run() function.`
            );
        }

        if (window.YaplaToolbox.config?.debug) {
            console.log(
                `[Yapla Toolbox] Running tool: ${tool.name}`
            );
        }

        return await tool.run();
    }

    function isLoaded(cacheKey) {
        return loadedScripts.has(cacheKey);
    }

    window.YaplaToolbox.loader = {
        buildScriptUrl,
        loadScript,
        loadTool,
        runTool,
        isLoaded
    };

    if (window.YaplaToolbox.config?.debug) {
        console.log("[Yapla Toolbox] Loader loaded.");
    }
})();

