```javascript
(() => {
    "use strict";

    window.YaplaToolbox = window.YaplaToolbox || {};

    const PANEL_ID = "yapla-toolbox-panel";

    let panel = null;

    function getToolDefinitions() {
        return window.YaplaToolbox.toolDefinitions || [];
    }

    function createPanel() {
        const existing = document.getElementById(PANEL_ID);

        if (existing) {
            panel = existing;
            return panel;
        }

        window.YaplaToolbox.styles?.inject();

        panel = document.createElement("div");
        panel.id = PANEL_ID;

        panel.innerHTML = `
            <div id="yapla-toolbox-header">
                <div id="yapla-toolbox-header-left">
                    <div id="yapla-toolbox-title">
                        ${escapeHtml(
                            window.YaplaToolbox.config?.ui?.title ||
                            window.YaplaToolbox.config?.name ||
                            "Yapla Toolbox"
                        )}
                    </div>

                    <div id="yapla-toolbox-version">
                        v${escapeHtml(
                            window.YaplaToolbox.config?.version || "0.0.0"
                        )}
                    </div>
                </div>

                <button
                    id="yapla-toolbox-close"
                    type="button"
                    title="Close toolbox"
                    aria-label="Close toolbox"
                >
                    ✕
                </button>
            </div>

            <div id="yapla-toolbox-content">

                <div id="yapla-toolbox-message"></div>

                <div id="yapla-toolbox-search-wrapper">
                    <input
                        id="yapla-toolbox-search"
                        type="text"
                        placeholder="Search tools..."
                        autocomplete="off"
                    >
                </div>

                <div id="yapla-toolbox-tools"></div>

            </div>

            <div id="yapla-toolbox-footer">
                Developed by Djamal
            </div>
        `;

        document.body.appendChild(panel);

        bindEvents();
        renderTools();

        return panel;
    }

    function bindEvents() {
        if (!panel) {
            return;
        }

        const closeButton = panel.querySelector("#yapla-toolbox-close");
        const searchInput = panel.querySelector("#yapla-toolbox-search");

        closeButton?.addEventListener("click", () => {
            hide();
        });

        searchInput?.addEventListener("input", () => {
            renderTools(searchInput.value);
        });
    }

    function renderTools(searchTerm = "") {
        if (!panel) {
            return;
        }

        const container = panel.querySelector("#yapla-toolbox-tools");

        if (!container) {
            return;
        }

        const definitions = getToolDefinitions();

        const query = searchTerm.trim().toLowerCase();

        const filtered = definitions.filter(tool => {
            if (!query) {
                return true;
            }

            const haystack = [
                tool.name,
                tool.category,
                tool.description,
                tool.id
            ]
                .filter(Boolean)
                .join(" ")
                .toLowerCase();

            return haystack.includes(query);
        });

        if (!filtered.length) {
            container.innerHTML = `
                <div class="yapla-toolbox-empty">
                    No tools found.
                </div>
            `;
            return;
        }

        const grouped = groupByCategory(filtered);

        container.innerHTML = "";

        for (const [category, tools] of Object.entries(grouped)) {
            const section = document.createElement("section");

            section.className = "yapla-toolbox-category";

            const title = document.createElement("div");
            title.className = "yapla-toolbox-category-title";
            title.textContent = category;

            const list = document.createElement("div");
            list.className = "yapla-toolbox-tool-list";

            for (const tool of tools) {
                list.appendChild(createToolButton(tool));
            }

            section.appendChild(title);
            section.appendChild(list);

            container.appendChild(section);
        }
    }

    function createToolButton(toolDefinition) {
        const button = document.createElement("button");

        button.type = "button";
        button.className = "yapla-toolbox-tool";

        button.dataset.toolId = toolDefinition.id;

        button.innerHTML = `
            <div class="yapla-toolbox-tool-icon">
                ${escapeHtml(toolDefinition.icon || "🧰")}
            </div>

            <div class="yapla-toolbox-tool-info">
                <div class="yapla-toolbox-tool-name">
                    ${escapeHtml(toolDefinition.name)}
                </div>

                ${
                    toolDefinition.description
                        ? `
                            <div class="yapla-toolbox-tool-description">
                                ${escapeHtml(toolDefinition.description)}
                            </div>
                        `
                        : ""
                }
            </div>

            <div class="yapla-toolbox-tool-status">
                ›
            </div>
        `;

        button.addEventListener("click", async () => {
            await handleToolClick(button, toolDefinition);
        });

        return button;
    }

    async function handleToolClick(button, toolDefinition) {
        if (button.disabled) {
            return;
        }

        button.disabled = true;

        const status = button.querySelector(
            ".yapla-toolbox-tool-status"
        );

        if (status) {
            status.textContent = "…";
        }

        showMessage(
            `Loading ${toolDefinition.name}...`,
            "info"
        );

        try {
            await window.YaplaToolbox.loader.runTool(toolDefinition);

            if (status) {
                status.textContent = "✓";
            }

            showMessage(
                `${toolDefinition.name} launched.`,
                "success"
            );

            /*
             * The toolbox hides after launching a tool.
             *
             * This keeps the page clean while the selected tool's
             * own interface is open.
             *
             * If we later decide some tools should keep the toolbox
             * visible, we can make this configurable per tool.
             */
            hide();

        } catch (error) {
            console.error(
                `[Yapla Toolbox] Failed to run tool "${toolDefinition.id}":`,
                error
            );

            if (status) {
                status.textContent = "!";
            }

            showMessage(
                error?.message ||
                `Failed to launch ${toolDefinition.name}.`,
                "error"
            );

        } finally {
            button.disabled = false;

            setTimeout(() => {
                if (status && status.textContent !== "!") {
                    status.textContent = "›";
                }
            }, 1200);
        }
    }

    function groupByCategory(tools) {
        const grouped = {};

        for (const tool of tools) {
            const category = tool.category || "Other";

            if (!grouped[category]) {
                grouped[category] = [];
            }

            grouped[category].push(tool);
        }

        return grouped;
    }

    function showMessage(text, type = "info") {
        if (!panel) {
            return;
        }

        const message = panel.querySelector("#yapla-toolbox-message");

        if (!message) {
            return;
        }

        message.className = "";

        message.id = "yapla-toolbox-message";
        message.classList.add("is-visible", type);
        message.textContent = text;
    }

    function clearMessage() {
        if (!panel) {
            return;
        }

        const message = panel.querySelector("#yapla-toolbox-message");

        if (!message) {
            return;
        }

        message.className = "";
        message.id = "yapla-toolbox-message";
        message.textContent = "";
    }

    function show() {
        createPanel();

        panel.classList.remove("yapla-toolbox-hidden");

        clearMessage();

        const searchInput = panel.querySelector(
            "#yapla-toolbox-search"
        );

        if (searchInput) {
            searchInput.focus();
        }

        window.YaplaToolbox.isOpen = true;
    }

    function hide() {
        if (!panel) {
            return;
        }

        panel.classList.add("yapla-toolbox-hidden");

        window.YaplaToolbox.isOpen = false;
    }

    function toggle() {
        if (!panel) {
            show();
            return;
        }

        if (panel.classList.contains("yapla-toolbox-hidden")) {
            show();
        } else {
            hide();
        }
    }

    function destroy() {
        panel?.remove();
        panel = null;

        window.YaplaToolbox.isOpen = false;
    }

    function escapeHtml(value) {
        return String(value ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }

    window.YaplaToolbox.ui = {
        create: createPanel,
        renderTools,
        show,
        hide,
        toggle,
        destroy,
        showMessage,
        clearMessage
    };

    if (window.YaplaToolbox.config?.debug) {
        console.log("[Yapla Toolbox] UI module loaded.");
    }
})();
```
