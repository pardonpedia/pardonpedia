/**
 * TimeChart — yearly pardon histogram with presidential-term background shading
 *
 * Year boundaries are aligned to inauguration date (Jan 20), not Jan 1.
 * Background stripes alternate grey/white per unique president; consecutive
 * terms by the same president are merged into one stripe with a dotted
 * dividing line at the second-term start.
 */

// Parse a YYYY-MM-DD string as local midnight (avoids UTC-offset day-shift bugs)
function parseLocalDate(str) {
    const [y, m, d] = str.split('-').map(Number);
    return new Date(y, m - 1, d);
}

// Floor a date to the most recent Jan 20 boundary (inauguration-aligned year)
function floorToTermYear(date) {
    const y = date.getFullYear();
    const jan20 = new Date(y, 0, 20);
    return date >= jan20 ? jan20 : new Date(y - 1, 0, 20);
}

function addTermYears(date, n) {
    const d = new Date(date);
    d.setFullYear(d.getFullYear() + n);
    return d;
}

// xUnits: returns array of year-start dates (Jan 20) in [start, end)
function termYearUnits(start, end) {
    const years = [];
    let current = floorToTermYear(start);
    while (current < end) {
        years.push(current);
        current = addTermYears(current, 1);
    }
    return years;
}

// Build merged president regions from adminData.
// Consecutive rows with the same presidentId are collapsed into one stripe.
// If a president served two consecutive terms, termBoundary records the
// second-term inauguration date for the dotted dividing line.
function buildPresidentRegions(adminData) {
    const sorted = [...adminData].sort((a, b) => parseLocalDate(a.startDate) - parseLocalDate(b.startDate));
    const regions = [];
    for (const term of sorted) {
        const last = regions[regions.length - 1];
        const termEnd = term.endDate ? parseLocalDate(term.endDate) : new Date(2099, 0, 1);
        if (last && last.presidentId === term.presidentId) {
            last.termBoundary = parseLocalDate(term.startDate);
            last.endDate = termEnd;
        } else {
            regions.push({
                presidentId:   term.presidentId,
                displayName:   term.displayName,
                lastName:      term.lastName,
                party:         term.partyAbbreviation,
                startDate:     parseLocalDate(term.startDate),
                endDate:       termEnd,
                termBoundary:  null,
            });
        }
    }

    // Disambiguate presidents sharing a last name (e.g. both Bushes):
    // replace label with everything after the first word of displayName
    const lastNameCounts = new Map();
    regions.forEach(r => lastNameCounts.set(r.lastName, (lastNameCounts.get(r.lastName) ?? 0) + 1));
    regions.forEach(r => {
        r.label = lastNameCounts.get(r.lastName) > 1
            ? r.displayName.replace(/^\S+\s/, '')  // "George H. W. Bush" → "H. W. Bush"
            : r.lastName;
    });

    return regions;
}

export class TimeChart {
    constructor(facts, adminData, parentSelector, updateFn) {
        this.facts          = facts;
        this.adminData      = adminData;
        this.parentSelector = parentSelector;
        this.updateFn       = updateFn;
        this.title          = 'Grant Year';

        // Sorted term spans for party lookup by exact date range
        this._termSpans = adminData
            .map(d => ({
                start: parseLocalDate(d.startDate),
                end:   d.endDate ? parseLocalDate(d.endDate) : new Date(2099, 0, 1),
                party: d.partyAbbreviation,
            }))
            .sort((a, b) => a.start - b.start);

        this.presidentRegions = buildPresidentRegions(adminData);

        this._setup();
    }

