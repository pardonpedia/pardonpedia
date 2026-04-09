/**
 * PardonPedia - Clemency Records Explorer
 */

import { RowChart, computeFrozenFacetKeys } from './rowChart.js';
import { TimeChart } from './timeChart.js';
import { formatShortDate, escapeHtml, scrollToTop, parseCsvGrantDate, formatMetaUpdatedDate } from './shared.js';
import { renderPardonDetail } from './detailPanel.js';
import { trackPageView } from './analytics.js';
import { applyParamsToCharts, searchStringFromFilterTypes } from './filterUrl.js';
import { downloadFilteredCsv, PARDONS_EXPORT_COLUMNS } from './csvDownload.js';

trackPageView();

export class Site {
    constructor() {
        if (window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost')
            document.title = 'Pardonpedia DEV';

        this._suppressUrlPush = false;
        this._lastPushedSearch = '';
        this._popstateBound = false;
        this._filterColResizeObs = null;
        this._pdfDocPromiseByKey = new Map();

        this.records = this.getData();
        window.site = this;
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

        const [pardonsResp, adminResp, metaResp, storiesResp, moneyResp, courtDocsResp] = await Promise.all([
            fetch('data/pardons.csv.gz'),
            fetch('data/administrations.csv'),
            fetch('data/pardons.meta.json'),
            fetch('data/stories.csv.gz'),
            fetch('data/money.csv.gz'),
            fetch('data/court_documents.csv.gz'),
        ]);

        const [buf, adminText, metaJson, storiesBuf] = await Promise.all([
            pardonsResp.arrayBuffer(),
            adminResp.text(),
            metaResp.json(),
            storiesResp.arrayBuffer(),
        ]);

        const adminData = d3.csvParse(adminText);
        this.termOrder  = new Map(adminData.map(d => [d.presidentTerm, +d.startYear]));
        this.termParty  = new Map(adminData.map(d => [d.presidentTerm, d.partyAbbreviation]));
        this.yearParty  = new Map();
        adminData.forEach(d => {
            const start = +d.startYear;
            const end   = d.endYear ? +d.endYear : 2030;
            for (let y = start; y < end; y++) this.yearParty.set(y, d.partyAbbreviation);
        });

        const text = pako.inflate(new Uint8Array(buf), { to: 'string' });
        const allRecords = d3.csvParse(text);

        const storiesText = pako.inflate(new Uint8Array(storiesBuf), { to: 'string' });
        this.stories = d3.csvParse(storiesText);

        this.storiesByPardonId = new Map();
        this.stories.forEach(s => {
            if (!this.storiesByPardonId.has(s.pardonId)) this.storiesByPardonId.set(s.pardonId, []);
            this.storiesByPardonId.get(s.pardonId).push(s);
        });

        const moneyByPardonId = new Map();
        if (moneyResp.ok) {
            const moneyBuf = await moneyResp.arrayBuffer();
            const moneyText = pako.inflate(new Uint8Array(moneyBuf), { to: 'string' });
            d3.csvParse(moneyText).forEach(m => {
                const key = String(m.pardonMoneyId ?? m.id ?? '').trim();
                if (key) moneyByPardonId.set(key, m);
            });
        }

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
            record.count = 1;
            if (record.grantDate)
                record.date = parseCsvGrantDate(record.grantDate);

            const pid = String(record.id ?? '').trim();
            const m = moneyByPardonId.get(pid);
            if (m) {
                record.forgivenAmount = m.forgivenAmount;
                record.remedyType = m.remedyType;
                record.forgivenAmountNum = m.forgivenAmount === '' || m.forgivenAmount == null
                    ? 0
                    : Number(m.forgivenAmount);
                if (Number.isNaN(record.forgivenAmountNum)) record.forgivenAmountNum = 0;
            }
            record.courtDocuments = courtDocumentsByPardonId.get(pid) ?? [];
        });

        this.records = allRecords;

        // Display the dataset generation date from meta file
        const generatedAt = metaJson?.pardons?.generated_at;
        if (generatedAt) {
            const formatted = formatMetaUpdatedDate(generatedAt);
            if (formatted) document.getElementById('updated-date').textContent = `Updated ${formatted}`;
        }

        this.facts = crossfilter(this.records);
        dc.facts = this.facts;

