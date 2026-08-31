(() => {
    "use strict";

    window.YaplaToolbox = window.YaplaToolbox || {};

    window.YaplaToolbox.config = {
        name: "Yapla Toolbox",

        version: "0.1.0",

        /*
         * Base URL where this repository is hosted.
         *
         * Example:
         * https://djamh.github.io/yapla-toolbox
         *
         * We will replace this once your GitHub repository
         * and GitHub Pages URL are confirmed.
         */
        baseUrl: "",

        /*
         * Used to bypass browser caching while we're developing.
         *
         * Later we can replace this with proper version-based caching
         * if desired.
         */
        cacheBust: true,

        /*
         * Toolbox UI settings.
         */
        ui: {
            title: "Yapla Toolbox",
            position: "right",
            width: 420
        },

        /*
         * Development logging.
         *
         * Set to false later if you want a quieter console.
         */
        debug: true
    };

    if (window.YaplaToolbox.config.debug) {
        console.log(
            `[Yapla Toolbox] Config loaded v${window.YaplaToolbox.config.version}`
        );
    }
})();
