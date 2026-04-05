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

// Slugify a string
export function slugify(text) {
    return text.toString().toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^\w\-]+/g, '')
        .replace(/\-\-+/g, '-')
        .replace(/^-+/, '')
        .replace(/-+$/, '');
}
