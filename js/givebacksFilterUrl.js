/**
 * Query-string sync for Givebacks row charts (Offense, Remedy).
 */

export const GIVEBACKS_FILTER_PARAM_KEYS = ['off', 'rem'];

const TITLE_TO_PARAM = {
    Offense: 'off',
    Remedy: 'rem',
};

const PARAM_TO_TITLE = {
    off: 'Offense',
    rem: 'Remedy',
};

const CHART_TITLE_ORDER = ['Remedy', 'Offense'];

export function givebacksFiltersToSearchParams(filterTypes) {
    const p = new URLSearchParams(window.location.search);
    for (const k of GIVEBACKS_FILTER_PARAM_KEYS) {
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

export function givebacksSearchStringFromFilterTypes(filterTypes) {
    return givebacksFiltersToSearchParams(filterTypes).toString();
}

export function applyGivebacksParamsToCharts(params) {
    dc.filterAll();
    for (const key of GIVEBACKS_FILTER_PARAM_KEYS) {
        const title = PARAM_TO_TITLE[key];
        const rowChart = dc.rowCharts.find(rc => rc.title === title);
        if (!rowChart) continue;
        const values = params.getAll(key);
        if (values.length === 0) continue;
        rowChart.chart.replaceFilter([values]);
    }
}
