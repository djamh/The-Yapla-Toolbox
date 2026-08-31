(() => {
    "use strict";

    const TOOL_ID = "translation-search";
    const PANEL_ID = "uts-panel";
    const STYLE_ID = "uts-tool-styles";

    window.YaplaToolbox.registerTool({
        id: TOOL_ID,
        name: "Clés de traduction",
        category: "Traductions",
        icon: "🌐",
        description: "Rechercher dans toutes les pages de traduction.",

        async run() {
            /*
             * If the translation tool is already open,
             * bring it back instead of creating another instance.
             */
            const existing = document.getElementById(PANEL_ID);

            if (existing) {
                existing.style.display = "block";
                return;
            }

            const state = {
                loading: false,
                cancelled: false,
                data: [],
                loadedPages: 0,
                totalPages: null
            };

            function getBasePageUrl() {
                const match = location.pathname.match(
                    /^(.*\/translation)(?:\/page\/\d+)?$/
                );

                if (match) {
                    return `${location.origin}${match[1]}/page/`;
                }

                return `${location.origin}${location.pathname.replace(/\/$/, "")}/page/`;
            }

            function detectTotalPagesFromDocument(doc = document) {
                const pageSpans = Array.from(
                    doc.querySelectorAll(".paginationControl .page")
                );

                const numericPages = pageSpans
                    .map(element =>
                        parseInt(element.textContent.trim(), 10)
                    )
                    .filter(number => !Number.isNaN(number));

                const lastButton = doc.querySelector(
                    ".paginationControl .last[id]"
                );

                const lastButtonId = parseInt(
                    lastButton?.id || "",
                    10
                );

                const candidates = [
                    ...numericPages,
                    ...(Number.isNaN(lastButtonId)
                        ? []
                        : [lastButtonId])
                ];

                return candidates.length
                    ? Math.max(...candidates)
                    : 1;
            }

            function extractRowsFromHtml(html, pageNumber) {
                const doc = new DOMParser().parseFromString(
                    html,
                    "text/html"
                );

                const rows = Array.from(
                    doc.querySelectorAll(
                        "#translation_list tbody tr"
                    )
                );

                return rows.map((row, index) => {
                    const cells = row.querySelectorAll("td");

                    return {
                        page: pageNumber,
                        row: index + 1,
                        feature: (
                            cells[0]?.innerText || ""
                        ).trim(),
                        key: (
                            cells[1]?.innerText || ""
                        ).trim(),
                        valueA: (
                            cells[2]?.innerText || ""
                        ).trim(),
                        valueB: (
                            cells[3]?.innerText || ""
                        ).trim()
                    };
                });
            }

            async function fetchPageRaw(pageNumber) {
                const baseUrl = getBasePageUrl();

                const url =
                    `${baseUrl}${pageNumber}` +
                    `?_=${Date.now()}_${pageNumber}`;

                const response = await fetch(url, {
                    method: "GET",
                    credentials: "same-origin",
                    headers: {
                        "X-Requested-With":
                            "XMLHttpRequest"
                    }
                });

                if (!response.ok) {
                    throw new Error(
                        `Page ${pageNumber} failed with status ${response.status}`
                    );
                }

                return await response.text();
            }

            async function fetchPage(pageNumber) {
                const html =
                    await fetchPageRaw(pageNumber);

                return extractRowsFromHtml(
                    html,
                    pageNumber
                );
            }

            async function detectTotalPagesFromServer() {
                try {
                    const pageOne =
                        await fetchPageRaw(1);

                    const doc =
                        new DOMParser().parseFromString(
                            pageOne,
                            "text/html"
                        );

                    return detectTotalPagesFromDocument(
                        doc
                    );
                } catch (error) {
                    console.warn(
                        "[Translation Search] Could not detect pagination from server. Falling back to current page.",
                        error
                    );

                    return detectTotalPagesFromDocument(
                        document
                    );
                }
            }

            async function loadAllPages() {
                if (state.loading) {
                    return;
                }

                state.loading = true;
                state.cancelled = false;
                state.data = [];
                state.loadedPages = 0;

                updateStatus(
                    "Detecting number of pages..."
                );

                try {
                    state.totalPages =
                        await detectTotalPagesFromServer();
                } catch (error) {
                    state.loading = false;

                    updateStatus(
                        "Unable to detect translation pages."
                    );

                    console.error(error);

                    return;
                }

                updateStatus(
                    `Detected ${state.totalPages} page(s). Starting load...`
                );

                const concurrency = 5;
                let nextPage = 1;

                async function worker() {
                    while (
                        nextPage <= state.totalPages &&
                        !state.cancelled
                    ) {
                        const page = nextPage++;

                        try {
                            const rows =
                                await fetchPage(page);

                            state.data.push(...rows);

                            state.loadedPages++;

                            updateStatus(
                                `Loading pages... ${state.loadedPages} / ${state.totalPages} — ${state.data.length} rows`
                            );
                        } catch (error) {
                            console.error(
                                `Error loading page ${page}:`,
                                error
                            );

                            state.loadedPages++;

                            updateStatus(
                                `Loading pages... ${state.loadedPages} / ${state.totalPages} (some errors) — ${state.data.length} rows`
                            );
                        }
                    }
                }

                const workers = Array.from(
                    { length: concurrency },
                    () => worker()
                );

                await Promise.all(workers);

                state.loading = false;

                /*
                 * Sort because concurrent workers may finish
                 * pages in a different order.
                 */
                state.data.sort((a, b) => {
                    if (a.page !== b.page) {
                        return a.page - b.page;
                    }

                    return a.row - b.row;
                });

                if (state.cancelled) {
                    updateStatus(
                        `Stopped. Loaded ${state.loadedPages} / ${state.totalPages} page(s), ${state.data.length} rows.`
                    );
                } else {
                    updateStatus(
                        `Done. Loaded ${state.loadedPages} / ${state.totalPages} page(s), ${state.data.length} rows.`
                    );
                }

                console.log(
                    "[Translation Search] Loaded rows:",
                    state.data
                );

                return state.data;
            }

            function searchData(term) {
                const query =
                    term.trim().toLowerCase();

                if (!query) {
                    results.innerHTML = `
                        <div class="uts-muted">
                            Enter a search term.
                        </div>
                    `;

                    return;
                }

                const matches = state.data.filter(
                    item => {
                        return (
                            item.feature
                                .toLowerCase()
                                .includes(query) ||

                            item.key
                                .toLowerCase()
                                .includes(query) ||

                            item.valueA
                                .toLowerCase()
                                .includes(query) ||

                            item.valueB
                                .toLowerCase()
                                .includes(query)
                        );
                    }
                );

                const visibleMatches =
                    matches.slice(0, 500);

                const html = visibleMatches
                    .map(item => `
                        <div class="uts-result">
                            <div>
                                <strong>
                                    Page ${item.page}
                                </strong>
                                —
                                <code>
                                    ${escapeHtml(item.key || "—")}
                                </code>
                            </div>

                            <div>
                                <strong>Feature:</strong>
                                ${escapeHtml(item.feature || "—")}
                            </div>

                            <div>
                                <strong>Col 3:</strong>
                                ${escapeHtml(item.valueA || "—")}
                            </div>

                            <div>
                                <strong>Col 4:</strong>
                                ${escapeHtml(item.valueB || "—")}
                            </div>
                        </div>
                    `)
                    .join("");

                results.innerHTML = `
                    <div class="uts-result-count">
                        <strong>${matches.length}</strong>
                        match(es)
                    </div>

                    <div class="uts-result-list">
                        ${
                            html ||
                            "<div>No matches found.</div>"
                        }
                    </div>

                    ${
                        matches.length > 500
                            ? `
                                <div class="uts-muted uts-result-limit">
                                    Showing first 500 results only.
                                </div>
                            `
                            : ""
                    }
                `;
            }

            function escapeHtml(value) {
                return String(value)
                    .replaceAll("&", "&amp;")
                    .replaceAll("<", "&lt;")
                    .replaceAll(">", "&gt;")
                    .replaceAll('"', "&quot;")
                    .replaceAll("'", "&#039;");
            }

            function updateStatus(text) {
                status.textContent = text;
            }

            function injectStyles() {
                if (
                    document.getElementById(STYLE_ID)
                ) {
                    return;
                }

                const style =
                    document.createElement("style");

                style.id = STYLE_ID;

                style.textContent = `
                    #${PANEL_ID},
                    #${PANEL_ID} * {
                        box-sizing: border-box;
                    }

                    #${PANEL_ID} {
                        position: fixed;
                        top: 20px;
                        right: 20px;

                        width: 480px;
                        max-width: calc(100vw - 40px);
                        max-height: 85vh;

                        z-index: 2147483647;

                        display: flex;
                        flex-direction: column;

                        background: #f1f5fd;
                        color: #222;

                        border: 1px solid #ccc;
                        border-radius: 10px;

                        box-shadow:
                            0 10px 25px
                            rgba(0, 0, 0, 0.2);

                        font-family:
                            Arial,
                            sans-serif;

                        overflow: hidden;
                    }

                    #${PANEL_ID} .uts-header {
                        display: flex;
                        justify-content: space-between;
                        align-items: center;

                        padding: 12px;

                        background: #f1f5fd;
                    }

                    #${PANEL_ID} .uts-title {
                        font-size: 16px;
                        font-weight: bold;
                    }

                    #${PANEL_ID} .uts-body {
                        padding: 0 12px 12px;
                        overflow-y: auto;
                    }

                    #${PANEL_ID} .uts-actions {
                        display: flex;
                        gap: 8px;
                        flex-wrap: wrap;

                        margin-bottom: 8px;
                    }

                    #${PANEL_ID} button {
                        background-color: #ff7b14;
                        color: white;

                        border: 0;
                        border-radius: 10px;

                        padding: 8px 15px;

                        font-family:
                            Muli,
                            Arial,
                            Helvetica,
                            sans-serif;

                        font-size: 14px;
                        font-weight: 400;

                        cursor: pointer;
                    }

                    #${PANEL_ID} button:hover {
                        opacity: 0.9;
                    }

                    #${PANEL_ID} button:disabled {
                        opacity: 0.55;
                        cursor: default;
                    }

                    #${PANEL_ID} .uts-close {
                        background: #b7b7b7;

                        padding: 5px 9px;
                    }

                    #${PANEL_ID} .uts-status {
                        margin-bottom: 10px;

                        font-size: 13px;
                        color: #444;
                    }

                    #${PANEL_ID} .uts-input {
                        width: 100%;

                        padding: 10px;

                        margin-bottom: 8px;

                        border: 1px solid #bbb;
                        border-radius: 8px;

                        background: white;

                        font-size: 14px;
                    }

                    #${PANEL_ID} .uts-results {
                        font-size: 13px;
                        line-height: 1.4;
                    }

                    #${PANEL_ID} .uts-result-count {
                        margin-bottom: 8px;
                    }

                    #${PANEL_ID} .uts-result-list {
                        max-height: 400px;
                        overflow: auto;

                        padding: 8px;

                        border: 1px solid #ddd;
                        border-radius: 6px;

                        background: white;
                    }

                    #${PANEL_ID} .uts-result {
                        padding: 8px 0;
                        border-bottom:
                            1px solid #eee;
                    }

                    #${PANEL_ID} .uts-result:last-child {
                        border-bottom: 0;
                    }

                    #${PANEL_ID} .uts-muted {
                        color: #666;
                    }

                    #${PANEL_ID} .uts-result-limit {
                        margin-top: 8px;
                    }

                    #${PANEL_ID} .uts-footer {
                        margin-top: 10px;

                        padding-top: 6px;

                        border-top:
                            1px dashed #c9c9c9;

                        text-align: right;

                        font-size: 11px;
                        font-style: italic;
                        letter-spacing: 1px;

                        color: #6b6b6b;
                    }
                `;

                document.head.appendChild(style);
            }

            injectStyles();

            const panel =
                document.createElement("div");

            panel.id = PANEL_ID;

            panel.innerHTML = `
                <div class="uts-header">

                    <div class="uts-title">
                        Universal Translation Search
                    </div>

                    <button
                        type="button"
                        class="uts-close"
                        aria-label="Close"
                        title="Close"
                    >
                        ✕
                    </button>

                </div>

                <div class="uts-body">

                    <div class="uts-actions">

                        <button
                            type="button"
                            class="uts-load"
                        >
                            Load all pages
                        </button>

                        <button
                            type="button"
                            class="uts-stop"
                        >
                            Stop
                        </button>

                    </div>

                    <div class="uts-status">
                        Ready.
                    </div>

                    <input
                        class="uts-input"
                        type="text"
                        placeholder="Search in feature, key, and last 2 columns"
                        autocomplete="off"
                    >

                    <div class="uts-actions">

                        <button
                            type="button"
                            class="uts-search"
                        >
                            Search
                        </button>

                        <button
                            type="button"
                            class="uts-clear"
                        >
                            Clear
                        </button>

                    </div>

                    <div class="uts-results"></div>

                    <div class="uts-footer">
                        Developed by Djamal
                    </div>

                </div>
            `;

            document.body.appendChild(panel);

            const status =
                panel.querySelector(".uts-status");

            const input =
                panel.querySelector(".uts-input");

            const results =
                panel.querySelector(".uts-results");

            const loadButton =
                panel.querySelector(".uts-load");

            const stopButton =
                panel.querySelector(".uts-stop");

            const searchButton =
                panel.querySelector(".uts-search");

            const clearButton =
                panel.querySelector(".uts-clear");

            const closeButton =
                panel.querySelector(".uts-close");

            closeButton.addEventListener(
                "click",
                () => {
                    state.cancelled = true;
                    panel.remove();
                }
            );

            loadButton.addEventListener(
                "click",
                async () => {
                    loadButton.disabled = true;

                    try {
                        await loadAllPages();
                    } finally {
                        loadButton.disabled = false;
                    }
                }
            );

            stopButton.addEventListener(
                "click",
                () => {
                    state.cancelled = true;

                    updateStatus(
                        `Stopping... already loaded ${state.loadedPages} page(s), ${state.data.length} rows.`
                    );
                }
            );

            function executeSearch() {
                if (!state.data.length) {
                    results.innerHTML = `
                        <div class="uts-muted">
                            Load the pages first.
                        </div>
                    `;

                    return;
                }

                searchData(input.value);
            }

            searchButton.addEventListener(
                "click",
                executeSearch
            );

            clearButton.addEventListener(
                "click",
                () => {
                    input.value = "";
                    results.innerHTML = "";
                    input.focus();
                }
            );

            input.addEventListener(
                "keydown",
                event => {
                    if (event.key === "Enter") {
                        executeSearch();
                    }
                }
            );

            updateStatus(
                "Ready. Click 'Load all pages'."
            );

            input.focus();
        }
    });
})();

