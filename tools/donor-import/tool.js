(() => {
    'use strict';

    const TOOL_ID = 'donor-import';

    window.YaplaToolbox.registerTool({
        id: TOOL_ID,
        name: 'Import de donateurs',
        category: 'Dons',
        icon: '📄',
        description: 'Importer des donateurs depuis un fichier CSV ou Excel.',

        async run() {
            const LOG = '[YAPLA TOOLBOX - DONOR IMPORT]';

            const IDS = {
                launcher: 'ytb-donor-import-launcher',
                mapping: 'ytb-donor-import-mapping-overlay',
                progress: 'ytb-donor-import-progress-overlay',
                done: 'ytb-donor-import-done-overlay',
                iframe: 'ytb-donor-import-worker-iframe',
                fileInput: 'ytb-donor-import-file-input',
                toast: 'ytb-donor-import-toast'
            };

            const STORAGE = {
                fileText: 'yapla_toolbox_donor_import_file_text',
                fileType: 'yapla_toolbox_donor_import_file_type',
                excelJson: 'yapla_toolbox_donor_import_excel_json',
                mapping: 'yapla_toolbox_donor_import_mapping',
                mappingConfirmed: 'yapla_toolbox_donor_import_mapping_confirmed',
                currentIndex: 'yapla_toolbox_donor_import_current_index',
                totalCount: 'yapla_toolbox_donor_import_total_count',
                stopped: 'yapla_toolbox_donor_import_stopped',
                running: 'yapla_toolbox_donor_import_running',
                completed: 'yapla_toolbox_donor_import_completed'
            };

            const XLSX_URL =
                'https://cdn.jsdelivr.net/npm/xlsx/dist/xlsx.full.min.js';

            const origin = window.location.origin;
            const addPageURL = `${origin}/donation/fr/donator/add`;

            const isListPage =
                /\/donation\/fr\/donator\/list/.test(window.location.pathname);

            const isAddPage =
                /\/donation\/fr\/donator\/add/.test(window.location.pathname);

            const controller = {
                iframe: null,
                donors: [],
                mapping: {},
                currentIndex: 0,
                total: 0,
                running: false,
                waitingForSave: false,
                processing: false,
                generation: 0
            };

            function debug(message, data) {
                if (data !== undefined) {
                    console.log(`${LOG} ${message}`, data);
                } else {
                    console.log(`${LOG} ${message}`);
                }
            }

            function warn(message, data) {
                if (data !== undefined) {
                    console.warn(`${LOG} ${message}`, data);
                } else {
                    console.warn(`${LOG} ${message}`);
                }
            }

            function errorLog(message, data) {
                if (data !== undefined) {
                    console.error(`${LOG} ${message}`, data);
                } else {
                    console.error(`${LOG} ${message}`);
                }
            }

            /*
             * ------------------------------------------------------------
             * PAGE VALIDATION
             * ------------------------------------------------------------
             */

            if (!isListPage && !isAddPage) {
                alert(
                    'Cet outil doit être lancé depuis la liste des donateurs ' +
                    'ou la page d’ajout d’un donateur.'
                );
                return;
            }

            /*
             * If the tool already has a launcher, simply bring it back.
             * This prevents duplicate execution when clicking the tool twice.
             */
            const existingLauncher = document.getElementById(IDS.launcher);

            if (existingLauncher) {
                existingLauncher.style.display = 'flex';
                existingLauncher.scrollIntoView({
                    behavior: 'smooth',
                    block: 'nearest'
                });
                return;
            }

            /*
             * ------------------------------------------------------------
             * LAUNCHER
             * ------------------------------------------------------------
             */

            createLauncher();

            if (localStorage.getItem(STORAGE.completed) === 'true') {
                showDoneOverlay();
            }

            function createLauncher() {
                const container = document.createElement('div');
                container.id = IDS.launcher;

                Object.assign(container.style, {
                    position: 'fixed',
                    top: '70px',
                    right: '20px',
                    zIndex: '2147483000',
                    display: 'flex',
                    gap: '8px',
                    alignItems: 'center',
                    padding: '10px',
                    background: '#ffffff',
                    border: '1px solid #dfe3e8',
                    borderRadius: '10px',
                    boxShadow: '0 8px 30px rgba(0,0,0,.16)',
                    fontFamily: 'Arial, sans-serif'
                });

                const importBtn = document.createElement('button');
                importBtn.type = 'button';
                importBtn.textContent = '📄 Importer';

                stylePrimary(importBtn);

                importBtn.addEventListener('click', async () => {
                    try {
                        const result = await loadSpreadsheetFile();

                        clearImportState();

                        localStorage.setItem(
                            STORAGE.currentIndex,
                            '0'
                        );

                        if (result.type === 'csv') {
                            localStorage.setItem(
                                STORAGE.fileText,
                                result.text
                            );

                            localStorage.setItem(
                                STORAGE.fileType,
                                'csv'
                            );
                        } else {
                            localStorage.setItem(
                                STORAGE.excelJson,
                                JSON.stringify(result.json)
                            );

                            localStorage.setItem(
                                STORAGE.fileType,
                                'excel'
                            );
                        }

                        await prepareMapping();
                    } catch (err) {
                        if (err && err.message === 'FILE_SELECTION_CANCELLED') {
                            return;
                        }

                        errorLog('Upload failed', err);

                        alert(
                            'Impossible de charger le fichier.\n\n' +
                            (err?.message || String(err))
                        );
                    }
                });

                const stopBtn = document.createElement('button');
                stopBtn.type = 'button';
                stopBtn.textContent = 'Arrêter';

                styleSecondary(stopBtn);

                stopBtn.addEventListener('click', () => {
                    stopImport(false);
                });

                const closeBtn = document.createElement('button');
                closeBtn.type = 'button';
                closeBtn.textContent = '✕';
                closeBtn.title = 'Fermer';

                styleClose(closeBtn);

                closeBtn.addEventListener('click', () => {
                    if (controller.running) {
                        const confirmed = confirm(
                            'Un import est en cours.\n\n' +
                            'Voulez-vous vraiment arrêter l’import?'
                        );

                        if (!confirmed) {
                            return;
                        }

                        stopImport(false);
                    }

                    container.remove();
                });

                container.append(
                    importBtn,
                    stopBtn,
                    closeBtn
                );

                document.body.appendChild(container);
            }

            /*
             * ------------------------------------------------------------
             * FILE LOADING
             * ------------------------------------------------------------
             */

            function loadSpreadsheetFile() {
                return new Promise((resolve, reject) => {
                    document.getElementById(IDS.fileInput)?.remove();

                    const input = document.createElement('input');

                    input.id = IDS.fileInput;
                    input.type = 'file';

                    input.accept = [
                        '.csv',
                        '.xlsx',
                        '.xls',
                        'text/csv',
                        'application/vnd.ms-excel',
                        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                    ].join(',');

                    input.style.display = 'none';

                    document.body.appendChild(input);

                    let changed = false;

                    input.addEventListener(
                        'change',
                        async event => {
                            changed = true;

                            const file =
                                event.target.files &&
                                event.target.files[0];

                            if (!file) {
                                input.remove();
                                reject(
                                    new Error(
                                        'FILE_SELECTION_CANCELLED'
                                    )
                                );
                                return;
                            }

                            try {
                                const fileName =
                                    file.name.toLowerCase();

                                debug('Selected file', {
                                    name: file.name
                                });

                                if (fileName.endsWith('.csv')) {
                                    const text = await file.text();

                                    resolve({
                                        type: 'csv',
                                        text
                                    });
                                } else if (
                                    fileName.endsWith('.xlsx') ||
                                    fileName.endsWith('.xls')
                                ) {
                                    await ensureXLSXLoaded();

                                    const arrayBuffer =
                                        await file.arrayBuffer();

                                    const workbook =
                                        window.XLSX.read(
                                            arrayBuffer,
                                            {
                                                type: 'array'
                                            }
                                        );

                                    const firstSheetName =
                                        workbook.SheetNames[0];

                                    if (!firstSheetName) {
                                        throw new Error(
                                            'Le fichier Excel ne contient aucune feuille.'
                                        );
                                    }

                                    const sheet =
                                        workbook.Sheets[
                                            firstSheetName
                                        ];

                                    const rows =
                                        window.XLSX.utils.sheet_to_json(
                                            sheet,
                                            {
                                                defval: '',
                                                raw: false
                                            }
                                        );

                                    resolve({
                                        type: 'excel',
                                        json: rows
                                    });
                                } else {
                                    throw new Error(
                                        'Type de fichier non supporté.'
                                    );
                                }
                            } catch (err) {
                                reject(err);
                            } finally {
                                input.remove();
                            }
                        },
                        { once: true }
                    );

                    window.addEventListener(
                        'focus',
                        () => {
                            setTimeout(() => {
                                if (
                                    !changed &&
                                    document.body.contains(input)
                                ) {
                                    input.remove();

                                    reject(
                                        new Error(
                                            'FILE_SELECTION_CANCELLED'
                                        )
                                    );
                                }
                            }, 500);
                        },
                        { once: true }
                    );

                    input.click();
                });
            }

            function ensureXLSXLoaded() {
                if (window.XLSX) {
                    return Promise.resolve();
                }

                return new Promise((resolve, reject) => {
                    const existing = document.querySelector(
                        'script[data-ytb-donor-import-xlsx="true"]'
                    );

                    if (existing) {
                        existing.addEventListener(
                            'load',
                            () => resolve(),
                            { once: true }
                        );

                        existing.addEventListener(
                            'error',
                            () => reject(
                                new Error(
                                    'Impossible de charger la bibliothèque Excel.'
                                )
                            ),
                            { once: true }
                        );

                        return;
                    }

                    const script =
                        document.createElement('script');

                    script.src = XLSX_URL;
                    script.async = true;

                    script.dataset.ytbDonorImportXlsx =
                        'true';

                    script.onload = () => {
                        if (!window.XLSX) {
                            reject(
                                new Error(
                                    'SheetJS a été chargé, mais XLSX est introuvable.'
                                )
                            );
                            return;
                        }

                        resolve();
                    };

                    script.onerror = () => {
                        reject(
                            new Error(
                                'Impossible de charger SheetJS depuis jsDelivr.'
                            )
                        );
                    };

                    document.head.appendChild(script);
                });
            }

            /*
             * ------------------------------------------------------------
             * STORED ROWS
             * ------------------------------------------------------------
             */

            function getStoredRows() {
                const fileType =
                    localStorage.getItem(STORAGE.fileType);

                if (fileType === 'excel') {
                    try {
                        const json = JSON.parse(
                            localStorage.getItem(
                                STORAGE.excelJson
                            ) || '[]'
                        );

                        if (!json.length) {
                            return {
                                headers: [],
                                data: []
                            };
                        }

                        const headerSet = new Set();

                        json.forEach(row => {
                            Object.keys(row).forEach(key => {
                                headerSet.add(
                                    cleanCell(key)
                                );
                            });
                        });

                        const headers =
                            Array.from(headerSet);

                        const data = json.map(row => {
                            const obj = {};

                            headers.forEach(header => {
                                obj[header] =
                                    cleanCell(
                                        row[header] || ''
                                    );
                            });

                            return obj;
                        });

                        return {
                            headers,
                            data
                        };
                    } catch (err) {
                        errorLog(
                            'Failed reading Excel JSON',
                            err
                        );

                        return {
                            headers: [],
                            data: []
                        };
                    }
                }

                const text =
                    localStorage.getItem(
                        STORAGE.fileText
                    );

                if (!text) {
                    return {
                        headers: [],
                        data: []
                    };
                }

                return parseCSV(text);
            }

            function parseCSV(csvText) {
                const text =
                    String(csvText || '')
                        .replace(/^\uFEFF/, '');

                const delimiter =
                    detectDelimiter(text);

                const rows =
                    parseDelimitedText(
                        text,
                        delimiter
                    );

                if (!rows.length) {
                    return {
                        headers: [],
                        data: []
                    };
                }

                const headers =
                    rows[0].map(cleanCell);

                const data =
                    rows
                        .slice(1)
                        .filter(row =>
                            row.some(
                                cell =>
                                    cleanCell(cell) !== ''
                            )
                        )
                        .map(row => {
                            const obj = {};

                            headers.forEach(
                                (header, index) => {
                                    obj[header] =
                                        cleanCell(
                                            row[index] || ''
                                        );
                                }
                            );

                            return obj;
                        });

                return {
                    headers,
                    data
                };
            }

            function detectDelimiter(text) {
                const firstLine =
                    text
                        .split(/\r?\n/)
                        .find(
                            line =>
                                line.trim() !== ''
                        ) || '';

                const tabs =
                    (firstLine.match(/\t/g) || [])
                        .length;

                const semicolons =
                    (firstLine.match(/;/g) || [])
                        .length;

                const commas =
                    (firstLine.match(/,/g) || [])
                        .length;

                if (
                    tabs >= semicolons &&
                    tabs >= commas &&
                    tabs > 0
                ) {
                    return '\t';
                }

                return semicolons > commas
                    ? ';'
                    : ',';
            }

            function parseDelimitedText(
                text,
                delimiter
            ) {
                const rows = [];

                let row = [];
                let cell = '';
                let inQuotes = false;

                for (
                    let i = 0;
                    i < text.length;
                    i++
                ) {
                    const char = text[i];
                    const next = text[i + 1];

                    if (char === '"') {
                        if (
                            inQuotes &&
                            next === '"'
                        ) {
                            cell += '"';
                            i++;
                        } else {
                            inQuotes = !inQuotes;
                        }

                        continue;
                    }

                    if (
                        char === delimiter &&
                        !inQuotes
                    ) {
                        row.push(cell);
                        cell = '';
                        continue;
                    }

                    if (
                        (
                            char === '\n' ||
                            char === '\r'
                        ) &&
                        !inQuotes
                    ) {
                        if (
                            char === '\r' &&
                            next === '\n'
                        ) {
                            i++;
                        }

                        row.push(cell);
                        rows.push(row);

                        row = [];
                        cell = '';

                        continue;
                    }

                    cell += char;
                }

                if (
                    cell.length ||
                    row.length
                ) {
                    row.push(cell);
                    rows.push(row);
                }

                return rows;
            }

            function cleanCell(value) {
                return String(
                    value ?? ''
                ).trim();
            }

            /*
             * ------------------------------------------------------------
             * PREPARE MAPPING
             * ------------------------------------------------------------
             */

            async function prepareMapping() {
                const parsed = getStoredRows();

                if (!parsed.data.length) {
                    alert(
                        'Le fichier ne contient aucune donnée valide.'
                    );
                    return;
                }

                localStorage.setItem(
                    STORAGE.totalCount,
                    String(parsed.data.length)
                );

                showLoadingProgress(
                    'Chargement du formulaire Yapla…'
                );

                try {
                    const iframe =
                        await loadWorkerIframe();

                    const frameDoc =
                        getIframeDocument(iframe);

                    const ready =
                        await waitForForm(
                            15000,
                            frameDoc
                        );

                    if (!ready) {
                        throw new Error(
                            'Le formulaire d’ajout de donateur ne s’est pas chargé.'
                        );
                    }

                    const fields =
                        detectYaplaFields(
                            frameDoc
                        );

                    hideProgressOverlay();

                    if (!fields.length) {
                        throw new Error(
                            'Aucun champ Yapla n’a été détecté.'
                        );
                    }

                    showMappingPanel(
                        fields,
                        parsed.headers
                    );
                } catch (err) {
                    hideProgressOverlay();
                    removeHiddenIframe();

                    errorLog(
                        'Could not prepare mapping',
                        err
                    );

                    alert(
                        'Impossible de préparer l’import.\n\n' +
                        (err?.message || String(err))
                    );
                }
            }

            /*
             * ------------------------------------------------------------
             * FIELD DETECTION
             * ------------------------------------------------------------
             */

            function detectYaplaFields(rootDoc) {
                const form =
                    rootDoc.querySelector(
                        '#mod_form_advanced_form'
                    ) ||
                    rootDoc.querySelector(
                        'form.form-create'
                    ) ||
                    rootDoc.querySelector('form');

                if (!form) {
                    return [];
                }

                const items = [];

                const groups =
                    form.querySelectorAll(
                        '.form-group'
                    );

                groups.forEach(
                    (group, index) => {
                        const label =
                            group.querySelector(
                                'label.control-label, label'
                            );

                        const rawLabel =
                            label
                                ? label.textContent || ''
                                : `Field ${index + 1}`;

                        const labelText =
                            cleanLabelText(
                                rawLabel
                            );

                        const editableEl =
                            group.querySelector(
                                'input, select, textarea'
                            );

                        const staticEl =
                            group.querySelector(
                                'p.form-control-static'
                            );

                        const mandatory = !!(
                            group.classList.contains(
                                'required'
                            ) ||
                            group.classList.contains(
                                'input-required'
                            ) ||
                            label?.classList.contains(
                                'required'
                            ) ||
                            label?.classList.contains(
                                'input-required'
                            ) ||
                            editableEl?.classList.contains(
                                'required'
                            ) ||
                            editableEl?.classList.contains(
                                'input-required'
                            ) ||
                            editableEl?.hasAttribute(
                                'required'
                            ) ||
                            editableEl?.getAttribute(
                                'aria-required'
                            ) === 'true'
                        );

                        if (editableEl) {
                            items.push({
                                key:
                                    editableEl.name ||
                                    editableEl.id ||
                                    `field_${index}`,

                                label:
                                    labelText,

                                selector:
                                    buildSelector(
                                        editableEl
                                    ),

                                editable:
                                    true,

                                mandatory,

                                tagName:
                                    editableEl.tagName
                                        .toLowerCase(),

                                type:
                                    editableEl.type ||
                                    editableEl.tagName
                                        .toLowerCase()
                            });

                            return;
                        }

                        if (staticEl) {
                            items.push({
                                key:
                                    staticEl.id ||
                                    `static_${index}`,

                                label:
                                    labelText,

                                selector:
                                    buildSelector(
                                        staticEl
                                    ),

                                editable:
                                    false,

                                mandatory,

                                tagName:
                                    staticEl.tagName
                                        .toLowerCase(),

                                type:
                                    'static'
                            });
                        }
                    }
                );

                debug(
                    'Detected fields',
                    items
                );

                return items;
            }

            function cleanLabelText(text) {
                return String(text || '')
                    .replace(/\s+/g, ' ')
                    .replace(/\*+/g, '')
                    .trim();
            }

            function buildSelector(el) {
                if (el.id) {
                    return `#${cssEscape(el.id)}`;
                }

                if (el.name) {
                    return (
                        `${el.tagName.toLowerCase()}` +
                        `[name="${cssEscapeAttr(el.name)}"]`
                    );
                }

                return null;
            }

            function cssEscape(value) {
                if (
                    window.CSS &&
                    typeof window.CSS.escape ===
                        'function'
                ) {
                    return window.CSS.escape(
                        value
                    );
                }

                return String(value).replace(
                    /([ #;?%&,.+*~\':"!^$[\]()=>|\/@])/g,
                    '\\$1'
                );
            }

            function cssEscapeAttr(value) {
                return String(value)
                    .replace(/\\/g, '\\\\')
                    .replace(/"/g, '\\"');
            }

            /*
             * ------------------------------------------------------------
             * MAPPING PANEL
             * ------------------------------------------------------------
             */

            function showMappingPanel(
                formFields,
                fileHeaders
            ) {
                removeMappingPanel();

                const overlay =
                    document.createElement('div');

                overlay.id = IDS.mapping;

                Object.assign(
                    overlay.style,
                    {
                        position: 'fixed',
                        inset: '0',
                        background:
                            'rgba(0,0,0,.45)',
                        zIndex: '2147483001',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: '24px',
                        fontFamily:
                            'Arial, sans-serif'
                    }
                );

                const panel =
                    document.createElement('div');

                Object.assign(
                    panel.style,
                    {
                        width: '100%',
                        maxWidth: '1000px',
                        maxHeight: '90vh',
                        overflow: 'auto',
                        background: '#fff',
                        borderRadius: '12px',
                        boxShadow:
                            '0 12px 40px rgba(0,0,0,.25)',
                        padding: '22px'
                    }
                );

                const title =
                    document.createElement('h2');

                title.textContent =
                    'Associer les colonnes aux champs Yapla';

                title.style.margin =
                    '0 0 8px 0';

                const subtitle =
                    document.createElement('div');

                subtitle.textContent =
                    'Tous les champs obligatoires doivent être associés avant de commencer l’import.';

                subtitle.style.marginBottom =
                    '18px';

                subtitle.style.color =
                    '#555';

                const validationMsg =
                    document.createElement('div');

                validationMsg.style.marginBottom =
                    '14px';

                validationMsg.style.fontSize =
                    '14px';

                validationMsg.style.minHeight =
                    '20px';

                const table =
                    document.createElement('div');

                Object.assign(
                    table.style,
                    {
                        display: 'grid',
                        gridTemplateColumns:
                            '1.3fr 1fr 1.2fr',
                        gap: '10px',
                        alignItems: 'center'
                    }
                );

                table.append(
                    makeCell(
                        'Champ Yapla',
                        true
                    ),
                    makeCell(
                        'Statut',
                        true
                    ),
                    makeCell(
                        'Colonne du fichier',
                        true
                    )
                );

                const savedMapping =
                    getSavedMapping();

                const selectEntries = [];

                formFields.forEach(field => {
                    table.appendChild(
                        makeCell(field.label)
                    );

                    const status =
                        document.createElement(
                            'div'
                        );

                    Object.assign(
                        status.style,
                        {
                            padding:
                                '8px 10px',
                            border:
                                '1px solid #ddd',
                            borderRadius:
                                '6px'
                        }
                    );

                    if (!field.editable) {
                        status.style.background =
                            '#f9f9f9';

                        status.textContent =
                            'Non modifiable';
                    } else if (
                        field.mandatory
                    ) {
                        status.style.background =
                            '#fff3cd';

                        status.textContent =
                            'Obligatoire';
                    } else {
                        status.style.background =
                            '#f5fbf5';

                        status.textContent =
                            'Modifiable';
                    }

                    table.appendChild(status);

                    const holder =
                        document.createElement(
                            'div'
                        );

                    if (!field.editable) {
                        const msg =
                            document.createElement(
                                'div'
                            );

                        Object.assign(
                            msg.style,
                            {
                                padding:
                                    '8px 10px',
                                border:
                                    '1px solid #ddd',
                                borderRadius:
                                    '6px',
                                color:
                                    '#777',
                                background:
                                    '#fafafa'
                            }
                        );

                        msg.textContent =
                            'Non modifiable';

                        holder.appendChild(msg);
                    } else {
                        const select =
                            document.createElement(
                                'select'
                            );

                        select.dataset.fieldKey =
                            field.key;

                        Object.assign(
                            select.style,
                            {
                                width: '100%',
                                padding:
                                    '8px 10px',
                                border:
                                    '1px solid #ccc',
                                borderRadius:
                                    '6px'
                            }
                        );

                        selectEntries.push({
                            field,
                            select
                        });

                        holder.appendChild(
                            select
                        );
                    }

                    table.appendChild(holder);
                });

                const footer =
                    document.createElement('div');

                Object.assign(
                    footer.style,
                    {
                        display: 'flex',
                        justifyContent:
                            'flex-end',
                        gap: '10px',
                        marginTop: '20px'
                    }
                );

                const cancelBtn =
                    document.createElement(
                        'button'
                    );

                cancelBtn.type = 'button';
                cancelBtn.textContent =
                    'Annuler';

                buttonStyle(
                    cancelBtn,
                    '#6c757d'
                );

                const resetBtn =
                    document.createElement(
                        'button'
                    );

                resetBtn.type = 'button';
                resetBtn.textContent =
                    'Réinitialiser';

                buttonStyle(
                    resetBtn,
                    '#6c757d'
                );

                const startBtn =
                    document.createElement(
                        'button'
                    );

                startBtn.type = 'button';
                startBtn.textContent =
                    'Commencer l’import';

                buttonStyle(
                    startBtn,
                    '#0069d9'
                );

                footer.append(
                    cancelBtn,
                    resetBtn,
                    startBtn
                );

                panel.append(
                    title,
                    subtitle,
                    validationMsg,
                    table,
                    footer
                );

                overlay.appendChild(panel);

                document.body.appendChild(
                    overlay
                );

                function getMissingMandatory() {
                    return selectEntries
                        .filter(
                            ({
                                field,
                                select
                            }) =>
                                field.editable &&
                                field.mandatory &&
                                !String(
                                    select.value ||
                                        ''
                                ).trim()
                        )
                        .map(
                            ({ field }) =>
                                field.label
                        );
                }

                function updateStartState() {
                    const missing =
                        getMissingMandatory();

                    if (missing.length) {
                        startBtn.disabled =
                            true;

                        startBtn.style.opacity =
                            '0.55';

                        startBtn.style.cursor =
                            'not-allowed';

                        validationMsg.style.color =
                            '#b45309';

                        validationMsg.textContent =
                            'Champs obligatoires non associés : ' +
                            missing.join(', ');
                    } else {
                        startBtn.disabled =
                            false;

                        startBtn.style.opacity =
                            '1';

                        startBtn.style.cursor =
                            'pointer';

                        validationMsg.style.color =
                            '#15803d';

                        validationMsg.textContent =
                            'Tous les champs obligatoires sont associés.';
                    }
                }

                function refreshSelects() {
                    const currentValues =
                        new Map();

                    selectEntries.forEach(
                        ({
                            field,
                            select
                        }) => {
                            currentValues.set(
                                field.key,
                                select.value || ''
                            );
                        }
                    );

                    selectEntries.forEach(
                        ({
                            field,
                            select
                        }) => {
                            const selectedElsewhere =
                                new Set();

                            currentValues.forEach(
                                (
                                    value,
                                    key
                                ) => {
                                    if (
                                        key !==
                                            field.key &&
                                        value
                                    ) {
                                        selectedElsewhere.add(
                                            value
                                        );
                                    }
                                }
                            );

                            const ownValue =
                                currentValues.get(
                                    field.key
                                ) || '';

                            const available =
                                fileHeaders.filter(
                                    header =>
                                        !selectedElsewhere.has(
                                            header
                                        ) ||
                                        header ===
                                            ownValue
                                );

                            select.innerHTML = '';

                            const emptyOpt =
                                document.createElement(
                                    'option'
                                );

                            emptyOpt.value = '';

                            emptyOpt.textContent =
                                '— Ne pas importer —';

                            select.appendChild(
                                emptyOpt
                            );

                            available.forEach(
                                header => {
                                    const opt =
                                        document.createElement(
                                            'option'
                                        );

                                    opt.value =
                                        header;

                                    opt.textContent =
                                        header;

                                    select.appendChild(
                                        opt
                                    );
                                }
                            );

                            if (
                                available.includes(
                                    ownValue
                                )
                            ) {
                                select.value =
                                    ownValue;
                            }
                        }
                    );

                    updateStartState();
                }

                selectEntries.forEach(
                    ({
                        field,
                        select
                    }) => {
                        if (
                            savedMapping[
                                field.key
                            ]
                        ) {
                            select.value =
                                savedMapping[
                                    field.key
                                ];
                        }

                        select.addEventListener(
                            'change',
                            refreshSelects
                        );
                    }
                );

                cancelBtn.addEventListener(
                    'click',
                    () => {
                        removeMappingPanel();
                        removeHiddenIframe();
                    }
                );

                resetBtn.addEventListener(
                    'click',
                    () => {
                        selectEntries.forEach(
                            ({ select }) => {
                                select.value = '';
                            }
                        );

                        refreshSelects();
                    }
                );

                startBtn.addEventListener(
                    'click',
                    async () => {
                        const missing =
                            getMissingMandatory();

                        if (missing.length) {
                            alert(
                                'Vous devez associer tous les champs obligatoires :\n\n- ' +
                                missing.join(
                                    '\n- '
                                )
                            );

                            return;
                        }

                        const mapping = {};

                        selectEntries.forEach(
                            ({
                                field,
                                select
                            }) => {
                                const value =
                                    String(
                                        select.value ||
                                            ''
                                    ).trim();

                                if (value) {
                                    mapping[
                                        field.key
                                    ] = value;
                                }
                            }
                        );

                        localStorage.setItem(
                            STORAGE.mapping,
                            JSON.stringify(
                                mapping
                            )
                        );

                        localStorage.setItem(
                            STORAGE.mappingConfirmed,
                            'true'
                        );

                        localStorage.setItem(
                            STORAGE.currentIndex,
                            '0'
                        );

                        localStorage.setItem(
                            STORAGE.running,
                            'true'
                        );

                        localStorage.removeItem(
                            STORAGE.completed
                        );

                        localStorage.removeItem(
                            STORAGE.stopped
                        );

                        removeMappingPanel();

                        await startImport();
                    }
                );

                /*
                 * Set saved mapping only after options
                 * have initially been created.
                 */
                refreshSelects();

                selectEntries.forEach(
                    ({
                        field,
                        select
                    }) => {
                        const saved =
                            savedMapping[
                                field.key
                            ];

                        if (
                            saved &&
                            Array.from(
                                select.options
                            ).some(
                                option =>
                                    option.value ===
                                    saved
                            )
                        ) {
                            select.value = saved;
                        }
                    }
                );

                refreshSelects();
            }

            function removeMappingPanel() {
                document
                    .getElementById(
                        IDS.mapping
                    )
                    ?.remove();
            }

            function makeCell(
                text,
                isHeader = false
            ) {
                const el =
                    document.createElement(
                        'div'
                    );

                el.textContent = text;

                Object.assign(
                    el.style,
                    {
                        padding: '8px 10px',
                        border:
                            '1px solid #ddd',
                        borderRadius: '6px',
                        background:
                            isHeader
                                ? '#f1f3f5'
                                : '#fff',
                        fontWeight:
                            isHeader
                                ? '700'
                                : '400'
                    }
                );

                return el;
            }

            function getSavedMapping() {
                try {
                    return JSON.parse(
                        localStorage.getItem(
                            STORAGE.mapping
                        ) || '{}'
                    );
                } catch {
                    return {};
                }
            }

            /*
             * ------------------------------------------------------------
             * IMPORT CONTROLLER
             * ------------------------------------------------------------
             */

            async function startImport() {
                const parsed =
                    getStoredRows();

                const mapping =
                    getSavedMapping();

                if (!parsed.data.length) {
                    alert(
                        'Aucune donnée valide trouvée.'
                    );
                    return;
                }

                if (
                    !Object.keys(mapping).length
                ) {
                    alert(
                        'Aucune association de champs trouvée.'
                    );
                    return;
                }

                controller.donors =
                    parsed.data;

                controller.mapping =
                    mapping;

                controller.currentIndex =
                    parseInt(
                        localStorage.getItem(
                            STORAGE.currentIndex
                        ) || '0',
                        10
                    );

                controller.total =
                    parsed.data.length;

                controller.running =
                    true;

                controller.waitingForSave =
                    false;

                controller.processing =
                    false;

                localStorage.setItem(
                    STORAGE.running,
                    'true'
                );

                localStorage.setItem(
                    STORAGE.totalCount,
                    String(controller.total)
                );

                localStorage.removeItem(
                    STORAGE.completed
                );

                localStorage.removeItem(
                    STORAGE.stopped
                );

                showProgressOverlay();
                updateProgressUI();

                await processNextDonor();
            }

            async function processNextDonor() {
                if (
                    !controller.running ||
                    isStopped()
                ) {
                    return;
                }

                if (controller.processing) {
                    return;
                }

                if (
                    controller.currentIndex >=
                    controller.total
                ) {
                    finishImport();
                    return;
                }

                controller.processing = true;

                const generation =
                    ++controller.generation;

                const donor =
                    controller.donors[
                        controller.currentIndex
                    ];

                try {
                    updateProgressUI(donor);

                    const iframe =
                        await loadWorkerIframe();

                    if (
                        generation !==
                        controller.generation
                    ) {
                        return;
                    }

                    if (
                        !controller.running ||
                        isStopped()
                    ) {
                        return;
                    }

                    const frameDoc =
                        getIframeDocument(
                            iframe
                        );

                    const ready =
                        await waitForForm(
                            15000,
                            frameDoc
                        );

                    if (!ready) {
                        throw new Error(
                            'Le formulaire d’ajout ne s’est pas chargé.'
                        );
                    }

                    const formFields =
                        detectYaplaFields(
                            frameDoc
                        );

                    const ok =
                        await fillCurrentDonor(
                            formFields,
                            donor,
                            controller.mapping,
                            frameDoc
                        );

                    if (!ok) {
                        throw new Error(
                            `Impossible de remplir le donateur ${controller.currentIndex + 1}.`
                        );
                    }

                    const saveButton =
                        findSaveButton(
                            frameDoc
                        );

                    if (!saveButton) {
                        throw new Error(
                            'Bouton Enregistrer introuvable.'
                        );
                    }

                    controller.waitingForSave =
                        true;

                    updateProgressUI(donor);

                    debug(
                        'Clicking save',
                        {
                            index:
                                controller.currentIndex,
                            donor
                        }
                    );

                    await sleep(250);

                    const navigationPromise =
                        waitForIframeNavigation(
                            iframe,
                            20000
                        );

                    saveButton.click();

                    await navigationPromise;

                    if (
                        generation !==
                        controller.generation
                    ) {
                        return;
                    }

                    if (
                        !controller.running ||
                        isStopped()
                    ) {
                        return;
                    }

                    /*
                     * Give Yapla a brief moment after navigation
                     * before checking the resulting page.
                     */
                    await sleep(300);

                    const resultDoc =
                        getIframeDocument(
                            iframe
                        );

                    const validationError =
                        detectValidationError(
                            resultDoc
                        );

                    if (validationError) {
                        throw new Error(
                            'Yapla a refusé le formulaire : ' +
                            validationError
                        );
                    }

                    controller.waitingForSave =
                        false;

                    controller.currentIndex++;

                    localStorage.setItem(
                        STORAGE.currentIndex,
                        String(
                            controller.currentIndex
                        )
                    );

                    updateProgressUI();

                    controller.processing =
                        false;

                    if (
                        controller.currentIndex >=
                        controller.total
                    ) {
                        finishImport();
                        return;
                    }

                    await sleep(150);

                    await processNextDonor();
                } catch (err) {
                    controller.processing =
                        false;

                    errorLog(
                        'Import error',
                        err
                    );

                    stopImport(
                        true,
                        'Import arrêté au donateur ' +
                        `${controller.currentIndex + 1}/${controller.total}.\n\n` +
                        (err?.message ||
                            String(err))
                    );
                }
            }

            /*
             * ------------------------------------------------------------
             * HIDDEN IFRAME
             * ------------------------------------------------------------
             */

            function loadWorkerIframe() {
                removeHiddenIframe();

                return new Promise(
                    (resolve, reject) => {
                        const iframe =
                            document.createElement(
                                'iframe'
                            );

                        iframe.id =
                            IDS.iframe;

                        iframe.src =
                            `${addPageURL}?ytbDonorImport=${Date.now()}`;

                        Object.assign(
                            iframe.style,
                            {
                                width: '1px',
                                height: '1px',
                                position: 'fixed',
                                left: '-10000px',
                                top: '-10000px',
                                opacity: '0',
                                pointerEvents:
                                    'none',
                                border: '0'
                            }
                        );

                        iframe.setAttribute(
                            'aria-hidden',
                            'true'
                        );

                        const timeout =
                            setTimeout(
                                () => {
                                    reject(
                                        new Error(
                                            'Timeout lors du chargement du formulaire Yapla.'
                                        )
                                    );
                                },
                                20000
                            );

                        iframe.addEventListener(
                            'load',
                            () => {
                                clearTimeout(
                                    timeout
                                );

                                try {
                                    getIframeDocument(
                                        iframe
                                    );

                                    controller.iframe =
                                        iframe;

                                    resolve(
                                        iframe
                                    );
                                } catch (err) {
                                    reject(
                                        new Error(
                                            'Impossible d’accéder au formulaire dans l’iframe. ' +
                                            'Le formulaire doit être sur le même domaine Yapla.'
                                        )
                                    );
                                }
                            },
                            { once: true }
                        );

                        iframe.addEventListener(
                            'error',
                            () => {
                                clearTimeout(
                                    timeout
                                );

                                reject(
                                    new Error(
                                        'Erreur lors du chargement du formulaire Yapla.'
                                    )
                                );
                            },
                            { once: true }
                        );

                        controller.iframe =
                            iframe;

                        document.body.appendChild(
                            iframe
                        );
                    }
                );
            }

            function getIframeDocument(
                iframe
            ) {
                const frameWindow =
                    iframe.contentWindow;

                if (!frameWindow) {
                    throw new Error(
                        'Iframe window unavailable.'
                    );
                }

                const frameDoc =
                    iframe.contentDocument ||
                    frameWindow.document;

                if (!frameDoc) {
                    throw new Error(
                        'Iframe document unavailable.'
                    );
                }

                return frameDoc;
            }

            function waitForIframeNavigation(
                iframe,
                timeoutMs = 20000
            ) {
                return new Promise(
                    (resolve, reject) => {
                        let finished = false;

                        const timeout =
                            setTimeout(
                                () => {
                                    if (finished) {
                                        return;
                                    }

                                    finished = true;

                                    reject(
                                        new Error(
                                            'Timeout après l’enregistrement du donateur.'
                                        )
                                    );
                                },
                                timeoutMs
                            );

                        iframe.addEventListener(
                            'load',
                            () => {
                                if (finished) {
                                    return;
                                }

                                finished = true;

                                clearTimeout(
                                    timeout
                                );

                                resolve();
                            },
                            { once: true }
                        );
                    }
                );
            }

            function removeHiddenIframe() {
                document
                    .getElementById(
                        IDS.iframe
                    )
                    ?.remove();

                controller.iframe =
                    null;
            }

            /*
             * ------------------------------------------------------------
             * FORM FILLING
             * ------------------------------------------------------------
             */

            async function fillCurrentDonor(
                formFields,
                donor,
                mapping,
                rootDoc
            ) {
                const fieldByKey =
                    new Map(
                        formFields.map(
                            field => [
                                field.key,
                                field
                            ]
                        )
                    );

                const entries =
                    Object.entries(mapping)
                        .map(
                            ([
                                fieldKey,
                                fileHeader
                            ]) => ({
                                fieldKey,
                                fileHeader,
                                field:
                                    fieldByKey.get(
                                        fieldKey
                                    )
                            })
                        )
                        .filter(
                            item =>
                                item.field &&
                                item.field
                                    .editable &&
                                item.field
                                    .selector
                        );

                entries.sort(
                    (a, b) =>
                        getFieldPriority(
                            a.field
                        ) -
                        getFieldPriority(
                            b.field
                        )
                );

                debug(
                    'Fill order',
                    entries
                );

                for (
                    const item of entries
                ) {
                    const {
                        field,
                        fileHeader
                    } = item;

                    const el =
                        rootDoc.querySelector(
                            field.selector
                        );

                    if (!el) {
                        warn(
                            'Field not found',
                            field
                        );

                        if (
                            field.mandatory
                        ) {
                            return false;
                        }

                        continue;
                    }

                    const value =
                        donor[fileHeader];

                    if (
                        value == null ||
                        String(value).trim() ===
                            ''
                    ) {
                        if (
                            field.mandatory
                        ) {
                            warn(
                                'Mandatory field empty',
                                {
                                    field:
                                        field.label,
                                    fileHeader
                                }
                            );

                            return false;
                        }

                        continue;
                    }

                    const result =
                        await setElementValue(
                            el,
                            String(value).trim(),
                            field,
                            rootDoc
                        );

                    if (
                        result === false
                    ) {
                        if (
                            field.mandatory
                        ) {
                            return false;
                        }

                        continue;
                    }

                    if (
                        isCountryField(
                            field,
                            el
                        )
                    ) {
                        await sleep(400);
                    }
                }

                return true;
            }

            function getFieldPriority(
                field
            ) {
                const selector =
                    String(
                        field.selector || ''
                    ).toLowerCase();

                const key =
                    String(
                        field.key || ''
                    ).toLowerCase();

                const label =
                    normalizeText(
                        field.label || ''
                    );

                if (
                    selector.includes(
                        'address_country'
                    ) ||
                    key.includes(
                        'country'
                    ) ||
                    label.includes('pays')
                ) {
                    return 1;
                }

                if (
                    selector.includes(
                        'address_state'
                    ) ||
                    key.includes('state') ||
                    label.includes(
                        'province'
                    )
                ) {
                    return 2;
                }

                return 10;
            }

            function isCountryField(
                field,
                el
            ) {
                const selector =
                    String(
                        field.selector || ''
                    ).toLowerCase();

                const key =
                    String(
                        field.key || ''
                    ).toLowerCase();

                const label =
                    normalizeText(
                        field.label || ''
                    );

                const name =
                    String(
                        el.name || ''
                    ).toLowerCase();

                return (
                    selector.includes(
                        'address_country'
                    ) ||
                    key.includes(
                        'country'
                    ) ||
                    label.includes(
                        'pays'
                    ) ||
                    name ===
                        'address_country'
                );
            }

            async function setElementValue(
                el,
                rawValue,
                field,
                rootDoc
            ) {
                const tag =
                    el.tagName.toLowerCase();

                if (tag === 'select') {
                    return setSelectValue(
                        el,
                        rawValue,
                        field,
                        rootDoc
                    );
                }

                if (
                    tag === 'textarea' ||
                    tag === 'input'
                ) {
                    /*
                     * Skip controls that should not be assigned
                     * as normal text inputs.
                     */
                    const type =
                        String(
                            el.type || ''
                        ).toLowerCase();

                    if (
                        type === 'submit' ||
                        type === 'button' ||
                        type === 'hidden' ||
                        type === 'file'
                    ) {
                        return false;
                    }

                    if (
                        type === 'checkbox' ||
                        type === 'radio'
                    ) {
                        return setCheckableValue(
                            el,
                            rawValue
                        );
                    }

                    el.focus();

                    setNativeValue(
                        el,
                        rawValue
                    );

                    el.dispatchEvent(
                        new Event(
                            'input',
                            {
                                bubbles: true
                            }
                        )
                    );

                    el.dispatchEvent(
                        new Event(
                            'change',
                            {
                                bubbles: true
                            }
                        )
                    );

                    el.blur();

                    return true;
                }

                return false;
            }

            function setNativeValue(
                element,
                value
            ) {
                const prototype =
                    element.tagName ===
                    'TEXTAREA'
                        ? window
                            .HTMLTextAreaElement
                            .prototype
                        : window
                            .HTMLInputElement
                            .prototype;

                const descriptor =
                    Object.getOwnPropertyDescriptor(
                        prototype,
                        'value'
                    );

                if (
                    descriptor &&
                    descriptor.set
                ) {
                    descriptor.set.call(
                        element,
                        value
                    );
                } else {
                    element.value =
                        value;
                }
            }

            function setCheckableValue(
                el,
                rawValue
            ) {
                const value =
                    normalizeText(
                        rawValue
                    );

                const truthy =
                    new Set([
                        '1',
                        'true',
                        'yes',
                        'oui',
                        'y',
                        'x'
                    ]);

                const falsy =
                    new Set([
                        '0',
                        'false',
                        'no',
                        'non',
                        ''
                    ]);

                if (
                    !truthy.has(value) &&
                    !falsy.has(value)
                ) {
                    return false;
                }

                el.checked =
                    truthy.has(value);

                el.dispatchEvent(
                    new Event(
                        'input',
                        {
                            bubbles: true
                        }
                    )
                );

                el.dispatchEvent(
                    new Event(
                        'change',
                        {
                            bubbles: true
                        }
                    )
                );

                return true;
            }

            function normalizeText(text) {
                return String(text || '')
                    .normalize('NFD')
                    .replace(
                        /[\u0300-\u036f]/g,
                        ''
                    )
                    .replace(/\s+/g, ' ')
                    .trim()
                    .toLowerCase();
            }

            function setSelectValue(
                select,
                rawValue,
                field
            ) {
                const raw =
                    String(
                        rawValue || ''
                    ).trim();

                const target =
                    normalizeText(raw);

                const options =
                    Array.from(
                        select.options
                    ).map(opt => ({
                        el: opt,

                        text:
                            String(
                                opt.textContent ||
                                    ''
                            ).trim(),

                        value:
                            String(
                                opt.value || ''
                            ).trim(),

                        normText:
                            normalizeText(
                                opt.textContent ||
                                    ''
                            ),

                        normValue:
                            normalizeText(
                                opt.value || ''
                            )
                    }));

                const fieldLabel =
                    String(
                        field?.label || ''
                    );

                const fieldName =
                    String(
                        select.name || ''
                    );

                const aliasMap =
                    buildSelectAliasMap(
                        fieldLabel,
                        fieldName
                    );

                const aliasValue =
                    aliasMap[target] ||
                    null;

                let match =
                    options.find(
                        opt =>
                            opt.normText ===
                            target
                    ) ||
                    options.find(
                        opt =>
                            opt.normValue ===
                            target
                    );

                if (
                    !match &&
                    aliasValue
                ) {
                    const normalizedAlias =
                        normalizeText(
                            aliasValue
                        );

                    match =
                        options.find(
                            opt =>
                                opt.normValue ===
                                normalizedAlias
                        ) ||
                        options.find(
                            opt =>
                                opt.normText ===
                                normalizedAlias
                        );
                }

                if (!match) {
                    match =
                        options.find(
                            opt =>
                                (
                                    opt.normText &&
                                    opt.normText.includes(
                                        target
                                    )
                                ) ||
                                (
                                    target &&
                                    target.includes(
                                        opt.normText
                                    )
                                )
                        );
                }

                if (
                    !match &&
                    /^[A-Z]{2}$/i.test(raw)
                ) {
                    match =
                        options.find(
                            opt =>
                                opt.value
                                    .toUpperCase() ===
                                raw.toUpperCase()
                        );
                }

                if (!match) {
                    warn(
                        'No select option matched',
                        {
                            field:
                                fieldLabel,
                            rawValue,
                            options
                        }
                    );

                    return false;
                }

                select.value =
                    match.el.value;

                select.dispatchEvent(
                    new Event(
                        'input',
                        {
                            bubbles: true
                        }
                    )
                );

                select.dispatchEvent(
                    new Event(
                        'change',
                        {
                            bubbles: true
                        }
                    )
                );

                debug(
                    'Select matched',
                    {
                        field:
                            fieldLabel,
                        rawValue,
                        matchedText:
                            match.text,
                        matchedValue:
                            match.value
                    }
                );

                return true;
            }

            function buildSelectAliasMap(
                fieldLabel,
                fieldName
            ) {
                const label =
                    normalizeText(
                        fieldLabel
                    );

                const name =
                    normalizeText(
                        fieldName
                    );

                const map = {};

                const isCountry =
                    label.includes('pays') ||
                    name.includes(
                        'country'
                    );

                const isProvince =
                    label.includes(
                        'province'
                    ) ||
                    name.includes(
                        'state'
                    );

                if (isCountry) {
                    Object.assign(
                        map,
                        {
                            ca: 'CA',
                            canada: 'CA',
                            france: 'FR',
                            'etats-unis':
                                'US',
                            'etats unis':
                                'US',
                            usa: 'US',
                            us: 'US'
                        }
                    );
                }

                if (isProvince) {
                    Object.assign(
                        map,
                        {
                            qc: 'QC',
                            quebec: 'QC',

                            on: 'ON',
                            ontario: 'ON',

                            bc: 'BC',
                            'colombie-britannique':
                                'BC',

                            ab: 'AB',
                            alberta: 'AB',

                            nb: 'NB',
                            'nouveau-brunswick':
                                'NB',

                            ns: 'NS',
                            'nouvelle-ecosse':
                                'NS',

                            mb: 'MB',
                            manitoba: 'MB',

                            sk: 'SK',
                            saskatchewan: 'SK',

                            pe: 'PE',
                            'ile-du-prince-edouard':
                                'PE',

                            nl: 'NL',
                            'terre-neuve-et-labrador':
                                'NL',

                            nt: 'NT',
                            'territoires-du-nord-ouest':
                                'NT',

                            yt: 'YT',
                            yukon: 'YT'
                        }
                    );
                }

                return map;
            }

            function findSaveButton(
                rootDoc
            ) {
                return (
                    rootDoc.querySelector(
                        'a.btn.btn-action.form-submit.btn-save'
                    ) ||
                    rootDoc.querySelector(
                        '.page-controls .btn-save'
                    ) ||
                    rootDoc.querySelector(
                        '.form-submit.btn-save'
                    ) ||
                    Array.from(
                        rootDoc.querySelectorAll(
                            'a, button, input[type="submit"]'
                        )
                    ).find(el =>
                        /enregistrer|save/i.test(
                            (
                                el.textContent ||
                                el.value ||
                                ''
                            ).trim()
                        )
                    )
                );
            }

            /*
             * ------------------------------------------------------------
             * VALIDATION ERROR DETECTION
             * ------------------------------------------------------------
             */

            function detectValidationError(
                rootDoc
            ) {
                const selectors = [
                    '.alert-danger',
                    '.alert-error',
                    '.has-error .help-block',
                    '.form-group.has-error',
                    '.error-message',
                    '.invalid-feedback'
                ];

                const messages = [];

                selectors.forEach(
                    selector => {
                        rootDoc
                            .querySelectorAll(
                                selector
                            )
                            .forEach(el => {
                                const text =
                                    String(
                                        el.textContent ||
                                            ''
                                    )
                                        .replace(
                                            /\s+/g,
                                            ' '
                                        )
                                        .trim();

                                if (
                                    text &&
                                    !messages.includes(
                                        text
                                    )
                                ) {
                                    messages.push(
                                        text
                                    );
                                }
                            });
                    }
                );

                if (!messages.length) {
                    return null;
                }

                return messages
                    .slice(0, 3)
                    .join(' | ');
            }

            /*
             * ------------------------------------------------------------
             * PROGRESS UI
             * ------------------------------------------------------------
             */

            function showLoadingProgress(
                message
            ) {
                showProgressOverlay();

                const status =
                    document.querySelector(
                        `#${IDS.progress} [data-role="status"]`
                    );

                if (status) {
                    status.textContent =
                        message;
                }
            }

            function showProgressOverlay() {
                if (
                    document.getElementById(
                        IDS.progress
                    )
                ) {
                    return;
                }

                const overlay =
                    document.createElement(
                        'div'
                    );

                overlay.id =
                    IDS.progress;

                Object.assign(
                    overlay.style,
                    {
                        position: 'fixed',
                        inset: '0',
                        background:
                            'rgba(255,255,255,.94)',
                        zIndex:
                            '2147483002',
                        display: 'flex',
                        alignItems:
                            'center',
                        justifyContent:
                            'center',
                        fontFamily:
                            'Arial, sans-serif'
                    }
                );

                const card =
                    document.createElement(
                        'div'
                    );

                Object.assign(
                    card.style,
                    {
                        width: '380px',
                        background: '#fff',
                        borderRadius:
                            '16px',
                        boxShadow:
                            '0 15px 50px rgba(0,0,0,.14)',
                        padding: '26px',
                        textAlign:
                            'center'
                    }
                );

                card.innerHTML = `
                    <div style="
                        font-size:20px;
                        font-weight:700;
                        margin-bottom:18px;
                    ">
                        Import de donateurs
                    </div>

                    <div
                        data-role="ring"
                        style="
                            width:120px;
                            height:120px;
                            border-radius:50%;
                            margin:0 auto 16px auto;
                            display:flex;
                            align-items:center;
                            justify-content:center;
                            background:conic-gradient(
                                #0069d9 0deg,
                                #e9ecef 0deg
                            );
                        "
                    >
                        <div
                            data-role="label"
                            style="
                                width:88px;
                                height:88px;
                                border-radius:50%;
                                background:#fff;
                                display:flex;
                                align-items:center;
                                justify-content:center;
                                font-size:18px;
                                font-weight:700;
                            "
                        >
                            0/0
                        </div>
                    </div>

                    <div
                        data-role="status"
                        style="
                            font-size:15px;
                            color:#444;
                            margin-bottom:8px;
                        "
                    >
                        Préparation de l’import…
                    </div>

                    <div
                        data-role="donor"
                        style="
                            font-size:13px;
                            color:#666;
                            min-height:18px;
                            margin-bottom:18px;
                        "
                    ></div>

                    <button
                        data-role="stop"
                        type="button"
                        style="
                            padding:9px 14px;
                            border:none;
                            border-radius:7px;
                            background:#dc3545;
                            color:#fff;
                            cursor:pointer;
                            font-weight:600;
                        "
                    >
                        Arrêter l’import
                    </button>
                `;

                overlay.appendChild(card);

                document.body.appendChild(
                    overlay
                );

                card
                    .querySelector(
                        '[data-role="stop"]'
                    )
                    ?.addEventListener(
                        'click',
                        () => {
                            stopImport(false);
                        }
                    );
            }

            function updateProgressUI(
                donor = null
            ) {
                const overlay =
                    document.getElementById(
                        IDS.progress
                    );

                if (!overlay) {
                    return;
                }

                const total =
                    controller.total ||
                    parseInt(
                        localStorage.getItem(
                            STORAGE.totalCount
                        ) || '0',
                        10
                    );

                const completed =
                    parseInt(
                        localStorage.getItem(
                            STORAGE.currentIndex
                        ) || '0',
                        10
                    );

                const label =
                    overlay.querySelector(
                        '[data-role="label"]'
                    );

                const ring =
                    overlay.querySelector(
                        '[data-role="ring"]'
                    );

                const status =
                    overlay.querySelector(
                        '[data-role="status"]'
                    );

                const donorEl =
                    overlay.querySelector(
                        '[data-role="donor"]'
                    );

                if (
                    !label ||
                    !ring ||
                    !status ||
                    !donorEl
                ) {
                    return;
                }

                const showing =
                    controller.waitingForSave
                        ? Math.min(
                            completed + 1,
                            total
                        )
                        : Math.min(
                            completed,
                            total
                        );

                const safeTotal =
                    total || 1;

                const percent =
                    Math.min(
                        100,
                        Math.round(
                            (
                                showing /
                                safeTotal
                            ) * 100
                        )
                    );

                const deg =
                    Math.round(
                        (
                            percent /
                            100
                        ) * 360
                    );

                label.textContent =
                    `${showing}/${total}`;

                ring.style.background =
                    `conic-gradient(` +
                    `#0069d9 ${deg}deg, ` +
                    `#e9ecef ${deg}deg)`;

                if (
                    completed >= total &&
                    total > 0
                ) {
                    status.textContent =
                        'Import terminé';

                    donorEl.textContent =
                        '';

                    return;
                }

                status.textContent =
                    controller.waitingForSave
                        ? 'Enregistrement du donateur…'
                        : 'Préparation du prochain donateur…';

                if (donor) {
                    const donorName =
                        Object.values(donor)
                            .filter(Boolean)
                            .slice(0, 2)
                            .join(' ')
                            .trim();

                    donorEl.textContent =
                        donorName
                            ? `Donateur actuel : ${donorName}`
                            : `Donateur ${completed + 1}`;
                }
            }

            function hideProgressOverlay() {
                document
                    .getElementById(
                        IDS.progress
                    )
                    ?.remove();
            }

            /*
             * ------------------------------------------------------------
             * COMPLETE / STOP
             * ------------------------------------------------------------
             */

            function finishImport() {
                debug(
                    'Import complete'
                );

                controller.running =
                    false;

                controller.processing =
                    false;

                controller.waitingForSave =
                    false;

                localStorage.removeItem(
                    STORAGE.running
                );

                localStorage.setItem(
                    STORAGE.completed,
                    'true'
                );

                removeHiddenIframe();

                clearPayloadState();

                hideProgressOverlay();

                showDoneOverlay();
            }

            function stopImport(
                showAlert = false,
                message = 'Import arrêté.'
            ) {
                debug(
                    'Stopping import'
                );

                controller.generation++;

                controller.running =
                    false;

                controller.processing =
                    false;

                controller.waitingForSave =
                    false;

                localStorage.removeItem(
                    STORAGE.running
                );

                localStorage.setItem(
                    STORAGE.stopped,
                    'true'
                );

                removeHiddenIframe();

                hideProgressOverlay();

                removeMappingPanel();

                if (showAlert) {
                    alert(message);
                } else {
                    showToast(
                        'Import arrêté'
                    );
                }
            }

            function showDoneOverlay() {
                hideProgressOverlay();

                document
                    .getElementById(
                        IDS.done
                    )
                    ?.remove();

                const overlay =
                    document.createElement(
                        'div'
                    );

                overlay.id =
                    IDS.done;

                Object.assign(
                    overlay.style,
                    {
                        position: 'fixed',
                        inset: '0',
                        background:
                            'rgba(255,255,255,.94)',
                        zIndex:
                            '2147483002',
                        display: 'flex',
                        alignItems:
                            'center',
                        justifyContent:
                            'center',
                        fontFamily:
                            'Arial, sans-serif'
                    }
                );

                const card =
                    document.createElement(
                        'div'
                    );

                Object.assign(
                    card.style,
                    {
                        width: '360px',
                        background: '#fff',
                        borderRadius:
                            '16px',
                        boxShadow:
                            '0 15px 50px rgba(0,0,0,.14)',
                        padding: '26px',
                        textAlign:
                            'center'
                    }
                );

                card.innerHTML = `
                    <div style="
                        font-size:22px;
                        font-weight:700;
                        margin-bottom:10px;
                    ">
                        ✅ Import terminé
                    </div>

                    <div style="
                        font-size:15px;
                        color:#555;
                        margin-bottom:18px;
                    ">
                        Tous les donateurs ont été traités.
                    </div>

                    <button
                        data-role="close"
                        type="button"
                        style="
                            padding:10px 14px;
                            border:none;
                            border-radius:8px;
                            background:#0069d9;
                            color:#fff;
                            cursor:pointer;
                        "
                    >
                        Fermer
                    </button>
                `;

                overlay.appendChild(card);

                document.body.appendChild(
                    overlay
                );

                card
                    .querySelector(
                        '[data-role="close"]'
                    )
                    ?.addEventListener(
                        'click',
                        () => {
                            localStorage.removeItem(
                                STORAGE.completed
                            );

                            overlay.remove();
                        }
                    );
            }

            /*
             * ------------------------------------------------------------
             * STORAGE
             * ------------------------------------------------------------
             */

            function clearImportState() {
                Object.values(
                    STORAGE
                ).forEach(key => {
                    localStorage.removeItem(
                        key
                    );
                });

                controller.generation++;

                controller.donors = [];
                controller.mapping = {};
                controller.currentIndex = 0;
                controller.total = 0;
                controller.running = false;
                controller.waitingForSave =
                    false;
                controller.processing = false;

                removeHiddenIframe();
                removeMappingPanel();
                hideProgressOverlay();

                document
                    .getElementById(
                        IDS.done
                    )
                    ?.remove();
            }

            function clearPayloadState() {
                localStorage.removeItem(
                    STORAGE.fileText
                );

                localStorage.removeItem(
                    STORAGE.fileType
                );

                localStorage.removeItem(
                    STORAGE.excelJson
                );

                localStorage.removeItem(
                    STORAGE.mapping
                );

                localStorage.removeItem(
                    STORAGE.mappingConfirmed
                );

                localStorage.removeItem(
                    STORAGE.currentIndex
                );

                localStorage.removeItem(
                    STORAGE.totalCount
                );

                localStorage.removeItem(
                    STORAGE.stopped
                );
            }

            function isStopped() {
                return (
                    localStorage.getItem(
                        STORAGE.stopped
                    ) === 'true'
                );
            }

            /*
             * ------------------------------------------------------------
             * GENERAL HELPERS
             * ------------------------------------------------------------
             */

            async function waitForForm(
                timeoutMs = 15000,
                rootDoc = document
            ) {
                const start =
                    Date.now();

                while (
                    Date.now() - start <
                    timeoutMs
                ) {
                    if (
                        rootDoc.querySelector(
                            '#mod_form_advanced_form'
                        ) ||
                        rootDoc.querySelector(
                            'form.form-create'
                        ) ||
                        rootDoc.querySelector(
                            'form'
                        )
                    ) {
                        return true;
                    }

                    await sleep(150);
                }

                return false;
            }

            function sleep(ms) {
                return new Promise(
                    resolve =>
                        setTimeout(
                            resolve,
                            ms
                        )
                );
            }

            function showToast(message) {
                document
                    .getElementById(
                        IDS.toast
                    )
                    ?.remove();

                const el =
                    document.createElement(
                        'div'
                    );

                el.id =
                    IDS.toast;

                el.textContent =
                    message;

                Object.assign(
                    el.style,
                    {
                        position: 'fixed',
                        bottom: '20px',
                        right: '20px',
                        background:
                            '#212529',
                        color: '#fff',
                        padding:
                            '10px 14px',
                        borderRadius:
                            '8px',
                        fontSize:
                            '14px',
                        zIndex:
                            '2147483003',
                        opacity: '0',
                        transform:
                            'translateY(10px)',
                        transition:
                            'all .2s ease',
                        fontFamily:
                            'Arial, sans-serif'
                    }
                );

                document.body.appendChild(
                    el
                );

                requestAnimationFrame(
                    () => {
                        el.style.opacity =
                            '1';

                        el.style.transform =
                            'translateY(0)';
                    }
                );

                setTimeout(
                    () => {
                        el.style.opacity =
                            '0';

                        el.style.transform =
                            'translateY(10px)';

                        setTimeout(
                            () =>
                                el.remove(),
                            200
                        );
                    },
                    2000
                );
            }

            /*
             * ------------------------------------------------------------
             * BUTTON STYLES
             * ------------------------------------------------------------
             */

            function stylePrimary(btn) {
                Object.assign(
                    btn.style,
                    {
                        padding:
                            '9px 13px',
                        border: 'none',
                        borderRadius:
                            '7px',
                        background:
                            '#0d6efd',
                        color: '#fff',
                        fontWeight:
                            '600',
                        cursor: 'pointer'
                    }
                );
            }

            function styleSecondary(btn) {
                Object.assign(
                    btn.style,
                    {
                        padding:
                            '9px 13px',
                        border: 'none',
                        borderRadius:
                            '7px',
                        background:
                            '#6c757d',
                        color: '#fff',
                        fontWeight:
                            '600',
                        cursor: 'pointer'
                    }
                );
            }

            function styleClose(btn) {
                Object.assign(
                    btn.style,
                    {
                        width: '36px',
                        height: '36px',
                        border: 'none',
                        borderRadius:
                            '7px',
                        background:
                            '#f1f3f5',
                        color: '#333',
                        fontSize:
                            '17px',
                        fontWeight:
                            '700',
                        cursor: 'pointer'
                    }
                );
            }

            function buttonStyle(
                btn,
                background
            ) {
                Object.assign(
                    btn.style,
                    {
                        padding:
                            '10px 14px',
                        border: 'none',
                        borderRadius:
                            '6px',
                        background,
                        color: '#fff',
                        cursor: 'pointer'
                    }
                );
            }
        }
    });
})();
