(() => {
    'use strict';

    const TOOL_ID = 'payment-attestation';

    const IDS = {
        style: 'ytb-payment-attestation-styles',
        modal: 'ytb-payment-attestation-modal',
        status: 'ytb-payment-attestation-status',
    };

    const STORAGE_KEY =
        'yapla_toolbox_payment_attestation_job_v1';

    const STRIPE_SESSION_KEY =
        'yapla_toolbox_payment_attestation_stripe_session';

    const JOB_MAX_AGE_MS =
        6 * 60 * 60 * 1000;

    const STRIPE_ACCOUNTS = {
        s1: 'acct_1GWTo1Aioa7GoDvO',
        s2: 'acct_1MBedEJ8NgBiCKW4',
    };

    const PLATFORM_ADDRESS = {
        name: 'Yapla',
        address: '6415 Rue des Écores #2',
        city: 'Montréal (Québec) H2G 2J6',
    };

    const PDF_URL =
        'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js';

    const AUTOTABLE_URL =
        'https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.4/dist/jspdf.plugin.autotable.min.js';

    window.YaplaToolbox.registerTool({
        id: TOOL_ID,
        name: 'Attestation de paiement',
        category: 'Comptabilité',
        icon: '🧾',
        description: 'Générer une attestation de paiement à partir de Yapla et Stripe.',

        async run() {
            if (window !== window.top) {
                alert(
                    'Cet outil doit être lancé dans la fenêtre principale.'
                );
                return;
            }

            installStyles();

            if (isYaplaInvoicePage()) {
                await runOnYapla();
                return;
            }

            if (location.hostname === 'dashboard.stripe.com') {
                await runOnStripe();
                return;
            }

            alert(
                'Cet outil doit être lancé depuis :\n\n' +
                '• une facture Yapla\n' +
                '• ou dashboard.stripe.com pendant une recherche d’attestation.'
            );
        },
    });

    /*
     * ============================================================
     * ENVIRONMENT
     * ============================================================
     */

    function isYaplaInvoicePage() {
        return (
            /^s[12]\.yapla\.com$/i.test(location.hostname) &&
            /\/accounting\/[^/]+\/billing\/view\/billingId\//i.test(
                location.pathname
            )
        );
    }

    function isYaplaHost(hostname = location.hostname) {
        return /^s[12]\.yapla\.com$/i.test(hostname);
    }

    /*
     * ============================================================
     * STORAGE
     * ============================================================
     */

    function getJob() {
        if (!isYaplaHost()) {
            return null;
        }

        try {
            const raw =
                localStorage.getItem(STORAGE_KEY);

            if (!raw) {
                return null;
            }

            const job =
                JSON.parse(raw);

            if (
                !job ||
                typeof job !== 'object'
            ) {
                return null;
            }

            if (
                !job.createdAt ||
                Date.now() -
                    job.createdAt >
                    JOB_MAX_AGE_MS
            ) {
                localStorage.removeItem(
                    STORAGE_KEY
                );

                return null;
            }

            return job;
        } catch (error) {
            console.warn(
                '[Attestation Yapla] Job illisible.',
                error
            );

            return null;
        }
    }

    function saveJob(job) {
        if (!isYaplaHost()) {
            return;
        }

        job.updatedAt =
            Date.now();

        localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify(job)
        );
    }

    function deleteJob() {
        if (!isYaplaHost()) {
            return;
        }

        localStorage.removeItem(
            STORAGE_KEY
        );
    }

    function getStripeSession() {
        try {
            return JSON.parse(
                sessionStorage.getItem(
                    STRIPE_SESSION_KEY
                ) || 'null'
            );
        } catch {
            return null;
        }
    }

    function saveStripeSession(value) {
        sessionStorage.setItem(
            STRIPE_SESSION_KEY,
            JSON.stringify(value)
        );
    }

    /*
     * ============================================================
     * STYLES
     * ============================================================
     */

    function installStyles() {
        if (
            document.getElementById(
                IDS.style
            )
        ) {
            return;
        }

        const style =
            document.createElement('style');

        style.id =
            IDS.style;

        style.textContent = `
            #${IDS.modal} {
                position: fixed;
                inset: 0;
                z-index: 2147483005;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 22px;
                background: rgba(15,23,42,.58);
                font-family: Arial, sans-serif;
            }

            #${IDS.modal} .ya-card {
                width: min(760px, 100%);
                max-height: min(84vh, 900px);
                overflow: auto;
                border-radius: 12px;
                background: #fff;
                color: #1f2937;
                box-shadow: 0 24px 70px rgba(0,0,0,.35);
            }

            #${IDS.modal} .ya-head {
                position: sticky;
                top: 0;
                z-index: 2;
                padding: 19px 22px 14px;
                border-bottom: 1px solid #e5e7eb;
                background: #fff;
            }

            #${IDS.modal} .ya-head h2 {
                margin: 0;
                font-size: 20px;
                line-height: 1.3;
            }

            #${IDS.modal} .ya-head p {
                margin: 7px 0 0;
                color: #6b7280;
                font-size: 13px;
            }

            #${IDS.modal} .ya-body {
                padding: 18px 22px;
            }

            #${IDS.modal} .ya-actions {
                position: sticky;
                bottom: 0;
                display: flex;
                justify-content: flex-end;
                gap: 10px;
                padding: 14px 22px;
                border-top: 1px solid #e5e7eb;
                background: #fff;
            }

            #${IDS.modal} .ya-btn,
            #${IDS.status} .ya-btn {
                border: 1px solid #d1d5db;
                border-radius: 7px;
                padding: 10px 14px;
                background: #fff;
                color: #111827;
                font-weight: 700;
                cursor: pointer;
            }

            #${IDS.modal} .ya-btn-primary,
            #${IDS.status} .ya-btn-primary {
                border-color: #ff7b14;
                background: #ff7b14;
                color: #fff;
            }

            #${IDS.modal} .ya-btn:disabled {
                opacity: .45;
                cursor: not-allowed;
            }

            #${IDS.modal} .ya-option {
                display: grid;
                grid-template-columns: 24px 1fr;
                gap: 10px;
                margin: 0 0 11px;
                padding: 14px;
                border: 1px solid #dbe1e8;
                border-radius: 9px;
                cursor: pointer;
            }

            #${IDS.modal} .ya-option:hover {
                border-color: #ff7b14;
            }

            #${IDS.modal} .ya-option input {
                margin-top: 4px;
            }

            #${IDS.modal} .ya-option-title {
                font-weight: 700;
            }

            #${IDS.modal} .ya-option-details {
                margin-top: 5px;
                color: #4b5563;
                font-size: 13px;
                line-height: 1.5;
                white-space: pre-line;
            }

            #${IDS.modal} .ya-summary {
                display: grid;
                grid-template-columns: minmax(150px,210px) 1fr;
                gap: 8px 14px;
                margin-bottom: 16px;
                font-size: 14px;
            }

            #${IDS.modal} .ya-summary dt {
                color: #6b7280;
                font-weight: 700;
            }

            #${IDS.modal} .ya-summary dd {
                margin: 0;
            }

            #${IDS.modal} .ya-warning-box {
                margin-top: 16px;
                padding: 13px 15px;
                border: 1px solid #f59e0b;
                border-radius: 8px;
                background: #fffbeb;
            }

            #${IDS.modal} .ya-warning-box strong {
                color: #92400e;
            }

            #${IDS.modal} .ya-warning-box ul {
                margin: 8px 0 0;
                padding-left: 20px;
            }

            #${IDS.modal} .ya-ok-box {
                margin-top: 16px;
                padding: 12px 14px;
                border: 1px solid #86efac;
                border-radius: 8px;
                background: #f0fdf4;
                color: #166534;
                font-weight: 700;
            }

            #${IDS.status} {
                position: fixed;
                right: 22px;
                bottom: 22px;
                z-index: 2147483004;
                width: min(500px, calc(100vw - 44px));
                max-height: 66vh;
                overflow: auto;
                padding: 15px 16px;
                border: 1px solid #dbe1e8;
                border-radius: 10px;
                background: #fff;
                color: #1f2937;
                box-shadow: 0 14px 40px rgba(0,0,0,.24);
                font: 14px/1.45 Arial, sans-serif;
            }

            #${IDS.status} strong {
                display: block;
                margin-bottom: 5px;
            }

            #${IDS.status} .ya-status-actions {
                display: flex;
                flex-wrap: wrap;
                gap: 8px;
                margin-top: 11px;
            }

            #${IDS.status} .ya-status-actions a {
                display: inline-block;
                border: 1px solid #d1d5db;
                border-radius: 6px;
                padding: 7px 10px;
                background: #fff;
                color: #111827;
                font-weight: 700;
                text-decoration: none;
            }

            #${IDS.status} .ya-progress-log {
                margin: 10px 0 0;
                padding: 0;
                list-style: none;
                font-size: 12px;
                color: #475569;
            }

            #${IDS.status} .ya-progress-log li {
                display: grid;
                grid-template-columns: 62px 1fr;
                gap: 7px;
                margin: 0;
                padding: 5px 0;
                border-bottom: 1px solid #eef2f7;
            }

            #${IDS.status} .ya-progress-log time {
                color: #94a3b8;
                font-variant-numeric: tabular-nums;
            }

            #${IDS.status} .ya-warning {
                margin-top: 10px;
                padding: 10px;
                border: 1px solid #f59e0b;
                border-radius: 7px;
                background: #fffbeb;
                color: #92400e;
            }
        `;

        document.head.appendChild(
            style
        );
    }

    /*
     * ============================================================
     * GENERIC HELPERS
     * ============================================================
     */

    function cleanText(value) {
        return String(value ?? '')
            .replace(/\u00a0/g, ' ')
            .replace(/[\t\r\n]+/g, ' ')
            .replace(/\s{2,}/g, ' ')
            .trim();
    }

    function normalizeKey(value) {
        return cleanText(value)
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[°º]/g, '')
            .replace(/[’']/g, '')
            .replace(/[^a-zA-Z0-9]+/g, ' ')
            .toLowerCase()
            .trim();
    }

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function safeFilePart(value) {
        return cleanText(value)
            .replace(/[\\/:*?"<>|]+/g, '-')
            .replace(/\s+/g, ' ')
            .slice(0, 90)
            .trim() || 'document';
    }

    function textOf(selector, root = document) {
        const element =
            root.querySelector(selector);

        return cleanText(
            element
                ? element.textContent
                : ''
        );
    }

    function delay(ms) {
        return new Promise(
            resolve =>
                setTimeout(
                    resolve,
                    ms
                )
        );
    }

    function parseMoney(text) {
        const original =
            cleanText(text);

        if (!original) {
            return {
                amount: null,
                currency: '',
                original: '',
            };
        }

        const currencyCode =
            (
                original.match(
                    /\b[A-Z]{3}\b/i
                ) || []
            )[0]?.toUpperCase() || '';

        const symbol =
            (
                original.match(
                    /[$€£]/
                ) || []
            )[0] || '';

        const numberMatch =
            original.match(
                /[-+]?\d[\d\s.,'’]*/
            );

        if (!numberMatch) {
            return {
                amount: null,
                currency:
                    currencyCode ||
                    symbol,
                original,
            };
        }

        let raw =
            numberMatch[0]
                .replace(
                    /[\s'’]/g,
                    ''
                );

        const lastComma =
            raw.lastIndexOf(',');

        const lastDot =
            raw.lastIndexOf('.');

        if (
            lastComma !== -1 &&
            lastDot !== -1
        ) {
            const decimalSeparator =
                lastComma > lastDot
                    ? ','
                    : '.';

            const thousandsSeparator =
                decimalSeparator === ','
                    ? '.'
                    : ',';

            raw =
                raw
                    .split(
                        thousandsSeparator
                    )
                    .join('');

            if (
                decimalSeparator === ','
            ) {
                raw =
                    raw.replace(
                        ',',
                        '.'
                    );
            }
        } else if (
            lastComma !== -1
        ) {
            const decimals =
                raw.length -
                lastComma -
                1;

            raw =
                decimals === 1 ||
                decimals === 2
                    ? raw.replace(
                        ',',
                        '.'
                    )
                    : raw.replace(
                        /,/g,
                        ''
                    );
        } else if (
            lastDot !== -1
        ) {
            const decimals =
                raw.length -
                lastDot -
                1;

            if (
                !(
                    decimals === 1 ||
                    decimals === 2
                )
            ) {
                raw =
                    raw.replace(
                        /\./g,
                        ''
                    );
            }
        }

        const amount =
            Number(raw);

        return {
            amount:
                Number.isFinite(amount)
                    ? amount
                    : null,

            currency:
                currencyCode ||
                symbol,

            original,
        };
    }

    function normalizeCurrency(
        value,
        fallback = 'CAD'
    ) {
        const raw =
            cleanText(value)
                .toUpperCase();

        if (
            /^[A-Z]{3}$/.test(raw)
        ) {
            return raw;
        }

        if (raw === '$') {
            return fallback;
        }

        if (raw === '€') {
            return 'EUR';
        }

        if (raw === '£') {
            return 'GBP';
        }

        return fallback;
    }

    function formatMoney(
        amount,
        currency = 'CAD'
    ) {
        const safeAmount =
            Number.isFinite(
                Number(amount)
            )
                ? Number(amount)
                : 0;

        const safeCurrency =
            normalizeCurrency(
                currency,
                'CAD'
            );

        try {
            return new Intl.NumberFormat(
                'fr-CA',
                {
                    style: 'currency',
                    currency:
                        safeCurrency,
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                }
            )
                .format(
                    safeAmount
                )
                .replace(
                    /\u00a0/g,
                    ' '
                );
        } catch {
            return (
                `${safeAmount.toFixed(2)} ` +
                safeCurrency
            );
        }
    }

    function nearlyEqual(
        a,
        b,
        tolerance = 0.02
    ) {
        return (
            Number.isFinite(a) &&
            Number.isFinite(b) &&
            Math.abs(a - b) <=
                tolerance
        );
    }

    /*
     * ============================================================
     * MODAL / STATUS
     * ============================================================
     */

    function removeModal() {
        document
            .getElementById(
                IDS.modal
            )
            ?.remove();
    }

    function showModal({
        title,
        subtitle = '',
        bodyHtml = '',
        confirmText = 'Continuer',
        cancelText = 'Annuler',
        confirmDisabled = false,
        onConfirm,
        onCancel,
    }) {
        removeModal();

        const overlay =
            document.createElement(
                'div'
            );

        overlay.id =
            IDS.modal;

        overlay.innerHTML = `
            <div
                class="ya-card"
                role="dialog"
                aria-modal="true"
            >
                <div class="ya-head">
                    <h2>
                        ${escapeHtml(title)}
                    </h2>

                    ${
                        subtitle
                            ? `<p>${escapeHtml(subtitle)}</p>`
                            : ''
                    }
                </div>

                <div class="ya-body">
                    ${bodyHtml}
                </div>

                <div class="ya-actions">
                    <button
                        type="button"
                        class="ya-btn ya-cancel"
                    >
                        ${escapeHtml(cancelText)}
                    </button>

                    <button
                        type="button"
                        class="ya-btn ya-btn-primary ya-confirm"
                        ${
                            confirmDisabled
                                ? 'disabled'
                                : ''
                        }
                    >
                        ${escapeHtml(confirmText)}
                    </button>
                </div>
            </div>
        `;

        document.body.appendChild(
            overlay
        );

        const confirmButton =
            overlay.querySelector(
                '.ya-confirm'
            );

        const cancelButton =
            overlay.querySelector(
                '.ya-cancel'
            );

        confirmButton.addEventListener(
            'click',
            () => {
                if (
                    typeof onConfirm ===
                    'function'
                ) {
                    onConfirm({
                        overlay,
                        confirmButton,
                        cancelButton,
                    });
                }
            }
        );

        cancelButton.addEventListener(
            'click',
            () => {
                removeModal();

                if (
                    typeof onCancel ===
                    'function'
                ) {
                    onCancel();
                }
            }
        );

        return {
            overlay,
            confirmButton,
            cancelButton,
        };
    }

    function showStatus(
        title,
        message,
        actions = []
    ) {
        document
            .getElementById(
                IDS.status
            )
            ?.remove();

        const box =
            document.createElement(
                'div'
            );

        box.id =
            IDS.status;

        box.innerHTML = `
            <strong>
                ${escapeHtml(title)}
            </strong>

            <div>
                ${escapeHtml(message)}
            </div>

            ${
                actions.length
                    ? '<div class="ya-status-actions"></div>'
                    : ''
            }
        `;

        document.body.appendChild(
            box
        );

        const actionBox =
            box.querySelector(
                '.ya-status-actions'
            );

        for (
            const action of actions
        ) {
            if (action.href) {
                const link =
                    document.createElement(
                        'a'
                    );

                link.href =
                    action.href;

                link.textContent =
                    action.label;

                link.target =
                    action.target ||
                    '_blank';

                link.rel =
                    'noopener noreferrer';

                actionBox.appendChild(
                    link
                );
            } else {
                const button =
                    document.createElement(
                        'button'
                    );

                button.type =
                    'button';

                button.className =
                    'ya-btn';

                button.textContent =
                    action.label;

                button.addEventListener(
                    'click',
                    action.onClick
                );

                actionBox.appendChild(
                    button
                );
            }
        }

        return box;
    }

    /*
     * ============================================================
     * PDF LIBRARIES
     * ============================================================
     */

    async function ensurePdfLibraries() {
        if (
            window.jspdf?.jsPDF?.API
                ?.autoTable
        ) {
            return window.jspdf;
        }

        if (
            !window.jspdf?.jsPDF
        ) {
            await loadExternalScript(
                PDF_URL,
                'ytb-payment-attestation-jspdf'
            );
        }

        if (
            !window.jspdf?.jsPDF?.API
                ?.autoTable
        ) {
            await loadExternalScript(
                AUTOTABLE_URL,
                'ytb-payment-attestation-autotable'
            );
        }

        if (
            !window.jspdf?.jsPDF?.API
                ?.autoTable
        ) {
            throw new Error(
                'jsPDF AutoTable n’est pas disponible.'
            );
        }

        return window.jspdf;
    }

    function loadExternalScript(
        src,
        id
    ) {
        return new Promise(
            (resolve, reject) => {
                const existing =
                    document.getElementById(
                        id
                    );

                if (existing) {
                    if (
                        existing.dataset
                            .loaded ===
                        'true'
                    ) {
                        resolve();
                        return;
                    }

                    existing.addEventListener(
                        'load',
                        resolve,
                        {
                            once: true,
                        }
                    );

                    existing.addEventListener(
                        'error',
                        () =>
                            reject(
                                new Error(
                                    `Impossible de charger ${src}`
                                )
                            ),
                        {
                            once: true,
                        }
                    );

                    return;
                }

                const script =
                    document.createElement(
                        'script'
                    );

                script.id = id;
                script.src = src;
                script.async = true;

                script.addEventListener(
                    'load',
                    () => {
                        script.dataset.loaded =
                            'true';

                        resolve();
                    },
                    {
                        once: true,
                    }
                );

                script.addEventListener(
                    'error',
                    () =>
                        reject(
                            new Error(
                                `Impossible de charger ${src}`
                            )
                        ),
                    {
                        once: true,
                    }
                );

                document.head.appendChild(
                    script
                );
            }
        );
    }

    /*
     * ============================================================
     * YAPLA SIDE
     * ============================================================
     */

    async function runOnYapla() {
        installYaplaMessageListener();

        const existingJob =
            getJob();

        if (
            existingJob &&
            existingJob.invoice?.billingId ===
                currentBillingId() &&
            ![
                'completed',
                'cancelled',
            ].includes(
                existingJob.status
            )
        ) {
            renderYaplaStatus(
                existingJob
            );

            if (
                existingJob.status ===
                'stripeDataReady'
            ) {
                handleStripeDataReady(
                    existingJob
                );
            }

            return;
        }

        startFromYapla();
    }

    function currentBillingId() {
        return (
            location.pathname.match(
                /billingId\/(\d+)/i
            )?.[1] || ''
        );
    }

    function readYaplaConfig() {
        try {
            return JSON.parse(
                document
                    .querySelector(
                        '#js-config'
                    )
                    ?.textContent.trim() ||
                    '{}'
            );
        } catch {
            return {};
        }
    }

    function findHeaderIndex(
        headers,
        alternatives
    ) {
        return headers.findIndex(
            header =>
                alternatives.some(
                    needle =>
                        header.includes(
                            needle
                        )
                )
        );
    }

    function readCell(
        cells,
        index
    ) {
        return (
            index >= 0 &&
            cells[index]
        )
            ? cleanText(
                cells[index]
                    .textContent
            )
            : '';
    }

    function readInvoiceNumberFromPage() {
        const candidates = [
            textOf(
                '[data-component="page-heading"] h3 span'
            ),

            textOf(
                '[data-component="page-heading"] h3'
            ),

            textOf(
                '.appli-header-light h3'
            ),
        ];

        for (
            const candidate
            of candidates
        ) {
            const match =
                candidate.match(
                    /(?:facture|invoice)\s*(?:n(?:o|umero)?|number)?\s*[°º#.:\-]*\s*(\d{3,})/i
                );

            if (match) {
                return match[1];
            }
        }

        return '';
    }

    function scrapePayments(
        pageInvoiceNumber = ''
    ) {
        const tables =
            [
                ...document.querySelectorAll(
                    '#payment_info table'
                ),
            ];

        const table =
            tables.find(
                candidate =>
                    candidate.querySelector(
                        'tbody tr'
                    )
            );

        if (!table) {
            return [];
        }

        const headers =
            [
                ...table.querySelectorAll(
                    'thead th'
                ),
            ].map(
                th =>
                    normalizeKey(
                        th.getAttribute(
                            'aria-label'
                        ) ||
                        th.textContent
                    )
            );

        const resolveIndex =
            (
                alternatives,
                fallback
            ) => {
                const found =
                    findHeaderIndex(
                        headers,
                        alternatives
                    );

                return found >= 0
                    ? found
                    : fallback;
            };

        const indexes = {
            date:
                resolveIndex(
                    [
                        'date du paiement',
                        'payment date',
                    ],
                    0
                ),

            source:
                resolveIndex(
                    ['source'],
                    1
                ),

            invoiceNumber:
                resolveIndex(
                    [
                        'n de facture',
                        'numero de facture',
                        'invoice number',
                    ],
                    2
                ),

            paymentNumber:
                resolveIndex(
                    [
                        'n de paiement',
                        'numero de paiement',
                        'payment number',
                    ],
                    3
                ),

            method:
                resolveIndex(
                    [
                        'methode de paiement',
                        'payment method',
                    ],
                    4
                ),

            thirdParty:
                resolveIndex(
                    [
                        'info de paiement tiers',
                        'third party payment',
                    ],
                    5
                ),

            status:
                resolveIndex(
                    [
                        'statut',
                        'status',
                    ],
                    6
                ),

            total:
                resolveIndex(
                    [
                        'montant total',
                        'total amount',
                    ],
                    7
                ),
        };

        return [
            ...table.querySelectorAll(
                'tbody tr'
            ),
        ]
            .map(
                (row, rowIndex) => {
                    const cells =
                        [
                            ...row.querySelectorAll(
                                ':scope > td'
                            ),
                        ];

                    const paymentLink =
                        row.querySelector(
                            'a[href*="/payment/view/paymentId/"]'
                        );

                    const linkPaymentId =
                        paymentLink
                            ?.getAttribute(
                                'href'
                            )
                            ?.match(
                                /paymentId\/(\d+)/i
                            )?.[1] ||
                        '';

                    const totalText =
                        readCell(
                            cells,
                            indexes.total
                        );

                    return {
                        rowIndex,

                        date:
                            readCell(
                                cells,
                                indexes.date
                            ),

                        source:
                            readCell(
                                cells,
                                indexes.source
                            ),

                        invoiceNumber:
                            readCell(
                                cells,
                                indexes
                                    .invoiceNumber
                            ) ||
                            pageInvoiceNumber,

                        paymentNumber:
                            readCell(
                                cells,
                                indexes
                                    .paymentNumber
                            ) ||
                            linkPaymentId,

                        method:
                            readCell(
                                cells,
                                indexes.method
                            ),

                        thirdParty:
                            readCell(
                                cells,
                                indexes
                                    .thirdParty
                            ),

                        status:
                            readCell(
                                cells,
                                indexes.status
                            ),

                        totalText,

                        totalAmount:
                            parseMoney(
                                totalText
                            ).amount,
                    };
                }
            )
            .filter(
                payment =>
                    payment.paymentNumber ||
                    payment.invoiceNumber ||
                    payment.date
            );
    }

    function scrapeInvoiceLines() {
        const table =
            document.querySelector(
                '#item_part table.billing-table, #item_part table.main-table, table.billing-table'
            );

        if (!table) {
            return {
                items: [],
                taxes: [],
                subtotal: null,
                invoiceTotal:
                    null,
            };
        }

        const items = [];
        let currentGroup = '';

        for (
            const row
            of table.querySelectorAll(
                'tbody tr'
            )
        ) {
            const cells =
                [
                    ...row.querySelectorAll(
                        ':scope > td'
                    ),
                ];

            if (!cells.length) {
                continue;
            }

            const firstCell =
                cells[0];

            const firstText =
                cleanText(
                    firstCell.textContent
                );

            const amountText =
                cleanText(
                    cells.at(-1)
                        ?.textContent ||
                    ''
                );

            const isGroup =
                firstCell.classList.contains(
                    'table-description-subtitle'
                ) ||
                (
                    firstText &&
                    cells
                        .slice(1)
                        .every(
                            cell =>
                                !cleanText(
                                    cell.textContent
                                )
                        )
                );

            if (isGroup) {
                currentGroup =
                    firstText;

                continue;
            }

            const parsedAmount =
                parseMoney(
                    amountText
                );

            if (
                !firstText &&
                parsedAmount.amount ===
                    null
            ) {
                continue;
            }

            items.push({
                group:
                    currentGroup,

                description:
                    firstText,

                fullDescription:
                    [
                        currentGroup,
                        firstText,
                    ]
                        .filter(Boolean)
                        .join(' - ') ||
                    'Transaction',

                amountText,

                amount:
                    parsedAmount.amount,
            });
        }

        const taxes =
            [
                ...table.querySelectorAll(
                    'tfoot tr'
                ),
            ]
                .map(row => {
                    const label =
                        cleanText(
                            row.querySelector(
                                '.billing-tax-label'
                            )
                                ?.textContent ||
                            ''
                        );

                    const valueText =
                        cleanText(
                            row.querySelector(
                                '.billing-tax-value'
                            )
                                ?.textContent ||
                            ''
                        );

                    return {
                        label,
                        amountText:
                            valueText,
                        amount:
                            parseMoney(
                                valueText
                            ).amount,
                    };
                })
                .filter(
                    tax =>
                        tax.label &&
                        tax.amount !==
                            null
                );

        const subtotal =
            parseMoney(
                textOf(
                    '.billing-subtotal-value',
                    table
                )
            ).amount;

        const totalElement =
            table.querySelector(
                '.billing-total-value[data-bill]'
            ) ||
            [
                ...table.querySelectorAll(
                    'tfoot tr'
                ),
            ]
                .find(
                    row =>
                        normalizeKey(
                            row.querySelector(
                                '.billing-total-label'
                            )
                                ?.textContent
                        ) ===
                        'total'
                )
                ?.querySelector(
                    '.billing-total-value'
                );

        const invoiceTotal =
            totalElement?.dataset.bill
                ? Number(
                    totalElement.dataset
                        .bill
                )
                : parseMoney(
                    cleanText(
                        totalElement
                            ?.textContent ||
                        ''
                    )
                ).amount;

        return {
            items,
            taxes,
            subtotal,
            invoiceTotal,
        };
    }

    function scrapeYaplaInvoice() {
        const config =
            readYaplaConfig();

        const lines =
            scrapeInvoiceLines();

        const currency =
            normalizeCurrency(
                config.companyCurrency ||
                document.body.className.match(
                    /currency-([a-z]{3})/i
                )?.[1] ||
                'CAD'
            );

        const invoiceNumber =
            readInvoiceNumberFromPage();

        return {
            sourceUrl:
                location.href,

            billingId:
                currentBillingId(),

            invoiceNumber,

            companyId:
                cleanText(
                    config.id
                ),

            companyName:
                cleanText(
                    config.companyName
                ) ||
                'Association',

            currency,

            contributor: {
                organization:
                    textOf(
                        '#organization'
                    ),

                firstName:
                    textOf(
                        '#firstname'
                    ),

                lastName:
                    textOf(
                        '#lastname'
                    ),

                email:
                    textOf(
                        '#email'
                    ),
            },

            address: {
                address:
                    textOf(
                        '#address'
                    ),

                city:
                    textOf(
                        '#city'
                    ),

                state:
                    textOf(
                        '#state'
                    ),

                zip:
                    textOf(
                        '#zip'
                    ),

                country:
                    textOf(
                        '#country'
                    ),
            },

            billingDate:
                textOf(
                    '#billingDate'
                ),

            invoiceTotal:
                lines.invoiceTotal,

            subtotal:
                lines.subtotal,

            items:
                lines.items,

            taxes:
                lines.taxes,

            payments:
                scrapePayments(
                    invoiceNumber
                ),
        };
    }

    function buildYaplaWarnings(
        invoice,
        payment
    ) {
        const warnings = [];

        if (!invoice.companyName) {
            warnings.push(
                "Le nom de l'association n'a pas été détecté."
            );
        }

        if (
            !invoice.address.address ||
            !invoice.address.city ||
            !invoice.address.zip ||
            !invoice.address.country
        ) {
            warnings.push(
                "L'adresse de facturation est incomplète."
            );
        }

        if (!invoice.items.length) {
            warnings.push(
                "Aucune ligne de facture n'a été détectée."
            );
        }

        if (
            !Number.isFinite(
                invoice.invoiceTotal
            )
        ) {
            warnings.push(
                "Le total de la facture n'a pas été détecté."
            );
        }

        if (
            !(
                payment.invoiceNumber ||
                invoice.invoiceNumber
            )
        ) {
            warnings.push(
                "Le numéro de facture n'a pas été détecté."
            );
        }

        if (!payment.date) {
            warnings.push(
                "La date du paiement n'a pas été détectée."
            );
        }

        if (
            !/accepte|accepted|succeeded|reussi/i.test(
                normalizeKey(
                    payment.status
                )
            )
        ) {
            warnings.push(
                `Le paiement Yapla n'est pas indiqué comme accepté : ${
                    payment.status ||
                    'statut inconnu'
                }.`
            );
        }

        return warnings;
    }

    function paymentChoiceHtml(
        payments
    ) {
        return payments
            .map(
                (
                    payment,
                    index
                ) => `
                    <label class="ya-option">
                        <input
                            type="radio"
                            name="ya-payment"
                            value="${index}"
                        >

                        <span>
                            <span class="ya-option-title">
                                ${escapeHtml(
                                    payment.date ||
                                    'Date inconnue'
                                )}
                                - Paiement
                                ${escapeHtml(
                                    payment.paymentNumber ||
                                    'inconnu'
                                )}
                            </span>

                            <span class="ya-option-details">
Facture : ${escapeHtml(payment.invoiceNumber || 'inconnue')}
${escapeHtml(payment.method || 'Méthode inconnue')}
${escapeHtml(payment.status || 'Statut inconnu')} - ${escapeHtml(payment.totalText || 'Montant inconnu')}
                            </span>
                        </span>
                    </label>
                `
            )
            .join('');
    }

    function startFromYapla() {
        try {
            const invoice =
                scrapeYaplaInvoice();

            if (
                !invoice.payments.length
            ) {
                showModal({
                    title:
                        'Aucun paiement détecté',

                    bodyHtml: `
                        <div class="ya-warning-box">
                            La section Paiements ne contient
                            aucun paiement exploitable.
                        </div>
                    `,

                    confirmText:
                        'Fermer',

                    onConfirm:
                        removeModal,
                });

                return;
            }

            if (
                invoice.payments.length ===
                1
            ) {
                openStripeForPayment(
                    invoice,
                    invoice.payments[0]
                );

                return;
            }

            const modal =
                showModal({
                    title:
                        'Sélectionnez le paiement',

                    subtitle:
                        `Cette facture contient ${invoice.payments.length} paiements.`,

                    bodyHtml:
                        paymentChoiceHtml(
                            invoice.payments
                        ),

                    confirmText:
                        'Ouvrir Stripe',

                    confirmDisabled:
                        true,

                    onConfirm:
                        ({
                            overlay,
                        }) => {
                            const selected =
                                overlay.querySelector(
                                    'input[name="ya-payment"]:checked'
                                );

                            if (!selected) {
                                return;
                            }

                            openStripeForPayment(
                                invoice,
                                invoice.payments[
                                    Number(
                                        selected.value
                                    )
                                ]
                            );
                        },
                });

            modal.overlay
                .querySelectorAll(
                    'input[name="ya-payment"]'
                )
                .forEach(
                    radio => {
                        radio.addEventListener(
                            'change',
                            () => {
                                modal.confirmButton.disabled =
                                    false;
                            }
                        );
                    }
                );
        } catch (error) {
            console.error(
                '[Attestation Yapla]',
                error
            );

            showModal({
                title:
                    'Erreur de lecture',

                bodyHtml: `
                    <div class="ya-warning-box">
                        ${escapeHtml(
                            error.message ||
                            String(error)
                        )}
                    </div>
                `,

                confirmText:
                    'Fermer',

                onConfirm:
                    removeModal,
            });
        }
    }

    function openStripeForPayment(
        invoice,
        payment
    ) {
        const server =
            location.hostname.startsWith(
                's2.'
            )
                ? 's2'
                : 's1';

        const stripeAccount =
            STRIPE_ACCOUNTS[
                server
            ];

        const selectedPayment = {
            ...payment,

            invoiceNumber:
                payment.invoiceNumber ||
                invoice.invoiceNumber ||
                '',
        };

        const searchUrl =
            `https://dashboard.stripe.com/${stripeAccount}/search?query=` +
            encodeURIComponent(
                selectedPayment
                    .paymentNumber
            );

        const job = {
            version: 1,

            jobId:
                `ytb-ya-${Date.now()}-${Math.random()
                    .toString(36)
                    .slice(2, 8)}`,

            createdAt:
                Date.now(),

            updatedAt:
                Date.now(),

            status:
                'awaitingStripe',

            yaplaOrigin:
                location.origin,

            yaplaUrl:
                location.href,

            stripeAccount,

            stripeSearchUrl:
                searchUrl,

            invoice,
            selectedPayment,

            warnings:
                buildYaplaWarnings(
                    invoice,
                    selectedPayment
                ),

            stripe: null,
        };

        saveJob(job);

        removeModal();

        const stripeWindow =
            window.open(
                searchUrl,
                '_blank'
            );

        /*
         * Do not rely entirely on window.opener.
         * Stripe may isolate the browsing context.
         */
        job.stripeWindowOpened =
            Boolean(stripeWindow);

        saveJob(job);

        renderYaplaStatus(job);
    }

    function renderYaplaStatus(job) {
        const actions = [];

        actions.push({
            label:
                'Ouvrir Stripe',

            href:
                job.selectedStripeUrl ||
                job.stripeSearchUrl,
        });

        if (
            job.status ===
            'stripeDataReady'
        ) {
            actions.push({
                label:
                    'Générer le PDF',

                onClick:
                    () =>
                        showFinalConfirmation(
                            getJob() ||
                            job
                        ),
            });
        }

        actions.push({
            label:
                'Annuler',

            onClick:
                cancelJob,
        });

        const statusText =
            {
                awaitingStripe:
                    'Stripe est ouvert. Dans l’onglet Stripe, ouvre le bookmark Yapla Toolbox puis lance « Attestation de paiement ».',

                stripeSearching:
                    'Stripe analyse actuellement le paiement.',

                stripeDataReady:
                    'Les données Stripe ont été reçues. Le PDF peut maintenant être généré.',

                generatingPdf:
                    'Création du PDF…',

                completed:
                    'PDF généré.',

                error:
                    job.errorMessage ||
                    'Une erreur est survenue.',
            }[job.status] ||
            job.status;

        const box =
            showStatus(
                'Attestation de paiement',
                statusText,
                actions
            );

        if (
            job.status ===
            'awaitingStripe'
        ) {
            const warning =
                document.createElement(
                    'div'
                );

            warning.className =
                'ya-warning';

            warning.innerHTML = `
                <strong>Étape Stripe</strong><br>
                Une fois Stripe ouvert :

                <br><br>

                1. Clique sur ton bookmark Yapla Toolbox.<br>
                2. Choisis « Attestation de paiement ».<br>
                3. Laisse l’onglet Stripe ouvert pendant l’analyse.
            `;

            box.appendChild(
                warning
            );
        }
    }

    function cancelJob() {
        deleteJob();

        document
            .getElementById(
                IDS.status
            )
            ?.remove();

        removeModal();
    }

    /*
     * ============================================================
     * CROSS DOMAIN MESSAGE
     * ============================================================
     */

    function installYaplaMessageListener() {
        if (
            window.__ytbPaymentAttestationMessageListener
        ) {
            return;
        }

        window.__ytbPaymentAttestationMessageListener =
            true;

        window.addEventListener(
            'message',
            event => {
                if (
                    event.origin !==
                    'https://dashboard.stripe.com'
                ) {
                    return;
                }

                const data =
                    event.data;

                if (
                    !data ||
                    data.type !==
                        'ytb-payment-attestation-stripe-result'
                ) {
                    return;
                }

                const job =
                    getJob();

                if (!job) {
                    return;
                }

                if (
                    data.paymentNumber &&
                    String(
                        data.paymentNumber
                    ) !==
                        String(
                            job.selectedPayment
                                .paymentNumber
                        )
                ) {
                    console.warn(
                        '[Attestation Yapla] Résultat Stripe ignoré, mauvais numéro de paiement.'
                    );

                    return;
                }

                job.stripe =
                    data.stripe;

                job.selectedStripeUrl =
                    data.stripe
                        ?.paymentUrl ||
                    '';

                job.warnings =
                    buildStripeWarnings(
                        job,
                        data.stripe
                    );

                job.status =
                    'stripeDataReady';

                job.errorMessage =
                    '';

                saveJob(job);

                renderYaplaStatus(
                    job
                );

                handleStripeDataReady(
                    job
                );
            }
        );

        window.addEventListener(
            'storage',
            event => {
                if (
                    event.key !==
                    STORAGE_KEY ||
                    !event.newValue
                ) {
                    return;
                }

                try {
                    const job =
                        JSON.parse(
                            event.newValue
                        );

                    if (
                        job.invoice
                            ?.billingId ===
                        currentBillingId()
                    ) {
                        renderYaplaStatus(
                            job
                        );
                    }
                } catch {}
            }
        );
    }

    function handleStripeDataReady(
        job
    ) {
        const warnings =
            Array.isArray(
                job.warnings
            )
                ? job.warnings
                : [];

        if (!warnings.length) {
            generateAutomatically(
                job
            );

            return;
        }

        showFinalConfirmation(
            job
        );
    }

    /*
     * ============================================================
     * STRIPE SIDE
     * ============================================================
     */

    async function runOnStripe() {
        const paymentNumber =
            getStripePaymentNumber();

        const stripeAccount =
            getStripeAccount();

        let session =
            getStripeSession();

        if (
            !session ||
            session.paymentNumber !==
                paymentNumber
        ) {
            session = {
                createdAt:
                    Date.now(),

                paymentNumber,

                stripeAccount,
            };

            saveStripeSession(
                session
            );
        }

        if (
            !session.paymentNumber
        ) {
            showStatus(
                'Attestation de paiement',
                'Impossible de déterminer le numéro de paiement. Ouvre d’abord Stripe depuis la facture Yapla.'
            );

            return;
        }

        showStatus(
            'Attestation de paiement',
            `Recherche Stripe pour le paiement ${session.paymentNumber}…`
        );

        if (
            isStripePaymentPage()
        ) {
            await processStripeDetail(
                session
            );

            return;
        }

        await processStripeSearch(
            session
        );
    }

    function getStripePaymentNumber() {
        const query =
            new URLSearchParams(
                location.search
            ).get('query');

        if (query) {
            return cleanText(
                query
            );
        }

        return (
            getStripeSession()
                ?.paymentNumber ||
            ''
        );
    }

    function getStripeAccount() {
        return (
            location.pathname.match(
                /\/(acct_[A-Za-z0-9]+)\//
            )?.[1] ||
            getStripeSession()
                ?.stripeAccount ||
            ''
        );
    }

    function isStripePaymentPage() {
        return /\/payments\/(?:pi|py|ch)_[A-Za-z0-9]+/i.test(
            location.pathname
        );
    }

    async function processStripeSearch(
        session
    ) {
        const results =
            await waitForStripeResults(
                60000
            );

        if (!results.length) {
            showStatus(
                'Paiement Stripe introuvable',
                `Aucun résultat n’a été détecté pour ${session.paymentNumber}.`
            );

            return;
        }

        if (
            results.length === 1
        ) {
            const result =
                results[0];

            session.paymentUrl =
                result.url;

            saveStripeSession(
                session
            );

            /*
             * Prefer SPA click so our toolbox code survives.
             */
            if (
                result.anchor &&
                result.anchor.isConnected
            ) {
                result.anchor.click();

                await waitFor(
                    () =>
                        isStripePaymentPage(),
                    {
                        timeout:
                            15000,
                    }
                ).catch(
                    () => null
                );

                if (
                    isStripePaymentPage()
                ) {
                    await processStripeDetail(
                        session
                    );

                    return;
                }
            }

            /*
             * Fallback.
             *
             * A full navigation can destroy the injected Toolbox.
             * sessionStorage preserves the search data, so the user
             * can simply reopen the Toolbox on the detail page.
             */
            location.href =
                result.url;

            return;
        }

        showStripeSelection(
            results,
            session
        );
    }

    function collectStripeSearchResults() {
        const candidates = [];
        const seen = new Set();

        const anchors =
            [
                ...document.querySelectorAll(
                    'a[href*="/payments/"]'
                ),
            ];

        for (
            const anchor
            of anchors
        ) {
            let url;

            try {
                url =
                    new URL(
                        anchor.getAttribute(
                            'href'
                        ),
                        location.origin
                    ).href;
            } catch {
                continue;
            }

            if (
                !/\/payments\/(?:pi|py|ch)_/i.test(
                    url
                )
            ) {
                continue;
            }

            if (seen.has(url)) {
                continue;
            }

            seen.add(url);

            const container =
                anchor.closest(
                    'tr,[role="row"],li'
                ) ||
                anchor.parentElement;

            const result = {
                url,

                summary:
                    cleanText(
                        container?.innerText ||
                        container
                            ?.textContent ||
                        anchor.textContent
                    ),
            };

            Object.defineProperty(
                result,
                'anchor',
                {
                    value: anchor,
                    enumerable:
                        false,
                }
            );

            candidates.push(
                result
            );
        }

        return candidates;
    }

    async function waitForStripeResults(
        timeout
    ) {
        const started =
            Date.now();

        while (
            Date.now() -
                started <
            timeout
        ) {
            const results =
                collectStripeSearchResults();

            if (results.length) {
                /*
                 * Give React a moment to finish rendering.
                 */
                await delay(350);

                const stable =
                    collectStripeSearchResults();

                return stable.length
                    ? stable
                    : results;
            }

            await delay(250);
        }

        return [];
    }

    function showStripeSelection(
        results,
        session
    ) {
        const html =
            results
                .map(
                    (
                        result,
                        index
                    ) => `
                        <label class="ya-option">
                            <input
                                type="radio"
                                name="ya-stripe-result"
                                value="${index}"
                            >

                            <span>
                                <span class="ya-option-title">
                                    Résultat Stripe ${index + 1}
                                </span>

                                <span class="ya-option-details">
                                    ${escapeHtml(
                                        result.summary ||
                                        result.url
                                    )}
                                </span>
                            </span>
                        </label>
                    `
                )
                .join('');

        const modal =
            showModal({
                title:
                    'Plusieurs paiements Stripe trouvés',

                subtitle:
                    `Choisis le paiement ${session.paymentNumber}.`,

                bodyHtml:
                    html,

                confirmText:
                    'Ouvrir ce paiement',

                confirmDisabled:
                    true,

                onConfirm:
                    ({
                        overlay,
                    }) => {
                        const selected =
                            overlay.querySelector(
                                'input[name="ya-stripe-result"]:checked'
                            );

                        if (!selected) {
                            return;
                        }

                        const result =
                            results[
                                Number(
                                    selected.value
                                )
                            ];

                        session.paymentUrl =
                            result.url;

                        saveStripeSession(
                            session
                        );

                        removeModal();

                        if (
                            result.anchor &&
                            result.anchor
                                .isConnected
                        ) {
                            result.anchor.click();
                        } else {
                            location.href =
                                result.url;
                        }
                    },
            });

        modal.overlay
            .querySelectorAll(
                'input[name="ya-stripe-result"]'
            )
            .forEach(
                radio => {
                    radio.addEventListener(
                        'change',
                        () => {
                            modal.confirmButton.disabled =
                                false;
                        }
                    );
                }
            );
    }

    async function processStripeDetail(
        session
    ) {
        showStatus(
            'Lecture du paiement Stripe',
            'Recherche du total, des frais d’application et du statut…'
        );

        const stripe =
            await waitForStripeDetails(
                session,
                60000
            );

        if (!stripe) {
            showStatus(
                'Lecture Stripe incomplète',
                'Les montants Stripe n’ont pas pu être détectés.'
            );

            return;
        }

        const sent =
            sendStripeResultToYapla(
                session,
                stripe
            );

        if (sent) {
            showStatus(
                'Données Stripe envoyées',
                'Retourne sur la facture Yapla. Le PDF va être généré depuis Yapla.'
            );
        } else {
            showStatus(
                'Retour Yapla requis',
                'L’onglet Yapla d’origine n’est plus accessible. Retourne sur la facture Yapla et relance l’attestation.'
            );
        }
    }

    function findExactTextElements(
        labels
    ) {
        const wanted =
            new Set(
                labels.map(
                    normalizeKey
                )
            );

        return [
            ...document.querySelectorAll(
                'div,span,dt,th,p'
            ),
        ].filter(
            element => {
                const text =
                    normalizeKey(
                        element.textContent
                    );

                return (
                    text &&
                    wanted.has(text) &&
                    element.children
                        .length <= 3
                );
            }
        );
    }

    function extractMoneyNearLabels(
        labels
    ) {
        const labelElements =
            findExactTextElements(
                labels
            );

        for (
            const labelElement
            of labelElements
        ) {
            let container =
                labelElement.parentElement;

            for (
                let depth = 0;
                depth < 6 &&
                container;
                depth += 1,
                container =
                    container.parentElement
            ) {
                const containerText =
                    cleanText(
                        container.innerText ||
                        container.textContent
                    );

                const withoutLabel =
                    containerText
                        .replace(
                            cleanText(
                                labelElement
                                    .textContent
                            ),
                            ' '
                        )
                        .trim();

                const matches =
                    withoutLabel.match(
                        /(?:[$€£]\s*)?[-+]?\d[\d\s.,'’]*(?:\s*(?:CAD|USD|EUR|GBP))?/gi
                    ) || [];

                const parsed =
                    matches
                        .map(parseMoney)
                        .filter(
                            item =>
                                item.amount !==
                                null
                        );

                if (parsed.length) {
                    return (
                        parsed.find(
                            item =>
                                item.currency
                        ) ||
                        parsed[0]
                    );
                }
            }
        }

        return {
            amount: null,
            currency: '',
            original: '',
        };
    }

    function detectStripeStatus() {
        const page =
            normalizeKey(
                document.body
                    .innerText ||
                document.body
                    .textContent
            );

        if (
            page.includes(
                'partially refunded'
            ) ||
            page.includes(
                'partiellement rembourse'
            )
        ) {
            return 'Partiellement remboursé';
        }

        if (
            page.includes(
                'refunded'
            ) ||
            page.includes(
                'rembourse'
            )
        ) {
            return 'Remboursé';
        }

        if (
            page.includes(
                'succeeded'
            ) ||
            page.includes(
                'reussi'
            )
        ) {
            return 'Succeeded';
        }

        if (
            page.includes(
                'failed'
            ) ||
            page.includes(
                'echoue'
            )
        ) {
            return 'Failed';
        }

        return '';
    }

    function scrapeStripeDetails(
        session
    ) {
        const fee =
            extractMoneyNearLabels([
                'Application fee',
                "Frais d'application",
                'Frais d’application',
                "Commission de l'application",
            ]);

        const total =
            extractMoneyNearLabels([
                'Amount details',
                'Détails du montant',
                'Détail du montant',
            ]);

        const status =
            detectStripeStatus();

        const bodyKey =
            normalizeKey(
                document.body
                    .innerText ||
                document.body
                    .textContent
            );

        return {
            paymentUrl:
                location.href,

            paymentIntentId:
                location.pathname.match(
                    /\/payments\/((?:pi|py|ch)_[A-Za-z0-9]+)/
                )?.[1] ||
                '',

            paymentNumber:
                session.paymentNumber,

            feeAmount:
                fee.amount,

            feeText:
                fee.original,

            feeCurrency:
                normalizeCurrency(
                    fee.currency,
                    'CAD'
                ),

            totalAmount:
                total.amount,

            totalText:
                total.original,

            totalCurrency:
                normalizeCurrency(
                    total.currency,
                    fee.currency ||
                    'CAD'
                ),

            status,

            isRefunded:
                /partially refunded|partiellement rembourse|refunded|rembourse/.test(
                    bodyKey
                ),
        };
    }

    async function waitForStripeDetails(
        session,
        timeout
    ) {
        const started =
            Date.now();

        let last = null;

        while (
            Date.now() -
                started <
            timeout
        ) {
            last =
                scrapeStripeDetails(
                    session
                );

            if (
                Number.isFinite(
                    last.feeAmount
                ) &&
                Number.isFinite(
                    last.totalAmount
                )
            ) {
                return last;
            }

            /*
             * If one of the two values is available for >2 sec,
             * return the partial information and let Yapla warn.
             */
            if (
                Number.isFinite(
                    last.feeAmount
                ) ||
                Number.isFinite(
                    last.totalAmount
                )
            ) {
                await delay(2000);

                return scrapeStripeDetails(
                    session
                );
            }

            await delay(250);
        }

        return last;
    }

    function sendStripeResultToYapla(
        session,
        stripe
    ) {
        const payload = {
            type:
                'ytb-payment-attestation-stripe-result',

            paymentNumber:
                session.paymentNumber,

            stripe,
        };

        /*
         * Primary transport.
         */
        try {
            if (
                window.opener &&
                !window.opener.closed
            ) {
                window.opener.postMessage(
                    payload,
                    '*'
                );

                return true;
            }
        } catch (error) {
            console.warn(
                '[Attestation Yapla] postMessage vers opener impossible.',
                error
            );
        }

        return false;
    }

    /*
     * ============================================================
     * WARNINGS
     * ============================================================
     */

    function buildStripeWarnings(
        job,
        stripe
    ) {
        const warnings = [
            ...(job.warnings || []),
        ];

        const invoiceTotal =
            Number(
                job.invoice
                    .invoiceTotal
            );

        const hasFee =
            Number.isFinite(
                stripe.feeAmount
            );

        const hasTotal =
            Number.isFinite(
                stripe.totalAmount
            );

        const fee =
            hasFee
                ? Number(
                    stripe.feeAmount
                )
                : null;

        const total =
            hasTotal
                ? Number(
                    stripe.totalAmount
                )
                : null;

        if (!hasFee) {
            warnings.push(
                "Les frais d'application Stripe n'ont pas été détectés. La contribution volontaire sera indiquée à 0,00."
            );
        }

        if (!hasTotal) {
            warnings.push(
                "Le montant total Stripe n'a pas été détecté. Il sera calculé à partir de la facture et des frais détectés."
            );
        }

        if (
            Number.isFinite(
                invoiceTotal
            ) &&
            hasFee &&
            hasTotal &&
            !nearlyEqual(
                invoiceTotal +
                fee,
                total
            )
        ) {
            warnings.push(
                `Les montants ne concordent pas : facture ${formatMoney(
                    invoiceTotal,
                    job.invoice.currency
                )} + contribution ${formatMoney(
                    fee,
                    stripe.feeCurrency
                )} ≠ total Stripe ${formatMoney(
                    total,
                    stripe.totalCurrency
                )}.`
            );
        }

        if (
            stripe.isRefunded
        ) {
            warnings.push(
                'Le paiement Stripe semble remboursé ou partiellement remboursé.'
            );
        }

        if (
            stripe.status &&
            !/succeeded|reussi/i.test(
                normalizeKey(
                    stripe.status
                )
            )
        ) {
            warnings.push(
                `Le statut Stripe n'est pas « Succeeded/Réussi » : ${stripe.status}.`
            );
        }

        return [
            ...new Set(
                warnings
            ),
        ];
    }

    /*
     * ============================================================
     * PDF CONFIRMATION
     * ============================================================
     */

    function showFinalConfirmation(
        job
    ) {
        if (!job?.stripe) {
            return;
        }

        const warnings =
            job.warnings ||
            buildStripeWarnings(
                job,
                job.stripe
            );

        showModal({
            title:
                "Générer l'attestation PDF",

            subtitle:
                'Toutes les données ont été récupérées.',

            bodyHtml:
                buildConfirmationHtml(
                    job,
                    job.stripe,
                    warnings
                ),

            confirmText:
                'Générer le PDF',

            cancelText:
                'Fermer',

            onConfirm:
                async ({
                    confirmButton,
                }) => {
                    confirmButton.disabled =
                        true;

                    confirmButton.textContent =
                        'Génération…';

                    try {
                        job.status =
                            'generatingPdf';

                        saveJob(job);

                        await ensurePdfLibraries();

                        generatePdf(
                            job,
                            job.stripe,
                            warnings
                        );

                        job.status =
                            'completed';

                        saveJob(job);

                        confirmButton.textContent =
                            'PDF généré';

                        renderYaplaStatus(
                            job
                        );

                        setTimeout(
                            removeModal,
                            300
                        );
                    } catch (error) {
                        console.error(
                            '[Attestation Yapla] PDF',
                            error
                        );

                        job.status =
                            'error';

                        job.errorMessage =
                            error.message ||
                            String(error);

                        saveJob(job);

                        confirmButton.disabled =
                            false;

                        confirmButton.textContent =
                            'Réessayer';

                        renderYaplaStatus(
                            job
                        );
                    }
                },
        });
    }

    async function generateAutomatically(
        job
    ) {
        try {
            job.status =
                'generatingPdf';

            saveJob(job);

            renderYaplaStatus(
                job
            );

            await ensurePdfLibraries();

            generatePdf(
                job,
                job.stripe,
                []
            );

            job.status =
                'completed';

            saveJob(job);

            renderYaplaStatus(
                job
            );
        } catch (error) {
            job.status =
                'error';

            job.errorMessage =
                error.message ||
                String(error);

            saveJob(job);

            renderYaplaStatus(
                job
            );
        }
    }

    function buildConfirmationHtml(
        job,
        stripe,
        warnings
    ) {
        const invoice =
            job.invoice;

        const payment =
            job.selectedPayment;

        const fee =
            Number.isFinite(
                stripe.feeAmount
            )
                ? stripe.feeAmount
                : 0;

        const total =
            Number.isFinite(
                stripe.totalAmount
            )
                ? stripe.totalAmount
                : (
                    Number(
                        invoice.invoiceTotal
                    ) || 0
                ) +
                fee;

        const currency =
            stripe.totalCurrency ||
            stripe.feeCurrency ||
            invoice.currency;

        const warningHtml =
            warnings.length
                ? `
                    <div class="ya-warning-box">
                        <strong>
                            ${warnings.length}
                            avertissement${warnings.length > 1 ? 's' : ''}
                        </strong>

                        <ul>
                            ${warnings
                                .map(
                                    warning =>
                                        `<li>${escapeHtml(warning)}</li>`
                                )
                                .join('')}
                        </ul>
                    </div>
                `
                : `
                    <div class="ya-ok-box">
                        Les données principales concordent.
                    </div>
                `;

        return `
            <dl class="ya-summary">
                <dt>Association</dt>
                <dd>${escapeHtml(invoice.companyName)}</dd>

                <dt>Contributeur</dt>
                <dd>
                    ${escapeHtml(
                        [
                            invoice.contributor.organization,
                            invoice.contributor.firstName,
                            invoice.contributor.lastName,
                            invoice.contributor.email,
                        ]
                            .filter(Boolean)
                            .join(' - ')
                    )}
                </dd>

                <dt>N° de facture</dt>
                <dd>${escapeHtml(payment.invoiceNumber || invoice.invoiceNumber)}</dd>

                <dt>N° de paiement</dt>
                <dd>${escapeHtml(payment.paymentNumber)}</dd>

                <dt>Date</dt>
                <dd>${escapeHtml(payment.date)}</dd>

                <dt>Montant association</dt>
                <dd>${escapeHtml(formatMoney(invoice.invoiceTotal, invoice.currency))}</dd>

                <dt>Contribution volontaire</dt>
                <dd>${escapeHtml(formatMoney(fee, stripe.feeCurrency || invoice.currency))}</dd>

                <dt>Total Stripe</dt>
                <dd>${escapeHtml(formatMoney(total, currency))}</dd>
            </dl>

            ${warningHtml}
        `;
    }

    /*
     * ============================================================
     * PDF
     * ============================================================
     */

    function sanitizePdfText(
        value
    ) {
        return cleanText(value)
            .replace(/[–—]/g, '-')
            .replace(/[“”]/g, '"')
            .replace(/[’]/g, "'");
    }

    function addWrappedText(
        doc,
        text,
        x,
        y,
        maxWidth,
        options = {}
    ) {
        const lines =
            doc.splitTextToSize(
                sanitizePdfText(
                    text
                ),
                maxWidth
            );

        doc.text(
            lines,
            x,
            y,
            options
        );

        const lineHeight =
            (
                doc.getFontSize() *
                0.3528
            ) *
            (
                options.lineHeightFactor ||
                1.2
            );

        return (
            y +
            lines.length *
                lineHeight
        );
    }

    function addPdfPageNumbers(
        doc
    ) {
        const count =
            doc.getNumberOfPages();

        for (
            let page = 1;
            page <= count;
            page += 1
        ) {
            doc.setPage(page);

            doc.setFont(
                'helvetica',
                'normal'
            );

            doc.setFontSize(8);

            doc.setTextColor(
                120,
                120,
                120
            );

            doc.text(
                `Page ${page} / ${count}`,
                198,
                290,
                {
                    align:
                        'right',
                }
            );
        }
    }

    function generatePdf(
        job,
        stripe
    ) {
        const namespace =
            window.jspdf;

        if (
            !namespace?.jsPDF ||
            !namespace.jsPDF.API
                ?.autoTable
        ) {
            throw new Error(
                'jsPDF et AutoTable ne sont pas disponibles.'
            );
        }

        const {
            jsPDF,
        } = namespace;

        const doc =
            new jsPDF({
                orientation:
                    'portrait',

                unit:
                    'mm',

                format:
                    'a4',

                compress:
                    true,
            });

        const invoice =
            job.invoice;

        const payment =
            job.selectedPayment;

        const currency =
            normalizeCurrency(
                stripe.totalCurrency ||
                stripe.feeCurrency ||
                invoice.currency,

                invoice.currency
            );

        const feeAmount =
            Number.isFinite(
                stripe.feeAmount
            )
                ? stripe.feeAmount
                : 0;

        const invoiceTotal =
            Number.isFinite(
                invoice.invoiceTotal
            )
                ? invoice.invoiceTotal
                : invoice.items.reduce(
                    (
                        sum,
                        item
                    ) =>
                        sum +
                        (
                            Number.isFinite(
                                item.amount
                            )
                                ? item.amount
                                : 0
                        ),
                    0
                ) +
                invoice.taxes.reduce(
                    (
                        sum,
                        tax
                    ) =>
                        sum +
                        (
                            Number.isFinite(
                                tax.amount
                            )
                                ? tax.amount
                                : 0
                        ),
                    0
                );

        const totalAmount =
            Number.isFinite(
                stripe.totalAmount
            )
                ? stripe.totalAmount
                : invoiceTotal +
                feeAmount;

        const margin = 12;
        const pageWidth =
            doc.internal.pageSize
                .getWidth();

        const contentWidth =
            pageWidth -
            margin * 2;

        let y = 15;

        doc.setTextColor(
            255,
            123,
            20
        );

        doc.setFont(
            'helvetica',
            'bold'
        );

        doc.setFontSize(22);

        doc.text(
            'Yapla',
            margin,
            y
        );

        doc.setTextColor(
            35,
            35,
            35
        );

        doc.setFontSize(15);

        doc.text(
            'ATTESTATION DE PAIEMENT',
            pageWidth / 2,
            29,
            {
                align:
                    'center',
            }
        );

        doc.setFont(
            'helvetica',
            'normal'
        );

        doc.setFontSize(9.5);

        doc.text(
            `Attestation n° ${sanitizePdfText(
                payment.invoiceNumber ||
                invoice.invoiceNumber ||
                invoice.billingId ||
                ''
            )}`,
            margin,
            42
        );

        doc.text(
            `Date d'émission : ${sanitizePdfText(
                payment.date ||
                invoice.billingDate ||
                ''
            )}`,
            margin,
            48
        );

        doc.setDrawColor(
            145,
            145,
            145
        );

        doc.line(
            margin,
            56,
            pageWidth - margin,
            56
        );

        y = 67;

        doc.setFont(
            'helvetica',
            'bold'
        );

        doc.setFontSize(10);

        doc.text(
            'Bénéficiaire :',
            margin,
            y
        );

        doc.text(
            'Plateforme de collecte :',
            143,
            y
        );

        doc.setFont(
            'helvetica',
            'normal'
        );

        doc.setFontSize(9.5);

        let leftY =
            y + 6;

        leftY =
            addWrappedText(
                doc,
                invoice.companyName,
                margin,
                leftY,
                88
            );

        if (
            invoice.address.address
        ) {
            leftY =
                addWrappedText(
                    doc,
                    invoice.address
                        .address,
                    margin,
                    leftY,
                    88
                );
        }

        const cityLine =
            [
                invoice.address.city,
                invoice.address.state,
                invoice.address.zip,
            ]
                .filter(Boolean)
                .join(', ');

        if (cityLine) {
            leftY =
                addWrappedText(
                    doc,
                    cityLine,
                    margin,
                    leftY,
                    88
                );
        }

        if (
            invoice.address.country
        ) {
            leftY =
                addWrappedText(
                    doc,
                    invoice.address
                        .country,
                    margin,
                    leftY,
                    88
                );
        }

        let rightY =
            y + 6;

        doc.text(
            PLATFORM_ADDRESS.name,
            pageWidth - margin,
            rightY,
            {
                align:
                    'right',
            }
        );

        rightY += 5;

        doc.text(
            PLATFORM_ADDRESS.address,
            pageWidth - margin,
            rightY,
            {
                align:
                    'right',
            }
        );

        rightY += 5;

        doc.text(
            PLATFORM_ADDRESS.city,
            pageWidth - margin,
            rightY,
            {
                align:
                    'right',
            }
        );

        y =
            Math.max(
                leftY,
                rightY + 5
            ) +
            6;

        doc.line(
            margin,
            y,
            pageWidth - margin,
            y
        );

        y += 14;

        doc.setFont(
            'helvetica',
            'bold'
        );

        doc.text(
            'Objet : Attestation de paiement',
            margin,
            y
        );

        y += 15;

        doc.text(
            'Contributeur :',
            margin,
            y
        );

        y += 6;

        doc.setFont(
            'helvetica',
            'normal'
        );

        if (
            invoice.contributor
                .organization
        ) {
            y =
                addWrappedText(
                    doc,
                    invoice.contributor
                        .organization,
                    margin,
                    y,
                    contentWidth
                );
        }

        const contributorName =
            [
                invoice.contributor.lastName,
                invoice.contributor.firstName,
            ]
                .filter(Boolean)
                .join(', ');

        if (contributorName) {
            y =
                addWrappedText(
                    doc,
                    contributorName,
                    margin,
                    y,
                    contentWidth
                );
        }

        if (
            invoice.contributor.email
        ) {
            y =
                addWrappedText(
                    doc,
                    invoice.contributor
                        .email,
                    margin,
                    y,
                    contentWidth
                );
        }

        y += 10;

        doc.setFont(
            'helvetica',
            'bold'
        );

        doc.text(
            'Bénéficiaires :',
            margin,
            y
        );

        y += 7;

        doc.setFont(
            'helvetica',
            'normal'
        );

        const descriptions =
            invoice.items
                .map(
                    item =>
                        item.fullDescription
                )
                .filter(Boolean)
                .join('; ') ||
            'paiement de facture';

        y =
            addWrappedText(
                doc,

                `- ${invoice.companyName} reconnaît avoir reçu la somme de ${formatMoney(
                    invoiceTotal,
                    invoice.currency
                )} pour ${descriptions}.`,

                margin + 6,
                y,
                contentWidth - 6
            );

        y += 3;

        y =
            addWrappedText(
                doc,

                `- Yapla reconnaît avoir reçu une contribution volontaire de ${formatMoney(
                    feeAmount,
                    currency
                )}.`,

                margin + 6,
                y,
                contentWidth - 6
            );

        y += 11;

        doc.setFont(
            'helvetica',
            'bold'
        );

        doc.text(
            'Récapitulatif de votre paiement :',
            margin,
            y
        );

        y += 5;

        const tableRows = [];

        for (
            const item
            of invoice.items
        ) {
            tableRows.push([
                sanitizePdfText(
                    item.fullDescription ||
                    item.description ||
                    'Transaction'
                ),

                formatMoney(
                    Number.isFinite(
                        item.amount
                    )
                        ? item.amount
                        : 0,
                    invoice.currency
                ),
            ]);
        }

        for (
            const tax
            of invoice.taxes
        ) {
            tableRows.push([
                sanitizePdfText(
                    tax.label
                ),

                formatMoney(
                    Number.isFinite(
                        tax.amount
                    )
                        ? tax.amount
                        : 0,
                    invoice.currency
                ),
            ]);
        }

        tableRows.push([
            'Contribution volontaire Yapla',

            formatMoney(
                feeAmount,
                currency
            ),
        ]);

        tableRows.push([
            {
                content:
                    'Total',

                styles: {
                    fontStyle:
                        'bold',
                    halign:
                        'right',
                },
            },

            formatMoney(
                totalAmount,
                currency
            ),
        ]);

        doc.autoTable({
            startY: y,

            margin: {
                left:
                    margin,

                right:
                    margin,

                bottom:
                    16,
            },

            head: [
                [
                    'Type de transaction',
                    'Total',
                ],
            ],

            body:
                tableRows,

            theme:
                'grid',

            styles: {
                font:
                    'helvetica',

                fontSize:
                    8.7,

                textColor:
                    [
                        35,
                        35,
                        35,
                    ],

                cellPadding:
                    2.5,

                lineColor:
                    [
                        70,
                        70,
                        70,
                    ],

                lineWidth:
                    0.25,

                overflow:
                    'linebreak',
            },

            headStyles: {
                fillColor:
                    [
                        255,
                        255,
                        255,
                    ],

                textColor:
                    [
                        25,
                        25,
                        25,
                    ],

                fontStyle:
                    'bold',
            },

            columnStyles: {
                0: {
                    cellWidth:
                        contentWidth -
                        42,
                },

                1: {
                    cellWidth:
                        42,

                    halign:
                        'right',
                },
            },
        });

        addPdfPageNumbers(
            doc
        );

        const contributorFileName =
            invoice.contributor
                .organization ||
            [
                invoice.contributor
                    .firstName,

                invoice.contributor
                    .lastName,
            ]
                .filter(Boolean)
                .join(' ') ||
            invoice.companyName;

        const fileName =
            `Attestation de paiement - ` +
            `${safeFilePart(
                payment.invoiceNumber ||
                invoice.invoiceNumber ||
                invoice.billingId
            )} - ` +
            `${safeFilePart(
                contributorFileName
            )}.pdf`;

        doc.save(
            fileName
        );
    }

    /*
     * ============================================================
     * WAIT
     * ============================================================
     */

    function waitFor(
        getter,
        options = {}
    ) {
        const timeout =
            options.timeout ??
            30000;

        const interval =
            options.interval ??
            100;

        const started =
            Date.now();

        return new Promise(
            (resolve, reject) => {
                const tick = () => {
                    try {
                        const result =
                            getter();

                        if (result) {
                            resolve(
                                result
                            );

                            return;
                        }
                    } catch {}

                    if (
                        Date.now() -
                            started >=
                        timeout
                    ) {
                        reject(
                            new Error(
                                options.message ||
                                'Délai dépassé.'
                            )
                        );

                        return;
                    }

                    setTimeout(
                        tick,
                        interval
                    );
                };

                tick();
            }
        );
    }
})();
