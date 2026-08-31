(() => {
    'use strict';

    const TOOL_ID = 'payment-attestation';

    const STORAGE_KEY =
        'yapla_toolbox_payment_attestation_job_v2';

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

    const IDS = {
        style: 'ytb-pa-style',
        modal: 'ytb-pa-modal',
        status: 'ytb-pa-status',
    };

    window.YaplaToolbox.registerTool({
        id: TOOL_ID,
        name: 'Attestation de paiement',
        category: 'Comptabilité',
        icon: '🧾',
        description:
            'Générer une attestation de paiement à partir de Yapla et Stripe.',

        async run() {
            if (!isInvoicePage()) {
                alert(
                    'Lance cet outil depuis une facture Yapla.'
                );
                return;
            }

            installStyles();
            installStripeResultListener();

            const existing =
                getJob();

         if (
                existing &&
                existing.invoice?.billingId ===
                    currentBillingId() &&
                ![
                    'completed',
                    'cancelled',
                ].includes(existing.status)
            ) {
                if (
                    existing.status ===
                    'stripeDataReady'
                ) {
                    processStripeResult(existing);
                    return;
                }
            
                // Ancienne tâche incomplète : on la supprime
                // et on recommence proprement.
                deleteJob();
            }

            start();
        },
    });

    // ============================================================
    // ENVIRONMENT
    // ============================================================

    function isInvoicePage() {
        return (
            /^s[12]\.yapla\.com$/i.test(
                location.hostname
            ) &&
            /\/accounting\/[^/]+\/billing\/view\/billingId\//i.test(
                location.pathname
            )
        );
    }

    function currentBillingId() {
        return (
            location.pathname.match(
                /billingId\/(\d+)/i
            )?.[1] || ''
        );
    }

    // ============================================================
    // STORAGE
    // ============================================================

    function getJob() {
        try {
            return JSON.parse(
                localStorage.getItem(
                    STORAGE_KEY
                ) || 'null'
            );
        } catch {
            return null;
        }
    }

    function saveJob(job) {
        job.updatedAt =
            Date.now();

        localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify(job)
        );
    }

    function deleteJob() {
        localStorage.removeItem(
            STORAGE_KEY
        );
    }

    // ============================================================
    // GENERIC
    // ============================================================

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
            .replace(
                /[\u0300-\u036f]/g,
                ''
            )
            .replace(/[°º]/g, '')
            .replace(/[’']/g, '')
            .replace(
                /[^a-zA-Z0-9]+/g,
                ' '
            )
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
            .replace(
                /[\\/:*?"<>|]+/g,
                '-'
            )
            .slice(0, 90)
            .trim() || 'document';
    }

    function textOf(
        selector,
        root = document
    ) {
        return cleanText(
            root.querySelector(selector)
                ?.textContent || ''
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

        const match =
            original.match(
                /[-+]?\d[\d\s.,'’]*/
            );

        if (!match) {
            return {
                amount: null,
                currency:
                    currencyCode ||
                    symbol,
                original,
            };
        }

        let raw =
            match[0].replace(
                /[\s'’]/g,
                ''
            );

        const comma =
            raw.lastIndexOf(',');

        const dot =
            raw.lastIndexOf('.');

        if (
            comma !== -1 &&
            dot !== -1
        ) {
            const decimal =
                comma > dot
                    ? ','
                    : '.';

            const thousands =
                decimal === ','
                    ? '.'
                    : ',';

            raw =
                raw
                    .split(thousands)
                    .join('');

            if (decimal === ',') {
                raw =
                    raw.replace(
                        ',',
                        '.'
                    );
            }
        } else if (
            comma !== -1
        ) {
            const decimals =
                raw.length -
                comma -
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
            dot !== -1
        ) {
            const decimals =
                raw.length -
                dot -
                1;

            if (
                decimals !== 1 &&
                decimals !== 2
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
                Number.isFinite(
                    amount
                )
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
        const valueClean =
            cleanText(value)
                .toUpperCase();

        if (
            /^[A-Z]{3}$/.test(
                valueClean
            )
        ) {
            return valueClean;
        }

        if (valueClean === '$') {
            return fallback;
        }

        if (valueClean === '€') {
            return 'EUR';
        }

        if (valueClean === '£') {
            return 'GBP';
        }

        return fallback;
    }

    function formatMoney(
        amount,
        currency = 'CAD'
    ) {
        const number =
            Number(amount);

        const safeAmount =
            Number.isFinite(number)
                ? number
                : 0;

        const safeCurrency =
            normalizeCurrency(
                currency
            );

        try {
            return new Intl.NumberFormat(
                'fr-CA',
                {
                    style:
                        'currency',

                    currency:
                        safeCurrency,

                    minimumFractionDigits:
                        2,

                    maximumFractionDigits:
                        2,
                }
            )
                .format(safeAmount)
                .replace(
                    /\u00a0/g,
                    ' '
                );
        } catch {
            return (
                safeAmount.toFixed(
                    2
                ) +
                ' ' +
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

    // ============================================================
    // STYLE
    // ============================================================

    function installStyles() {
        if (
            document.getElementById(
                IDS.style
            )
        ) {
            return;
        }

        const style =
            document.createElement(
                'style'
            );

        style.id =
            IDS.style;

        style.textContent = `
            #${IDS.modal} {
                position: fixed;
                inset: 0;
                z-index: 2147483646;
                display: flex;
                align-items: center;
                justify-content: center;
                background: rgba(15,23,42,.55);
                padding: 20px;
                font-family: Arial,sans-serif;
            }

            #${IDS.modal} .card {
                width: min(720px,100%);
                max-height: 85vh;
                overflow: auto;
                background: white;
                border-radius: 12px;
                box-shadow: 0 20px 60px rgba(0,0,0,.3);
            }

            #${IDS.modal} .head {
                padding: 18px 20px;
                border-bottom: 1px solid #e5e7eb;
            }

            #${IDS.modal} h2 {
                margin: 0;
                font-size: 20px;
            }

            #${IDS.modal} .body {
                padding: 18px 20px;
            }

            #${IDS.modal} .actions {
                display: flex;
                justify-content: flex-end;
                gap: 10px;
                padding: 14px 20px;
                border-top: 1px solid #e5e7eb;
            }

            #${IDS.modal} button,
            #${IDS.status} button {
                border: 1px solid #d1d5db;
                border-radius: 7px;
                padding: 9px 13px;
                background: #fff;
                cursor: pointer;
                font-weight: 700;
            }

            #${IDS.modal} .primary {
                background: #ff7b14;
                border-color: #ff7b14;
                color: white;
            }

            #${IDS.modal} .option {
                display: block;
                padding: 13px;
                margin-bottom: 10px;
                border: 1px solid #dbe1e8;
                border-radius: 8px;
                cursor: pointer;
            }

            #${IDS.modal} .option:hover {
                border-color: #ff7b14;
            }

            #${IDS.modal} .details {
                display: block;
                margin: 5px 0 0 25px;
                color: #64748b;
                font-size: 13px;
                line-height: 1.5;
            }

            #${IDS.modal} .warning {
                padding: 12px;
                border: 1px solid #f59e0b;
                background: #fffbeb;
                border-radius: 8px;
                margin-top: 15px;
            }

            #${IDS.status} {
                position: fixed;
                right: 20px;
                bottom: 20px;
                z-index: 2147483645;
                width: min(430px,calc(100vw - 40px));
                background: white;
                border: 1px solid #dbe1e8;
                border-radius: 10px;
                padding: 15px;
                box-shadow: 0 14px 40px rgba(0,0,0,.22);
                font: 14px/1.45 Arial,sans-serif;
            }

            #${IDS.status} strong {
                display: block;
                margin-bottom: 5px;
            }
        `;

        document.head.appendChild(
            style
        );
    }

    // ============================================================
    // MODAL
    // ============================================================

    function removeModal() {
        document
            .getElementById(
                IDS.modal
            )
            ?.remove();
    }

    function showModal({
        title,
        body,
        confirmText =
            'Continuer',
        onConfirm,
    }) {
        removeModal();

        const modal =
            document.createElement(
                'div'
            );

        modal.id =
            IDS.modal;

        modal.innerHTML = `
            <div class="card">
                <div class="head">
                    <h2>
                        ${escapeHtml(title)}
                    </h2>
                </div>

                <div class="body">
                    ${body}
                </div>

                <div class="actions">
                    <button class="cancel">
                        Annuler
                    </button>

                    <button class="primary confirm">
                        ${escapeHtml(confirmText)}
                    </button>
                </div>
            </div>
        `;

        document.body.appendChild(
            modal
        );

        modal
            .querySelector(
                '.cancel'
            )
            .onclick =
            removeModal;

        modal
            .querySelector(
                '.confirm'
            )
            .onclick =
            () =>
                onConfirm?.(
                    modal
                );

        return modal;
    }

    function showStatus(
        message
    ) {
        let box =
            document.getElementById(
                IDS.status
            );

        if (!box) {
            box =
                document.createElement(
                    'div'
                );

            box.id =
                IDS.status;

            document.body.appendChild(
                box
            );
        }

        box.innerHTML = `
            <strong>
                Attestation de paiement
            </strong>

            <div>
                ${escapeHtml(message)}
            </div>
        `;
    }

    // ============================================================
    // YAPLA SCRAPE
    // ============================================================

    function readYaplaConfig() {
        try {
            return JSON.parse(
                document.querySelector(
                    '#js-config'
                )?.textContent ||
                    '{}'
            );
        } catch {
            return {};
        }
    }

    function readInvoiceNumber() {
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
                    /(?:facture|invoice)\s*(?:n(?:o|umero)?|number)?\s*[°º#.:_-]*\s*(\d{3,})/i
                );

            if (match) {
                return match[1];
            }
        }

        return '';
    }

    function scrapePayments(
        invoiceNumber
    ) {
        const table =
            [
                ...document.querySelectorAll(
                    '#payment_info table'
                ),
            ].find(
                element =>
                    element.querySelector(
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
                cell =>
                    normalizeKey(
                        cell.getAttribute(
                            'aria-label'
                        ) ||
                        cell.textContent
                    )
            );

        const findIndex =
            (
                alternatives,
                fallback
            ) => {
                const index =
                    headers.findIndex(
                        header =>
                            alternatives.some(
                                alternative =>
                                    header.includes(
                                        alternative
                                    )
                            )
                    );

                return index >= 0
                    ? index
                    : fallback;
            };

        const indexes = {
            date:
                findIndex(
                    [
                        'date du paiement',
                        'payment date',
                    ],
                    0
                ),

            invoice:
                findIndex(
                    [
                        'n de facture',
                        'numero de facture',
                        'invoice number',
                    ],
                    2
                ),

            payment:
                findIndex(
                    [
                        'n de paiement',
                        'numero de paiement',
                        'payment number',
                    ],
                    3
                ),

            method:
                findIndex(
                    [
                        'methode de paiement',
                        'payment method',
                    ],
                    4
                ),

            thirdParty:
                findIndex(
                    [
                        'info de paiement tiers',
                        'third party payment',
                    ],
                    5
                ),

            status:
                findIndex(
                    [
                        'statut',
                        'status',
                    ],
                    6
                ),

            total:
                findIndex(
                    [
                        'montant total',
                        'total amount',
                    ],
                    7
                ),
        };

        const read =
            (cells, index) =>
                cleanText(
                    cells[index]
                        ?.textContent ||
                        ''
                );

        return [
            ...table.querySelectorAll(
                'tbody tr'
            ),
        ]
            .map(
                (
                    row,
                    rowIndex
                ) => {
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

                    const paymentId =
                        paymentLink
                            ?.getAttribute(
                                'href'
                            )
                            ?.match(
                                /paymentId\/(\d+)/i
                            )?.[1] ||
                        '';

                    const totalText =
                        read(
                            cells,
                            indexes.total
                        );

                    return {
                        rowIndex,

                        date:
                            read(
                                cells,
                                indexes.date
                            ),

                        invoiceNumber:
                            read(
                                cells,
                                indexes.invoice
                            ) ||
                            invoiceNumber,

                        paymentNumber:
                            read(
                                cells,
                                indexes.payment
                            ) ||
                            paymentId,

                        method:
                            read(
                                cells,
                                indexes.method
                            ),

                        thirdParty:
                            read(
                                cells,
                                indexes.thirdParty
                            ),

                        status:
                            read(
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
                    payment.paymentNumber
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

            const first =
                cleanText(
                    cells[0]
                        .textContent
                );

            const amountText =
                cleanText(
                    cells.at(-1)
                        ?.textContent ||
                    ''
                );

            const isGroup =
                cells[0]
                    .classList
                    .contains(
                        'table-description-subtitle'
                    ) ||
                (
                    first &&
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
                    first;
                continue;
            }

            const amount =
                parseMoney(
                    amountText
                ).amount;

            if (
                !first &&
                amount === null
            ) {
                continue;
            }

            items.push({
                group:
                    currentGroup,

                description:
                    first,

                fullDescription:
                    [
                        currentGroup,
                        first,
                    ]
                        .filter(Boolean)
                        .join(' - ') ||
                    'Transaction',

                amount,
                amountText,
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

                    const value =
                        cleanText(
                            row.querySelector(
                                '.billing-tax-value'
                            )
                                ?.textContent ||
                            ''
                        );

                    return {
                        label,

                        amount:
                            parseMoney(
                                value
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
            totalElement?.dataset
                .bill
                ? Number(
                    totalElement
                        .dataset
                        .bill
                )
                : parseMoney(
                    totalElement
                        ?.textContent ||
                    ''
                ).amount;

        return {
            items,
            taxes,
            subtotal,
            invoiceTotal,
        };
    }

    function scrapeInvoice() {
        const config =
            readYaplaConfig();

        const lines =
            scrapeInvoiceLines();

        const invoiceNumber =
            readInvoiceNumber();

        const currency =
            normalizeCurrency(
                config.companyCurrency ||
                    'CAD'
            );

        return {
            sourceUrl:
                location.href,

            billingId:
                currentBillingId(),

            invoiceNumber,

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

    // ============================================================
    // START
    // ============================================================

    function start() {
        const invoice =
            scrapeInvoice();

        if (
            !invoice.payments.length
        ) {
            alert(
                'Aucun paiement détecté sur cette facture.'
            );
            return;
        }

        if (
            invoice.payments.length ===
            1
        ) {
            openStripe(
                invoice,
                invoice.payments[0]
            );

            return;
        }

        choosePayment(
            invoice
        );
    }

    function choosePayment(invoice) {
        const html =
            invoice.payments
                .map(
                    (
                        payment,
                        index
                    ) => `
                        <label class="option">
                            <input
                                type="radio"
                                name="ytb-pa-payment"
                                value="${index}"
                            >

                            <strong>
                                ${escapeHtml(
                                    payment.date ||
                                    'Date inconnue'
                                )}
                                -
                                Paiement
                                ${escapeHtml(
                                    payment.paymentNumber
                                )}
                            </strong>

                            <span class="details">
                                Facture :
                                ${escapeHtml(
                                    payment.invoiceNumber ||
                                    invoice.invoiceNumber
                                )}
                                <br>

                                ${escapeHtml(
                                    payment.method ||
                                    ''
                                )}

                                ${payment.thirdParty
                                    ? ` - ${escapeHtml(
                                        payment.thirdParty
                                    )}`
                                    : ''
                                }

                                <br>

                                ${escapeHtml(
                                    payment.status ||
                                    ''
                                )}
                                -
                                ${escapeHtml(
                                    payment.totalText ||
                                    ''
                                )}
                            </span>
                        </label>
                    `
                )
                .join('');

        showModal({
            title:
                'Choisir le paiement',

            body:
                html,

            confirmText:
                'Ouvrir Stripe',

            onConfirm(modal) {
                const selected =
                    modal.querySelector(
                        'input[name="ytb-pa-payment"]:checked'
                    );

                if (!selected) {
                    alert(
                        'Choisis un paiement.'
                    );
                    return;
                }

                removeModal();

                openStripe(
                    invoice,
                    invoice.payments[
                        Number(
                            selected.value
                        )
                    ]
                );
            },
        });
    }

    // ============================================================
    // OPEN STRIPE
    // ============================================================

    function openStripe(
        invoice,
        payment
    ) {
        const server =
            location.hostname
                .startsWith(
                    's2.'
                )
                ? 's2'
                : 's1';

        const stripeAccount =
            STRIPE_ACCOUNTS[
                server
            ];

        const paymentNumber =
            String(
                payment.paymentNumber ||
                ''
            );

        const stripeSearchUrl =
            `https://dashboard.stripe.com/${stripeAccount}/search?query=` +
            encodeURIComponent(
                paymentNumber
            );

        const job = {
            version: 2,

            jobId:
                `ytb-pa-${Date.now()}-${Math.random()
                    .toString(36)
                    .slice(2, 8)}`,

            createdAt:
                Date.now(),

            updatedAt:
                Date.now(),

            status:
                'awaitingStripe',

            stripeAccount,
            stripeSearchUrl,

            invoice,

            selectedPayment: {
                ...payment,

                invoiceNumber:
                    payment.invoiceNumber ||
                    invoice.invoiceNumber,
            },

            stripe:
                null,

            warnings:
                [],
        };

        saveJob(job);

        showStatus(
            `Stripe ouvert pour le paiement ${paymentNumber}. ` +
            `Clique maintenant le même bookmarklet dans l'onglet Stripe.`
        );

        /*
         * IMPORTANT:
         * pas de noopener.
         *
         * Le bookmarklet Stripe renverra ensuite
         * le résultat avec window.opener.postMessage().
         */
        const stripeWindow =
            window.open(
                stripeSearchUrl,
                '_blank'
            );

        if (!stripeWindow) {
            job.status =
                'error';

            saveJob(job);

            alert(
                'Le navigateur a bloqué l’ouverture de Stripe.'
            );
        }
    }

    // ============================================================
    // STRIPE RESULT
    // ============================================================

    function installStripeResultListener() {
    if (
        window.__ytbPaymentAttestationV2Listener
    ) {
        return;
    }

    window.__ytbPaymentAttestationV2Listener =
        true;

    const receiveStripeResult =
        data => {
            if (
                !data ||
                data.type !==
                    'YTB_PAYMENT_ATTESTATION_STRIPE_RESULT'
            ) {
                return;
            }

            const job =
                getJob();

            if (!job) {
                console.warn(
                    '[Attestation] Aucun job Yapla actif.'
                );
                return;
            }

            if (
                data.paymentNumber &&
                String(
                    data.paymentNumber
                ) !==
                    String(
                        job
                            .selectedPayment
                            .paymentNumber
                    )
            ) {
                console.warn(
                    '[Attestation] Le numéro de paiement Stripe ne correspond pas.'
                );
                return;
            }

            if (!data.stripe) {
                return;
            }

            job.stripe =
                data.stripe;

            job.status =
                'stripeDataReady';

            job.warnings =
                buildWarnings(
                    job
                );

            saveJob(job);

            processStripeResult(
                job
            );
        };

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

            /*
             * Stripe crée ce canal AVANT
             * d'ouvrir la fiche paiement.
             */
            if (
                data?.source ===
                    'yapla-toolbox-stripe' &&
                data?.type ===
                    'YTB_PAYMENT_ATTESTATION_CHANNEL'
            ) {
                const port =
                    event.ports?.[0];

                if (!port) {
                    console.warn(
                        '[Attestation] MessageChannel absent.'
                    );
                    return;
                }

                window.__ytbPaymentAttestationStripePort =
                    port;

                port.onmessage =
                    portEvent => {
                        receiveStripeResult(
                            portEvent.data
                        );
                    };

                port.start?.();

                console.log(
                    '[Attestation] Canal Stripe connecté.'
                );

                return;
            }

            /*
             * Fallback si window.opener
             * fonctionne encore.
             */
            if (
                data?.source ===
                    'yapla-toolbox-stripe'
            ) {
                receiveStripeResult(
                    data
                );
            }
        }
    );
}

    function buildWarnings(job) {
        const warnings = [];

        const invoice =
            job.invoice;

        const payment =
            job.selectedPayment;

        const stripe =
            job.stripe;

        if (
            !Number.isFinite(
                Number(
                    invoice.invoiceTotal
                )
            )
        ) {
            warnings.push(
                'Le total Yapla n’a pas été détecté.'
            );
        }

        if (
            !Number.isFinite(
                Number(
                    stripe.totalAmount
                )
            )
        ) {
            warnings.push(
                'Le total Stripe n’a pas été détecté.'
            );
        }

        if (
            !Number.isFinite(
                Number(
                    stripe.feeAmount
                )
            )
        ) {
            warnings.push(
                "Les frais d'application Stripe n'ont pas été détectés."
            );
        }

        const invoiceTotal =
            Number(
                invoice.invoiceTotal
            );

        const total =
            Number(
                stripe.totalAmount
            );

        const fee =
            Number(
                stripe.feeAmount
            );

        if (
            Number.isFinite(
                invoiceTotal
            ) &&
            Number.isFinite(total) &&
            Number.isFinite(fee) &&
            !nearlyEqual(
                invoiceTotal +
                    fee,
                total
            )
        ) {
            warnings.push(
                `Les montants ne concordent pas : ` +
                `${formatMoney(
                    invoiceTotal,
                    invoice.currency
                )} + ` +
                `${formatMoney(
                    fee,
                    stripe.feeCurrency ||
                    invoice.currency
                )} ≠ ` +
                `${formatMoney(
                    total,
                    stripe.totalCurrency ||
                    invoice.currency
                )}.`
            );
        }

        if (
            stripe.isRefunded
        ) {
            warnings.push(
                `Le paiement Stripe est remboursé ou partiellement remboursé${
                    stripe.amountRefunded
                        ? ` (${formatMoney(
                            stripe.amountRefunded,
                            stripe.totalCurrency ||
                            invoice.currency
                        )})`
                        : ''
                }.`
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
                `Statut Stripe : ${stripe.status}.`
            );
        }

        if (
            payment.status &&
            !/accepte|accepted|succeeded|reussi/i.test(
                normalizeKey(
                    payment.status
                )
            )
        ) {
            warnings.push(
                `Statut Yapla : ${payment.status}.`
            );
        }

        return [
            ...new Set(
                warnings
            ),
        ];
    }

    function processStripeResult(
        job
    ) {
        if (
            !job?.stripe
        ) {
            return;
        }

        if (
            !job.warnings
                ?.length
        ) {
            generateAutomatically(
                job
            );

            return;
        }

        const warningHtml =
            job.warnings
                .map(
                    warning =>
                        `<li>${escapeHtml(
                            warning
                        )}</li>`
                )
                .join('');

        showModal({
            title:
                'Données Stripe récupérées',

            body: `
                <div>
                    <strong>
                        Total Stripe :
                    </strong>
                    ${escapeHtml(
                        formatMoney(
                            job.stripe
                                .totalAmount,
                            job.stripe
                                .totalCurrency ||
                            job.invoice
                                .currency
                        )
                    )}
                </div>

                <div>
                    <strong>
                        Contribution Yapla :
                    </strong>
                    ${escapeHtml(
                        formatMoney(
                            job.stripe
                                .feeAmount,
                            job.stripe
                                .feeCurrency ||
                            job.invoice
                                .currency
                        )
                    )}
                </div>

                <div class="warning">
                    <strong>
                        Vérification requise
                    </strong>

                    <ul>
                        ${warningHtml}
                    </ul>
                </div>
            `,

            confirmText:
                'Générer le PDF',

            async onConfirm() {
                removeModal();

                await generateJobPdf(
                    job
                );
            },
        });
    }

    async function generateAutomatically(
        job
    ) {
        showStatus(
            'Données Stripe reçues. Génération du PDF…'
        );

        await generateJobPdf(
            job
        );
    }

    // ============================================================
    // PDF LIBRARIES
    // ============================================================

    async function loadScript(
        src,
        id
    ) {
        if (
            document.getElementById(
                id
            )
        ) {
            return;
        }

        await new Promise(
            (
                resolve,
                reject
            ) => {
                const script =
                    document.createElement(
                        'script'
                    );

                script.id =
                    id;

                script.src =
                    src;

                script.onload =
                    resolve;

                script.onerror =
                    () =>
                        reject(
                            new Error(
                                `Impossible de charger ${src}`
                            )
                        );

                document.head.appendChild(
                    script
                );
            }
        );
    }

    async function ensurePdfLibraries() {
        if (
            !window.jspdf
                ?.jsPDF
        ) {
            await loadScript(
                PDF_URL,
                'ytb-pa-jspdf'
            );
        }

        if (
            !window.jspdf
                ?.jsPDF
                ?.API
                ?.autoTable
        ) {
            await loadScript(
                AUTOTABLE_URL,
                'ytb-pa-autotable'
            );
        }

        if (
            !window.jspdf
                ?.jsPDF
                ?.API
                ?.autoTable
        ) {
            throw new Error(
                'jsPDF AutoTable indisponible.'
            );
        }
    }

    async function generateJobPdf(
        job
    ) {
        try {
            job.status =
                'generatingPdf';

            saveJob(job);

            showStatus(
                'Génération du PDF…'
            );

            await ensurePdfLibraries();

            generatePdf(
                job
            );

            job.status =
                'completed';

            saveJob(job);

            showStatus(
                'PDF généré.'
            );
        } catch (error) {
            console.error(
                '[Attestation PDF]',
                error
            );

            job.status =
                'error';

            job.error =
                error.message ||
                String(error);

            saveJob(job);

            showStatus(
                `Erreur PDF : ${job.error}`
            );
        }
    }

    // ============================================================
    // PDF
    // ============================================================

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
        width
    ) {
        const lines =
            doc.splitTextToSize(
                sanitizePdfText(
                    text
                ),
                width
            );

        doc.text(
            lines,
            x,
            y
        );

        return (
            y +
            lines.length *
                4.5
        );
    }

    function generatePdf(job) {
        const {
            jsPDF,
        } =
            window.jspdf;

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

        const stripe =
            job.stripe;

        const invoiceTotal =
            Number.isFinite(
                Number(
                    invoice.invoiceTotal
                )
            )
                ? Number(
                    invoice.invoiceTotal
                )
                : 0;

        const fee =
            Number.isFinite(
                Number(
                    stripe.feeAmount
                )
            )
                ? Number(
                    stripe.feeAmount
                )
                : 0;

        const total =
            Number.isFinite(
                Number(
                    stripe.totalAmount
                )
            )
                ? Number(
                    stripe.totalAmount
                )
                : invoiceTotal +
                    fee;

        const currency =
            normalizeCurrency(
                stripe.totalCurrency ||
                    stripe.feeCurrency ||
                    invoice.currency
            );

        const margin = 12;

        const width =
            doc.internal
                .pageSize
                .getWidth();

        const contentWidth =
            width -
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

        doc.setFontSize(
            22
        );

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

        doc.setFontSize(
            15
        );

        doc.text(
            'ATTESTATION DE PAIEMENT',
            width / 2,
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

        doc.setFontSize(
            9.5
        );

        doc.text(
            `Attestation n° ${sanitizePdfText(
                payment.invoiceNumber ||
                    invoice.invoiceNumber ||
                    invoice.billingId
            )}`,
            margin,
            42
        );

        doc.text(
            `Date d'émission : ${sanitizePdfText(
                payment.date ||
                    invoice.billingDate
            )}`,
            margin,
            48
        );

        doc.line(
            margin,
            56,
            width - margin,
            56
        );

        y = 67;

        doc.setFont(
            'helvetica',
            'bold'
        );

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

        const city =
            [
                invoice.address.city,
                invoice.address.state,
                invoice.address.zip,
            ]
                .filter(Boolean)
                .join(', ');

        if (city) {
            leftY =
                addWrappedText(
                    doc,
                    city,
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

        doc.text(
            PLATFORM_ADDRESS.name,
            width - margin,
            y + 6,
            {
                align:
                    'right',
            }
        );

        doc.text(
            PLATFORM_ADDRESS.address,
            width - margin,
            y + 11,
            {
                align:
                    'right',
            }
        );

        doc.text(
            PLATFORM_ADDRESS.city,
            width - margin,
            y + 16,
            {
                align:
                    'right',
            }
        );

        y =
            Math.max(
                leftY,
                y + 22
            ) +
            5;

        doc.line(
            margin,
            y,
            width - margin,
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

        y += 14;

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

        const contributor =
            [
                invoice.contributor
                    .organization,

                [
                    invoice.contributor
                        .lastName,
                    invoice.contributor
                        .firstName,
                ]
                    .filter(Boolean)
                    .join(', '),

                invoice.contributor
                    .email,
            ].filter(Boolean);

        for (
            const line
            of contributor
        ) {
            y =
                addWrappedText(
                    doc,
                    line,
                    margin,
                    y,
                    contentWidth
                );
        }

        y += 7;

        doc.setFont(
            'helvetica',
            'bold'
        );

        doc.text(
            'Date du paiement :',
            margin,
            y
        );

        doc.setFont(
            'helvetica',
            'normal'
        );

        doc.text(
            sanitizePdfText(
                payment.date ||
                    invoice.billingDate
            ),
            48,
            y
        );

        y += 6;

        doc.setFont(
            'helvetica',
            'bold'
        );

        doc.text(
            'Mode de versement :',
            margin,
            y
        );

        doc.setFont(
            'helvetica',
            'normal'
        );

        doc.text(
            /carte|card|credit/i.test(
                normalizeKey(
                    payment.method
                )
            )
                ? 'Carte bancaire'
                : sanitizePdfText(
                    payment.method ||
                        'Non indiqué'
                ),
            51,
            y
        );

        y += 14;

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
                    fee,
                    currency
                )}.`,
                margin + 6,
                y,
                contentWidth - 6
            );

        y += 10;

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

        const rows = [];

        for (
            const item
            of invoice.items
        ) {
            rows.push([
                sanitizePdfText(
                    item.fullDescription ||
                        'Transaction'
                ),

                formatMoney(
                    item.amount,
                    invoice.currency
                ),
            ]);
        }

        for (
            const tax
            of invoice.taxes
        ) {
            rows.push([
                sanitizePdfText(
                    tax.label
                ),

                formatMoney(
                    tax.amount,
                    invoice.currency
                ),
            ]);
        }

        rows.push([
            'Contribution volontaire Yapla',

            formatMoney(
                fee,
                currency
            ),
        ]);

        rows.push([
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
                total,
                currency
            ),
        ]);

        doc.autoTable({
            startY:
                y,

            head: [
                [
                    'Type de transaction',
                    'Total',
                ],
            ],

            body:
                rows,

            theme:
                'grid',

            margin: {
                left:
                    margin,

                right:
                    margin,
            },

            styles: {
                font:
                    'helvetica',

                fontSize:
                    8.7,

                cellPadding:
                    2.5,
            },

            columnStyles: {
                1: {
                    halign:
                        'right',

                    cellWidth:
                        42,
                },
            },
        });

        const contributorName =
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

        const filename =
            `Attestation de paiement - ` +
            `${safeFilePart(
                payment.invoiceNumber ||
                    invoice.invoiceNumber ||
                    invoice.billingId
            )} - ` +
            `${safeFilePart(
                contributorName
            )}.pdf`;

        doc.save(
            filename
        );
    }
})();
