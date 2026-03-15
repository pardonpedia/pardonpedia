/**
 * PardonPedia - Clemency Records Explorer
 */

import { RowChart } from './rowChart.js';
import { formatDate, scrollToTop, addCommas } from './shared.js';

export class Site {
    constructor() {
        if (window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost')
            document.title = 'PardonPedia DEV';

        this.records = this.getData();
        window.site = this;
    }

    async getData() {
        const overlay = document.getElementById('loading-overlay');
        overlay.classList.replace('loading-hidden', 'loading-visible');

        const resp = await fetch('data/pardons.csv.gz');
        const buf = await resp.arrayBuffer();
        const text = pako.inflate(new Uint8Array(buf), { to: 'string' });
        const allRecords = d3.csvParse(text);

        allRecords.forEach(record => {
            record.count = 1;
            if (record.grantDate) {
                record.date = new Date(record.grantDate);
            }
        });

        this.records = allRecords;

        // Display the latest grant date
        const maxDate = d3.max(allRecords.filter(d => d.date), d => d.date);
        if (maxDate && !isNaN(maxDate)) {
            const formatted = maxDate.toLocaleDateString('en-US', {
                month: 'short', day: 'numeric', year: 'numeric'
            });
            document.getElementById('updated-date').textContent = `Updated ${formatted}`;
        }

        this.facts = crossfilter(this.records);
        dc.facts = this.facts;

        this.setupCharts();
        dc.renderAll();
        this.refresh();
        overlay.classList.replace('loading-visible', 'loading-hidden');
    }

    setupCharts() {
        const boundRefresh = () => this.refresh();
        dc.refresh = boundRefresh;

        dc.rowCharts = [
            new RowChart(this.facts, 'presidentTerm', 185, 50,  boundRefresh, 'President / Term', null, '#chart-president_term'),
            new RowChart(this.facts, 'clemencyType',  185, 20,  boundRefresh, 'Clemency Type',    null, '#chart-clemency_type'),
            new RowChart(this.facts, 'district',       185, 500, boundRefresh, 'District',         null, '#chart-district', true),
        ];

        this.setupGrantDateChart();
        this.listRecords();
    }

    setupGrantDateChart() {
        const yearFloor = d => d.date ? new Date(d.date.getFullYear(), 0, 1) : null;

        this.grantDateDimension = this.facts.dimension(d => {
            if (!d.date || isNaN(d.date)) return null;
            return new Date(d.date.getFullYear(), 0, 1);
        });

        const rawGroup = this.grantDateDimension.group().reduceCount();

        // Filter out the null-date bucket
        const filteredGroup = {
            all: () => rawGroup.all().filter(d => d.key !== null),
            top: n => rawGroup.top(Infinity).filter(d => d.key !== null).slice(0, n)
        };

        const dates = this.records.filter(d => d.date && !isNaN(d.date)).map(d => d.date);
        const minYear = new Date(d3.min(dates).getFullYear(), 0, 1);
        const maxYear = new Date(d3.max(dates).getFullYear() + 1, 0, 1);

        // Width = 3 columns + 2 gaps
        const width = 3 * 185 + 2 * 8;
        const height = 100;

        this.grantDateChart = new dc.BarChart('#chart-grant-date');
        this.grantDateChart
            .width(width)
            .height(height)
            .dimension(this.grantDateDimension)
            .group(filteredGroup)
            .x(d3.scaleTime().domain([minYear, maxYear]))
            .xUnits(d3.timeYears)
            .elasticY(true)
            .centerBar(true)
            .colors(['#aecde8'])
            .barPadding(0.1)
            .brushOn(true)
            .margins({ top: 10, right: 10, bottom: 25, left: 35 })
            .on('filtered', () => this.refresh());

        this.grantDateChart.xAxis()
            .ticks(d3.timeYear.every(10))
            .tickFormat(d3.timeFormat('%Y'))
            .tickSize(4);
        this.grantDateChart.yAxis().ticks(3);

        dc.grantDateChart = this.grantDateChart;
        dc.grantDateDimension = this.grantDateDimension;
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

        if (dc.grantDateDimension) {
            const rng = dc.grantDateDimension.currentFilter();
            if (rng && rng[0] && rng[1]) {
                const fmt = d3.timeFormat('%Y');
                filterTypes.push({
                    name: 'Date',
                    filters: [`${fmt(rng[0])} – ${fmt(rng[1])}`]
                });
            }
        }

        return filterTypes;
    }

    refresh() {
        const filterTypes = this.collectFilters();
        const hasActiveFilters = filterTypes.length > 0;
        const filteredRecords = dc.facts.allFiltered();
        const recordCount = filteredRecords.length;

        let menuHtml = `<span class="record-count">${recordCount.toLocaleString()} records</span>`;
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

            if (filterName === 'Date' && dc.grantDateChart) {
                dc.grantDateChart.filterAll();
            } else {
                const rowChart = dc.rowCharts.find(rc => rc.title === filterName);
                if (rowChart) {
                    rowChart.chart.filter(filterValue);
                    if (filterName === 'District') {
                        clearSearchInput('#chart-district');
                    }
                }
            }

            dc.redrawAll();
            this.refresh();
        });

        d3.select('.clear-button').on('click', () => {
            dc.filterAll();
            if (dc.grantDateChart) dc.grantDateChart.filterAll();
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

    listRecords() {
        const records = this.facts.allFiltered();

        const sorted = [...records]
            .sort((a, b) => {
                if (a.date && b.date) return b.date - a.date;
                return 0;
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

        const clemencyTag = record.clemencyType
            ? `<span class="record-tag record-tag-clemency">${record.clemencyType}</span>`
            : '';

        const presidentTag = record.presidentTerm
            ? `<span class="record-tag record-tag-president">${record.presidentTerm}</span>`
            : '';

        const districtTag = record.district
            ? `<span class="record-tag record-tag-district">${record.district}</span>`
            : '';

        const offenseLine = offense
            ? `<div class="record-offense">${offense}</div>`
            : '';

        return `
            <div class="record">
                <div class="record-header">
                    <span class="record-name">${name}</span>
                    ${dateStr}
                </div>
                <div class="record-meta">
                    ${clemencyTag}${presidentTag}${districtTag}
                </div>
                ${offenseLine}
            </div>
        `;
    }

    downloadCsv(records) {
        const columns = ['name', 'grantDate', 'clemencyType', 'presidentTerm', 'district', 'offense'];

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
