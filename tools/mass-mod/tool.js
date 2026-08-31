(() => {
  "use strict";

  const TOOL_ID = "mass-mod";
  const STYLE_ID = "ytb-mass-mod-styles";
  const OVERLAY_ID = "ytb-mass-mod-overlay";

  window.YaplaToolbox.registerTool({
    id: TOOL_ID,
    name: "Modification en masse",
    category: "Membres",
    icon: "👥",
    description: "Modifier un champ pour plusieurs membres depuis un fichier Excel ou CSV.",

    async run() {
      /*
       * If the tool was already initialized, reopen its existing modal.
       * This prevents duplicate state, styles, handlers and panels.
       */
      const existingOverlay = document.getElementById(OVERLAY_ID);
      if (existingOverlay) {
        existingOverlay.hidden = false;
        return;
      }

      /*
       * Equivalent of Tampermonkey @noframes.
       */
      if (window !== window.top) {
        alert("Cet outil doit être lancé dans la fenêtre principale de Yapla.");
        return;
      }

      /*
       * Equivalent of:
       * @match https://s2.yapla.com/member/fr/member/list*
       *
       * We intentionally do not hard-code s2 here so the tool can work
       * on another Yapla server if the same member interface is available.
       */
      if (!/^\/member\/fr\/member\/list(?:\/|$)/.test(window.location.pathname)) {
        alert(
          "Cet outil doit être lancé depuis la liste des membres Yapla.\n\n" +
          "Page attendue : /member/fr/member/list"
        );
        return;
      }

      const APP = Object.freeze({
        name: "Modification en masse Yapla",
        prefix: "YBM",
        version: "1.0.0-toolbox",
        overlayId: OVERLAY_ID,

        xlsxUrl:
          "https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js",

        searchUrl: "/member/fr/member/list/search/qsearch",

        requestTimeoutMs: 45_000,
        readRetryCount: 2,
        retryBaseDelayMs: 1_500,
        betweenMembersDelayMs: 300,
      });

      const CODE = Object.freeze({
        INIT: "YBM-I001",
        UI_OPENED: "YBM-I002",
        FILE_LOADED: "YBM-I100",
        FIRST_MEMBER_FOUND: "YBM-I200",
        FIELDS_FOUND: "YBM-I210",
        PREFLIGHT_STARTED: "YBM-I300",
        PREFLIGHT_COMPLETE: "YBM-I301",
        RUN_STARTED: "YBM-I400",
        MEMBER_SAVED: "YBM-I410",
        PASSWORD_SAVED: "YBM-I411",
        RUN_PAUSED: "YBM-I420",
        RUN_RESUMED: "YBM-I421",
        RUN_STOP_REQUESTED: "YBM-I422",
        RUN_COMPLETE: "YBM-I430",
        REPORT_DOWNLOADED: "YBM-I500",

        XLSX_UNAVAILABLE: "YBM-E001",
        UNEXPECTED: "YBM-E002",
        FILE_MISSING: "YBM-E100",
        FILE_READ: "YBM-E101",
        FILE_EMPTY: "YBM-E102",
        EMAIL_INVALID: "YBM-W103",
        EMAIL_DUPLICATE: "YBM-W104",
        NO_VALID_EMAIL: "YBM-E105",

        SEARCH_HTTP: "YBM-E200",
        SEARCH_PARSE: "YBM-E201",
        MEMBER_NOT_FOUND: "YBM-W202",
        MEMBER_AMBIGUOUS: "YBM-W203",
        EDIT_LINK_MISSING: "YBM-E204",
        AUTH_EXPIRED: "YBM-E205",
        REQUEST_TIMEOUT: "YBM-E206",
        REQUEST_NETWORK: "YBM-E207",
        RATE_LIMIT: "YBM-E208",

        EDIT_HTTP: "YBM-E210",
        EDIT_FORM_MISSING: "YBM-E211",
        FIELD_MISSING: "YBM-E212",
        FIELD_INCOMPATIBLE: "YBM-E213",
        FIELD_VALUE_INVALID: "YBM-E214",
        NO_SUPPORTED_FIELD: "YBM-E215",
        SAVE_LINK_MISSING: "YBM-E216",

        SAVE_HTTP: "YBM-E220",
        SAVE_VALIDATION: "YBM-E221",
        SAVE_REDIRECT: "YBM-E222",
        SAVE_UNCERTAIN: "YBM-E223",

        PASSWORD_INVALID: "YBM-E230",
        PASSWORD_FORM_MISSING: "YBM-E231",
        PASSWORD_SAVE_HTTP: "YBM-E232",
        PASSWORD_SAVE_VALIDATION: "YBM-E233",
        PASSWORD_SAVE_UNCERTAIN: "YBM-E234",
        PASSWORD_PAGE_HTTP: "YBM-E235",

        STOPPED: "YBM-W401",
      });

      const STATUS_LABELS = Object.freeze({
        pending: "En attente",
        ready: "Prêt",
        success: "Réussi",
        invalid: "Courriel invalide",
        duplicate: "Doublon ignoré",
        not_found: "Introuvable",
        ambiguous: "Ambigu",
        search_error: "Erreur de recherche",
        edit_error: "Erreur de modification",
        stopped: "Arrêté avant traitement",
      });

      class YbmError extends Error {
        constructor(code, message, context = {}, cause = null) {
          super(message);
          this.name = "YbmError";
          this.code = code;
          this.context = sanitizeContext(context);
          this.cause = cause || undefined;
        }
      }

      const state = {
        phase: "upload",
        sourceFileName: "",
        entries: [],
        supplementalReportRows: [],
        fields: [],
        firstMember: null,
        selectedField: null,
        selectedValue: null,

        processing: false,
        paused: false,
        stopRequested: false,
        preflightCancelled: false,

        processed: 0,
        totalToProcess: 0,

        logs: [],
        startedAt: null,
        finishedAt: null,

        selectedFile: null,
      };

      let overlay;
      let body;
      let footer;
      let closeButton;

      installStyles();
      createModal();
      renderUploadStep();
      openModal();

      debug(
        "info",
        CODE.INIT,
        `${APP.name} v${APP.version} initialisé`,
        {
          page: location.pathname,
        }
      );

      /*
       * ============================================================
       * TOOLBOX / DEPENDENCY SETUP
       * ============================================================
       */

      function ensureXlsxLoaded() {
        if (window.XLSX) {
          return Promise.resolve(window.XLSX);
        }

        return new Promise((resolve, reject) => {
          const existing = document.querySelector(
            'script[data-ytb-mass-mod-xlsx="true"]'
          );

          if (existing) {
            const checkExisting = () => {
              if (window.XLSX) {
                resolve(window.XLSX);
              } else {
                reject(
                  new YbmError(
                    CODE.XLSX_UNAVAILABLE,
                    "La bibliothèque SheetJS a été chargée, mais XLSX est introuvable."
                  )
                );
              }
            };

            if (existing.dataset.loaded === "true") {
              checkExisting();
              return;
            }

            existing.addEventListener("load", checkExisting, {
              once: true,
            });

            existing.addEventListener(
              "error",
              () => {
                reject(
                  new YbmError(
                    CODE.XLSX_UNAVAILABLE,
                    "La bibliothèque Excel SheetJS n’a pas pu être chargée."
                  )
                );
              },
              { once: true }
            );

            return;
          }

          const script = document.createElement("script");

          script.src = APP.xlsxUrl;
          script.async = true;
          script.dataset.ytbMassModXlsx = "true";

          script.addEventListener(
            "load",
            () => {
              script.dataset.loaded = "true";

              if (!window.XLSX) {
                reject(
                  new YbmError(
                    CODE.XLSX_UNAVAILABLE,
                    "SheetJS a été téléchargé, mais l’objet XLSX n’est pas disponible."
                  )
                );
                return;
              }

              resolve(window.XLSX);
            },
            { once: true }
          );

          script.addEventListener(
            "error",
            () => {
              reject(
                new YbmError(
                  CODE.XLSX_UNAVAILABLE,
                  "Impossible de charger SheetJS depuis cdn.sheetjs.com."
                )
              );
            },
            { once: true }
          );

          document.head.appendChild(script);
        });
      }

      /*
       * ============================================================
       * UI
       * ============================================================
       */

      function installStyles() {
        if (document.getElementById(STYLE_ID)) {
          return;
        }

        const css = `
          #${APP.overlayId} {
            position: fixed;
            inset: 0;
            z-index: 2147483001;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
            background: rgba(15, 23, 42, .58);
            font-family: Arial, sans-serif;
          }

          #${APP.overlayId}[hidden] {
            display: none !important;
          }

          #${APP.overlayId} .ybm-dialog {
            width: min(920px, 96vw);
            max-height: 92vh;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            background: #fff;
            color: #172033;
            border-radius: 14px;
            box-shadow: 0 24px 70px rgba(15, 23, 42, .35);
          }

          #${APP.overlayId} .ybm-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 18px 22px;
            border-bottom: 1px solid #dce3ec;
          }

          #${APP.overlayId} .ybm-header h2 {
            margin: 0;
            font-size: 20px;
            color: #12314a;
          }

          #${APP.overlayId} .ybm-version {
            margin-left: 8px;
            color: #64748b;
            font-size: 12px;
            font-weight: 400;
          }

          #${APP.overlayId} .ybm-close {
            width: 34px;
            height: 34px;
            border: 0;
            border-radius: 7px;
            background: transparent;
            color: #475569;
            font-size: 24px;
            cursor: pointer;
          }

          #${APP.overlayId} .ybm-close:hover {
            background: #eef2f7;
          }

          #${APP.overlayId} .ybm-body {
            padding: 22px;
            overflow: auto;
          }

          #${APP.overlayId} .ybm-footer {
            display: flex;
            align-items: center;
            justify-content: flex-end;
            gap: 10px;
            padding: 15px 22px;
            border-top: 1px solid #dce3ec;
            background: #f8fafc;
          }

          #${APP.overlayId} .ybm-card {
            padding: 16px;
            border: 1px solid #dbe4ee;
            border-radius: 10px;
            background: #fff;
          }

          #${APP.overlayId} .ybm-card + .ybm-card {
            margin-top: 14px;
          }

          #${APP.overlayId} .ybm-grid {
            display: grid;
            grid-template-columns: repeat(4, minmax(0, 1fr));
            gap: 10px;
          }

          #${APP.overlayId} .ybm-stat {
            padding: 12px;
            border-radius: 9px;
            background: #f1f5f9;
          }

          #${APP.overlayId} .ybm-stat strong {
            display: block;
            margin-top: 4px;
            font-size: 21px;
            color: #0f3c5c;
          }

          #${APP.overlayId} .ybm-label {
            display: block;
            margin-bottom: 7px;
            font-size: 13px;
            font-weight: 700;
            color: #334155;
          }

          #${APP.overlayId} .ybm-input,
          #${APP.overlayId} .ybm-select,
          #${APP.overlayId} .ybm-textarea {
            width: 100%;
            box-sizing: border-box;
            border: 1px solid #aebdce;
            border-radius: 7px;
            padding: 10px 11px;
            background: #fff;
            color: #172033;
            font: 14px Arial, sans-serif;
          }

          #${APP.overlayId} .ybm-textarea {
            min-height: 90px;
            resize: vertical;
          }

          #${APP.overlayId} .ybm-input:focus,
          #${APP.overlayId} .ybm-select:focus,
          #${APP.overlayId} .ybm-textarea:focus {
            outline: 3px solid rgba(14, 165, 233, .18);
            border-color: #0284c7;
          }

          #${APP.overlayId} .ybm-file-zone {
            display: block;
            padding: 24px;
            border: 2px dashed #93b2c8;
            border-radius: 10px;
            background: #f7fbfe;
            text-align: center;
            cursor: pointer;
          }

          #${APP.overlayId} .ybm-file-zone:hover {
            border-color: #0284c7;
          }

          #${APP.overlayId} .ybm-btn {
            border: 1px solid transparent;
            border-radius: 7px;
            padding: 10px 15px;
            font: 700 13px Arial, sans-serif;
            cursor: pointer;
          }

          #${APP.overlayId} .ybm-btn:disabled {
            cursor: not-allowed;
            opacity: .5;
          }

          #${APP.overlayId} .ybm-btn-primary {
            background: #0369a1;
            color: #fff;
          }

          #${APP.overlayId} .ybm-btn-primary:hover:not(:disabled) {
            background: #075985;
          }

          #${APP.overlayId} .ybm-btn-secondary {
            background: #fff;
            color: #334155;
            border-color: #b8c5d3;
          }

          #${APP.overlayId} .ybm-btn-danger {
            background: #b91c1c;
            color: #fff;
          }

          #${APP.overlayId} .ybm-btn-warning {
            background: #d97706;
            color: #fff;
          }

          #${APP.overlayId} .ybm-muted {
            color: #64748b;
            font-size: 13px;
          }

          #${APP.overlayId} .ybm-note {
            padding: 11px 13px;
            border-radius: 8px;
            background: #edf7ff;
            color: #164e63;
            font-size: 13px;
          }

          #${APP.overlayId} .ybm-warning {
            padding: 11px 13px;
            border-radius: 8px;
            background: #fff7ed;
            color: #9a3412;
            font-size: 13px;
          }

          #${APP.overlayId} .ybm-error {
            padding: 12px 14px;
            border-radius: 8px;
            background: #fef2f2;
            color: #991b1b;
          }

          #${APP.overlayId} .ybm-code {
            font: 700 12px Consolas, monospace;
          }

          #${APP.overlayId} .ybm-progress {
            height: 13px;
            overflow: hidden;
            border-radius: 999px;
            background: #e2e8f0;
          }

          #${APP.overlayId} .ybm-progress > div {
            height: 100%;
            width: 0;
            background: #0284c7;
            transition: width .2s ease;
          }

          #${APP.overlayId} .ybm-progress-meta {
            display: flex;
            justify-content: space-between;
            margin-top: 7px;
            font-size: 12px;
            color: #64748b;
          }

          #${APP.overlayId} .ybm-table-wrap {
            max-height: 260px;
            overflow: auto;
            border: 1px solid #dbe4ee;
            border-radius: 8px;
          }

          #${APP.overlayId} .ybm-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 12px;
          }

          #${APP.overlayId} .ybm-table th {
            position: sticky;
            top: 0;
            background: #edf2f7;
            color: #334155;
            text-align: left;
          }

          #${APP.overlayId} .ybm-table th,
          #${APP.overlayId} .ybm-table td {
            padding: 8px 9px;
            border-bottom: 1px solid #e5eaf0;
            vertical-align: top;
          }

          #${APP.overlayId} .ybm-log {
            max-height: 180px;
            overflow: auto;
            padding: 10px;
            border-radius: 8px;
            background: #0f172a;
            color: #dbeafe;
            font: 12px/1.45 Consolas, monospace;
          }

          #${APP.overlayId} .ybm-log-line + .ybm-log-line {
            margin-top: 5px;
          }

          #${APP.overlayId} .ybm-choice-list {
            display: grid;
            gap: 8px;
            max-height: 230px;
            overflow: auto;
            padding: 4px;
          }

          #${APP.overlayId} .ybm-choice {
            display: flex;
            align-items: flex-start;
            gap: 8px;
          }

          #${APP.overlayId} .ybm-spinner {
            width: 24px;
            height: 24px;
            border: 3px solid #cbd5e1;
            border-top-color: #0284c7;
            border-radius: 50%;
            animation: ytb-mass-mod-spin .8s linear infinite;
          }

          #${APP.overlayId} .ybm-busy {
            display: flex;
            align-items: center;
            gap: 12px;
          }

          @keyframes ytb-mass-mod-spin {
            to {
              transform: rotate(360deg);
            }
          }

          @media (max-width: 700px) {
            #${APP.overlayId} {
              padding: 0;
            }

            #${APP.overlayId} .ybm-dialog {
              width: 100vw;
              height: 100vh;
              max-height: none;
              border-radius: 0;
            }

            #${APP.overlayId} .ybm-grid {
              grid-template-columns: repeat(2, minmax(0, 1fr));
            }
          }
        `;

        const style = document.createElement("style");
        style.id = STYLE_ID;
        style.textContent = css;
        document.head.appendChild(style);
      }

      function createModal() {
        overlay = document.createElement("div");
        overlay.id = APP.overlayId;
        overlay.hidden = true;

        overlay.innerHTML = `
          <section
            class="ybm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ytb-mass-mod-title"
          >
            <header class="ybm-header">
              <h2 id="ytb-mass-mod-title">
                ${escapeHtml(APP.name)}
                <span class="ybm-version">v${escapeHtml(APP.version)}</span>
              </h2>

              <button
                class="ybm-close"
                type="button"
                aria-label="Réduire"
                title="Réduire"
              >
                ×
              </button>
            </header>

            <main class="ybm-body"></main>
            <footer class="ybm-footer"></footer>
          </section>
        `;

        document.body.appendChild(overlay);

        body = overlay.querySelector(".ybm-body");
        footer = overlay.querySelector(".ybm-footer");
        closeButton = overlay.querySelector(".ybm-close");

        closeButton.addEventListener("click", minimizeModal);

        overlay.addEventListener("click", (event) => {
          if (event.target === overlay) {
            minimizeModal();
          }
        });
      }

      function openModal() {
        overlay.hidden = false;

        debug("info", CODE.UI_OPENED, "Fenêtre ouverte", {
          phase: state.phase,
        });
      }

      function minimizeModal() {
        overlay.hidden = true;
      }

      function setActive(active) {
        state.processing = active;
      }

      /*
       * ============================================================
       * UPLOAD
       * ============================================================
       */

      function renderUploadStep() {
        state.phase = "upload";

        body.innerHTML = `
          <div class="ybm-card">
            <h3 style="margin-top:0">1. Importer la liste</h3>

            <p>
              Choisis un fichier Excel ou CSV. L’outil lit la première feuille
              et la première colonne.
            </p>

            <label class="ybm-file-zone" for="ytb-mass-mod-file">
              <strong>Sélectionner un fichier</strong><br>

              <span class="ybm-muted">
                Formats acceptés : .xlsx, .xls et .csv, avec ou sans en-tête
              </span>

              <input
                id="ytb-mass-mod-file"
                type="file"
                accept=".xlsx,.xls,.csv"
                hidden
              >
            </label>

            <p id="ytb-mass-mod-file-name" class="ybm-muted">
              Aucun fichier sélectionné.
            </p>
          </div>

          <div class="ybm-note" style="margin-top:14px">
            Aucune modification ne sera faite avant l’écran de confirmation final.
            Toutes les requêtes utilisent ta session Yapla actuelle sans enregistrer
            tes cookies.
          </div>
        `;

        footer.innerHTML = `
          <button
            class="ybm-btn ybm-btn-secondary"
            type="button"
            data-action="minimize"
          >
            Fermer
          </button>

          <button
            class="ybm-btn ybm-btn-primary"
            type="button"
            data-action="analyze-file"
            disabled
          >
            Analyser le fichier
          </button>
        `;

        const fileInput = body.querySelector("#ytb-mass-mod-file");
        const fileName = body.querySelector("#ytb-mass-mod-file-name");

        const analyzeButton = footer.querySelector(
          '[data-action="analyze-file"]'
        );

        fileInput.addEventListener("change", () => {
          state.selectedFile = fileInput.files?.[0] || null;

          fileName.textContent = state.selectedFile
            ? `${state.selectedFile.name} (${formatBytes(state.selectedFile.size)})`
            : "Aucun fichier sélectionné.";

          analyzeButton.disabled = !state.selectedFile;
        });

        footer
          .querySelector('[data-action="minimize"]')
          .addEventListener("click", minimizeModal);

        analyzeButton.addEventListener("click", handleFileAnalysis);
      }

      async function handleFileAnalysis() {
        setActive(true);

        state.logs = [];
        state.entries = [];
        state.supplementalReportRows = [];
        state.fields = [];
        state.firstMember = null;
        state.selectedField = null;
        state.selectedValue = null;
        state.stopRequested = false;
        state.preflightCancelled = false;

        try {
          if (!state.selectedFile) {
            throw new YbmError(
              CODE.FILE_MISSING,
              "Aucun fichier n’a été sélectionné."
            );
          }

          renderBusy(
            "Chargement de la bibliothèque Excel…",
            "Cette dépendance est chargée uniquement lorsque l’outil en a besoin."
          );

          await ensureXlsxLoaded();

          renderBusy(
            "Lecture du fichier Excel…",
            "Les données restent dans ton navigateur."
          );

          const parsed = await parseSpreadsheet(state.selectedFile);

          state.sourceFileName = state.selectedFile.name;
          state.entries = parsed.entries;
          state.supplementalReportRows = parsed.supplementalRows;

          debug(
            "info",
            CODE.FILE_LOADED,
            "Fichier analysé",
            parsed.stats
          );

          renderBusy(
            "Recherche du premier membre valide…",
            "Sa fiche servira uniquement à découvrir les champs disponibles."
          );

          const first = await findFirstUsableMember();

          state.firstMember = first;

          debug(
            "info",
            CODE.FIRST_MEMBER_FOUND,
            "Premier membre trouvé",
            {
              email: first.entry.email,
              memberId: first.entry.memberId,
            }
          );

          const editPage = await loadEditPage(
            first.entry.editUrl,
            first.entry.email
          );

          state.fields = [
            createPasswordField(),
            ...extractSupportedFields(editPage.form),
          ];

          if (state.fields.length === 0) {
            throw new YbmError(
              CODE.NO_SUPPORTED_FIELD,
              "Aucun champ modifiable compatible n’a été trouvé.",
              {
                memberId: first.entry.memberId,
              }
            );
          }

          debug(
            "info",
            CODE.FIELDS_FOUND,
            `${state.fields.length} champs compatibles trouvés`,
            {
              memberId: first.entry.memberId,

              fields: state.fields.map((field) => ({
                name: field.name,
                label: field.label,
                type: field.type,
              })),
            }
          );

          renderFieldSelection(parsed.stats);
        } catch (error) {
          handleFatalError(
            error,
            "Impossible de préparer le fichier"
          );
        } finally {
          setActive(false);
        }
      }

      async function parseSpreadsheet(file) {
        let workbook;

        try {
          const XLSX = await ensureXlsxLoaded();
          const bytes = await file.arrayBuffer();

          workbook = XLSX.read(bytes, {
            type: "array",
            dense: true,
          });
        } catch (error) {
          if (error instanceof YbmError) {
            throw error;
          }

          throw new YbmError(
            CODE.FILE_READ,
            "Le fichier n’a pas pu être lu comme un fichier Excel ou CSV.",
            {
              fileName: file.name,
            },
            error
          );
        }

        if (!workbook.SheetNames?.length) {
          throw new YbmError(
            CODE.FILE_EMPTY,
            "Le fichier ne contient aucune feuille.",
            {
              fileName: file.name,
            }
          );
        }

        const XLSX = window.XLSX;

        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];

        const rows = XLSX.utils.sheet_to_json(sheet, {
          header: 1,
          raw: false,
          defval: "",
          blankrows: false,
        });

        const values = rows
          .map((row, index) => ({
            rowNumber: index + 1,

            raw: String(
              Array.isArray(row)
                ? row[0] ?? ""
                : ""
            ).trim(),
          }))
          .filter((item) => item.raw !== "");

        if (!values.length) {
          throw new YbmError(
            CODE.FILE_EMPTY,
            "La première colonne de la première feuille est vide.",
            {
              sheetName,
            }
          );
        }

        if (looksLikeEmailHeader(values[0].raw)) {
          values.shift();
        }

        const seen = new Set();

        const entries = [];
        const supplementalRows = [];

        let invalidCount = 0;
        let duplicateCount = 0;

        for (const item of values) {
          const email = normalizeEmail(item.raw);

          if (!isValidEmail(email)) {
            invalidCount += 1;

            supplementalRows.push(
              makeReportRow({
                rowNumber: item.rowNumber,
                email: item.raw,
                status: "invalid",
                code: CODE.EMAIL_INVALID,
                message: "Format de courriel invalide",
              })
            );

            debug(
              "warn",
              CODE.EMAIL_INVALID,
              "Courriel invalide ignoré",
              {
                rowNumber: item.rowNumber,
                email: item.raw,
              }
            );

            continue;
          }

          if (seen.has(email)) {
            duplicateCount += 1;

            supplementalRows.push(
              makeReportRow({
                rowNumber: item.rowNumber,
                email,
                status: "duplicate",
                code: CODE.EMAIL_DUPLICATE,
                message: "Doublon dans le fichier, ligne ignorée",
              })
            );

            debug(
              "warn",
              CODE.EMAIL_DUPLICATE,
              "Courriel en double ignoré",
              {
                rowNumber: item.rowNumber,
                email,
              }
            );

            continue;
          }

          seen.add(email);

          entries.push({
            rowNumber: item.rowNumber,
            email,

            status: "pending",
            code: "",
            message: "",

            memberId: "",
            editUrl: "",

            oldValue: "",
            newValue: "",

            processedAt: "",
          });
        }

        if (!entries.length) {
          throw new YbmError(
            CODE.NO_VALID_EMAIL,
            "Le fichier ne contient aucune adresse courriel valide.",
            {
              invalidCount,
              duplicateCount,
            }
          );
        }

        return {
          entries,
          supplementalRows,

          stats: {
            sheetName,
            nonEmptyRows: values.length,
            validUniqueEmails: entries.length,
            invalidCount,
            duplicateCount,
          },
        };
      }

      /*
       * ============================================================
       * INITIAL MEMBER DISCOVERY
       * ============================================================
       */

      async function findFirstUsableMember() {
        let lastError = null;

        for (const entry of state.entries) {
          try {
            const resolution = await resolveMember(entry.email);

            applyResolution(entry, resolution);

            if (entry.status === "ready") {
              return {
                entry,
                resolution,
              };
            }
          } catch (error) {
            lastError = toYbmError(
              error,
              CODE.SEARCH_HTTP,
              "Erreur pendant la recherche du membre"
            );

            if (
              [
                CODE.AUTH_EXPIRED,
                CODE.SEARCH_PARSE,
                CODE.RATE_LIMIT,
              ].includes(lastError.code)
            ) {
              throw lastError;
            }

            entry.status = "search_error";
            entry.code = lastError.code;
            entry.message = lastError.message;

            debug(
              "error",
              lastError.code,
              lastError.message,
              {
                email: entry.email,
                ...lastError.context,
              }
            );
          }
        }

        throw new YbmError(
          CODE.MEMBER_NOT_FOUND,
          "Aucun membre correspondant exactement aux courriels valides n’a été trouvé dans Yapla.",
          lastError
            ? {
                lastError: lastError.code,
              }
            : {}
        );
      }

      /*
       * ============================================================
       * FIELD SELECTION
       * ============================================================
       */

      function renderFieldSelection(fileStats) {
        state.phase = "field-selection";

        const fieldOptions = state.fields
          .map((field, index) => {
            const suffix = field.fieldId
              ? ` · ${field.fieldId}`
              : ` · ${field.name}`;

            return `
              <option value="${index}">
                ${escapeHtml(field.label)}
                (${escapeHtml(typeLabel(field.type))}${escapeHtml(suffix)})
              </option>
            `;
          })
          .join("");

        body.innerHTML = `
          <div class="ybm-grid">
            <div class="ybm-stat">
              Courriels valides
              <strong>${fileStats.validUniqueEmails}</strong>
            </div>

            <div class="ybm-stat">
              Invalides
              <strong>${fileStats.invalidCount}</strong>
            </div>

            <div class="ybm-stat">
              Doublons retirés
              <strong>${fileStats.duplicateCount}</strong>
            </div>

            <div class="ybm-stat">
              Champs trouvés
              <strong>${state.fields.length}</strong>
            </div>
          </div>

          <div class="ybm-card">
            <h3 style="margin-top:0">2. Choisir le champ et la valeur</h3>

            <p class="ybm-muted">
              Champs analysés depuis la fiche de
              ${escapeHtml(state.firstMember.entry.email)}.
            </p>

            <label class="ybm-label" for="ytb-mass-mod-field">
              Champ à modifier
            </label>

            <select id="ytb-mass-mod-field" class="ybm-select">
              <option value="">Sélectionner un champ…</option>
              ${fieldOptions}
            </select>

            <div
              id="ytb-mass-mod-value-zone"
              style="margin-top:15px"
            ></div>
          </div>

          <div class="ybm-warning" style="margin-top:14px">
            Les champs de fichier et d’image sont volontairement exclus.
            Le mot de passe utilise la page sécurisée dédiée de chaque membre.
            Toute autre valeur choisie remplacera la valeur actuelle.
          </div>
        `;

        footer.innerHTML = `
          <button
            class="ybm-btn ybm-btn-secondary"
            type="button"
            data-action="restart"
          >
            Recommencer
          </button>

          <button
            class="ybm-btn ybm-btn-primary"
            type="button"
            data-action="preflight"
            disabled
          >
            Analyser toute la liste
          </button>
        `;

        const fieldSelect = body.querySelector("#ytb-mass-mod-field");

        const preflightButton = footer.querySelector(
          '[data-action="preflight"]'
        );

        fieldSelect.addEventListener("change", () => {
          const index =
            fieldSelect.value === ""
              ? -1
              : Number(fieldSelect.value);

          state.selectedField =
            index >= 0
              ? state.fields[index]
              : null;

          state.selectedValue = null;

          renderValueEditor(
            state.selectedField,
            (isValid) => {
              preflightButton.disabled =
                !state.selectedField ||
                !isValid;
            }
          );

          preflightButton.disabled =
            !state.selectedField ||
            state.selectedField.type === "password";
        });

        footer
          .querySelector('[data-action="restart"]')
          .addEventListener("click", confirmRestart);

        preflightButton.addEventListener(
          "click",
          handlePreflight
        );
      }

      function renderValueEditor(
        field,
        onValidityChange = () => {}
      ) {
        const zone = body.querySelector(
          "#ytb-mass-mod-value-zone"
        );

        if (!field) {
          zone.innerHTML = "";
          onValidityChange(false);
          return;
        }

        const commonLabel = `
          <label class="ybm-label">
            Nouvelle valeur pour « ${escapeHtml(field.label)} »
          </label>
        `;

        if (field.type === "password") {
          zone.innerHTML = `
            ${commonLabel}

            <input
              id="ytb-mass-mod-value"
              class="ybm-input"
              type="password"
              autocomplete="new-password"
              placeholder="Nouveau mot de passe"
            >

            <label class="ybm-choice" style="margin-top:9px">
              <input
                id="ytb-mass-mod-show-password"
                type="checkbox"
              >

              <span>Afficher le mot de passe</span>
            </label>

            <div
              id="ytb-mass-mod-password-rules"
              class="ybm-warning"
              style="margin-top:9px"
            >
              <span class="ybm-code">${CODE.PASSWORD_INVALID}</span>
              · Minimum 8 caractères, avec au moins une majuscule,
              une minuscule et un chiffre.
            </div>

            <div
              class="ybm-note"
              style="margin-top:9px"
            >
              Le même mot de passe sera envoyé dans les champs
              « Nouveau mot de passe » et « Confirmation »
              pour chaque membre.
            </div>
          `;

          const input = zone.querySelector(
            "#ytb-mass-mod-value"
          );

          const rules = zone.querySelector(
            "#ytb-mass-mod-password-rules"
          );

          zone
            .querySelector(
              "#ytb-mass-mod-show-password"
            )
            .addEventListener(
              "change",
              (event) => {
                input.type = event.target.checked
                  ? "text"
                  : "password";
              }
            );

          input.addEventListener(
            "input",
            () => {
              const validation =
                validatePassword(input.value);

              rules.className = validation.valid
                ? "ybm-note"
                : "ybm-warning";

              rules.innerHTML = validation.valid
                ? "Mot de passe conforme aux exigences Yapla."
                : `
                    <span class="ybm-code">
                      ${CODE.PASSWORD_INVALID}
                    </span>
                    · ${escapeHtml(validation.message)}
                  `;

              onValidityChange(validation.valid);
            }
          );

          onValidityChange(false);
          return;
        }

        if (
          field.type === "select" ||
          field.type === "radio"
        ) {
          zone.innerHTML = `
            ${commonLabel}

            <select
              id="ytb-mass-mod-value"
              class="ybm-select"
            >
              ${renderOptionTags(field.options)}
            </select>
          `;

          onValidityChange(true);
          return;
        }

        if (field.type === "boolean") {
          zone.innerHTML = `
            ${commonLabel}

            <select
              id="ytb-mass-mod-value"
              class="ybm-select"
            >
              <option value="true">Cochée</option>
              <option value="false">Non cochée</option>
            </select>
          `;

          onValidityChange(true);
          return;
        }

        if (
          field.type === "multiselect" ||
          field.type === "checkbox-group"
        ) {
          zone.innerHTML = `
            ${commonLabel}

            <div
              id="ytb-mass-mod-value"
              class="ybm-choice-list"
            >
              ${field.options
                .map(
                  (option) => `
                    <label class="ybm-choice">
                      <input
                        type="checkbox"
                        value="${escapeAttr(option.value)}"
                      >

                      <span>
                        ${escapeHtml(option.label || "(Vide)")}
                      </span>
                    </label>
                  `
                )
                .join("")}
            </div>
          `;

          onValidityChange(true);
          return;
        }

        if (field.type === "textarea") {
          zone.innerHTML = `
            ${commonLabel}

            <textarea
              id="ytb-mass-mod-value"
              class="ybm-textarea"
              placeholder="Laisser vide pour effacer le champ"
            ></textarea>
          `;

          onValidityChange(true);
          return;
        }

        const htmlType = [
          "email",
          "number",
          "date",
          "url",
          "tel",
        ].includes(field.inputType)
          ? field.inputType
          : "text";

        zone.innerHTML = `
          ${commonLabel}

          <input
            id="ytb-mass-mod-value"
            class="ybm-input"
            type="${htmlType}"
            placeholder="Laisser vide pour effacer le champ"
          >
        `;

        onValidityChange(true);
      }

      /*
       * ============================================================
       * PREFLIGHT
       * ============================================================
       */

      async function handlePreflight() {
        try {
          state.selectedValue =
            readSelectedValueFromUi(
              state.selectedField
            );

          state.phase = "preflight";
          state.preflightCancelled = false;

          setActive(true);

          debug(
            "info",
            CODE.PREFLIGHT_STARTED,
            "Analyse préalable de la liste commencée",
            {
              members: state.entries.length,
              field: state.selectedField.name,

              value: displayValue(
                state.selectedValue,
                state.selectedField
              ),
            }
          );

          renderPreflightProgress(
            0,
            state.entries.length,
            "Démarrage…"
          );

          for (
            let index = 0;
            index < state.entries.length;
            index += 1
          ) {
            if (state.preflightCancelled) {
              throw new YbmError(
                CODE.STOPPED,
                "L’analyse préalable a été annulée."
              );
            }

            const entry = state.entries[index];

            updatePreflightProgress(
              index,
              state.entries.length,
              `Recherche de ${entry.email}`
            );

            if (!entry.memberId) {
              try {
                const resolution =
                  await resolveMember(
                    entry.email
                  );

                applyResolution(
                  entry,
                  resolution
                );
              } catch (error) {
                const wrapped =
                  toYbmError(
                    error,
                    CODE.SEARCH_HTTP,
                    "Recherche impossible"
                  );

                if (
                  [
                    CODE.AUTH_EXPIRED,
                    CODE.SEARCH_PARSE,
                    CODE.RATE_LIMIT,
                  ].includes(wrapped.code)
                ) {
                  throw wrapped;
                }

                entry.status =
                  "search_error";

                entry.code =
                  wrapped.code;

                entry.message =
                  wrapped.message;

                debug(
                  "error",
                  wrapped.code,
                  wrapped.message,
                  {
                    email: entry.email,
                    ...wrapped.context,
                  }
                );
              }
            }

            updatePreflightProgress(
              index + 1,
              state.entries.length,
              `${index + 1}/${state.entries.length}`
            );

            await delay(80);
          }

          debug(
            "info",
            CODE.PREFLIGHT_COMPLETE,
            "Analyse préalable terminée",
            summarizeEntries()
          );

          renderConfirmation();
        } catch (error) {
          const wrapped =
            toYbmError(
              error,
              CODE.UNEXPECTED,
              "Erreur pendant l’analyse préalable"
            );

          if (wrapped.code === CODE.STOPPED) {
            debug(
              "warn",
              wrapped.code,
              wrapped.message
            );

            clearPasswordSecret();

            renderFieldSelection(
              rebuildFileStats()
            );
          } else {
            handleFatalError(
              wrapped,
              "L’analyse préalable a échoué"
            );
          }
        } finally {
          setActive(false);
        }
      }

      function renderPreflightProgress(
        done,
        total,
        current
      ) {
        body.innerHTML = `
          <div class="ybm-card">
            <div class="ybm-busy">
              <div class="ybm-spinner"></div>

              <div>
                <h3 style="margin:0 0 5px">
                  Analyse préalable des membres
                </h3>

                <div
                  class="ybm-muted"
                  id="ytb-mass-mod-current"
                >
                  ${escapeHtml(current)}
                </div>
              </div>
            </div>

            <div
              class="ybm-progress"
              style="margin-top:18px"
            >
              <div
                id="ytb-mass-mod-progress-bar"
                style="width:${percentage(done, total)}%"
              ></div>
            </div>

            <div class="ybm-progress-meta">
              <span id="ytb-mass-mod-progress-count">
                ${done}/${total}
              </span>

              <span>
                Aucune modification en cours
              </span>
            </div>
          </div>

          <div
            class="ybm-note"
            style="margin-top:14px"
          >
            Cette étape recherche les membres et détecte les
            courriels introuvables ou ambigus.
          </div>
        `;

        footer.innerHTML = `
          <button
            class="ybm-btn ybm-btn-danger"
            type="button"
            data-action="cancel-preflight"
          >
            Annuler l’analyse
          </button>
        `;

        footer
          .querySelector(
            '[data-action="cancel-preflight"]'
          )
          .addEventListener(
            "click",
            () => {
              state.preflightCancelled = true;
            }
          );
      }

      function updatePreflightProgress(
        done,
        total,
        current
      ) {
        const currentNode =
          body.querySelector(
            "#ytb-mass-mod-current"
          );

        const countNode =
          body.querySelector(
            "#ytb-mass-mod-progress-count"
          );

        const bar =
          body.querySelector(
            "#ytb-mass-mod-progress-bar"
          );

        if (currentNode) {
          currentNode.textContent = current;
        }

        if (countNode) {
          countNode.textContent =
            `${done}/${total}`;
        }

        if (bar) {
          bar.style.width =
            `${percentage(done, total)}%`;
        }
      }

      /*
       * ============================================================
       * CONFIRMATION
       * ============================================================
       */

      function renderConfirmation() {
        state.phase = "confirmation";

        const summary =
          summarizeEntries();

        const skipped =
          state.entries.filter(
            (entry) =>
              entry.status !== "ready"
          );

        const skippedRows =
          skipped
            .slice(0, 50)
            .map(
              (entry) => `
                <tr>
                  <td>${escapeHtml(entry.email)}</td>

                  <td>
                    ${escapeHtml(
                      STATUS_LABELS[
                        entry.status
                      ] || entry.status
                    )}
                  </td>

                  <td class="ybm-code">
                    ${escapeHtml(entry.code)}
                  </td>
                </tr>
              `
            )
            .join("");

        body.innerHTML = `
          <div class="ybm-card">
            <h3 style="margin-top:0">
              3. Confirmer la modification
            </h3>

            <p>
              <strong>Champ :</strong>
              ${escapeHtml(
                state.selectedField.label
              )}

              <span class="ybm-muted">
                (${escapeHtml(
                  state.selectedField.name
                )})
              </span>
            </p>

            <p>
              <strong>Nouvelle valeur :</strong>
              ${escapeHtml(
                displayValue(
                  state.selectedValue,
                  state.selectedField
                )
              )}
            </p>
          </div>

          <div
            class="ybm-grid"
            style="margin-top:14px"
          >
            <div class="ybm-stat">
              Seront modifiés
              <strong>${summary.ready}</strong>
            </div>

            <div class="ybm-stat">
              Introuvables
              <strong>${summary.notFound}</strong>
            </div>

            <div class="ybm-stat">
              Ambigus
              <strong>${summary.ambiguous}</strong>
            </div>

            <div class="ybm-stat">
              Autres erreurs
              <strong>${summary.otherErrors}</strong>
            </div>
          </div>

          ${
            skipped.length
              ? `
                <div class="ybm-card">
                  <strong>
                    Membres ignorés (${skipped.length})
                  </strong>

                  <div
                    class="ybm-table-wrap"
                    style="margin-top:10px"
                  >
                    <table class="ybm-table">
                      <thead>
                        <tr>
                          <th>Courriel</th>
                          <th>Résultat</th>
                          <th>Code</th>
                        </tr>
                      </thead>

                      <tbody>
                        ${skippedRows}
                      </tbody>
                    </table>
                  </div>

                  ${
                    skipped.length > 50
                      ? `
                        <p class="ybm-muted">
                          Seuls les 50 premiers sont affichés.
                          Le rapport final contiendra toute la liste.
                        </p>
                      `
                      : ""
                  }
                </div>
              `
              : ""
          }

          <label
            class="ybm-choice ybm-warning"
            style="margin-top:14px"
          >
            <input
              id="ytb-mass-mod-confirm"
              type="checkbox"
            >

            <span>
              Je confirme que la valeur sélectionnée doit remplacer
              la valeur actuelle pour les ${summary.ready}
              membres trouvés.
            </span>
          </label>
        `;

        footer.innerHTML = `
          <button
            class="ybm-btn ybm-btn-secondary"
            type="button"
            data-action="restart"
          >
            Recommencer
          </button>

          <button
            class="ybm-btn ybm-btn-primary"
            type="button"
            data-action="start"
            disabled
          >
            Démarrer les modifications
          </button>
        `;

        const confirmBox =
          body.querySelector(
            "#ytb-mass-mod-confirm"
          );

        const startButton =
          footer.querySelector(
            '[data-action="start"]'
          );

        confirmBox.addEventListener(
          "change",
          () => {
            startButton.disabled =
              !confirmBox.checked ||
              summary.ready === 0;
          }
        );

        footer
          .querySelector(
            '[data-action="restart"]'
          )
          .addEventListener(
            "click",
            confirmRestart
          );

        startButton.addEventListener(
          "click",
          runBulkModification
        );
      }

      /*
       * ============================================================
       * BULK RUN
       * ============================================================
       */

      async function runBulkModification() {
        state.phase = "running";

        state.paused = false;
        state.stopRequested = false;

        state.processed = 0;

        state.totalToProcess =
          state.entries.filter(
            (entry) =>
              entry.status === "ready"
          ).length;

        state.startedAt =
          new Date().toISOString();

        state.finishedAt = null;

        setActive(true);

        debug(
          "info",
          CODE.RUN_STARTED,
          "Modification en masse commencée",
          {
            total: state.totalToProcess,
            field: state.selectedField.name,

            value: displayValue(
              state.selectedValue,
              state.selectedField
            ),
          }
        );

        renderRunProgress();

        const readyEntries =
          state.entries.filter(
            (entry) =>
              entry.status === "ready"
          );

        for (
          let index = 0;
          index < readyEntries.length;
          index += 1
        ) {
          const entry =
            readyEntries[index];

          await waitWhilePaused();

          if (state.stopRequested) {
            markRemainingStopped(
              readyEntries.slice(index)
            );

            break;
          }

          updateRunProgress(
            entry.email
          );

          try {
            await processMember(entry);
          } catch (error) {
            const wrapped =
              toYbmError(
                error,
                CODE.UNEXPECTED,
                "Erreur inattendue pendant la modification"
              );

            entry.status =
              "edit_error";

            entry.code =
              wrapped.code;

            entry.message =
              wrapped.message;

            entry.processedAt =
              new Date().toISOString();

            debug(
              "error",
              wrapped.code,
              wrapped.message,
              {
                email: entry.email,
                memberId: entry.memberId,
                ...wrapped.context,
              }
            );

            if (
              [
                CODE.AUTH_EXPIRED,
                CODE.RATE_LIMIT,
              ].includes(wrapped.code)
            ) {
              state.stopRequested = true;

              debug(
                "warn",
                CODE.RUN_STOP_REQUESTED,
                "Arrêt automatique pour éviter une série d’échecs identiques.",
                {
                  causeCode:
                    wrapped.code,
                }
              );
            }
          }

          state.processed += 1;

          updateRunProgress(
            entry.email
          );

          if (
            !state.stopRequested &&
            index <
              readyEntries.length - 1
          ) {
            await delay(
              APP.betweenMembersDelayMs
            );
          }
        }

        state.finishedAt =
          new Date().toISOString();

        state.phase = "complete";

        clearPasswordSecret();

        setActive(false);

        debug(
          "info",
          CODE.RUN_COMPLETE,
          "Traitement terminé",
          summarizeEntries()
        );

        renderCompletion();
      }

      async function processMember(entry) {
        if (
          state.selectedField.type ===
          "password"
        ) {
          await processPasswordMember(
            entry
          );

          return;
        }

        const editPage =
          await loadEditPage(
            entry.editUrl,
            entry.email
          );

        const actualFields =
          extractSupportedFields(
            editPage.form
          );

        const actualField =
          actualFields.find(
            (field) =>
              field.name ===
              state.selectedField.name
          );

        if (!actualField) {
          throw new YbmError(
            CODE.FIELD_MISSING,
            "Le champ sélectionné n’existe pas dans cette fiche.",
            {
              field:
                state.selectedField.name,

              memberId:
                entry.memberId,
            }
          );
        }

        if (
          !areFieldTypesCompatible(
            state.selectedField,
            actualField
          )
        ) {
          throw new YbmError(
            CODE.FIELD_INCOMPATIBLE,
            "Le type du champ diffère de celui de la première fiche.",
            {
              expectedType:
                state.selectedField.type,

              actualType:
                actualField.type,

              field:
                actualField.name,
            }
          );
        }

        entry.oldValue =
          displayValue(
            readFieldValue(
              actualField
            ),
            actualField
          );

        applyFieldValue(
          actualField,
          state.selectedValue
        );

        entry.newValue =
          displayValue(
            state.selectedValue,
            state.selectedField
          );

        const formData =
          new FormData(
            editPage.form
          );

        await submitMemberForm(
          editPage.saveUrl,
          formData,
          entry
        );

        entry.status = "success";
        entry.code =
          CODE.MEMBER_SAVED;

        entry.message =
          "Modification enregistrée et redirection Yapla confirmée";

        entry.processedAt =
          new Date().toISOString();

        debug(
          "info",
          CODE.MEMBER_SAVED,
          "Membre modifié",
          {
            email: entry.email,
            memberId: entry.memberId,
            field:
              state.selectedField.name,
            oldValue:
              entry.oldValue,
            newValue:
              entry.newValue,
          }
        );
      }

      /*
       * ============================================================
       * PASSWORD
       * ============================================================
       */

      async function processPasswordMember(
        entry
      ) {
        const validation =
          validatePassword(
            state.selectedValue
          );

        if (!validation.valid) {
          throw new YbmError(
            CODE.PASSWORD_INVALID,
            validation.message,
            {
              memberId:
                entry.memberId,
            }
          );
        }

        const passwordPage =
          await loadPasswordPage(
            entry
          );

        const changePassword =
          passwordPage.form.querySelector(
            '[name="changePassword"]'
          );

        const confirmPassword =
          passwordPage.form.querySelector(
            '[name="confirm_password"]'
          );

        if (
          !changePassword ||
          !confirmPassword
        ) {
          throw new YbmError(
            CODE.PASSWORD_FORM_MISSING,
            "Les deux champs de mot de passe n’ont pas été trouvés.",
            {
              memberId:
                entry.memberId,
            }
          );
        }

        changePassword.value =
          state.selectedValue;

        confirmPassword.value =
          state.selectedValue;

        entry.oldValue =
          "[non lisible]";

        entry.newValue =
          "[mot de passe masqué]";

        const formData =
          new FormData(
            passwordPage.form
          );

        const bodyData =
          new URLSearchParams();

        for (
          const [name, value]
          of formData.entries()
        ) {
          bodyData.append(
            name,
            String(value)
          );
        }

        await submitPasswordForm(
          passwordPage.saveUrl,
          bodyData,
          entry
        );

        entry.status = "success";
        entry.code =
          CODE.PASSWORD_SAVED;

        entry.message =
          "Mot de passe enregistré";

        entry.processedAt =
          new Date().toISOString();

        debug(
          "info",
          CODE.PASSWORD_SAVED,
          "Mot de passe du membre modifié",
          {
            email: entry.email,
            memberId: entry.memberId,
          }
        );
      }

      async function loadPasswordPage(entry) {
        const resetUrl =
          new URL(
            `/member/fr/member/resetpassword/memberId/${encodeURIComponent(
              entry.memberId
            )}`,
            location.origin
          ).href;

        const {
          response,
          doc,
        } = await fetchHtmlWithRetry(
          resetUrl,
          {
            method: "GET",
            credentials: "include",
            redirect: "follow",

            headers: {
              Accept:
                "text/html,application/xhtml+xml",
            },
          },
          {
            operation: "password",
            email: entry.email,
          }
        );

        assertAuthenticated(
          response,
          doc
        );

        const form =
          doc.querySelector(
            "#passwordForm"
          );

        if (!form) {
          throw new YbmError(
            CODE.PASSWORD_FORM_MISSING,
            "Le formulaire #passwordForm n’a pas été trouvé.",
            {
              memberId:
                entry.memberId,

              finalUrl:
                response.url,
            }
          );
        }

        const memberIdInput =
          form.querySelector(
            '[name="id"]'
          );

        if (
          memberIdInput &&
          memberIdInput.value !==
            entry.memberId
        ) {
          throw new YbmError(
            CODE.PASSWORD_FORM_MISSING,
            "L’identifiant du formulaire de mot de passe ne correspond pas au membre.",
            {
              expectedMemberId:
                entry.memberId,

              formMemberId:
                memberIdInput.value,
            }
          );
        }

        const saveLink =
          doc.querySelector(
            'a.form-submit.btn-save[href*="/resetpassword/memberId/"]'
          );

        if (!saveLink) {
          throw new YbmError(
            CODE.PASSWORD_FORM_MISSING,
            "Le bouton Enregistrer de la page de mot de passe est absent.",
            {
              memberId:
                entry.memberId,
            }
          );
        }

        return {
          form,

          saveUrl:
            new URL(
              saveLink.getAttribute(
                "href"
              ),
              location.origin
            ).href,
        };
      }

      async function submitPasswordForm(
        saveUrl,
        bodyData,
        entry
      ) {
        let response;

        try {
          response =
            await fetchWithTimeout(
              saveUrl,
              {
                method: "POST",
                credentials: "include",
                redirect: "follow",

                headers: {
                  Accept:
                    "text/html,application/xhtml+xml",

                  "Content-Type":
                    "application/x-www-form-urlencoded;charset=UTF-8",
                },

                body:
                  bodyData.toString(),
              }
            );
        } catch (error) {
          throw new YbmError(
            CODE.PASSWORD_SAVE_UNCERTAIN,

            "La réponse de Yapla n’a pas été reçue. " +
              "Le mot de passe est peut-être modifié; " +
              "vérifie ce membre manuellement.",

            {
              memberId:
                entry.memberId,

              saveUrl:
                redactUrl(saveUrl),

              causeCode:
                error instanceof
                YbmError
                  ? error.code
                  : CODE.REQUEST_NETWORK,
            },

            error
          );
        }

        const text =
          await response.text();

        const doc =
          parseHtml(text);

        assertAuthenticated(
          response,
          doc
        );

        if (!response.ok) {
          throw new YbmError(
            CODE.PASSWORD_SAVE_HTTP,

            `Yapla a répondu HTTP ${response.status} pendant le changement de mot de passe.`,

            {
              memberId:
                entry.memberId,

              status:
                response.status,

              finalUrl:
                response.url,
            }
          );
        }

        const validationErrors =
          extractValidationErrors(
            doc
          );

        if (
          validationErrors.length
        ) {
          throw new YbmError(
            CODE.PASSWORD_SAVE_VALIDATION,
            "Yapla a refusé le nouveau mot de passe.",
            {
              memberId:
                entry.memberId,

              errors:
                validationErrors.slice(
                  0,
                  10
                ),

              finalUrl:
                response.url,
            }
          );
        }

        const finalUrl =
          new URL(
            response.url,
            location.origin
          );

        const stillOnResetForm =
          finalUrl.pathname.includes(
            "/member/resetpassword/memberId/"
          ) &&
          doc.querySelector(
            "#passwordForm"
          );

        const successMessage =
          doc.querySelector(
            "#message_box .alert-success, .alert.alert-success"
          );

        if (
          stillOnResetForm &&
          !successMessage
        ) {
          throw new YbmError(
            CODE.PASSWORD_SAVE_UNCERTAIN,
            "La page de mot de passe est restée ouverte sans confirmation de réussite.",
            {
              memberId:
                entry.memberId,

              finalUrl:
                response.url,

              redirected:
                response.redirected,
            }
          );
        }
      }

      /*
       * ============================================================
       * NORMAL MEMBER SAVE
       * ============================================================
       */

      async function submitMemberForm(
        saveUrl,
        formData,
        entry
      ) {
        let response;

        try {
          response =
            await fetchWithTimeout(
              saveUrl,
              {
                method: "POST",
                credentials: "include",
                redirect: "follow",

                headers: {
                  Accept:
                    "text/html,application/xhtml+xml",
                },

                body: formData,
              }
            );
        } catch (error) {
          throw new YbmError(
            CODE.SAVE_UNCERTAIN,

            "La réponse de Yapla n’a pas été reçue. " +
              "La modification est peut-être enregistrée; " +
              "vérifie manuellement cette fiche.",

            {
              memberId:
                entry.memberId,

              saveUrl:
                redactUrl(saveUrl),

              causeCode:
                error instanceof
                YbmError
                  ? error.code
                  : CODE.REQUEST_NETWORK,
            },

            error
          );
        }

        const text =
          await response.text();

        const doc =
          parseHtml(text);

        assertAuthenticated(
          response,
          doc
        );

        if (!response.ok) {
          throw new YbmError(
            CODE.SAVE_HTTP,
            `Yapla a répondu HTTP ${response.status} pendant l’enregistrement.`,
            {
              status:
                response.status,

              finalUrl:
                response.url,

              memberId:
                entry.memberId,
            }
          );
        }

        const expectedPath =
          `/member/fr/member/view/memberId/${entry.memberId}`;

        const finalUrl =
          new URL(
            response.url,
            location.origin
          );

        if (
          finalUrl.pathname.includes(
            expectedPath
          )
        ) {
          return;
        }

        const validationErrors =
          extractValidationErrors(
            doc
          );

        if (
          validationErrors.length
        ) {
          throw new YbmError(
            CODE.SAVE_VALIDATION,

            "Yapla a refusé le formulaire à cause d’une erreur de validation.",

            {
              memberId:
                entry.memberId,

              errors:
                validationErrors.slice(
                  0,
                  10
                ),

              finalUrl:
                response.url,
            }
          );
        }

        throw new YbmError(
          CODE.SAVE_REDIRECT,
          "La redirection attendue vers la fiche du membre n’a pas été observée.",
          {
            expectedPath,

            finalUrl:
              response.url,

            redirected:
              response.redirected,

            memberId:
              entry.memberId,
          }
        );
      }

      /*
       * ============================================================
       * RUN PROGRESS
       * ============================================================
       */

      function renderRunProgress() {
        body.innerHTML = `
          <div class="ybm-card">
            <h3 style="margin-top:0">
              4. Modification en cours
            </h3>

            <div class="ybm-progress">
              <div id="ytb-mass-mod-progress-bar"></div>
            </div>

            <div class="ybm-progress-meta">
              <span id="ytb-mass-mod-progress-count">
                0/${state.totalToProcess}
              </span>

              <span id="ytb-mass-mod-progress-percent">
                0%
              </span>
            </div>

            <p
              id="ytb-mass-mod-current"
              class="ybm-muted"
            >
              Préparation…
            </p>
          </div>

          <div
            class="ybm-grid"
            style="margin-top:14px"
          >
            <div class="ybm-stat">
              Réussites
              <strong id="ytb-mass-mod-success-count">0</strong>
            </div>

            <div class="ybm-stat">
              Erreurs
              <strong id="ytb-mass-mod-error-count">0</strong>
            </div>

            <div class="ybm-stat">
              Traités
              <strong id="ytb-mass-mod-done-count">0</strong>
            </div>

            <div class="ybm-stat">
              Restants
              <strong id="ytb-mass-mod-left-count">
                ${state.totalToProcess}
              </strong>
            </div>
          </div>

          <div class="ybm-card">
            <strong>Journal récent</strong>

            <div
              id="ytb-mass-mod-live-log"
              class="ybm-log"
              style="margin-top:9px"
            ></div>
          </div>

          <div class="ybm-warning">
            Tu peux réduire cette fenêtre.
            Ne ferme pas l’onglet Yapla pendant le traitement.
          </div>
        `;

        footer.innerHTML = `
          <button
            class="ybm-btn ybm-btn-secondary"
            type="button"
            data-action="minimize"
          >
            Réduire
          </button>

          <button
            class="ybm-btn ybm-btn-warning"
            type="button"
            data-action="pause"
          >
            Mettre en pause
          </button>

          <button
            class="ybm-btn ybm-btn-danger"
            type="button"
            data-action="stop"
          >
            Arrêter après ce membre
          </button>
        `;

        footer
          .querySelector(
            '[data-action="minimize"]'
          )
          .addEventListener(
            "click",
            minimizeModal
          );

        footer
          .querySelector(
            '[data-action="pause"]'
          )
          .addEventListener(
            "click",
            togglePause
          );

        footer
          .querySelector(
            '[data-action="stop"]'
          )
          .addEventListener(
            "click",
            requestStop
          );

        updateRunProgress(
          "Préparation…"
        );
      }

      function updateRunProgress(
        currentEmail
      ) {
        const percent =
          percentage(
            state.processed,
            state.totalToProcess
          );

        const successes =
          state.entries.filter(
            (entry) =>
              entry.status ===
              "success"
          ).length;

        const errors =
          state.entries.filter(
            (entry) =>
              entry.status ===
              "edit_error"
          ).length;

        const remaining =
          Math.max(
            0,
            state.totalToProcess -
              state.processed
          );

        setText(
          "#ytb-mass-mod-progress-count",
          `${state.processed}/${state.totalToProcess}`
        );

        setText(
          "#ytb-mass-mod-progress-percent",
          `${percent}%`
        );

        setText(
          "#ytb-mass-mod-current",
          state.paused
            ? `En pause avant ${currentEmail}`
            : `Membre : ${currentEmail}`
        );

        setText(
          "#ytb-mass-mod-success-count",
          String(successes)
        );

        setText(
          "#ytb-mass-mod-error-count",
          String(errors)
        );

        setText(
          "#ytb-mass-mod-done-count",
          String(state.processed)
        );

        setText(
          "#ytb-mass-mod-left-count",
          String(remaining)
        );

        const bar =
          body.querySelector(
            "#ytb-mass-mod-progress-bar"
          );

        if (bar) {
          bar.style.width =
            `${percent}%`;
        }

        renderLiveLog();
      }

      function togglePause() {
        if (state.stopRequested) {
          return;
        }

        state.paused =
          !state.paused;

        const button =
          footer.querySelector(
            '[data-action="pause"]'
          );

        if (button) {
          button.textContent =
            state.paused
              ? "Reprendre"
              : "Mettre en pause";
        }

        debug(
          "info",
          state.paused
            ? CODE.RUN_PAUSED
            : CODE.RUN_RESUMED,

          state.paused
            ? "Traitement mis en pause"
            : "Traitement repris"
        );

        updateRunProgress(
          state.paused
            ? "Prochain membre"
            : "Reprise…"
        );
      }

      function requestStop() {
        state.stopRequested = true;
        state.paused = false;

        const pauseButton =
          footer.querySelector(
            '[data-action="pause"]'
          );

        const stopButton =
          footer.querySelector(
            '[data-action="stop"]'
          );

        if (pauseButton) {
          pauseButton.disabled = true;
        }

        if (stopButton) {
          stopButton.disabled = true;
          stopButton.textContent =
            "Arrêt demandé";
        }

        debug(
          "warn",
          CODE.RUN_STOP_REQUESTED,
          "Arrêt demandé; aucun nouveau membre ne sera commencé."
        );
      }

      async function waitWhilePaused() {
        while (
          state.paused &&
          !state.stopRequested
        ) {
          await delay(250);
        }
      }

      function markRemainingStopped(
        entries
      ) {
        for (const entry of entries) {
          if (
            entry.status ===
            "ready"
          ) {
            entry.status =
              "stopped";

            entry.code =
              CODE.STOPPED;

            entry.message =
              "Non traité après la demande d’arrêt";
          }
        }
      }

      /*
       * ============================================================
       * COMPLETION
       * ============================================================
       */

      function renderCompletion() {
        const summary =
          summarizeEntries();

        const issueEntries =
          state.entries.filter(
            (entry) =>
              !["success"].includes(
                entry.status
              )
          );

        const issueRows =
          issueEntries
            .slice(0, 100)
            .map(
              (entry) => `
                <tr>
                  <td>
                    ${escapeHtml(entry.email)}
                  </td>

                  <td>
                    ${escapeHtml(
                      STATUS_LABELS[
                        entry.status
                      ] || entry.status
                    )}
                  </td>

                  <td class="ybm-code">
                    ${escapeHtml(
                      entry.code || ""
                    )}
                  </td>

                  <td>
                    ${escapeHtml(
                      entry.message || ""
                    )}
                  </td>
                </tr>
              `
            )
            .join("");

        body.innerHTML = `
          <div class="ybm-card">
            <h3 style="margin-top:0">
              Traitement terminé
            </h3>

            <p>
              ${
                state.stopRequested
                  ? "Le traitement a été arrêté à ta demande."
                  : "Tous les membres admissibles ont été traités."
              }
            </p>
          </div>

          <div
            class="ybm-grid"
            style="margin-top:14px"
          >
            <div class="ybm-stat">
              Réussites
              <strong>${summary.success}</strong>
            </div>

            <div class="ybm-stat">
              Erreurs de modification
              <strong>${summary.editErrors}</strong>
            </div>

            <div class="ybm-stat">
              Introuvables/ambigus
              <strong>
                ${
                  summary.notFound +
                  summary.ambiguous
                }
              </strong>
            </div>

            <div class="ybm-stat">
              Non traités
              <strong>${summary.stopped}</strong>
            </div>
          </div>

          ${
            issueEntries.length
              ? `
                <div class="ybm-card">
                  <strong>
                    Éléments à vérifier
                    (${issueEntries.length})
                  </strong>

                  <div
                    class="ybm-table-wrap"
                    style="margin-top:10px"
                  >
                    <table class="ybm-table">
                      <thead>
                        <tr>
                          <th>Courriel</th>
                          <th>Résultat</th>
                          <th>Code</th>
                          <th>Détail</th>
                        </tr>
                      </thead>

                      <tbody>
                        ${issueRows}
                      </tbody>
                    </table>
                  </div>
                </div>
              `
              : `
                <div
                  class="ybm-note"
                  style="margin-top:14px"
                >
                  Aucune erreur détectée.
                </div>
              `
          }

          <div class="ybm-card">
            <strong>Diagnostic</strong>

            <p class="ybm-muted">
              En cas de problème, télécharge le journal JSON
              et transmets le code d’erreur correspondant.
            </p>

            <div class="ybm-log">
              ${state.logs
                .slice(-20)
                .map(renderLogLine)
                .join("")}
            </div>
          </div>
        `;

        footer.innerHTML = `
          <button
            class="ybm-btn ybm-btn-secondary"
            type="button"
            data-action="debug"
          >
            Télécharger le diagnostic
          </button>

          <button
            class="ybm-btn ybm-btn-secondary"
            type="button"
            data-action="restart"
          >
            Nouvelle opération
          </button>

          <button
            class="ybm-btn ybm-btn-primary"
            type="button"
            data-action="report"
          >
            Télécharger le rapport Excel
          </button>
        `;

        footer
          .querySelector(
            '[data-action="debug"]'
          )
          .addEventListener(
            "click",
            downloadDebugLog
          );

        footer
          .querySelector(
            '[data-action="restart"]'
          )
          .addEventListener(
            "click",
            confirmRestart
          );

        footer
          .querySelector(
            '[data-action="report"]'
          )
          .addEventListener(
            "click",
            downloadExcelReport
          );
      }

      function renderBusy(
        title,
        detail
      ) {
        body.innerHTML = `
          <div class="ybm-card ybm-busy">
            <div class="ybm-spinner"></div>

            <div>
              <h3 style="margin:0 0 5px">
                ${escapeHtml(title)}
              </h3>

              <div class="ybm-muted">
                ${escapeHtml(detail)}
              </div>
            </div>
          </div>
        `;

        footer.innerHTML = `
          <button
            class="ybm-btn ybm-btn-secondary"
            type="button"
            data-action="minimize"
          >
            Réduire
          </button>
        `;

        footer
          .querySelector(
            '[data-action="minimize"]'
          )
          .addEventListener(
            "click",
            minimizeModal
          );
      }

      function handleFatalError(
        error,
        title
      ) {
        const wrapped =
          toYbmError(
            error,
            CODE.UNEXPECTED,
            "Erreur inattendue"
          );

        debug(
          "error",
          wrapped.code,
          wrapped.message,
          wrapped.context
        );

        clearPasswordSecret();

        state.phase = "error";

        body.innerHTML = `
          <div class="ybm-error">
            <strong>
              ${escapeHtml(title)}
            </strong>

            <p>
              ${escapeHtml(
                wrapped.message
              )}
            </p>

            <div class="ybm-code">
              ${escapeHtml(
                wrapped.code
              )}
            </div>
          </div>

          <div class="ybm-card">
            <strong>
              Informations de diagnostic
            </strong>

            <pre
              class="ybm-log"
              style="white-space:pre-wrap"
            >${escapeHtml(
              JSON.stringify(
                wrapped.context,
                null,
                2
              )
            )}</pre>
          </div>

          <p class="ybm-muted">
            Ouvre également F12 → Console
            et recherche le code
            ${escapeHtml(wrapped.code)}.
          </p>
        `;

        footer.innerHTML = `
          <button
            class="ybm-btn ybm-btn-secondary"
            type="button"
            data-action="debug"
          >
            Télécharger le diagnostic
          </button>

          <button
            class="ybm-btn ybm-btn-primary"
            type="button"
            data-action="restart"
          >
            Recommencer
          </button>
        `;

        footer
          .querySelector(
            '[data-action="debug"]'
          )
          .addEventListener(
            "click",
            downloadDebugLog
          );

        footer
          .querySelector(
            '[data-action="restart"]'
          )
          .addEventListener(
            "click",
            confirmRestart
          );
      }

      /*
       * ============================================================
       * MEMBER SEARCH
       * ============================================================
       */

      async function resolveMember(email) {
        const bodyData =
          new URLSearchParams();

        bodyData.set(
          "q[search]",
          email
        );

        bodyData.set(
          "qsearch_submit",
          ""
        );

        const {
          response,
          doc,
        } = await fetchHtmlWithRetry(
          new URL(
            APP.searchUrl,
            location.origin
          ).href,

          {
            method: "POST",
            credentials: "include",
            redirect: "follow",

            headers: {
              Accept:
                "text/html,application/xhtml+xml",

              "Content-Type":
                "application/x-www-form-urlencoded;charset=UTF-8",
            },

            body:
              bodyData.toString(),
          },

          {
            operation: "search",
            email,
          }
        );

        assertAuthenticated(
          response,
          doc
        );

        const rows =
          Array.from(
            doc.querySelectorAll(
              "#memberListTable tbody tr"
            )
          );

        if (
          !rows.length &&
          !doc.querySelector(
            "#memberListTable"
          )
        ) {
          throw new YbmError(
            CODE.SEARCH_PARSE,
            "Le tableau des membres n’a pas été trouvé dans la réponse Yapla.",
            {
              email,
              finalUrl:
                response.url,
            }
          );
        }

        const exactRows =
          rows.filter((row) => {
            const emailCell =
              findEmailCell(row);

            return (
              emailCell &&
              normalizeEmail(
                emailCell.textContent
              ) ===
                normalizeEmail(email)
            );
          });

        if (
          exactRows.length === 0
        ) {
          return {
            status:
              "not_found",

            code:
              CODE.MEMBER_NOT_FOUND,

            message:
              "Aucun membre ne correspond exactement à ce courriel",
          };
        }

        if (
          exactRows.length > 1
        ) {
          return {
            status:
              "ambiguous",

            code:
              CODE.MEMBER_AMBIGUOUS,

            message:
              `${exactRows.length} membres possèdent exactement ce courriel`,
          };
        }

        const row =
          exactRows[0];

        const editLink =
          row.querySelector(
            'a.dropdown-item[href*="/member/fr/member/edit/memberId/"]'
          );

        if (!editLink) {
          throw new YbmError(
            CODE.EDIT_LINK_MISSING,
            "Le lien Modifier est absent de la ligne du membre.",
            {
              email,
            }
          );
        }

        const editUrl =
          new URL(
            editLink.getAttribute(
              "href"
            ),
            location.origin
          ).href;

        const memberId =
          extractMemberId(
            editUrl
          );

        if (!memberId) {
          throw new YbmError(
            CODE.EDIT_LINK_MISSING,
            "Le memberId ne peut pas être extrait du lien Modifier.",
            {
              email,
              editUrl,
            }
          );
        }

        return {
          status: "ready",
          code: "",
          message:
            "Membre trouvé",
          memberId,
          editUrl,
        };
      }

      function applyResolution(
        entry,
        resolution
      ) {
        entry.status =
          resolution.status;

        entry.code =
          resolution.code || "";

        entry.message =
          resolution.message || "";

        entry.memberId =
          resolution.memberId || "";

        entry.editUrl =
          resolution.editUrl || "";

        if (
          entry.status !== "ready"
        ) {
          debug(
            "warn",
            entry.code,
            entry.message,
            {
              email:
                entry.email,
            }
          );
        }
      }

      /*
       * ============================================================
       * EDIT PAGE
       * ============================================================
       */

      async function loadEditPage(
        editUrl,
        email
      ) {
        const {
          response,
          doc,
        } = await fetchHtmlWithRetry(
          editUrl,

          {
            method: "GET",
            credentials: "include",
            redirect: "follow",

            headers: {
              Accept:
                "text/html,application/xhtml+xml",
            },
          },

          {
            operation: "edit",
            email,
          }
        );

        assertAuthenticated(
          response,
          doc
        );

        const form =
          doc.querySelector(
            "form.form-create[method='post'], " +
              "form.form-create, " +
              "form[method='post'][enctype='multipart/form-data']"
          );

        if (!form) {
          throw new YbmError(
            CODE.EDIT_FORM_MISSING,
            "Le formulaire de modification n’a pas été trouvé.",
            {
              email,

              finalUrl:
                response.url,
            }
          );
        }

        const saveLink =
          doc.querySelector(
            "a.btn-save.form-submit[href], a.form-submit[href]"
          );

        if (!saveLink) {
          throw new YbmError(
            CODE.SAVE_LINK_MISSING,
            "Le bouton Enregistrer n’a pas été trouvé.",
            {
              email,

              finalUrl:
                response.url,
            }
          );
        }

        return {
          doc,
          form,

          saveUrl:
            new URL(
              saveLink.getAttribute(
                "href"
              ),
              location.origin
            ).href,

          finalUrl:
            response.url,
        };
      }

      /*
       * ============================================================
       * FETCH
       * ============================================================
       */

      async function fetchHtmlWithRetry(
        url,
        options,
        context
      ) {
        let lastError;

        for (
          let attempt = 0;
          attempt <=
          APP.readRetryCount;
          attempt += 1
        ) {
          try {
            const response =
              await fetchWithTimeout(
                url,
                options
              );

            if (
              response.status ===
              429
            ) {
              if (
                attempt <
                APP.readRetryCount
              ) {
                debug(
                  "warn",
                  CODE.RATE_LIMIT,
                  "Limite temporaire Yapla; nouvelle tentative",
                  {
                    attempt:
                      attempt + 1,

                    ...context,
                  }
                );

                await delay(
                  APP.retryBaseDelayMs *
                    (attempt + 1)
                );

                continue;
              }

              throw new YbmError(
                CODE.RATE_LIMIT,
                "Yapla limite temporairement les requêtes (HTTP 429).",
                {
                  status:
                    response.status,

                  ...context,
                }
              );
            }

            if (!response.ok) {
              const code =
                context.operation ===
                "edit"
                  ? CODE.EDIT_HTTP
                  : context.operation ===
                      "password"
                    ? CODE.PASSWORD_PAGE_HTTP
                    : CODE.SEARCH_HTTP;

              if (
                response.status >=
                  500 &&
                attempt <
                  APP.readRetryCount
              ) {
                debug(
                  "warn",
                  code,
                  "Erreur serveur temporaire; nouvelle tentative",
                  {
                    status:
                      response.status,

                    attempt:
                      attempt + 1,

                    ...context,
                  }
                );

                await delay(
                  APP.retryBaseDelayMs *
                    (attempt + 1)
                );

                continue;
              }

              throw new YbmError(
                code,
                `Yapla a répondu HTTP ${response.status}.`,
                {
                  status:
                    response.status,

                  finalUrl:
                    response.url,

                  ...context,
                }
              );
            }

            const text =
              await response.text();

            const doc =
              parseHtml(text);

            return {
              response,
              text,
              doc,
            };
          } catch (error) {
            lastError = error;

            if (
              error instanceof
                YbmError &&
              ![
                CODE.REQUEST_TIMEOUT,
                CODE.REQUEST_NETWORK,
              ].includes(error.code)
            ) {
              throw error;
            }

            if (
              attempt <
              APP.readRetryCount
            ) {
              debug(
                "warn",
                error.code ||
                  CODE.REQUEST_NETWORK,
                "Requête de lecture échouée; nouvelle tentative",
                {
                  attempt:
                    attempt + 1,

                  ...context,
                }
              );

              await delay(
                APP.retryBaseDelayMs *
                  (attempt + 1)
              );

              continue;
            }
          }
        }

        throw (
          lastError ||
          new YbmError(
            CODE.REQUEST_NETWORK,
            "La requête Yapla a échoué.",
            context
          )
        );
      }

      async function fetchWithTimeout(
        url,
        options
      ) {
        const controller =
          new AbortController();

        const timeout =
          setTimeout(
            () =>
              controller.abort(),

            APP.requestTimeoutMs
          );

        try {
          return await fetch(
            url,
            {
              ...options,
              signal:
                controller.signal,
            }
          );
        } catch (error) {
          if (
            error?.name ===
            "AbortError"
          ) {
            throw new YbmError(
              CODE.REQUEST_TIMEOUT,

              `La requête a dépassé ${
                APP.requestTimeoutMs /
                1000
              } secondes.`,

              {
                url:
                  redactUrl(url),
              },

              error
            );
          }

          throw new YbmError(
            CODE.REQUEST_NETWORK,
            "Erreur réseau pendant la communication avec Yapla.",
            {
              url:
                redactUrl(url),
            },
            error
          );
        } finally {
          clearTimeout(timeout);
        }
      }

      function assertAuthenticated(
        response,
        doc
      ) {
        const finalUrl =
          response.url || "";

        const loginForm =
          doc.querySelector(
            'form[action*="login" i], ' +
              'form[id*="login" i], ' +
              'form[name*="login" i]'
          );

        if (
          /\/login(?:\/|$|\?)/i.test(
            finalUrl
          ) ||
          loginForm
        ) {
          throw new YbmError(
            CODE.AUTH_EXPIRED,
            "La session Yapla semble expirée. Reconnecte-toi, puis recommence.",
            {
              finalUrl,
            }
          );
        }
      }

      /*
       * ============================================================
       * FIELD EXTRACTION
       * ============================================================
       */

      function extractSupportedFields(
        form
      ) {
        const allControls =
          Array.from(
            form.elements
          ).filter(
            (element) =>
              element?.name &&
              !element.disabled
          );

        const names = [];

        for (
          const control
          of allControls
        ) {
          if (
            !names.includes(
              control.name
            )
          ) {
            names.push(
              control.name
            );
          }
        }

        const fields = [];

        for (const name of names) {
          const controls =
            allControls.filter(
              (control) =>
                control.name ===
                name
            );

          const visibleControls =
            controls.filter(
              (control) => {
                const type =
                  String(
                    control.type || ""
                  ).toLowerCase();

                return ![
                  "hidden",
                  "submit",
                  "button",
                  "reset",
                  "file",
                  "image",
                  "password",
                ].includes(type);
              }
            );

          if (
            !visibleControls.length
          ) {
            continue;
          }

          const primary =
            visibleControls[0];

          const tagName =
            primary.tagName.toLowerCase();

          const inputType =
            String(
              primary.type || "text"
            ).toLowerCase();

          let type;
          let options = [];

          if (
            tagName === "select"
          ) {
            type = primary.multiple
              ? "multiselect"
              : "select";

            options =
              Array.from(
                primary.options
              ).map(
                (option) => ({
                  value:
                    option.value,

                  label:
                    option.textContent.trim() ||
                    "(Vide)",
                })
              );
          } else if (
            tagName ===
            "textarea"
          ) {
            type = "textarea";
          } else if (
            inputType ===
            "radio"
          ) {
            type = "radio";

            options =
              visibleControls.map(
                (control) => ({
                  value:
                    control.value,

                  label:
                    findControlOptionLabel(
                      control
                    ),
                })
              );
          } else if (
            inputType ===
            "checkbox"
          ) {
            type =
              visibleControls.length ===
              1
                ? "boolean"
                : "checkbox-group";

            options =
              visibleControls.map(
                (control) => ({
                  value:
                    control.value,

                  label:
                    findControlOptionLabel(
                      control
                    ),
                })
              );
          } else {
            type = "text";
          }

          fields.push({
            name,

            label:
              findFieldLabel(
                primary,
                name
              ),

            type,
            inputType,

            fieldId:
              primary.getAttribute(
                "fieldid"
              ) || "",

            fieldType:
              primary.getAttribute(
                "fieldtype"
              ) || "",

            options,
            controls,
            visibleControls,
            primary,
          });
        }

        return fields;
      }

      function createPasswordField() {
        return {
          name:
            "__ybm_password__",

          label:
            "Mot de passe",

          type:
            "password",

          inputType:
            "password",

          fieldId:
            "special-resetpassword",

          fieldType:
            "password",

          options: [],
          controls: [],
          visibleControls: [],

          primary: null,
          special: true,
        };
      }

      function findFieldLabel(
        control,
        fallback
      ) {
        const group =
          control.closest(
            ".form-group"
          ) ||
          control.parentElement;

        const groupLabel =
          group?.querySelector(
            "label.control-label, label:not([for])"
          );

        if (
          groupLabel?.textContent.trim()
        ) {
          return cleanLabel(
            groupLabel.textContent
          );
        }

        if (control.id) {
          const explicit =
            control.ownerDocument.querySelector(
              `label[for="${cssEscape(
                control.id
              )}"]`
            );

          if (
            explicit?.textContent.trim()
          ) {
            return cleanLabel(
              explicit.textContent
            );
          }
        }

        return cleanLabel(
          fallback
            .replace(/\[\]$/, "")
            .replace(
              /[_-]+/g,
              " "
            )
        );
      }

      function findControlOptionLabel(
        control
      ) {
        if (control.id) {
          const explicit =
            control.ownerDocument.querySelector(
              `label[for="${cssEscape(
                control.id
              )}"]`
            );

          if (
            explicit?.textContent.trim()
          ) {
            return cleanLabel(
              explicit.textContent
            );
          }
        }

        return (
          control.value ||
          "Option"
        );
      }

      /*
       * ============================================================
       * FIELD VALUES
       * ============================================================
       */

      function readFieldValue(
        field
      ) {
        if (
          field.type === "select"
        ) {
          return field.primary.value;
        }

        if (
          field.type ===
          "multiselect"
        ) {
          return Array.from(
            field.primary.selectedOptions
          ).map(
            (option) =>
              option.value
          );
        }

        if (
          field.type === "radio"
        ) {
          return (
            field.visibleControls.find(
              (control) =>
                control.checked
            )?.value ?? ""
          );
        }

        if (
          field.type === "boolean"
        ) {
          return Boolean(
            field.visibleControls[0]
              .checked
          );
        }

        if (
          field.type ===
          "checkbox-group"
        ) {
          return field.visibleControls
            .filter(
              (control) =>
                control.checked
            )
            .map(
              (control) =>
                control.value
            );
        }

        return (
          field.primary.value ?? ""
        );
      }

      function applyFieldValue(
        field,
        value
      ) {
        if (
          field.type === "select"
        ) {
          const exists =
            Array.from(
              field.primary.options
            ).some(
              (option) =>
                option.value ===
                String(value)
            );

          if (!exists) {
            throw invalidValueError(
              field,
              value
            );
          }

          field.primary.value =
            String(value);

          return;
        }

        if (
          field.type ===
          "multiselect"
        ) {
          const values =
            new Set(
              Array.isArray(value)
                ? value.map(String)
                : []
            );

          const available =
            new Set(
              Array.from(
                field.primary.options
              ).map(
                (option) =>
                  option.value
              )
            );

          if (
            Array.from(values).some(
              (item) =>
                !available.has(item)
            )
          ) {
            throw invalidValueError(
              field,
              value
            );
          }

          for (
            const option
            of field.primary.options
          ) {
            option.selected =
              values.has(
                option.value
              );
          }

          return;
        }

        if (
          field.type === "radio"
        ) {
          const target =
            field.visibleControls.find(
              (control) =>
                control.value ===
                String(value)
            );

          if (!target) {
            throw invalidValueError(
              field,
              value
            );
          }

          for (
            const control
            of field.visibleControls
          ) {
            control.checked =
              control === target;
          }

          return;
        }

        if (
          field.type === "boolean"
        ) {
          field.visibleControls[0]
            .checked =
            Boolean(value);

          return;
        }

        if (
          field.type ===
          "checkbox-group"
        ) {
          const values =
            new Set(
              Array.isArray(value)
                ? value.map(String)
                : []
            );

          const available =
            new Set(
              field.visibleControls.map(
                (control) =>
                  control.value
              )
            );

          if (
            Array.from(values).some(
              (item) =>
                !available.has(item)
            )
          ) {
            throw invalidValueError(
              field,
              value
            );
          }

          for (
            const control
            of field.visibleControls
          ) {
            control.checked =
              values.has(
                control.value
              );
          }

          return;
        }

        field.primary.value =
          value == null
            ? ""
            : String(value);
      }

      function invalidValueError(
        field,
        value
      ) {
        return new YbmError(
          CODE.FIELD_VALUE_INVALID,
          "La valeur choisie n’est pas disponible dans cette fiche.",
          {
            field: field.name,

            value:
              Array.isArray(value)
                ? value
                : String(value),

            availableValues:
              field.options.map(
                (option) =>
                  option.value
              ),
          }
        );
      }

      function readSelectedValueFromUi(
        field
      ) {
        if (!field) {
          throw new YbmError(
            CODE.FIELD_MISSING,
            "Aucun champ n’est sélectionné."
          );
        }

        const valueControl =
          body.querySelector(
            "#ytb-mass-mod-value"
          );

        if (!valueControl) {
          throw new YbmError(
            CODE.FIELD_VALUE_INVALID,
            "Le contrôle de valeur est absent."
          );
        }

        if (
          field.type === "password"
        ) {
          const validation =
            validatePassword(
              valueControl.value
            );

          if (!validation.valid) {
            throw new YbmError(
              CODE.PASSWORD_INVALID,
              validation.message
            );
          }

          return valueControl.value;
        }

        if (
          field.type === "boolean"
        ) {
          return (
            valueControl.value ===
            "true"
          );
        }

        if (
          field.type ===
            "multiselect" ||
          field.type ===
            "checkbox-group"
        ) {
          return Array.from(
            valueControl.querySelectorAll(
              'input[type="checkbox"]:checked'
            )
          ).map(
            (input) =>
              input.value
          );
        }

        return valueControl.value;
      }

      function areFieldTypesCompatible(
        expected,
        actual
      ) {
        return (
          expected.type ===
          actual.type
        );
      }

      /*
       * ============================================================
       * PARSING / VALIDATION
       * ============================================================
       */

      function findEmailCell(row) {
        const cells =
          Array.from(
            row.querySelectorAll(
              "td"
            )
          );

        return (
          cells.find(
            (cell) =>
              /^(courriel|email|e-mail)$/i.test(
                (
                  cell.getAttribute(
                    "data-label"
                  ) || ""
                ).trim()
              )
          ) || null
        );
      }

      function extractValidationErrors(
        doc
      ) {
        const selectors = [
          "#message_box .alert-danger",
          ".alert.alert-danger",
          ".has-error .help-block",
          ".form-group.has-error .error",
          "ul.errors li",
        ];

        const messages = [];

        for (
          const selector
          of selectors
        ) {
          for (
            const node
            of doc.querySelectorAll(
              selector
            )
          ) {
            if (
              node.closest(
                '[style*="display:none"], [style*="display: none"]'
              )
            ) {
              continue;
            }

            const text =
              node.textContent
                .replace(
                  /\s+/g,
                  " "
                )
                .trim();

            if (
              text &&
              !messages.includes(
                text
              )
            ) {
              messages.push(text);
            }
          }
        }

        return messages;
      }

      /*
       * ============================================================
       * DISPLAY HELPERS
       * ============================================================
       */

      function renderOptionTags(
        options
      ) {
        return options
          .map(
            (option) => `
              <option
                value="${escapeAttr(
                  option.value
                )}"
              >
                ${escapeHtml(
                  option.label ||
                  "(Vide)"
                )}
              </option>
            `
          )
          .join("");
      }

      function typeLabel(type) {
        return (
          {
            password:
              "page spéciale",

            text:
              "texte",

            textarea:
              "texte long",

            select:
              "liste",

            multiselect:
              "choix multiple",

            radio:
              "choix unique",

            boolean:
              "case à cocher",

            "checkbox-group":
              "cases multiples",
          }[type] || type
        );
      }

      function displayValue(
        value,
        field
      ) {
        if (!field) {
          return String(
            value ?? ""
          );
        }

        if (
          field.type === "password"
        ) {
          return "[mot de passe masqué]";
        }

        if (
          field.type === "boolean"
        ) {
          return value
            ? "Cochée"
            : "Non cochée";
        }

        if (
          Array.isArray(value)
        ) {
          if (!value.length) {
            return "(Aucune valeur)";
          }

          return value
            .map(
              (item) =>
                optionLabel(
                  field,
                  item
                )
            )
            .join(" | ");
        }

        if (
          value === "" ||
          value == null
        ) {
          return "(Vide)";
        }

        return optionLabel(
          field,
          String(value)
        );
      }

      function optionLabel(
        field,
        value
      ) {
        return (
          field.options?.find(
            (option) =>
              option.value ===
              value
          )?.label ||
          String(value)
        );
      }

      /*
       * ============================================================
       * SUMMARY / REPORT
       * ============================================================
       */

      function summarizeEntries() {
        const count =
          (status) =>
            state.entries.filter(
              (entry) =>
                entry.status ===
                status
            ).length;

        return {
          totalValidUnique:
            state.entries.length,

          ready:
            count("ready"),

          success:
            count("success"),

          notFound:
            count("not_found"),

          ambiguous:
            count("ambiguous"),

          searchErrors:
            count("search_error"),

          editErrors:
            count("edit_error"),

          stopped:
            count("stopped"),

          otherErrors:
            count("search_error") +
            count("edit_error"),

          invalid:
            state.supplementalReportRows.filter(
              (row) =>
                row.Statut ===
                STATUS_LABELS.invalid
            ).length,

          duplicates:
            state.supplementalReportRows.filter(
              (row) =>
                row.Statut ===
                STATUS_LABELS.duplicate
            ).length,
        };
      }

      function rebuildFileStats() {
        return {
          validUniqueEmails:
            state.entries.length,

          invalidCount:
            state.supplementalReportRows.filter(
              (row) =>
                row.Code ===
                CODE.EMAIL_INVALID
            ).length,

          duplicateCount:
            state.supplementalReportRows.filter(
              (row) =>
                row.Code ===
                CODE.EMAIL_DUPLICATE
            ).length,
        };
      }

      function makeReportRow({
        rowNumber = "",
        email = "",
        memberId = "",
        status = "pending",
        code = "",
        message = "",
        oldValue = "",
        newValue = "",
        processedAt = "",
      }) {
        return {
          "Ligne Excel":
            rowNumber,

          Courriel:
            email,

          "ID membre":
            memberId,

          Statut:
            STATUS_LABELS[status] ||
            status,

          Code:
            code,

          Détail:
            message,

          Champ:
            state.selectedField
              ?.label || "",

          "Nom technique":
            state.selectedField
              ?.name || "",

          "Ancienne valeur":
            oldValue,

          "Nouvelle valeur":
            newValue,

          "Date du traitement":
            processedAt,
        };
      }

      function buildReportRows() {
        const entryRows =
          state.entries.map(
            (entry) =>
              makeReportRow({
                rowNumber:
                  entry.rowNumber,

                email:
                  entry.email,

                memberId:
                  entry.memberId,

                status:
                  entry.status,

                code:
                  entry.code,

                message:
                  entry.message,

                oldValue:
                  entry.oldValue,

                newValue:
                  entry.newValue,

                processedAt:
                  entry.processedAt,
              })
          );

        return [
          ...entryRows,
          ...state.supplementalReportRows,
        ].sort(
          (a, b) =>
            Number(
              a["Ligne Excel"] ||
              0
            ) -
            Number(
              b["Ligne Excel"] ||
              0
            )
        );
      }

      async function downloadExcelReport() {
        try {
          const XLSX =
            await ensureXlsxLoaded();

          const rows =
            buildReportRows();

          const sheet =
            XLSX.utils.json_to_sheet(
              rows
            );

          sheet["!autofilter"] = {
            ref: sheet["!ref"],
          };

          sheet["!cols"] = [
            { wch: 12 },
            { wch: 34 },
            { wch: 28 },
            { wch: 24 },
            { wch: 14 },
            { wch: 50 },
            { wch: 30 },
            { wch: 30 },
            { wch: 30 },
            { wch: 30 },
            { wch: 24 },
          ];

          const workbook =
            XLSX.utils.book_new();

          XLSX.utils.book_append_sheet(
            workbook,
            sheet,
            "Rapport"
          );

          const bytes =
            XLSX.write(
              workbook,
              {
                bookType: "xlsx",
                type: "array",
              }
            );

          downloadBlob(
            new Blob(
              [bytes],
              {
                type:
                  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
              }
            ),

            `rapport-modification-yapla-${fileTimestamp()}.xlsx`
          );

          debug(
            "info",
            CODE.REPORT_DOWNLOADED,
            "Rapport Excel téléchargé",
            {
              rows:
                rows.length,
            }
          );
        } catch (error) {
          handleFatalError(
            error instanceof YbmError
              ? error
              : new YbmError(
                  CODE.FILE_READ,
                  "Le rapport Excel n’a pas pu être généré.",
                  {},
                  error
                ),

            "Erreur de rapport"
          );
        }
      }

      function downloadDebugLog() {
        const diagnostic = {
          application: APP.name,
          version: APP.version,

          exportedAt:
            new Date().toISOString(),

          page:
            location.origin +
            location.pathname,

          phase:
            state.phase,

          sourceFileName:
            state.sourceFileName,

          selectedField:
            state.selectedField
              ? {
                  name:
                    state.selectedField
                      .name,

                  label:
                    state.selectedField
                      .label,

                  type:
                    state.selectedField
                      .type,

                  fieldId:
                    state.selectedField
                      .fieldId,
                }
              : null,

          selectedValue:
            state.selectedField
              ? displayValue(
                  state.selectedValue,
                  state.selectedField
                )
              : null,

          summary:
            summarizeEntries(),

          logs:
            state.logs,

          report:
            buildReportRows(),
        };

        downloadBlob(
          new Blob(
            [
              JSON.stringify(
                diagnostic,
                null,
                2
              ),
            ],
            {
              type:
                "application/json;charset=utf-8",
            }
          ),

          `diagnostic-yapla-${fileTimestamp()}.json`
        );
      }

      function downloadBlob(
        blob,
        fileName
      ) {
        const url =
          URL.createObjectURL(
            blob
          );

        const link =
          document.createElement(
            "a"
          );

        link.href = url;
        link.download = fileName;

        document.body.appendChild(
          link
        );

        link.click();
        link.remove();

        setTimeout(
          () =>
            URL.revokeObjectURL(
              url
            ),
          1_000
        );
      }

      /*
       * ============================================================
       * RESET
       * ============================================================
       */

      function confirmRestart() {
        if (state.processing) {
          return;
        }

        const hasWork =
          state.entries.length > 0 ||
          state.selectedFile;

        if (
          !hasWork ||
          window.confirm(
            "Recommencer une nouvelle opération et effacer l’état actuel de cet outil ?"
          )
        ) {
          resetState();
          renderUploadStep();
        }
      }

      function resetState() {
        state.phase = "upload";

        state.sourceFileName = "";

        state.entries = [];
        state.supplementalReportRows = [];

        state.fields = [];
        state.firstMember = null;

        state.selectedField = null;
        state.selectedValue = null;

        state.processing = false;
        state.paused = false;
        state.stopRequested = false;
        state.preflightCancelled = false;

        state.processed = 0;
        state.totalToProcess = 0;

        state.logs = [];

        state.startedAt = null;
        state.finishedAt = null;

        state.selectedFile = null;

        setActive(false);
      }

      function clearPasswordSecret() {
        if (
          state.selectedField?.type ===
          "password"
        ) {
          state.selectedValue = null;
        }
      }

      /*
       * ============================================================
       * LOGGING
       * ============================================================
       */

      function debug(
        level,
        code,
        message,
        context = {}
      ) {
        const entry = {
          timestamp:
            new Date().toISOString(),

          level,
          code,
          message,

          context:
            sanitizeContext(
              context
            ),
        };

        state.logs.push(entry);

        if (
          state.logs.length >
          2_000
        ) {
          state.logs.shift();
        }

        const method =
          level === "error"
            ? "error"
            : level === "warn"
              ? "warn"
              : "info";

        console[method](
          `[${APP.prefix}][${code}] ${message}`,
          entry.context
        );

        renderLiveLog();
      }

      function renderLiveLog() {
        const node =
          body?.querySelector(
            "#ytb-mass-mod-live-log"
          );

        if (!node) {
          return;
        }

        node.innerHTML =
          state.logs
            .slice(-12)
            .map(renderLogLine)
            .join("");

        node.scrollTop =
          node.scrollHeight;
      }

      function renderLogLine(log) {
        return `
          <div class="ybm-log-line">
            ${escapeHtml(
              log.timestamp.slice(
                11,
                19
              )
            )}
            [${escapeHtml(log.code)}]
            ${escapeHtml(log.message)}
          </div>
        `;
      }

      function sanitizeContext(
        value,
        depth = 0
      ) {
        if (depth > 5) {
          return "[profondeur limitée]";
        }

        if (
          value == null ||
          typeof value === "string" ||
          typeof value === "number" ||
          typeof value === "boolean"
        ) {
          return value;
        }

        if (
          value instanceof Error
        ) {
          return {
            name: value.name,
            message:
              value.message,
          };
        }

        if (
          Array.isArray(value)
        ) {
          return value
            .slice(0, 100)
            .map(
              (item) =>
                sanitizeContext(
                  item,
                  depth + 1
                )
            );
        }

        if (
          typeof value === "object"
        ) {
          const result = {};

          for (
            const [key, item]
            of Object.entries(
              value
            )
          ) {
            if (
              /cookie|authorization|php(sess)?id|xsrf|csrf|clearance/i.test(
                key
              )
            ) {
              result[key] =
                "[masqué]";
            } else if (
              typeof item !==
                "function" &&
              !(
                item instanceof
                Node
              )
            ) {
              result[key] =
                sanitizeContext(
                  item,
                  depth + 1
                );
            }
          }

          return result;
        }

        return String(value);
      }

      function toYbmError(
        error,
        fallbackCode,
        fallbackMessage
      ) {
        if (
          error instanceof
          YbmError
        ) {
          return error;
        }

        return new YbmError(
          fallbackCode,
          error?.message ||
            fallbackMessage,
          {},
          error
        );
      }

      /*
       * ============================================================
       * GENERIC HELPERS
       * ============================================================
       */

      function parseHtml(text) {
        return new DOMParser()
          .parseFromString(
            text,
            "text/html"
          );
      }

      function normalizeEmail(
        value
      ) {
        return String(
          value || ""
        )
          .trim()
          .toLowerCase();
      }

      function isValidEmail(
        email
      ) {
        return (
          /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
            email
          ) &&
          email.length <= 254
        );
      }

      function looksLikeEmailHeader(
        value
      ) {
        const normalized =
          value
            .trim()
            .toLowerCase()
            .replace(
              /[_-]+/g,
              " "
            );

        return (
          !isValidEmail(
            normalized
          ) &&
          /^(courriel|e mail|email|adresse courriel|adresse e mail|adresse email)s?$/.test(
            normalized
          )
        );
      }

      function validatePassword(
        value
      ) {
        const password =
          String(value || "");

        const missing = [];

        if (
          password.length < 8
        ) {
          missing.push(
            "au moins 8 caractères"
          );
        }

        if (
          !/[A-Z]/.test(
            password
          )
        ) {
          missing.push(
            "une lettre majuscule"
          );
        }

        if (
          !/[a-z]/.test(
            password
          )
        ) {
          missing.push(
            "une lettre minuscule"
          );
        }

        if (
          !/[0-9]/.test(
            password
          )
        ) {
          missing.push(
            "un chiffre"
          );
        }

        return {
          valid:
            missing.length === 0,

          message:
            missing.length
              ? `Il manque : ${missing.join(", ")}.`
              : "Mot de passe conforme.",
        };
      }

      function extractMemberId(
        url
      ) {
        const match =
          String(url).match(
            /\/memberId\/([^/?#]+)/i
          );

        return match
          ? decodeURIComponent(
              match[1]
            )
          : "";
      }

      function cleanLabel(
        value
      ) {
        return String(
          value || ""
        )
          .replace(
            /\s+/g,
            " "
          )
          .replace(
            /\s*\*\s*$/,
            ""
          )
          .trim();
      }

      function cssEscape(value) {
        if (
          window.CSS?.escape
        ) {
          return window.CSS.escape(
            value
          );
        }

        return String(value)
          .replace(
            /(["\\])/g,
            "\\$1"
          );
      }

      function redactUrl(value) {
        try {
          const url =
            new URL(
              value,
              location.origin
            );

          return (
            `${url.origin}` +
            `${url.pathname}`
          );
        } catch (_) {
          return String(value)
            .split("?")[0];
        }
      }

      function escapeHtml(value) {
        return String(
          value ?? ""
        )
          .replace(
            /&/g,
            "&amp;"
          )
          .replace(
            /</g,
            "&lt;"
          )
          .replace(
            />/g,
            "&gt;"
          )
          .replace(
            /"/g,
            "&quot;"
          )
          .replace(
            /'/g,
            "&#039;"
          );
      }

      function escapeAttr(value) {
        return escapeHtml(value);
      }

      function formatBytes(bytes) {
        if (
          !Number.isFinite(
            bytes
          ) ||
          bytes <= 0
        ) {
          return "0 octet";
        }

        const units = [
          "octets",
          "Ko",
          "Mo",
          "Go",
        ];

        const index =
          Math.min(
            Math.floor(
              Math.log(bytes) /
              Math.log(1024)
            ),
            units.length - 1
          );

        const size =
          bytes /
          (1024 ** index);

        return (
          `${size.toFixed(
            index === 0 ? 0 : 1
          )} ${units[index]}`
        );
      }

      function percentage(
        done,
        total
      ) {
        if (!total) {
          return 0;
        }

        return Math.max(
          0,
          Math.min(
            100,
            Math.round(
              (done / total) *
              100
            )
          )
        );
      }

      function fileTimestamp() {
        return new Date()
          .toISOString()
          .replace(
            /[:.]/g,
            "-"
          );
      }

      function setText(
        selector,
        text
      ) {
        const node =
          body.querySelector(
            selector
          );

        if (node) {
          node.textContent =
            text;
        }
      }

      function delay(ms) {
        return new Promise(
          (resolve) =>
            setTimeout(
              resolve,
              ms
            )
        );
      }
    },
  });
})();
