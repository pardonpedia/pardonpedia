/**
 * PardonPedia - Clemency Records Explorer
 */

import { RowChart, computeFrozenFacetKeys } from './rowChart.js';
import { TimeChart } from './timeChart.js';
import { formatDate, formatShortDate, escapeHtml, scrollToTop, addCommas } from './shared.js';
import { trackPageView } from './analytics.js';
import { applyParamsToCharts, searchStringFromFilterTypes } from './filterUrl.js';

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

        const [pardonsResp, adminResp, metaResp, storiesResp] = await Promise.all([
            fetch('data/pardons.csv.gz'),
            fetch('data/administrations.csv'),
            fetch('data/pardons.meta.json'),
            fetch('data/stories.csv.gz'),
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

        allRecords.forEach(record => {
            record.count = 1;
            if (record.grantDate) {
                const [gy, gm, gd] = record.grantDate.split('-').map(Number);
                record.date = new Date(gy, gm - 1, gd);
            }
        });

        this.records = allRecords;

        // Display the dataset generation date from meta file
        const generatedAt = metaJson?.pardons?.generated_at;
        if (generatedAt) {
            const formatted = new Date(generatedAt).toLocaleDateString('en-US', {
                month: 'short', day: 'numeric', year: 'numeric'
            });
            document.getElementById('updated-date').textContent = `Updated ${formatted}`;
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
            const records = dc.facts.allFiltered();
            this.downloadCsv(records);
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
        const onFaded = () => {
            panel.removeEventListener('transitionend', onFaded);
            this.renderDetail(record);
            requestAnimationFrame(() => panel.classList.remove('fading'));
        };
        panel.addEventListener('transitionend', onFaded, { once: true });
    }

    renderDetail(record) {
        const panel = document.getElementById('pardon-detail');
        if (!record) {
            panel.innerHTML = `<div class="detail-empty">No record selected.</div>`;
            return;
        }

        const name = record.personName || 'Unknown';
        const dateStr = record.date && !isNaN(record.date) ? formatDate(record.date) : '';

        const clemencyTag = record.clemencyType
            ? `<span class="record-tag record-tag-clemency">${record.clemencyType}</span>` : '';
        const presidentTag = record.presidentTerm
            ? `<span class="record-tag record-tag-president">${record.presidentTerm}</span>` : '';
        const districtTag = record.district
            ? `<span class="record-tag record-tag-district">${record.district}</span>` : '';

        const warrantCanvas = record.warrantKey
            ? `<div class="record-warrant-wrap">
                   <a href="${record.warrantUrl}" target="_blank" rel="noopener noreferrer" class="record-warrant-link">
                       <img id="warrant-thumb" class="record-warrant-canvas"
                            src="docs/warrants/thumbs/${record.warrantKey}.jpg"
                            style="width:256px" alt="Warrant preview">
                   </a>
                   <canvas id="warrant-canvas" class="record-warrant-canvas" style="display:none"></canvas>
                   <div id="warrant-page-controls" class="warrant-page-controls" style="display:none">
                       <button id="warrant-prev" class="warrant-nav-btn">&#8592;</button>
                       <span id="warrant-page-label" class="warrant-page-label"></span>
                       <button id="warrant-next" class="warrant-nav-btn">&#8594;</button>
                   </div>
               </div>`
            : '';

        const hasWarrant = !!record.warrantKey;

        const offenseSection = record.offense
            ? `<div class="detail-section"><div class="detail-label">Offense</div><div class="detail-value">${record.offense}</div></div>`
            : '';

        const sentencedSection = record.sentenced
            ? `<div class="detail-section"><div class="detail-label">Sentence</div><div class="detail-value">${record.sentenced}</div></div>`
            : '';

        const matchingStories = (this.storiesByPardonId && this.storiesByPardonId.get(record.id)) || [];
        const storiesSection = matchingStories.length > 0 ? `
            <div class="detail-section detail-stories">
                <div class="detail-label">Media Coverage</div>
                ${matchingStories.map(s => {
                    let domain = '';
                    try { domain = new URL(s.storyUrl).hostname.replace(/^www\./, ''); } catch(e) {}
                    const faviconUrl = domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=32` : '';
                    const thumbUrl = s.image || faviconUrl;
                    const isArticleImage = !!s.image;
                    const dateStr = s.publishDate ? s.publishDate.split(' ')[0] : '';
                    return `<a href="${s.storyUrl}" target="_blank" rel="noopener noreferrer" class="story-card">
                        ${thumbUrl ? `<img class="story-thumb${isArticleImage ? ' story-thumb--article' : ''}" src="${thumbUrl}" alt="${domain}">` : ''}
                        <div class="story-info">
                            <div class="story-publisher">${domain}</div>
                            <div class="story-title">${s.storyTitle}</div>
                            ${s.authorList ? `<div class="story-author">${s.authorList}</div>` : ''}
                            ${dateStr ? `<div class="story-date">${dateStr}</div>` : ''}
                        </div>
                    </a>`;
                }).join('')}
            </div>
        ` : '';

        panel.innerHTML = `
            <div class="pardon-detail-inner${hasWarrant ? ' pardon-detail-inner--has-warrant' : ''}">
                <div class="pardon-detail-left">
                    <div class="detail-top">
                        <div class="detail-name">${name}</div>
                        ${dateStr ? `<div class="detail-date">${dateStr}</div>` : ''}
                        <div class="detail-tags">${clemencyTag}${presidentTag}${districtTag}</div>
                    </div>
                    ${offenseSection}
                    ${sentencedSection}
                    ${storiesSection}
                </div>
                ${hasWarrant ? `<div class="pardon-detail-right">${warrantCanvas}</div>` : ''}
            </div>
        `;

        if (record.warrantKey) {
            const pdfUrl = `docs/warrants/pdfs/${record.warrantKey}.pdf`;
            const thumb = document.getElementById('warrant-thumb');
            const canvas = document.getElementById('warrant-canvas');
            const controls = document.getElementById('warrant-page-controls');
            const prevBtn = document.getElementById('warrant-prev');
            const nextBtn = document.getElementById('warrant-next');
            const pageLabel = document.getElementById('warrant-page-label');

            const cssWidth = 256;
            const dpr = window.devicePixelRatio || 1;
            const isActiveRecord = () => this.selectedRecord?.id === record.id;

            let currentPage = 1;
            let pdfDoc = null;

            const renderPage = (pdf, n) => {
                if (!isActiveRecord()) return;
                pdf.getPage(n).then(page => {
                    if (!isActiveRecord()) return;
                    const viewport = page.getViewport({ scale: 1 });
                    const scale = (cssWidth / viewport.width) * dpr;
                    const scaled = page.getViewport({ scale });
                    canvas.width = scaled.width;
                    canvas.height = scaled.height;
                    canvas.style.width = cssWidth + 'px';
                    canvas.style.height = (scaled.height / dpr) + 'px';
                    page.render({ canvasContext: canvas.getContext('2d'), viewport: scaled }).promise.then(() => {
                        if (!isActiveRecord()) return;
                        if (thumb) thumb.style.display = 'none';
                        canvas.style.display = '';
                    });
                    if (pageLabel) pageLabel.textContent = `${n} / ${pdf.numPages}`;
                    if (prevBtn) prevBtn.disabled = n <= 1;
                    if (nextBtn) nextBtn.disabled = n >= pdf.numPages;
                });
            };

            const goToPage = (n) => {
                if (!pdfDoc || !isActiveRecord()) return;
                currentPage = n;
                if (n === 1) {
                    canvas.style.display = 'none';
                    if (thumb) thumb.style.display = '';
                } else {
                    renderPage(pdfDoc, n);
                }
                if (pageLabel) pageLabel.textContent = `${n} / ${pdfDoc.numPages}`;
                if (prevBtn) prevBtn.disabled = n <= 1;
                if (nextBtn) nextBtn.disabled = n >= pdfDoc.numPages;
            };

            this._getPdfDocumentPromise(record.warrantKey, pdfUrl).then(pdf => {
                if (!isActiveRecord()) return;
                pdfDoc = pdf;
                if (pdf.numPages > 1 && controls) {
                    controls.style.display = '';
                    pageLabel.textContent = `1 / ${pdf.numPages}`;
                    prevBtn.disabled = true;
                    nextBtn.disabled = false;
                    prevBtn.addEventListener('click', () => {
                        if (currentPage > 1) goToPage(currentPage - 1);
                    });
                    nextBtn.addEventListener('click', () => {
                        if (currentPage < pdf.numPages) goToPage(currentPage + 1);
                    });
                }
            }).catch(() => {
                const wrap = canvas?.closest('.record-warrant-wrap');
                if (wrap) wrap.style.display = 'none';
            });
        }
    }

    downloadCsv(records) {
        const columns = ['name', 'grantDate', 'clemencyType', 'presidentTerm', 'district', 'offense', 'sentenced'];

        const escapeField = (field) => {
            if (field === null || field === undefined) return '';
            const str = String(field);
            if (str.includes(',') || str.includes('"') || str.includes('\n')) {
                return `"${str.replace(/"/g, '""')}"`;
            }
            return str;
        };

        const header = columns.join(',');
        const rows = records.map(record =>
            columns.map(col => escapeField(record[col])).join(',')
        );

        const csvContent = [header, ...rows].join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);

        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', `pardonpedia-${new Date().toISOString().split('T')[0]}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
}

new Site();
