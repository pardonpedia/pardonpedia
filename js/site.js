/**
 * PardonPedia - Clemency Records Explorer
 */

import { RowChart } from './rowChart.js';
import { TimeChart } from './timeChart.js';
import { formatDate, scrollToTop, addCommas } from './shared.js';
import { trackPageView } from './analytics.js';

trackPageView();

export class Site {
    constructor() {
        if (window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost')
            document.title = 'Pardonpedia DEV';

        this.records = this.getData();
        window.site = this;
    }

    async getData() {
        const overlay = document.getElementById('loading-overlay');
        overlay.classList.replace('loading-hidden', 'loading-visible');

        const [pardonsResp, adminResp, metaResp] = await Promise.all([
            fetch('data/pardons.csv.gz'),
            fetch('data/administrations.csv'),
            fetch('data/pardons.meta.json'),
        ]);

        const [buf, adminText, metaJson] = await Promise.all([
            pardonsResp.arrayBuffer(),
            adminResp.text(),
            metaResp.json(),
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

        allRecords.forEach(record => {
            record.count = 1;
            if (record.grantDate) {
                record.date = new Date(record.grantDate);
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
        this.setupNameSearch();
        dc.renderAll();
        this.refresh();
        overlay.classList.replace('loading-visible', 'loading-hidden');
        document.getElementById('name-search-input').focus();
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

        const termToFullLabel = new Map(); // presidentTerm  → display label
        const fullLabelOrder  = new Map(); // display label  → start year (for sort)
        const fullLabelParty  = new Map(); // display label  → party abbreviation

        presidentTerms.forEach(terms => {
            terms.sort((a, b) => +a.startYear - +b.startYear);

            // Consecutive = every term's endDate matches the next term's startDate
            const consecutive = terms.length > 1 &&
                terms.every((t, i) => i === terms.length - 1 || t.endDate === terms[i + 1].startDate);

            if (consecutive) {
                const first  = terms[0];
                const last   = terms[terms.length - 1];
                const endStr = last.endYear || 'present';
                const label  = `${first.displayName} (${first.startYear}-${endStr})`;
                terms.forEach(t => termToFullLabel.set(t.presidentTerm, label));
                fullLabelOrder.set(label, +first.startYear);
                fullLabelParty.set(label, first.partyAbbreviation);
            } else {
                terms.forEach(t => {
                    termToFullLabel.set(t.presidentTerm, t.presidentTerm);
                    fullLabelOrder.set(t.presidentTerm, +t.startYear);
                    fullLabelParty.set(t.presidentTerm, t.partyAbbreviation);
                });
            }
        });

        const presTermDim  = this.facts.dimension(d =>
            termToFullLabel.get(d.presidentTerm) || d.presidentTerm || ''
        );
        const termOrdering = d => -(fullLabelOrder.get(d.key) ?? 0);
        const termColorFn  = key => {
            const p = fullLabelParty.get(key);
            return p === 'D' ? '#6699cc' : p === 'R' ? '#cc6666' : '#aecde8';
        };

        dc.rowCharts = [
            new RowChart(this.facts, 'presidentTerm', 185, 50,  boundRefresh, 'Presidency', presTermDim, '#chart-president_term', false, false, termOrdering, termColorFn),
            new RowChart(this.facts, 'clemencyType',  185, 20,  boundRefresh, 'Clemency Type', null, '#chart-clemency_type'),
            new RowChart(this.facts, 'district',      185, 500, boundRefresh, 'District',      null, '#chart-district', true),
        ];

        dc.timeChart = new TimeChart(this.facts, adminData, '#chart-grant-date', boundRefresh);
        this.listRecords();
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
        const filteredRecords = dc.facts.allFiltered();
        const recordCount = filteredRecords.length;

        let menuHtml = `<span class="record-count">${recordCount.toLocaleString()} pardons</span>`;
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
                if (filterName === 'District') {
                    clearSearchInput('#chart-district');
                }
            }

            dc.redrawAll();
            this.refresh();
        });

        d3.select('.clear-button').on('click', () => {
            dc.filterAll();
            clearSearchInput('#chart-district');
            dc.redrawAll();
            this.refresh();
        });

        d3.select('#download-csv').on('click', () => {
            const records = dc.facts.allFiltered();
            this.downloadCsv(records);
        });

        dc.redrawAll();
        scrollToTop('#chart-district-content');
        scrollToTop('#chart-list');
        this.listRecords();
    }

    setupNameSearch() {
        this.nameFilter = null;

        const input = document.getElementById('name-search-input');
        const dropdown = document.getElementById('name-search-dropdown');
        const iconBtn = document.getElementById('name-search-icon');
        const ICON_SEARCH = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`;
        const ICON_CLEAR  = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
        let selectedIndex = -1;
        let matches = [];

        const getMatches = (term) => {
            if (!term || term.length < 1) return [];
            const lower = term.toLowerCase();
            const seen = new Set();
            return this.records
                .filter(r => r.personName && r.personName.toLowerCase().includes(lower))
                .map(r => r.personName)
                .filter(name => { if (seen.has(name)) return false; seen.add(name); return true; })
                .slice(0, 50);
        };

        const highlight = (name, term) => {
            const idx = name.toLowerCase().indexOf(term.toLowerCase());
            if (idx === -1) return name;
            return name.slice(0, idx)
                + `<mark class="name-match">${name.slice(idx, idx + term.length)}</mark>`
                + name.slice(idx + term.length);
        };

        const renderDropdown = () => {
            const term = input.value;
            matches = getMatches(term);
            if (!matches.length) { dropdown.style.display = 'none'; return; }
            dropdown.innerHTML = matches.map((name, i) =>
                `<div class="name-search-item${i === selectedIndex ? ' active' : ''}" data-name="${name}">${highlight(name, term)}</div>`
            ).join('');
            dropdown.style.display = 'block';
            dropdown.querySelectorAll('.name-search-item').forEach(item => {
                item.addEventListener('mousedown', e => {
                    e.preventDefault();
                    selectName(item.dataset.name);
                });
            });
        };

        const selectName = (name) => {
            input.value = name;
            this.nameFilter = name;
            dropdown.style.display = 'none';
            selectedIndex = -1;
            iconBtn.innerHTML = ICON_CLEAR;
            this.listRecords();
        };

        const clearFilter = () => {
            input.value = '';
            this.nameFilter = null;
            dropdown.style.display = 'none';
            selectedIndex = -1;
            iconBtn.innerHTML = ICON_SEARCH;
            this.listRecords();
        };

        iconBtn.addEventListener('mousedown', e => {
            e.preventDefault();
            if (this.nameFilter) clearFilter();
            else input.focus();
        });

        input.addEventListener('input', () => {
            if (!input.value) { clearFilter(); return; }
            this.nameFilter = null;
            selectedIndex = -1;
            renderDropdown();
        });

        input.addEventListener('keydown', e => {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                selectedIndex = Math.min(selectedIndex + 1, matches.length - 1);
                renderDropdown();
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                selectedIndex = Math.max(selectedIndex - 1, 0);
                renderDropdown();
            } else if (e.key === 'Enter') {
                e.preventDefault();
                if (selectedIndex >= 0 && matches[selectedIndex]) {
                    selectName(matches[selectedIndex]);
                } else if (matches.length === 1) {
                    selectName(matches[0]);
                }
            } else if (e.key === 'Escape') {
                clearFilter();
                input.focus();
            }
        });

        input.addEventListener('blur', () => {
            setTimeout(() => { dropdown.style.display = 'none'; }, 150);
        });
    }

    listRecords() {
        let records = this.facts.allFiltered();

        if (this.nameFilter) {
            const lower = this.nameFilter.toLowerCase();
            records = records.filter(r => r.personName && r.personName.toLowerCase() === lower);
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
            .slice(0, 200);

        let html;
        if (sorted.length === 0) {
            html = `<div style="padding:20px;color:#666;">No records found for the selected filters.</div>`;
        } else {
            html = sorted.map(record => this.renderRecordCard(record)).join('');
        }

        d3.select('#chart-list').html(html);
    }

    renderRecordCard(record) {
        const dateStr = record.date && !isNaN(record.date)
            ? `<span class="record-date">${formatDate(record.date)}</span>`
            : '';

        const name = record.personName || 'Unknown';
        const offense = record.offense || '';
        const sentenced = record.sentenced || '';

        const clemencyTag = record.clemencyType
            ? `<span class="record-tag record-tag-clemency">${record.clemencyType}</span>`
            : '';

        const presidentTag = record.presidentTerm
            ? `<span class="record-tag record-tag-president">${record.presidentTerm}</span>`
            : '';

        const districtTag = record.district
            ? `<span class="record-tag record-tag-district">${record.district}</span>`
            : '';

        const warrantLink = record.warrantUrl
            ? `<a href="${record.warrantUrl}" target="_blank" rel="noopener noreferrer" class="record-warrant-link">Warrant Document</a>`
            : '';

        const offenseLine = offense
            ? `<div class="record-offense">${offense}</div>`
            : '';

        const sentencedLine = sentenced
            ? `<div class="record-sentenced">${sentenced}</div>`
            : '';

        return `
            <div class="record">
                <div class="record-header">
                    <span class="record-name">${name}</span>${dateStr}
                    <div class="record-header-tags">${clemencyTag}${presidentTag}</div>
                </div>
                <div class="record-meta">
                    ${warrantLink}${districtTag}
                </div>
                ${offenseLine}
                ${sentencedLine}
            </div>
        `;
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