        this.setupCharts(adminData);
        this.setupNamesList();
        dc.renderAll();

        this._suppressUrlPush = true;
        applyParamsToCharts(new URLSearchParams(window.location.search));
        dc.redrawAll();
        this._lastPushedSearch = searchStringFromFilterTypes(this.collectFilters());
        this.refresh();
        this._suppressUrlPush = false;

        overlay.classList.replace('loading-visible', 'loading-hidden');
        document.getElementById('names-search-input').focus();

        requestAnimationFrame(() => {
            this._resizeFilterRowCharts();
        });
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

    setupCharts(adminData) {
        const boundRefresh = () => this.refresh();
        dc.refresh = boundRefresh;

        // Build combined labels for consecutive two-term presidents.
        // Non-consecutive terms (e.g. Trump 1 & 2 separated by Biden) stay separate.
        const presidentTerms = new Map();
        adminData.forEach(d => {
            if (!presidentTerms.has(d.presidentId)) presidentTerms.set(d.presidentId, []);
            presidentTerms.get(d.presidentId).push(d);
        });

        const adminIdToLabel  = new Map(); // administrationId → display label
        const fullLabelOrder  = new Map(); // display label    → start year (for sort)
        const fullLabelParty  = new Map(); // display label    → party abbreviation

        presidentTerms.forEach(terms => {
            terms.sort((a, b) => +a.startYear - +b.startYear);

            // Consecutive = every term's endDate matches the next term's startDate
            const consecutive = terms.length > 1 &&
                terms.every((t, i) => i === terms.length - 1 || t.endDate === terms[i + 1].startDate);

            if (consecutive) {
                const first  = terms[0];
                const last   = terms[terms.length - 1];
                const label  = `${first.displayName}`;
                terms.forEach(t => adminIdToLabel.set(t.administrationId, label));
                fullLabelOrder.set(label, +first.startYear);
                fullLabelParty.set(label, first.partyAbbreviation);
            } else {
                terms.forEach((t, i) => {
                    const label = terms.length > 1
                        ? `${t.displayName} ${i + 1}`
                        : `${t.displayName}`;
                    adminIdToLabel.set(t.administrationId, label);
                    fullLabelOrder.set(label, +t.startYear);
                    fullLabelParty.set(label, t.partyAbbreviation);
                });
            }
        });

        // Stamp displayPresidency onto each record in a single pass so the
        // crossfilter dimension is a plain field read with no runtime lookups.
        this.records.forEach(d => {
            d.displayPresidency = adminIdToLabel.get(d.administrationId) || d.presidentTerm || '';
            if (!fullLabelOrder.has(d.displayPresidency))
                fullLabelOrder.set(d.displayPresidency, fullLabelOrder.get(adminIdToLabel.get(d.administrationId)));
            if (!fullLabelParty.has(d.displayPresidency))
                fullLabelParty.set(d.displayPresidency, fullLabelParty.get(adminIdToLabel.get(d.administrationId)));
        });

        const presTermDim = this.facts.dimension(d => d.displayPresidency);
        const termOrdering = d => -(fullLabelOrder.get(d.key) ?? 0);
        const termColorFn  = key => {
            const p = fullLabelParty.get(key);
            return p === 'D' ? '#6699cc' : p === 'R' ? '#cc6666' : '#aecde8';
        };

        const noneToEmpty = v => v === 'None' ? '' : (v || '');
        const topicDim = this.facts.dimension(d => noneToEmpty(d.topic));
        const officeDim = this.facts.dimension(d => noneToEmpty(d.officeHeld));
        const relationshipDim = this.facts.dimension(d => noneToEmpty(d.relationship));

        const frozenClemency = computeFrozenFacetKeys(this.records, 'clemencyType', 20);
        const frozenOffice = computeFrozenFacetKeys(this.records, 'officeHeld', 50, noneToEmpty);
        const frozenRelationship = computeFrozenFacetKeys(this.records, 'relationship', 50, noneToEmpty);
        const frozenTopic = computeFrozenFacetKeys(this.records, 'topic', 50, noneToEmpty);

        const filterChartWidth = this._measureFilterChartWidth();
        dc.rowCharts = [
            new RowChart(this.facts, 'presidentTerm', filterChartWidth, 50, boundRefresh, 'Presidency',              presTermDim,       '#chart-president_term', false, false, termOrdering, termColorFn, null, true, null),
            new RowChart(this.facts, 'clemencyType',  filterChartWidth, 20, boundRefresh, 'Clemency Type',           null,              '#chart-clemency_type', false, false, null, null, null, false, frozenClemency),
            new RowChart(this.facts, 'officeHeld',    filterChartWidth, 50, boundRefresh, 'Occupation',              officeDim,         '#chart-officeHeld-wrap', false, false, null, null, null, false, frozenOffice),
            new RowChart(this.facts, 'relationship',  filterChartWidth, 50, boundRefresh, 'Relationship to President', relationshipDim, '#chart-relationship-wrap', false, false, null, null, null, false, frozenRelationship),
            new RowChart(this.facts, 'topic',         filterChartWidth, 50, boundRefresh, 'TOPIC',                   topicDim,          '#chart-topic-wrap', false, false, null, null, null, false, frozenTopic),
        ];

        dc.timeChart = new TimeChart(this.facts, adminData, '#chart-grant-date', boundRefresh);

        this._ensureFilterColResizeObserver();
        this._ensurePopstateListener();
    }

