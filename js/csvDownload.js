/**
 * Client-side CSV download for filtered Crossfilter rows.
 * Column arrays must stay in sync with data/pardons.csv and data/money.csv headers.
 */

/** @type {readonly string[]} */
export const PARDONS_EXPORT_COLUMNS = Object.freeze([
    'id', 'administrationId', 'presidencyNumber', 'presidentTermNumber', 'presidentName',
    'presidentTerm', 'sourceUrl', 'clemencyType', 'grantDate', 'personName', 'warrantUrl',
    'warrantKey', 'district', 'sentenced', 'offense', 'topic', 'officeHeld', 'relationship',
    'wikipediaUrl',
]);

/** @type {readonly string[]} */
export const MONEY_EXPORT_COLUMNS = Object.freeze([
    'id', 'pardonMoneyId', 'administrationId', 'presidencyNumber', 'presidentTermNumber',
    'presidentTerm', 'sourceUrl', 'clemencyType', 'grantDate', 'personName', 'warrantUrl',
    'warrantKey', 'district', 'sentenced', 'offense', 'topic', 'officeHeld', 'relationship',
    'offenseType', 'remedyType', 'forgivenAmount',
]);

/** @type {readonly string[]} */
export const REOFFENDERS_EXPORT_COLUMNS = Object.freeze([
    'pardonId', 'pardonName', 'clemencyType', 'grantDate', 'presidentName',
    'offense', 'sentenced', 'district', 'afterPardon',
    'url', 'title', 'publishDate', 'sentence', 'publisher', 'authorList',
]);

/** @type {readonly string[]} */
export const GIVEBACKS_EXPORT_COLUMNS = Object.freeze([
    'pardonId', 'name', 'grantDate', 'clemencyType', 'offenseType',
    'fineAmount', 'forfeitureAmount', 'restitutionAmount', 'presidentTerm', 'wikipediaUrl',
]);

/**
 * @param {unknown[]} records
 * @param {readonly string[]} columns
 * @param {string} downloadBasename Filename without extension (e.g. pardonpedia-2026-04-08)
 */
export function downloadFilteredCsv(records, columns, downloadBasename) {
    const escapeField = (field) => {
        if (field === null || field === undefined) return '';
        const str = String(field);
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
            return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
    };

    const header = columns.join(',');
    const rows = records.map((record) => {
        const row = /** @type {Record<string, unknown>} */ (record);
        return columns.map((col) => escapeField(row[col])).join(',');
    });

    const csvContent = [header, ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `${downloadBasename}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}
