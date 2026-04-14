/**
 * Givebacks table view (givebacks.csv).
 */

import { RowChart, computeFrozenFacetKeysBySum } from './rowChart.js';
import { ForgivenAmountMonthChart } from './forgivenAmountWeekChart.js';
import { formatShortDate, escapeHtml, formatMetaUpdatedDate, parseCsvGrantDate } from './shared.js';
import { renderPardonDetail } from './detailPanel.js';
import { trackPageView } from './analytics.js';
import { applyGivebacksParamsToCharts, givebacksSearchStringFromFilterTypes } from './givebacksFilterUrl.js';
import { downloadFilteredCsv, GIVEBACKS_EXPORT_COLUMNS } from './csvDownload.js';

trackPageView();

const moneyFmt = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
});

function grantDateTimestamp(r) {
    if (r.date instanceof Date && !Number.isNaN(r.date.getTime())) return r.date.getTime();
    if (r.grantDate) {
        const p = String(r.grantDate).split('-').map(Number);
        if (p.length >= 3 && p.every(n => !Number.isNaN(n)))
            return new Date(p[0], p[1] - 1, p[2]).getTime();
    }
    return NaN;
}

function parseMoney(value) {
    if (value === '' || value == null) return 0;
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
}

function formatCourtDocShortDate(value) {
    const raw = typeof value === 'string' ? value.trim() : '';
    if (!raw) return '';
    const parsed = parseCsvGrantDate(raw);
    if (parsed instanceof Date && !Number.isNaN(parsed.getTime())) return formatShortDate(parsed);
    return raw.slice(0, 10);
}

/** Grant date ascending (oldest first); undated rows last; then name, id. */
function sortGivebacksRecords(records) {
    return [...records].sort((a, b) => {
        const ta = grantDateTimestamp(a);
        const tb = grantDateTimestamp(b);
        const aOk = !Number.isNaN(ta);
        const bOk = !Number.isNaN(tb);
        if (aOk && bOk && ta !== tb) return ta - tb;
        if (aOk !== bOk) return aOk ? -1 : 1;
        const byName = (a.personName || '').localeCompare(b.personName || '', undefined, { sensitivity: 'base' });
        if (byName !== 0) return byName;
        return (+a.id || 0) - (+b.id || 0);
    });
}

/** Compact dollars for narrow row-chart labels (whole dollars) */
const rowMoneyFmt = v => new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
    notation: 'compact',
    compactDisplay: 'short',
}).format(Math.round(v));