    _ensurePopstateListener() {
        if (this._popstateBound) return;
        this._popstateBound = true;
        window.addEventListener('popstate', () => {
            if (!dc.rowCharts?.length) return;
            this._suppressUrlPush = true;
            applyParamsToCharts(new URLSearchParams(window.location.search));
            dc.redrawAll();
            this._lastPushedSearch = searchStringFromFilterTypes(this.collectFilters());
            this.refresh();
            this._suppressUrlPush = false;
        });
    }

    _syncUrlWithFilters() {
        if (this._suppressUrlPush) return;
        const next = searchStringFromFilterTypes(this.collectFilters());
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
                    filters: chartFilters
                });
            }
        });

        return filterTypes;
    }

    refresh() {
        const filterTypes = this.collectFilters();
        const hasActiveFilters = filterTypes.length > 0;
        const recordCount = dc.facts.allFiltered().length;

        const clemencyChart = dc.rowCharts.find(rc => rc.field === 'clemencyType');
        const clemencyGroups = clemencyChart ? clemencyChart.group.all() : [];
        const clemencyCounts = Object.fromEntries(clemencyGroups.map(d => [d.key, d.value]));
        const pardonCount = clemencyCounts['Pardon'] || 0;
        const commutationCount = clemencyCounts['Commutation'] || 0;
        const otherCount = recordCount - pardonCount - commutationCount;
        const countParts = [];
        if (pardonCount > 0) countParts.push(`${pardonCount.toLocaleString()} pardons`);
        if (commutationCount > 0) countParts.push(`${commutationCount.toLocaleString()} commutations`);
        if (otherCount > 0) countParts.push(`${otherCount.toLocaleString()} other`);

        let menuHtml = `<span class="record-count">${countParts.join(' / ')}</span>`;
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

        const clearSearchInput = (containerSelector) => {
            const container = d3.select(containerSelector);
            const input = container.select('.chart-search');
            if (!input.empty()) {
                input.property('value', '');
                input.classed('has-selection', false);
            }
            const searchContainer = container.select('.chart-search-container');
            if (!searchContainer.empty()) {
                searchContainer.classed('has-selection', false);
            }
        };

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
                PARDONS_EXPORT_COLUMNS,
                `pardonpedia-${new Date().toISOString().split('T')[0]}`,
            );
        });

        dc.redrawAll();
        this._syncUrlWithFilters();
        scrollToTop('#names-list');
        this.buildNamesList(this._namesSearchTerm || '');
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

        const sorted = [...records]
            .sort((a, b) => {
                const aHasDate = a.date && !isNaN(a.date);
                const bHasDate = b.date && !isNaN(b.date);
                if (aHasDate !== bHasDate) return aHasDate ? -1 : 1;
                if (aHasDate && bHasDate) {
                    const dateDiff = b.date - a.date;
                    if (dateDiff !== 0) return dateDiff;
                }
                return (+b.administrationId || 0) - (+a.administrationId || 0);
            })
;

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

            return `<div class="names-list-item${i === 0 ? ' selected' : ''}" data-idx="${i}">`
                + `<div class="nli-name">${name}</div>`
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

new Site();
