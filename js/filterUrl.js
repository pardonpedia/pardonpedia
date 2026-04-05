/**
 * Query-string sync for chart filters (Presidency, Clemency Type, Occupation, Relationship, TOPIC).
 */

export const FILTER_PARAM_KEYS = ['pre', 'clem', 'occ', 'rel', 'topic'];

const TITLE_TO_PARAM = {
    'Presidency': 'pre',
    'TOPIC': 'topic',
    'Occupation': 'occ',
    'Relationship to President': 'rel',
    'Clemency Type': 'clem',
};

const PARAM_TO_TITLE = {
    pre: 'Presidency',
    topic: 'TOPIC',
    occ: 'Occupation',
    rel: 'Relationship to President',
    clem: 'Clemency Type',
};

/** Fixed order for stable URLs */
const CHART_TITLE_ORDER = [
    'Presidency',
    'Clemency Type',
    'Occupation',
    'Relationship to President',
    'TOPIC',
];

/**
 * Merge current location search with filter types: drop known filter keys, append sorted values.
 */
export function filtersToSearchParams(filterTypes) {
    const p = new URLSearchParams(window.location.search);
    for (const k of FILTER_PARAM_KEYS) {
        p.delete(k);
    }
    const byTitle = Object.fromEntries(filterTypes.map(ft => [ft.name, ft.filters]));
    for (const title of CHART_TITLE_ORDER) {
        const param = TITLE_TO_PARAM[title];
        if (!param) continue;
        const filters = byTitle[title];
        if (!filters?.length) continue;
        [...filters]
            .map(String)
            .sort((a, b) => a.localeCompare(b))
            .forEach(v => p.append(param, v));
    }
    return p;
}

export function searchStringFromFilterTypes(filterTypes) {
    return filtersToSearchParams(filterTypes).toString();
}

/**
 * Reset dc filters and apply query params to row charts.
 */
export function applyParamsToCharts(params) {
    dc.filterAll();
    for (const key of FILTER_PARAM_KEYS) {
        const title = PARAM_TO_TITLE[key];
        const rowChart = dc.rowCharts.find(rc => rc.title === title);
        if (!rowChart) continue;
        const values = params.getAll(key);
        if (values.length === 0) continue;
        // dc.js: array-of-keys is expressed as one inner array so each key is toggled on after reset
        rowChart.chart.replaceFilter([values]);
    }
}