export class GivebacksSite {
    constructor() {
        if (window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost')
            document.title = 'Pardonpedia Givebacks DEV';

        this._suppressUrlPush = false;
        this._lastPushedSearch = '';
        this._popstateBound = false;
        this._filterColResizeObs = null;
        this._pdfDocPromiseByKey = new Map();

        this.records = this.getData();
        window.givebacksSite = this;
    }

    _getPdfDocumentPromise(warrantKey, pdfUrl) {
        const existing = this._pdfDocPromiseByKey.get(warrantKey);
        if (existing) return existing;

        const promise = pdfjsLib.getDocument(pdfUrl).promise
            .catch(err => {
                this._pdfDocPromiseByKey.delete(warrantKey);
                throw err;
            });
        this._pdfDocPromiseByKey.set(warrantKey, promise);
        return promise;
    }

    async getData() {
        const overlay = document.getElementById('loading-overlay');
        overlay.classList.replace('loading-hidden', 'loading-visible');

        const [givebacksResp, metaResp, courtDocsResp] = await Promise.all([
            fetch('data/givebacks.csv.gz'),
            fetch('data/pardons.meta.json'),
            fetch('data/court_documents.csv.gz'),
        ]);

        const [buf, metaJson] = await Promise.all([
            givebacksResp.arrayBuffer(),
            metaResp.json(),
        ]);

        const text = pako.inflate(new Uint8Array(buf), { to: 'string' });
        const allRecords = d3.csvParse(text).map((row) => {
            const restitutionAmountNum = parseMoney(row.restitutionAmount);
            const fineAmountNum = parseMoney(row.fineAmount);
            const forfeitureAmountNum = parseMoney(row.forfeitureAmount);
            const governmentAmountNum = fineAmountNum + forfeitureAmountNum;
            const totalGivebackNum = restitutionAmountNum + governmentAmountNum;
            const id = String(row.pardonId ?? '').trim();
            const offenseType = (row.offenseType || '').trim();
            const grantDate = (row.grantDate || '').trim();

            const record = {
                ...row,
                id,
                pardonId: id,
                personName: row.name,
                offenseType,
                grantDate,
                presidentName: row.presidentTerm,
                count: 1,
                restitutionAmountNum,
                fineAmountNum,
                forfeitureAmountNum,
                governmentAmountNum,
                totalGivebackNum,
                // Preserve existing givebacks compatibility fields used by chart/detail code.
                forgivenAmountNum: totalGivebackNum,
                forgivenAmount: String(totalGivebackNum),
            };
            if (grantDate) {
                const [gy, gm, gd] = grantDate.split('-').map(Number);
                record.date = new Date(gy, gm - 1, gd);
            }
            return record;
        });

        const courtDocumentsByPardonId = new Map();
        if (courtDocsResp.ok) {
            const courtBuf = await courtDocsResp.arrayBuffer();
            const courtText = pako.inflate(new Uint8Array(courtBuf), { to: 'string' });
            d3.csvParse(courtText).forEach(row => {
                const key = String(row.pardonId ?? '').trim();
                if (!key) return;
                if (!courtDocumentsByPardonId.has(key)) courtDocumentsByPardonId.set(key, []);
                courtDocumentsByPardonId.get(key).push(row);
            });
            courtDocumentsByPardonId.forEach(docs => {
                docs.sort((a, b) => String(a.documentDate || '').localeCompare(String(b.documentDate || '')));
            });
        }

        allRecords.forEach(record => {
            const pardonKey = String(record.pardonId ?? record.id ?? '').trim();
            record.courtDocuments = courtDocumentsByPardonId.get(pardonKey) ?? [];
        });

        this.records = allRecords;
        this._setGivebacksGrandTotalLede();

        const generatedAt = metaJson?.givebacks?.generated_at;
        if (generatedAt) {
            const formatted = formatMetaUpdatedDate(generatedAt);
            const el = document.getElementById('updated-date');
            if (el && formatted) el.textContent = `Updated ${formatted}`;
        }

        this.facts = crossfilter(this.records);
        dc.facts = this.facts;

        this.setupCharts();
        dc.renderAll();

        this._suppressUrlPush = true;
        applyGivebacksParamsToCharts(new URLSearchParams(window.location.search));
        dc.redrawAll();
        this._lastPushedSearch = givebacksSearchStringFromFilterTypes(this.collectFilters());
        this.refresh();
        this._suppressUrlPush = false;

        overlay.classList.replace('loading-visible', 'loading-hidden');

        requestAnimationFrame(() => {
            this._resizeFilterRowCharts();
        });
    }

    /** Top lede: full-dataset forgiven sum (ignores chart filters). */
    _setGivebacksGrandTotalLede() {
        const el = document.getElementById('givebacks-lede-head');
        if (!el) return;
        const grandTotal = this.records.reduce((s, r) => s + (r.forgivenAmountNum || 0), 0);
        el.textContent = `${moneyFmt.format(grandTotal)} in Givebacks `;
    }

    _fallbackFilterChartWidth() {
        return Math.max(96, Math.floor(133 * 1.44) - 6);
    }

    _measureFilterChartWidth() {
        const col = document.getElementById('filter-col-left');
        if (!col) return this._fallbackFilterChartWidth();
        const w = col.clientWidth;
        if (w < 48) return this._fallbackFilterChartWidth();
        return Math.max(96, w - 6);
    }

    _resizeFilterRowCharts() {
        if (!dc.rowCharts?.length) return;
        const chartWidth = this._measureFilterChartWidth();
        dc.rowCharts.forEach(rc => {
            if (rc.chart) rc.chart.width(chartWidth);
        });
        dc.redrawAll();
    }

    _ensureFilterColResizeObserver() {
        if (this._filterColResizeObs) return;
        const col = document.getElementById('filter-col-left');
        if (!col) return;
        let t;
        this._filterColResizeObs = new ResizeObserver(() => {
            clearTimeout(t);
            t = setTimeout(() => this._resizeFilterRowCharts(), 50);
        });
        this._filterColResizeObs.observe(col);
    }

    setupCharts() {
        const boundRefresh = () => this.refresh();
        dc.refresh = boundRefresh;

        const noneToEmpty = v => v === 'None' ? '' : (v || '');
        const offenseTypeDim = this.facts.dimension(d => noneToEmpty(d.offenseType));

        const frozenOffense = computeFrozenFacetKeysBySum(this.records, 'offenseType', 'totalGivebackNum', 50, noneToEmpty);
        // Keep remedy chart code path available for future restore.
        this._preservedRemedyFacet = computeFrozenFacetKeysBySum(this.records, 'remedyType', 'totalGivebackNum', 50, noneToEmpty);

        const filterChartWidth = this._measureFilterChartWidth();
        dc.rowCharts = [
            new RowChart(this.facts, 'offenseType', filterChartWidth, 50, boundRefresh, 'Offense', offenseTypeDim, '#chart-offenseType-wrap', false, false, null, null, null, false, frozenOffense, 'totalGivebackNum', rowMoneyFmt),
        ];

        new ForgivenAmountMonthChart(this.facts, '#chart-grant-date', boundRefresh);

        this._ensureFilterColResizeObserver();
        this._ensurePopstateListener();
    }

    _ensurePopstateListener() {
        if (this._popstateBound) return;
        this._popstateBound = true;
        window.addEventListener('popstate', () => {
            if (!dc.rowCharts?.length) return;
            this._suppressUrlPush = true;
            applyGivebacksParamsToCharts(new URLSearchParams(window.location.search));
            dc.redrawAll();
            this._lastPushedSearch = givebacksSearchStringFromFilterTypes(this.collectFilters());
            this.refresh();
            this._suppressUrlPush = false;
        });
    }

    _syncUrlWithFilters() {
        if (this._suppressUrlPush) return;
        const next = givebacksSearchStringFromFilterTypes(this.collectFilters());
        if (next === this._lastPushedSearch) return;
        this._lastPushedSearch = next;
        const qs = next ? `?${next}` : '';
        const hash = window.location.hash || '';
        history.pushState(null, '', `${window.location.pathname}${qs}${hash}`);
    }

    collectFilters() {
        const filterTypes = [];
        dc.rowCharts.forEach(rc => {
            const chartFilters = rc.chart.filters();
            if (chartFilters.length > 0) {
                filterTypes.push({
                    name: rc.title,
                    filters: chartFilters,
                });
            }
        });
        return filterTypes;
    }

    refresh() {
        const filterTypes = this.collectFilters();
        const hasActiveFilters = filterTypes.length > 0;
        const records = dc.facts.allFiltered();
        const recordCount = records.length;
        const totalForgiven = records.reduce((s, r) => s + (r.totalGivebackNum || 0), 0);

        let menuHtml = `<span class="record-count">${recordCount.toLocaleString()} recipients, ${moneyFmt.format(totalForgiven)} given back</span>`;
        if (hasActiveFilters) {
            menuHtml += `<button class="clear-button">Show All</button>`;
        }
        d3.select('#menu-info').html(menuHtml);

        if (filterTypes.length > 0) {
            const filterBoxes = filterTypes.map(filterType => {
                const valueBadges = filterType.filters.map(value => `
                    <span class="filter-value-badge" data-filter-name="${filterType.name}" data-filter-value="${value}">
                        ${value} <span class="filter-value-close">✕</span>
                    </span>
                `).join('');
                return `
                    <div class="filter-box">
                        <div class="filter-box-title">${filterType.name}</div>
                        <div class="filter-box-values">${valueBadges}</div>
                    </div>
                `;
            }).join('');
            d3.select('#filters').html(`<div class="filter-boxes-container">${filterBoxes}</div>`);
        } else {
            d3.select('#filters').html('');
        }

        d3.selectAll('.filter-value-badge').on('click', (event) => {
            event.stopPropagation();
            const badge = d3.select(event.currentTarget);
            const filterName = badge.attr('data-filter-name');
            const filterValue = badge.attr('data-filter-value');

            const rowChart = dc.rowCharts.find(rc => rc.title === filterName);
            if (rowChart) {
                rowChart.chart.filter(filterValue);
            }

            dc.redrawAll();
            this.refresh();
        });

        d3.select('.clear-button').on('click', () => {
            dc.filterAll();
            dc.redrawAll();
            this.refresh();
        });

        d3.select('#download-csv').on('click', () => {
            downloadFilteredCsv(
                dc.facts.allFiltered(),
                GIVEBACKS_EXPORT_COLUMNS,
                `pardonpedia-givebacks-${new Date().toISOString().split('T')[0]}`,
            );
        });

        dc.redrawAll();
        this._syncUrlWithFilters();
        this.buildGivebacksTable();
    }

    _syncStickyHeaderOffsets() {
        const table = document.getElementById('givebacks-table');
        if (!table) return;
        const headerRow = table.querySelector('thead .gb-columns-row');
        if (!headerRow) return;
        const h = Math.max(1, Math.ceil(headerRow.getBoundingClientRect().height));
        table.style.setProperty('--gb-header-row-height', `${h}px`);
    }

    buildGivebacksTable() {
        const tbody = document.getElementById('givebacks-table-body');
        if (!tbody) return;

        const records = sortGivebacksRecords(this.facts.allFiltered());
        const totalVictim = records.reduce((sum, r) => sum + (r.restitutionAmountNum || 0), 0);
        const totalGov = records.reduce((sum, r) => sum + (r.governmentAmountNum || 0), 0);

        const totalPardoneeEl = document.getElementById('gb-total-pardonee');
        const totalVictimEl = document.getElementById('gb-total-victim');
        const totalGovEl = document.getElementById('gb-total-gov');
        if (totalPardoneeEl) totalPardoneeEl.textContent = `Total for ${records.length.toLocaleString()} Pardonees`;
        if (totalVictimEl) totalVictimEl.textContent = moneyFmt.format(totalVictim);
        if (totalGovEl) totalGovEl.textContent = moneyFmt.format(totalGov);

        if (records.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" class="givebacks-table-empty">No records found.</td></tr>`;
            return;
        }

        const rows = records.map((r) => {
            const name = escapeHtml(r.personName || 'Unknown');
            const dateStr = r.date && !isNaN(r.date) ? formatShortDate(r.date) : '';
            const clem = escapeHtml(r.clemencyType || '');
            const metaLine = [clem, dateStr].filter(Boolean).join(' ');
            const offenseText = escapeHtml((r.offenseType || '—').trim() || '—');

            const victimNum = r.restitutionAmountNum || 0;
            const govNum = r.governmentAmountNum || 0;
            const fineNum = r.fineAmountNum || 0;
            const forfeitureNum = r.forfeitureAmountNum || 0;

            const victimCell = victimNum > 0
                ? `<div class="gb-amount">${moneyFmt.format(victimNum)}</div><div class="gb-subtext">Restitution erased</div>`
                : `<div class="gb-none">---</div>`;
            const govCell = govNum > 0
                ? `<div class="gb-amount">${moneyFmt.format(govNum)}</div><div class="gb-subtext">Fines ${moneyFmt.format(fineNum)} + forfeitures ${moneyFmt.format(forfeitureNum)}</div>`
                : `<div class="gb-none">---</div>`;
            const courtDocs = Array.isArray(r.courtDocuments) ? r.courtDocuments : [];
            const docsCell = courtDocs.length > 0
                ? `<td class="gb-col-docs">${(() => {
                    const district = escapeHtml(
                        (courtDocs.find((doc) => (doc.courtName || '').trim())?.courtName || '').trim() || 'District'
                    );
                    const districtHeader = `<div class="gb-doc-district">${district}</div>`;
                    const docsList = courtDocs.map((doc) => {
                        const typeLabel = (doc.documentTypeName || doc.documentType || doc.title || 'Document').trim() || 'Document';
                        const datePrefix = formatCourtDocShortDate(doc.documentDate);
                        const label = escapeHtml(datePrefix ? `${datePrefix} ${typeLabel}` : typeLabel);
                        const urlRaw = typeof doc.sourceUrl === 'string' ? doc.sourceUrl.trim() : '';
                        const href = /^https?:\/\//i.test(urlRaw) ? escapeHtml(urlRaw) : '';
                        return href
                            ? `<div class="gb-doc-placeholder"><a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a></div>`
                            : `<div class="gb-doc-placeholder">${label}</div>`;
                    }).join('');
                    return `${districtHeader}${docsList}`;
                })()}</td>`
                : `<td class="gb-col-docs"></td>`;

            return (
                `<tr class="gb-data-row">`
                + `<td class="gb-col-pardonee"><div class="gb-name">${name}</div><div class="gb-meta">${metaLine || '—'}</div></td>`
                + `<td class="gb-col-offense">${offenseText}</td>`
                + `<td class="gb-col-victim">${victimCell}</td>`
                + `<td class="gb-col-gov">${govCell}</td>`
                + docsCell
                + `</tr>`
            );
        });
        tbody.innerHTML = rows.join('');
        this._syncStickyHeaderOffsets();
    }

    setupNamesList() {
        this._namesSearchTerm = '';
        this.selectedRecord = null;
        this._namesHighlightIdx = 0;

        const input = document.getElementById('names-search-input');
        const container = document.getElementById('names-search-container');
        const clearBtn = container.querySelector('.chart-search-clear');

        input.addEventListener('input', () => {
            this._namesSearchTerm = input.value;
            this._namesHighlightIdx = 0;
            const hasTerm = !!input.value;
            clearBtn.style.display = hasTerm ? 'block' : 'none';
            container.querySelector('.chart-search-icon').style.display = hasTerm ? 'none' : '';
            this.buildNamesList(this._namesSearchTerm);
        });

        input.addEventListener('keydown', (e) => {
            const items = document.querySelectorAll('.names-list-item');
            const count = items.length;
            if (count === 0) return;

            if (e.key === 'ArrowDown') {
                e.preventDefault();
                this._namesHighlightIdx = Math.min(this._namesHighlightIdx + 1, count - 1);
                this._applyNamesHighlight(items);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                this._namesHighlightIdx = Math.max(this._namesHighlightIdx - 1, 0);
                this._applyNamesHighlight(items);
            } else if (e.key === 'Enter') {
                e.preventDefault();
                const record = this._sortedRecords?.[this._namesHighlightIdx];
                if (record) {
                    input.value = record.personName || '';
                    this._namesSearchTerm = input.value;
                    const highlighted = items[this._namesHighlightIdx];
                    if (highlighted) highlighted.click();
                }
            }
        });

        clearBtn.addEventListener('click', () => {
            input.value = '';
            this._namesSearchTerm = '';
            this._namesHighlightIdx = 0;
            clearBtn.style.display = 'none';
            container.querySelector('.chart-search-icon').style.display = '';
            this.buildNamesList('');
        });
    }

    _applyNamesHighlight(items) {
        items.forEach((el, i) => {
            el.classList.toggle('selected', i === this._namesHighlightIdx);
        });
        const target = items[this._namesHighlightIdx];
        if (target) target.scrollIntoView({ block: 'nearest' });
    }

    buildNamesList(searchTerm = '') {
        let records = this.facts.allFiltered();

        if (searchTerm) {
            const lower = searchTerm.toLowerCase();
            records = records.filter(r => r.personName && r.personName.toLowerCase().includes(lower));
        }

        const sorted = sortGivebacksRecords(records);

        const countEl = document.getElementById('names-list-count');
        if (countEl) countEl.textContent = sorted.length.toLocaleString();

        this._sortedRecords = sorted;

        const container = document.getElementById('names-list');
        if (sorted.length === 0) {
            container.innerHTML = `<div class="detail-empty">No records found.</div>`;
            this.renderDetail(null);
            return;
        }

        const clemencyClassAndLabel = (type) => {
            const t = (type || '').toLowerCase();
            if (t === 'commutation') return { cls: 'nli-clemency--commutation', label: 'Commutation' };
            if (t === 'pardon') return { cls: 'nli-clemency--pardon', label: 'Pardon' };
            return { cls: 'nli-clemency--other', label: escapeHtml(type || '') };
        };

        const truncateOffense = (text, maxLen) => {
            const s = (text || '').trim();
            if (!s) return '';
            if (s.length <= maxLen) return s;
            return `${s.slice(0, maxLen - 1)}…`;
        };

        container.innerHTML = sorted.map((r, i) => {
            const dateStr = r.date && !isNaN(r.date) ? formatShortDate(r.date) : '';
            const pres = escapeHtml(r.presidentName || r.presidentTerm || '');
            const metaLine = [pres, dateStr].filter(Boolean).join(' · ');
            const name = escapeHtml(r.personName || 'Unknown');
            const { cls: clemCls, label: clemLabel } = clemencyClassAndLabel(r.clemencyType);
            const clemHtml = clemLabel
                ? `<span class="nli-clemency ${clemCls}">${clemLabel}</span>`
                : '';
            const offenseRaw = truncateOffense(r.offense, 120);
            const offenseHtml = offenseRaw ? `<div class="nli-offense">${escapeHtml(offenseRaw)}</div>` : '';
            const amt = moneyFmt.format(r.forgivenAmountNum || 0);
            const remedyRaw = (r.remedyType || '').trim();
            const remedyLabel = remedyRaw && remedyRaw !== 'None' ? remedyRaw : '';
            const remedyHtml = remedyLabel
                ? `<span class="nli-amount-remedy">${escapeHtml(remedyLabel)}</span>`
                : '';
            const amountHtml = `<div class="nli-amount"><span class="nli-amount-value">${amt}</span>${remedyHtml}</div>`;

            return `<div class="names-list-item${i === 0 ? ' selected' : ''}" data-idx="${i}">`
                + `<div class="nli-name">${name}</div>`
                + amountHtml
                + offenseHtml
                + `<div class="nli-footer">`
                + `<span class="nli-meta">${metaLine || '—'}</span>`
                + (clemHtml ? `<span class="nli-footer-clemency">${clemHtml}</span>` : '')
                + `</div>`
                + `</div>`;
        }).join('');

        container.querySelectorAll('.names-list-item').forEach((el, i) => {
            el.addEventListener('click', () => {
                this._namesHighlightIdx = i;
                this.selectRecord(sorted[i], el);
            });
            el.addEventListener('mouseenter', () => {
                const r = sorted[i];
                if (r.warrantKey) {
                    this._getPdfDocumentPromise(r.warrantKey, `docs/warrants/pdfs/${r.warrantKey}.pdf`);
                }
            });
        });

        this._namesHighlightIdx = 0;
        this.selectRecord(sorted[0], container.querySelector('.names-list-item'));
    }

    selectRecord(record, el) {
        this.selectedRecord = record;
        document.querySelectorAll('.names-list-item').forEach(item => item.classList.remove('selected'));
        if (el) el.classList.add('selected');

        const panel = document.getElementById('pardon-detail');
        if (!panel.hasChildNodes()) {
            this.renderDetail(record);
            return;
        }

        panel.classList.add('fading');
        let finished = false;
        const finish = () => {
            if (finished) return;
            finished = true;
            panel.removeEventListener('transitionend', onTransitionEnd);
            clearTimeout(fallbackTimer);
            this.renderDetail(record);
            requestAnimationFrame(() => panel.classList.remove('fading'));
        };
        const onTransitionEnd = (e) => {
            if (e.target === panel && e.propertyName === 'opacity') finish();
        };
        const fallbackTimer = setTimeout(finish, 200);
        panel.addEventListener('transitionend', onTransitionEnd);
    }

    renderDetail(record) {
        const panel = document.getElementById('pardon-detail');
        renderPardonDetail(panel, record, {
            storiesByPardonId: this.storiesByPardonId,
            getPdfDocumentPromise: (k, u) => this._getPdfDocumentPromise(k, u),
            getSelectedRecord: () => this.selectedRecord,
        });
    }

}

new GivebacksSite();