    _setup() {
        // Use a sentinel Date (Jan 1, 1900) for records without dates instead of null.
        // Crossfilter miscomputes group counts when null keys are present and another
        // dimension is filtered, causing all bars to disappear.
        const SENTINEL = new Date(1900, 0, 1);

        this.dimension = this.facts.dimension(d => {
            if (!d.date || isNaN(d.date)) return SENTINEL;
            return floorToTermYear(d.date);
        });

        const rawGroup = this.dimension.group().reduceCount();
        const filteredGroup = {
            all: () => rawGroup.all().filter(d => d.key > SENTINEL),
            top: n => rawGroup.top(Infinity).filter(d => d.key > SENTINEL).slice(0, n),
        };

        // Domain: first inauguration → a couple of years past the last term end
        const sorted      = [...this.adminData].sort((a, b) => parseLocalDate(a.startDate) - parseLocalDate(b.startDate));
        const domainStart = floorToTermYear(parseLocalDate(sorted[0].startDate));
        const lastEnd     = sorted[sorted.length - 1].endDate;
        const domainEnd   = lastEnd ? addTermYears(floorToTermYear(parseLocalDate(lastEnd)), 2)
                                    : addTermYears(floorToTermYear(new Date()), 2);

        const container = document.querySelector(this.parentSelector);
        const rawW     = container ? container.clientWidth || 800 : 800;
        /* Trim a few px so bar chart width does not overflow the grid row and show a horizontal scrollbar. */
        const width    = Math.max(100, Math.floor(rawW) - 4);
        const height = 104;

        this.chart = new dc.BarChart(this.parentSelector);
        this.chart
            .width(width)
            .height(height)
            .dimension(this.dimension)
            .group(filteredGroup)
            .x(d3.scaleTime().domain([domainStart, domainEnd]))
            .xUnits(termYearUnits)
            .elasticY(true)
            .y(d3.scaleSqrt())
            .centerBar(false)
            .brushOn(false)
            .barPadding(0.2)
            .outerPadding(0)
            .margins({ top: 22, right: 10, bottom: 25, left: 35 })
            // colorAccessor receives the raw group datum {key, value} — d.key is the Date
            .colorAccessor(d => this._partyForDate(d.key))
            .colors(party => party === 'D' ? '#6699cc' : party === 'R' ? '#cc6666' : '#aecde8')
            .on('pretransition', chart => this._decorate(chart));

        this.chart.xAxis()
            .tickValues(this._inaugurationTicks())
            .tickFormat(d3.timeFormat('%Y'))
            .tickSize(4);
        this.chart.yAxis().ticks(3);

        dc.timeChart     = this.chart;
        dc.timeDimension = this.dimension;

        // Redraw whenever the container changes width
        this._resizeObserver = new ResizeObserver(entries => {
            const newWidth = Math.max(100, Math.floor(entries[0].contentRect.width) - 4);
            if (newWidth > 0 && Math.abs(newWidth - this.chart.width()) > 2) {
                this.chart.width(newWidth);
                this.chart.render();
            }
        });
        if (container) this._resizeObserver.observe(container.parentElement ?? container);
    }

    // Returns 'D', 'R', or null for the party in office on a given date
    _partyForDate(date) {
        for (const span of this._termSpans) {
            if (date >= span.start && date < span.end) return span.party;
        }
        return null;
    }

    // Ticks at every president region start, plus term-boundary midpoints for two-term presidents
    _inaugurationTicks() {
        const ticks = [];
        this.presidentRegions.forEach(r => {
            ticks.push(r.startDate);
            if (r.termBoundary) ticks.push(r.termBoundary);
        });
        return ticks;
    }

    _decorate(chart) {
        const g          = chart.select('g.chart-body');
        const svg        = chart.select('svg');
        const xScale     = chart.x();
        const chartH     = chart.effectiveHeight();
        const chartW     = chart.effectiveWidth();
        const marginLeft = chart.margins().left;
        const marginTop  = chart.margins().top;

        // --- 1. Background president stripes ---
        g.selectAll('.president-bg').remove();

        this.presidentRegions.forEach((region, i) => {
            const x1 = Math.max(0, xScale(region.startDate));
            const x2 = Math.min(chartW, xScale(region.endDate));
            if (x2 <= x1) return;

            g.insert('rect', ':first-child')
                .attr('class', 'president-bg')
                .attr('x', x1)
                .attr('y', 0)
                .attr('width', x2 - x1)
                .attr('height', chartH)
                .attr('fill', i % 2 === 0 ? '#eeeeee' : '#ffffff');

            // Dotted line at the boundary between consecutive terms of the same president
            if (region.termBoundary) {
                const xb = xScale(region.termBoundary);
                if (xb > 0 && xb < chartW) {
                    g.append('line')
                        .attr('class', 'president-bg')
                        .attr('x1', xb).attr('x2', xb)
                        .attr('y1', 0).attr('y2', chartH)
                        .attr('stroke', '#aaa')
                        .attr('stroke-width', 1)
                        .attr('stroke-dasharray', '3,3');
                }
            }
        });

        // --- 2. President name labels (in SVG top margin, outside clip-path) ---
        svg.selectAll('.president-label').remove();

        this.presidentRegions.forEach((region) => {
            const x1 = Math.max(0, xScale(region.startDate));
            const x2 = Math.min(chartW, xScale(region.endDate));
            if (x2 <= x1) return;

            const cx = Math.max(x1 + 2, Math.min(x2 - 2, (x1 + x2) / 2));

            svg.append('text')
                .attr('class', 'president-label')
                .attr('x', marginLeft + cx)
                .attr('y', marginTop - 5)
                .attr('text-anchor', 'middle')
                .attr('font-size', '11px')
                .attr('font-weight', '600')
                .attr('fill', '#888')
                .attr('pointer-events', 'none')
                .text(region.label);
        });

    }
}
