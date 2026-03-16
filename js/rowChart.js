export class RowChart {
    constructor(facts, attribute, width, maxItems, updateFunction, title, dim, parentSelector = '#chart-container', showSearch = false, singleSelect = false, ordering = null, barColorFn = null) {
        this.title = title;
        this.field = attribute;
        this.singleSelect = singleSelect;
        this.dim = dim ? dim : facts.dimension(d => d[attribute] || '');
        this.group = this.dim.group().reduceSum(dc.pluck('count'));

        this.group = removeZeroes(this.group);

        const ROW_HEIGHT = 20;
        const MARGINS = { top: 0, right: 10, bottom: 20, left: 10 };

        const container = d3.select(parentSelector)
            .append('div')
            .attr('id', 'chart-' + attribute);

        const titleRow = container.append('div')
            .attr('class', 'chart-title');

        titleRow.append('span')
            .attr('class', 'chart-title-text')
            .text(title);


        const contentId = 'chart-' + attribute + '-content';

        if (showSearch) {
            const group = this.group;
            const chartRef = { chart: null };

            const searchContainer = container.append('div')
                .attr('class', 'chart-search-container');

            const searchInput = searchContainer.append('input')
                .attr('type', 'text')
                .attr('class', 'chart-search')
                .attr('placeholder', 'Find ' + title.toLowerCase())
                .attr('spellcheck', 'false');

            searchContainer.append('span')
                .attr('class', 'chart-search-icon')
                .html('⌕');

            const clearBtn = searchContainer.append('button')
                .attr('class', 'chart-search-clear')
                .attr('type', 'button')
                .text('✕');

            const dropdown = searchContainer.append('div')
                .attr('class', 'chart-search-dropdown');

            let selectedIndex = -1;

            const getAllItems = () => {
                return group.top(Infinity).filter(d => d.value > 0);
            };

            const renderDropdown = (searchTerm) => {
                if (!searchTerm) {
                    dropdown.style('display', 'none');
                    return;
                }

                const items = getAllItems();
                const matches = items
                    .filter(d => d.key.toLowerCase().includes(searchTerm.toLowerCase()))
                    .slice(0, 12);

                if (matches.length === 0) {
                    dropdown.style('display', 'none');
                    return;
                }

                dropdown.html('');
                matches.forEach((d, i) => {
                    dropdown.append('div')
                        .attr('class', 'chart-search-item' + (i === selectedIndex ? ' selected' : ''))
                        .attr('data-value', d.key)
                        .html(`<span class="item-name">${d.key}</span><span class="item-count">${d.value.toLocaleString()}</span>`);
                });

                dropdown.style('display', 'block');

                dropdown.selectAll('.chart-search-item').on('mousedown', function(event) {
                    event.preventDefault();
                    const value = d3.select(this).attr('data-value');
                    selectItem(value);
                });
            };

            const selectItem = (value) => {
                if (chartRef.chart) {
                    chartRef.chart.filter(value);
                    dc.redrawAll();
                    updateFunction();
                }
                searchInput.property('value', value);
                searchInput.classed('has-selection', true);
                searchContainer.classed('has-selection', true);
                dropdown.style('display', 'none');
                selectedIndex = -1;
            };

            searchInput.on('input', function() {
                if (searchInput.classed('has-selection')) {
                    searchInput.classed('has-selection', false);
                    searchContainer.classed('has-selection', false);
                }
                selectedIndex = -1;
                renderDropdown(this.value);
            });

            searchInput.on('keydown', function(event) {
                const items = dropdown.selectAll('.chart-search-item');
                const count = items.size();

                if (event.key === 'ArrowDown') {
                    event.preventDefault();
                    selectedIndex = Math.min(selectedIndex + 1, count - 1);
                    items.classed('selected', (d, i) => i === selectedIndex);
                } else if (event.key === 'ArrowUp') {
                    event.preventDefault();
                    selectedIndex = Math.max(selectedIndex - 1, 0);
                    items.classed('selected', (d, i) => i === selectedIndex);
                } else if (event.key === 'Enter' && selectedIndex >= 0) {
                    event.preventDefault();
                    const selected = items.filter((d, i) => i === selectedIndex);
                    if (!selected.empty()) {
                        selectItem(selected.attr('data-value'));
                    }
                } else if (event.key === 'Escape') {
                    dropdown.style('display', 'none');
                    selectedIndex = -1;
                }
            });

            searchInput.on('blur', function() {
                setTimeout(() => dropdown.style('display', 'none'), 150);
            });

            clearBtn.on('click', function() {
                if (searchInput.classed('has-selection') && chartRef.chart) {
                    const currentValue = searchInput.property('value');
                    chartRef.chart.filter(currentValue);
                    dc.redrawAll();
                    updateFunction();
                }
                searchInput.property('value', '');
                searchInput.classed('has-selection', false);
                searchContainer.classed('has-selection', false);
                dropdown.style('display', 'none');
                selectedIndex = -1;
            });

            this.setChartRef = (chart) => { chartRef.chart = chart; };
        }

        container.append('div')
            .attr('id', contentId)
            .attr('class', 'chart-scroll');

        this.chart = dc.rowChart('#chart-' + attribute + '-content')
            .dimension(this.dim)
            .group(this.group)
            .data(ordering
                ? g => g.top(Infinity).filter(d => d.value > 0).sort((a, b) => ordering(a) - ordering(b)).slice(0, maxItems)
                : g => g.top(maxItems))
            .width(width)
            .height(Math.max(1, Math.min(maxItems, this.group.all().length)) * (ROW_HEIGHT + 2) + MARGINS.top + MARGINS.bottom + 8)
            .fixedBarHeight(ROW_HEIGHT)
            .margins(MARGINS)
            .elasticX(true)
            .colors(['#aecde8'])
            .label(d => d.key)
            .labelOffsetX(5)
            .on('filtered', () => updateFunction())
            .on('pretransition', chart => {
                chart.selectAll('g.axis').remove();
                chart.selectAll('path.domain').remove();
                chart.selectAll('.grid-line').remove();

                const filters = chart.filters();
                const innerWidth = chart.width() - chart.margins().left - chart.margins().right;

                chart.selectAll('g.row').each(function(d) {
                    const row = d3.select(this);
                    const rect = row.select('rect');
                    const isSelected = filters.includes(d.key);

                    if (barColorFn) {
                        rect.attr('fill', barColorFn(d.key));
                    }

                    if (isSelected) {
                        rect.attr('stroke', '#1a365d')
                            .attr('stroke-width', 2);
                    } else {
                        rect.attr('stroke', null)
                            .attr('stroke-width', null);
                    }

                    row.selectAll('text.count-label').remove();
                    row.append('text')
                        .attr('class', 'count-label')
                        .attr('x', innerWidth - 2)
                        .attr('y', ROW_HEIGHT / 2)
                        .attr('dy', '0.35em')
                        .attr('text-anchor', 'end')
                        .text(d.value.toLocaleString());
                });
            });

        this.chart.xAxis().ticks(0).tickSize(0).tickFormat(() => '');


        if (singleSelect) {
            this.chart.filterHandler((dimension, filters) => {
                if (filters.length === 0) {
                    dimension.filter(null);
                } else {
                    dimension.filterExact(filters[filters.length - 1]);
                }
                return filters;
            });
        }

        const getVisibleData = ordering
            ? () => this.group.top(Infinity).filter(d => d.value > 0).sort((a, b) => ordering(a) - ordering(b)).slice(0, maxItems)
            : () => this.group.top(maxItems);

        const adjustHeight = () => {
            const visibleData = getVisibleData();
            const visible = visibleData.length;
            this.chart.height(Math.max(1, visible) * (ROW_HEIGHT + 2) + MARGINS.top + MARGINS.bottom + 8);
        };
        this.chart.on('preRender', adjustHeight);
        this.chart.on('preRedraw', adjustHeight);


        if (this.setChartRef) {
            this.setChartRef(this.chart);
        }

        function removeZeroes(group) {
            const keep = d => d.value > 0 && d.key !== '' && d.key !== null && d.key !== undefined;
            return {
                all: () => group.all().filter(keep),
                top: n => group.top(Infinity).filter(keep).slice(0, n)
            };
        }
    }
}
