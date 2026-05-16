/**
 * Reoffenders page — loads reoffenders.csv.gz and renders a table of
 * pardoned individuals subsequently reported in connection with new charges.
 */

import { escapeHtml, formatShortDate, formatMetaUpdatedDate, parseCsvGrantDate, slugify } from './shared.js';
import { trackPageView } from './analytics.js';
import { downloadFilteredCsv, REOFFENDERS_EXPORT_COLUMNS } from './csvDownload.js';

trackPageView();

/** Parse a CSV publish date (ISO datetime or YYYY-MM-DD). Returns null for epoch/missing. */
function parsePublishDate(str) {
    if (!str || typeof str !== 'string') return null;
    const trimmed = str.trim().slice(0, 10);
    if (!trimmed || trimmed === '1970-01-01') return null;
    const d = parseCsvGrantDate(trimmed);
    return (d instanceof Date && !Number.isNaN(d.getTime())) ? d : null;
}

/** Simple CSV parser that handles quoted fields with embedded commas and newlines. */
function parseCsv(text) {
    const rows = [];
    let headers = null;
    let pos = 0;
    const len = text.length;

    function parseField() {
        if (pos < len && text[pos] === '"') {
            pos++; // skip opening quote
            let val = '';
            while (pos < len) {
                if (text[pos] === '"') {
                    if (pos + 1 < len && text[pos + 1] === '"') {
                        val += '"';
                        pos += 2;
                    } else {
                        pos++; // skip closing quote
                        break;
                    }
                } else {
                    val += text[pos++];
                }
            }
            return val;
        }
        let val = '';
        while (pos < len && text[pos] !== ',' && text[pos] !== '\n' && text[pos] !== '\r') {
            val += text[pos++];
        }
        return val;
    }

    function parseLine() {
        const fields = [];
        while (pos < len) {
            fields.push(parseField());
            if (pos < len && text[pos] === ',') {
                pos++;
            } else {
                // end of line
                if (pos < len && text[pos] === '\r') pos++;
                if (pos < len && text[pos] === '\n') pos++;
                break;
            }
        }
        return fields;
    }

    while (pos < len) {
        const fields = parseLine();
        if (!fields.length || (fields.length === 1 && fields[0] === '')) continue;
        if (!headers) {
            headers = fields;
        } else {
            const obj = {};
            headers.forEach((h, i) => { obj[h] = fields[i] ?? ''; });
            rows.push(obj);
        }
    }
    return rows;
}

