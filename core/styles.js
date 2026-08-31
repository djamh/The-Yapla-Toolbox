```javascript
(() => {
    "use strict";

    window.YaplaToolbox = window.YaplaToolbox || {};

    const STYLE_ID = "yapla-toolbox-styles";

    const css = `
        #yapla-toolbox-panel,
        #yapla-toolbox-panel * {
            box-sizing: border-box;
        }

        #yapla-toolbox-panel {
            position: fixed;
            top: 20px;
            right: 20px;
            width: 420px;
            max-width: calc(100vw - 40px);
            max-height: calc(100vh - 40px);
            z-index: 2147483647;

            display: flex;
            flex-direction: column;

            background: #f7f8fb;
            color: #222;

            border: 1px solid #d7dbe3;
            border-radius: 14px;

            box-shadow:
                0 18px 45px rgba(0, 0, 0, 0.18),
                0 3px 10px rgba(0, 0, 0, 0.08);

            font-family:
                Muli,
                Arial,
                Helvetica,
                sans-serif;

            overflow: hidden;
        }

        #yapla-toolbox-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;

            padding: 14px 16px;

            background: #ffffff;
            border-bottom: 1px solid #e3e6eb;
        }

        #yapla-toolbox-header-left {
            min-width: 0;
        }

        #yapla-toolbox-title {
            margin: 0;
            font-size: 17px;
            line-height: 1.2;
            font-weight: 700;
            color: #222;
        }

        #yapla-toolbox-version {
            margin-top: 3px;
            font-size: 11px;
            color: #7a7f89;
        }

        #yapla-toolbox-close {
            width: 34px;
            height: 34px;
            min-width: 34px;

            display: inline-flex;
            align-items: center;
            justify-content: center;

            padding: 0;

            border: 0;
            border-radius: 8px;

            background: #eceef2;
            color: #333;

            font-size: 18px;
            line-height: 1;

            cursor: pointer;
        }

        #yapla-toolbox-close:hover {
            background: #dfe2e8;
        }

        #yapla-toolbox-content {
            min-height: 0;
            overflow-y: auto;
            padding: 14px;
        }

        #yapla-toolbox-search-wrapper {
            margin-bottom: 14px;
        }

        #yapla-toolbox-search {
            width: 100%;

            padding: 10px 12px;

            border: 1px solid #cfd4dc;
            border-radius: 9px;

            background: #ffffff;
            color: #222;

            font: inherit;
            font-size: 14px;

            outline: none;
        }

        #yapla-toolbox-search:focus {
            border-color: #ff7b14;
            box-shadow: 0 0 0 2px rgba(255, 123, 20, 0.15);
        }

        #yapla-toolbox-tools {
            display: flex;
            flex-direction: column;
            gap: 16px;
        }

        .yapla-toolbox-category {
            display: flex;
            flex-direction: column;
            gap: 7px;
        }

        .yapla-toolbox-category-title {
            padding: 0 3px;

            font-size: 11px;
            line-height: 1.2;
            font-weight: 700;

            letter-spacing: 0.08em;
            text-transform: uppercase;

            color: #777d87;
        }

        .yapla-toolbox-tool-list {
            display: flex;
            flex-direction: column;
            gap: 7px;
        }

        .yapla-toolbox-tool {
            width: 100%;

            display: flex;
            align-items: center;
            gap: 11px;

            padding: 11px 12px;

            border: 1px solid #e0e3e8;
            border-radius: 10px;

            background: #ffffff;
            color: #222;

            text-align: left;

            cursor: pointer;
        }

        .yapla-toolbox-tool:hover {
            border-color: #ffc18f;
            background: #fff8f2;
        }

        .yapla-toolbox-tool:focus {
            outline: none;
            border-color: #ff7b14;
            box-shadow: 0 0 0 2px rgba(255, 123, 20, 0.15);
        }

        .yapla-toolbox-tool-icon {
            width: 34px;
            height: 34px;
            min-width: 34px;

            display: flex;
            align-items: center;
            justify-content: center;

            border-radius: 8px;

            background: #f1f2f5;

            font-size: 17px;
        }

        .yapla-toolbox-tool-info {
            min-width: 0;
            flex: 1;
        }

        .yapla-toolbox-tool-name {
            font-size: 14px;
            line-height: 1.25;
            font-weight: 600;

            color: #222;
        }

        .yapla-toolbox-tool-description {
            margin-top: 3px;

            font-size: 12px;
            line-height: 1.35;

            color: #717680;
        }

        .yapla-toolbox-tool-status {
            min-width: 18px;

            font-size: 12px;
            color: #868b94;
        }

        .yapla-toolbox-empty {
            padding: 20px 10px;

            text-align: center;

            font-size: 13px;
            color: #777d87;
        }

        #yapla-toolbox-message {
            display: none;

            margin-bottom: 12px;
            padding: 9px 11px;

            border-radius: 8px;

            font-size: 12px;
            line-height: 1.4;
        }

        #yapla-toolbox-message.is-visible {
            display: block;
        }

        #yapla-toolbox-message.info {
            background: #eef4ff;
            color: #31517d;
        }

        #yapla-toolbox-message.success {
            background: #edf8f0;
            color: #2f6b3d;
        }

        #yapla-toolbox-message.error {
            background: #fff0f0;
            color: #8b3535;
        }

        #yapla-toolbox-footer {
            padding: 9px 14px;

            background: #ffffff;
            border-top: 1px solid #e3e6eb;

            font-size: 10px;
            text-align: right;
            letter-spacing: 0.05em;
            color: #8a8f98;
        }

        .yapla-toolbox-hidden {
            display: none !important;
        }

        @media (max-width: 600px) {
            #yapla-toolbox-panel {
                top: 10px;
                right: 10px;
                width: calc(100vw - 20px);
                max-width: none;
                max-height: calc(100vh - 20px);
            }
        }
    `;

    function injectStyles() {
        const existing = document.getElementById(STYLE_ID);

        if (existing) {
            return existing;
        }

        const style = document.createElement("style");

        style.id = STYLE_ID;
        style.textContent = css;

        document.head.appendChild(style);

        if (window.YaplaToolbox.config?.debug) {
            console.log("[Yapla Toolbox] Styles injected.");
        }

        return style;
    }

    function removeStyles() {
        document.getElementById(STYLE_ID)?.remove();
    }

    window.YaplaToolbox.styles = {
        inject: injectStyles,
        remove: removeStyles
    };

    if (window.YaplaToolbox.config?.debug) {
        console.log("[Yapla Toolbox] Styles module loaded.");
    }
})();
```
