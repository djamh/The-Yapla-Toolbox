(() => {
    "use strict";

    window.YaplaToolbox = window.YaplaToolbox || {};

    const tools = new Map();

    function validateTool(tool) {
        if (!tool || typeof tool !== "object") {
            throw new Error("Tool definition must be an object.");
        }

        if (!tool.id || typeof tool.id !== "string") {
            throw new Error("Tool requires a string id.");
        }

        if (!tool.name || typeof tool.name !== "string") {
            throw new Error(`Tool "${tool.id}" requires a name.`);
        }

        if (typeof tool.run !== "function") {
            throw new Error(`Tool "${tool.id}" requires a run() function.`);
        }
    }

    function registerTool(tool) {
        validateTool(tool);

        if (tools.has(tool.id)) {
            console.warn(
                `[Yapla Toolbox] Tool "${tool.id}" is already registered. Replacing it.`
            );
        }

        const normalizedTool = {
            id: tool.id,
            name: tool.name,
            category: tool.category || "Other",
            description: tool.description || "",
            icon: tool.icon || "",
            matches: Array.isArray(tool.matches) ? tool.matches : [],
            run: tool.run
        };

        tools.set(tool.id, normalizedTool);

        if (window.YaplaToolbox.config?.debug) {
            console.log(
                `[Yapla Toolbox] Registered tool: ${normalizedTool.name} (${normalizedTool.id})`
            );
        }

        return normalizedTool;
    }

    function getTool(id) {
        return tools.get(id) || null;
    }

    function getAllTools() {
        return Array.from(tools.values());
    }

    function getToolsByCategory() {
        const grouped = {};

        for (const tool of tools.values()) {
            if (!grouped[tool.category]) {
                grouped[tool.category] = [];
            }

            grouped[tool.category].push(tool);
        }

        return grouped;
    }

    function unregisterTool(id) {
        return tools.delete(id);
    }

    window.YaplaToolbox.registry = {
        registerTool,
        getTool,
        getAllTools,
        getToolsByCategory,
        unregisterTool
    };

    window.YaplaToolbox.registerTool = registerTool;

    if (window.YaplaToolbox.config?.debug) {
        console.log("[Yapla Toolbox] Registry loaded.");
    }
})();