function renderRows(records) {
    const tbody = document.getElementById('reoffenders-table-body');
    if (!tbody) return;

    const menuInfo = document.getElementById('menu-info');
    if (menuInfo) {
        const personCount = new Set(records.map(r => r.pardonId)).size;
        menuInfo.textContent = `${personCount} pardonee${personCount !== 1 ? 's' : ''} with other alleged crimes`;
    }

    // Group consecutive rows by pardonId so we can apply rowspan to the name cell
    const groups = [];
    records.forEach(r => {
        const id = (r.pardonId || '').trim();
        const last = groups[groups.length - 1];
        if (last && last.pardonId === id) {
            last.rows.push(r);
        } else {
            groups.push({ pardonId: id, rows: [r] });
        }
    });

    function renderSourceRow(r, nameCell, crimeCell, isGroupStart = false) {
        const title = (r.title || '').trim();
        const url = (r.url || '').trim();
        const publisher = (r.publisher || '').trim();
        const authorList = (r.authorList || '').trim();
        const publishDate = parsePublishDate(r.publishDate);
        const image = (r.image || '').trim();

        const chargesHtml = title
            ? escapeHtml(title)
            : '<span class="re-placeholder">[Details not yet available]</span>';

        const titleLinkHtml = url
            ? `<a class="re-source-title" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${title ? escapeHtml(title) : escapeHtml(url)}</a>`
            : (title
                ? `<span class="re-source-title">${escapeHtml(title)}</span>`
                : `<span class="re-source-title re-placeholder">[Headline not available]</span>`);

        const publisherHtml = publisher
            ? `<span class="re-source-publisher">${escapeHtml(publisher)}</span>`
            : `<span class="re-source-publisher re-placeholder">[Publisher unknown]</span>`;

        const authorsHtml = authorList
            ? `<span class="re-source-authors">${escapeHtml(authorList)}</span>`
            : '';

        const dateHtml = publishDate
            ? `<span class="re-source-date">${escapeHtml(formatShortDate(publishDate))}</span>`
            : '';

        const thumbHtml = image
            ? `<div class="re-source-thumb-wrap">${url
                ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer"><img class="re-source-thumb" src="${escapeHtml(image)}" alt="" loading="lazy"></a>`
                : `<img class="re-source-thumb" src="${escapeHtml(image)}" alt="" loading="lazy">`
              }</div>`
            : '';

        const excerpt = (r.sentence || '').trim();
        const excerptHtml = excerpt
            ? `<blockquote class="re-source-excerpt">${escapeHtml(excerpt)}</blockquote>`
            : '';

        const afterPardon = (r.afterPardon || '').trim().toLowerCase();
        const afterPardonPill = afterPardon === 'true'
            ? '<span class="re-after-pill re-after-yes">After Pardon</span>'
            : afterPardon === 'false'
                ? '<span class="re-after-pill re-after-no">Before Pardon</span>'
                : '';

        const sourceCardHtml = `
            <div class="re-source-cell-wrap">
                ${afterPardonPill}
                <div class="re-source-card${image ? ' re-source-card--has-thumb' : ''}">
                    ${thumbHtml}
                    <div class="re-source-card-body">
                        ${titleLinkHtml}
                        <div class="re-source-meta">
                            ${[publisherHtml, authorsHtml, dateHtml].filter(Boolean).join('<span class="re-source-sep">·</span>')}
                        </div>
                    </div>
                    ${excerptHtml}
                </div>
            </div>`;

        return `<tr${isGroupStart ? ' class="re-group-start"' : ''}>
            ${nameCell}
            <td class="re-cell-source">${sourceCardHtml}</td>
            ${crimeCell}
        </tr>`;
    }

    const html = groups.map(group => {
        const pardonName = (group.rows[0].pardonName || '').trim();
        const pardonSlug = pardonName ? slugify(pardonName) : '';
        const nameLink = pardonSlug
            ? `<a href="index.html?pardon=${escapeHtml(pardonSlug)}" class="re-pardon-link">${escapeHtml(pardonName)}</a>`
            : escapeHtml(pardonName) || '<span class="re-placeholder">—</span>';
        const nameInner = `<div class="re-name-wrap"><div class="re-name-text">${nameLink}</div></div>`;

        const rowspan = group.rows.length > 1 ? ` rowspan="${group.rows.length}"` : '';
        const nameCell = `<td class="re-cell-name"${rowspan}>${nameInner}</td>`;

        const offense = (group.rows[0].offense || '').trim();
        const sentenced = (group.rows[0].sentenced || '').trim();
        const crimeHtml = `
            <div class="re-crime-jan6-header">
                <span class="re-jan6-pill">January 6th</span>
            </div>
            <div class="re-crime-block">
                <span class="re-crime-label">Offense</span>
                <span class="re-crime-value">${offense ? escapeHtml(offense) : '<span class="re-placeholder">—</span>'}</span>
            </div>
            ${sentenced ? `<div class="re-crime-block">
                <span class="re-crime-label">Sentence</span>
                <span class="re-crime-value">${escapeHtml(sentenced)}</span>
            </div>` : ''}`;
        const crimeCell = `<td class="re-cell-crime"${rowspan}>${crimeHtml}</td>`;

        return group.rows.map((r, i) => renderSourceRow(r, i === 0 ? nameCell : '', i === 0 ? crimeCell : '', i === 0)).join('');
    }).join('');

    tbody.innerHTML = html;
}

async function init() {
    const overlay = document.getElementById('loading-overlay');
    overlay.classList.replace('loading-hidden', 'loading-visible');

    try {
        const [dataResp, metaResp] = await Promise.all([
            fetch('data/reoffenders.csv.gz'),
            fetch('data/pardons.meta.json'),
        ]);

        const [buf, metaJson] = await Promise.all([
            dataResp.arrayBuffer(),
            metaResp.json(),
        ]);

        const text = pako.inflate(new Uint8Array(buf), { to: 'string' });
        const records = parseCsv(text);

        // Sort alphabetically by name, then by storyPardonId within each person
        records.sort((a, b) => {
            const byName = (a.pardonName || '').localeCompare(b.pardonName || '', undefined, { sensitivity: 'base' });
            if (byName !== 0) return byName;
            return (+a.storyPardonId || 0) - (+b.storyPardonId || 0);
        });

        renderRows(records);

        const downloadBtn = document.getElementById('download-csv');
        if (downloadBtn) {
            downloadBtn.addEventListener('click', () => {
                const date = new Date().toISOString().slice(0, 10);
                downloadFilteredCsv(records, REOFFENDERS_EXPORT_COLUMNS, `pardonpedia-reoffenders-${date}`);
            });
        }

        const generatedAt = metaJson?.reoffenders?.generated_at;
        if (generatedAt) {
            const formatted = formatMetaUpdatedDate(generatedAt);
            const el = document.getElementById('updated-date');
            if (el && formatted) el.textContent = `Updated ${formatted}`;
        }
    } finally {
        overlay.classList.replace('loading-visible', 'loading-hidden');
    }
}

init();
