/**
 * Givebacks time chart: month-binned total forgiven amount (single bars, neutral fill).
 */

/** First day shown on axis (inclusive) */
const DOMAIN_START = new Date(2025, 0, 20);
/** Last grant day in range (inclusive) */
const DOMAIN_LAST_DAY = new Date(2026, 3, 8);
/** Exclusive upper bound for time scale */
const DOMAIN_STOP_EXCL = new Date(2026, 3, 9);

const YEAR_2026_START = new Date(2026, 0, 1);

const SENTINEL = new Date(1900, 0, 1);

const MONTH_RANGE_START = d3.timeMonth.floor(DOMAIN_START);
const MONTH_RANGE_STOP_EXCL = d3.timeMonth.offset(d3.timeMonth.floor(DOMAIN_LAST_DAY), 1);

function givebacksMonthUnits() {
    return d3.timeMonths(MONTH_RANGE_START, MONTH_RANGE_STOP_EXCL);
}

function filterSentinelGroup(rawGroup) {
    return {
        all() {
            return rawGroup.all().filter(d => d.key > SENTINEL);
        },
        top(n) {
            return rawGroup.top(Infinity).filter(d => d.key > SENTINEL).slice(0, n);
        },
    };
}

export class ForgivenAmountMonthChart {
    constructor(facts, parentSelector, updateFn) {
        this.facts = facts;
        this.parentSelector = parentSelector;
        this.updateFn = updateFn;
        this.title = 'Forgiven amount by month';
        this._setup();
    }

    _setup() {
        this.dimension = this.facts.dimension(d => {
            if (!d.date || isNaN(d.date)) return SENTINEL;
            if (d.date < DOMAIN_START || d.date > DOMAIN_LAST_DAY) return SENTINEL;
            return d3.timeMonth.floor(d.date);
        });

        const rawGroup = this.dimension.group().reduceSum(d => Number(d.forgivenAmountNum) || 0);
        const group = filterSentinelGroup(rawGroup);

        const container = document.querySelector(this.parentSelector);
        const rawW = container ? container.clientWidth || 800 : 800;
        const width = Math.max(100, Math.floor(rawW) - 4);
        const height = 100;

        this.chart = new dc.BarChart(this.parentSelector);
        this.chart
            .width(width)
            .height(height)
            .dimension(this.dimension)
            .group(group)
            .x(d3.scaleTime().domain([MONTH_RANGE_START, MONTH_RANGE_STOP_EXCL]))
            .xUnits(givebacksMonthUnits)
            .elasticY(true)
            .centerBar(false)
            .brushOn(false)
            .barPadding(0.25)
            .outerPadding(0)
            .margins({ top: 8, right: 10, bottom: 25, left: 45 })
            .colors(['#aecde8'])
            .colorAccessor(() => 0)
            .on('pretransition', chart => this._decorateYearBackground(chart));

        this.chart.xAxis()
            .ticks(d3.timeMonth.every(1))
            .tickFormat(d3.timeFormat('%b %Y'))
            .tickSize(4);
        const yTickMoney = v => new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD',
            minimumFractionDigits: 0,
            maximumFractionDigits: 0,
            notation: 'compact',
            compactDisplay: 'short',
        }).format(Math.round(v));
        this.chart.yAxis().ticks(4).tickFormat(yTickMoney);

        dc.timeChart = this.chart;
        dc.timeDimension = this.dimension;

        this._resizeObserver = new ResizeObserver(entries => {
            const newWidth = Math.max(100, Math.floor(entries[0].contentRect.width) - 4);
            if (newWidth > 0 && Math.abs(newWidth - this.chart.width()) > 2) {
                this.chart.width(newWidth);
                this.chart.render();
            }
        });
        if (container) this._resizeObserver.observe(container.parentElement ?? container);
    }

    /**
     * Grey year labels: top-left of each half (2025 at y-axis, 2026 from Jan 1); dotted boundary line.
     */
    _decorateYearBackground(chart) {
        const g = chart.select('g.chart-body');
        const xScale = chart.x();
        const chartH = chart.effectiveHeight();
        const chartW = chart.effectiveWidth();

        g.selectAll('.givebacks-year-decoration').remove();
        const layer = g.insert('g', ':first-child').attr('class', 'givebacks-year-decoration');

        const xSplit = xScale(YEAR_2026_START);
        const x0 = 0;
        const x1 = chartW;
        const xNudge = 6;
        const yTop = 0;
        const fontSize = Math.min(22, Math.max(11, chartW / 36));

        const addLabel = (x, yearStr, anchor) => {
            layer.append('text')
                .attr('x', x)
                .attr('y', yTop)
                .attr('font-size', `${fontSize}px`)
                .text(yearStr)
                .attr('pointer-events', 'none')
                .attr('font-weight', '800')
                .attr('font-family', 'DM Sans, system-ui, sans-serif')
                .attr('fill', '#8a8a8a')
                .attr('fill-opacity', 0.35)
                .attr('dominant-baseline', 'hanging')
                .attr('text-anchor', anchor);
        };

        if (xSplit > x0 && xSplit < x1) {
            layer.append('line')
                .attr('x1', xSplit)
                .attr('x2', xSplit)
                .attr('y1', 0)
                .attr('y2', chartH)
                .attr('stroke', '#7a7a7a')
                .attr('stroke-width', 1)
                .attr('stroke-dasharray', '4 4')
                .attr('pointer-events', 'none');
            addLabel(x0 + xNudge, '2025', 'start');
            addLabel(xSplit + xNudge, '2026', 'start');
        }
        else {
            addLabel(x0 + xNudge, xSplit >= x1 ? '2025' : '2026', 'start');
        }
    }
}

/** @deprecated Use ForgivenAmountMonthChart */
export const ForgivenAmountWeekChart = ForgivenAmountMonthChart;
