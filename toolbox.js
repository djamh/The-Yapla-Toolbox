(async () => {
    "use strict";

    const TOOLBOX_GLOBAL = "YaplaToolbox";

    /*
     * If the toolbox is already loaded, just toggle it.
     */
    if (
        window[TOOLBOX_GLOBAL] &&
        window[TOOLBOX_GLOBAL].ui &&
        typeof window[TOOLBOX_GLOBAL].ui.toggle === "function"
    ) {
        window[TOOLBOX_GLOBAL].ui.toggle();
        return;
    }

    /*
     * Temporary bootstrap object.
     */
    window[TOOLBOX_GLOBAL] = window[TOOLBOX_GLOBAL] || {};

    /*
     * IMPORTANT:
     * Replace this with your real GitHub Pages URL.
     *
     * Example:
     * https://djamh.github.io/yapla-toolbox
     */
    const BASE_URL = "https://djamh.github.io/The-Yapla-Toolbox";

    /*
     * These are the core files required by the toolbox.
     * Order matters.
     */
    const coreScripts = [
        "core/config.js",
        "core/registry.js",
        "core/loader.js",
        "core/styles.js",
        "core/ui.js"
    ];

    /*
     * Tool definitions.
     *
     * The actual JavaScript for each tool is NOT loaded here.
     * It will only be downloaded when the user clicks the tool.
     */
    window[TOOLBOX_GLOBAL].toolDefinitions = [
        {
            id: "translation-search",
            name: "Clés de traduction",
            category: "Traductions",
            icon: "🌐",
            description: "Rechercher dans toutes les pages de traduction.",
            script: "tools/translation-search/tool.js"
        },
        {
            id: "donor-import",
            name: "Import de donateurs",
            category: "Dons",
            icon: "📄",
            description: "Importer des donateurs depuis un fichier CSV ou Excel.",
            script: "tools/donor-import/tool.js"
        },
        {
            id: "mass-mod",
            name: "Modification en masse",
            category: "Membres",
            icon: "👥",
            description: "Modifier un champ pour plusieurs membres depuis un fichier Excel ou CSV.",
            script: "tools/mass-mod/tool.js"
        },
        {
            id: "payment-attestation",
            name: "Attestation de paiement",
            category: "Comptabilité",
            icon: "🧾",
            description: "Générer une attestation de paiement à partir de Yapla et Stripe.",
            script: "tools/payment-attestation/tool.js"
        }
    ];

    function buildUrl(path) {
        const cleanBaseUrl = BASE_URL.replace(/\/$/, "");
        const cleanPath = path.replace(/^\/+/, "");

        return `${cleanBaseUrl}/${cleanPath}?_=${Date.now()}`;
    }

    function loadScript(path) {
        return new Promise((resolve, reject) => {
            const script = document.createElement("script");

            script.src = buildUrl(path);
            script.async = false;

            script.dataset.yaplaToolboxCore = path;

            script.onload = () => {
                console.log(`[Yapla Toolbox] Loaded ${path}`);
                resolve();
            };

            script.onerror = () => {
                script.remove();

                reject(
                    new Error(
                        `[Yapla Toolbox] Failed to load ${path}`
                    )
                );
            };

            document.head.appendChild(script);
        });
    }

    try {
        /*
         * Load core files sequentially.
         *
         * We intentionally do NOT use Promise.all because:
         *
         * config.js must exist before registry.js,
         * registry.js before loader.js,
         * etc.
         */
        for (const script of coreScripts) {
            await loadScript(script);
        }

        /*
         * toolbox.js knows the deployment URL, so it injects it
         * into config after config.js is loaded.
         */
        window[TOOLBOX_GLOBAL].config.baseUrl =
            BASE_URL.replace(/\/$/, "");

        console.log(
            `[Yapla Toolbox] Started v${window[TOOLBOX_GLOBAL].config.version}`
        );

        window[TOOLBOX_GLOBAL].ui.show();

    } catch (error) {
        console.error(
            "[Yapla Toolbox] Startup failed:",
            error
        );

        alert(
            "Yapla Toolbox could not be loaded.\n\n" +
            (error?.message || error)
        );

        /*
         * Remove the incomplete object so clicking the bookmark
         * again can retry cleanly.
         */
        delete window[TOOLBOX_GLOBAL];
    }
})();

