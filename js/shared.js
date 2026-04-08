/**
 * Shared utilities for PardonPedia
 */

// Format date as "January 1, 2022"
export function formatDate(date, includeDayOfWeek = false) {
    const daysOfWeek = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    const monthNames = [
        'January', 'February', 'March',
        'April', 'May', 'June', 'July',
        'August', 'September', 'October',
        'November', 'December'
    ];

    const day = date.getDate();
    const monthIndex = date.getMonth();
    const year = date.getFullYear();

    const rslt = monthNames[monthIndex] + ' ' + day + ', ' + year;

    if (!includeDayOfWeek)
        return rslt;
    else
        return daysOfWeek[date.getDay()] + ', ' + rslt;
}

/** e.g. "Oct 17, 2025" */
export function formatShortDate(date) {
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${monthNames[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}

/**
 * Parse CSV grantDate (YYYY-MM-DD or ISO datetime) as local calendar midnight.
 * Avoids UTC day-shift from `new Date(iso)` and bad numeric day when a time suffix is present.
 */
export function parseCsvGrantDate(str) {
    if (!str || typeof str !== 'string') return undefined;
    const ymd = str.trim().slice(0, 10);
    const parts = ymd.split('-');
    if (parts.length !== 3) return new Date(NaN);
    const [y, m, d] = parts.map(Number);
    if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return new Date(NaN);
    return new Date(y, m - 1, d);
}

/** Human-readable calendar date for pipeline `generated_at` (UTC date of the build). */
export function formatMetaUpdatedDate(isoTimestamp) {
    const d = new Date(isoTimestamp);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric',
        timeZone: 'UTC',
    });
}

export function escapeHtml(s) {
    if (s === null || s === undefined) return '';
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/"/g, '&quot;');
}

// Add commas to numbers: 123456789 -> '123,456,789'
export function addCommas(number) {
    return number.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// Smooth scroll to top of a container
export function scrollToTop(divId) {
    d3.select(divId)
        .transition()
        .duration(750)
        .tween('scrollTop', function() {
            let node = this;
            let i = d3.interpolateNumber(node.scrollTop, 0);
            return function(t) { node.scrollTop = i(t); };
        });
}

/**
 * Givebacks remedy label → stable slug for CSS / chart colors (Fine, Restitution, Forfeiture).
 */
export function remedyTypeSlug(remedyRaw) {
    const t = String(remedyRaw || '').trim().toLowerCase();
    if (t === 'fine') return 'fine';
    if (t === 'restitution') return 'restitution';
    if (t === 'forfeiture') return 'forfeiture';
    return 'other';
}

/**
 * Stacked time chart + row-chart bar fills. Order: bottom → top stack. No red/blue.
 */
export const REMEDY_STACK_SPECS = [
    { slug: 'fine', label: 'Fine' },
    { slug: 'restitution', label: 'Restitution' },
    { slug: 'forfeiture', label: 'Forfeiture' },
    { slug: 'other', label: 'Other' },
];

const REMEDY_BAR_FILL = {
    fine: '#ca8a04',
    restitution: '#059669',
    forfeiture: '#9333ea',
    other: '#64748b',
};

export function remedyBarFill(slug) {
    return REMEDY_BAR_FILL[slug] || REMEDY_BAR_FILL.other;
}

// Slugify a string
export function slugify(text) {
    return text.toString().toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^\w\-]+/g, '')
        .replace(/\-\-+/g, '-')
        .replace(/^-+/, '')
        .replace(/-+$/, '');
}
