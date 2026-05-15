/**
 * Shared detail panel HTML + warrant PDF preview (Pardons and Givebacks).
 */

import { formatDate, escapeHtml, remedyTypeSlug, parseCsvGrantDate } from './shared.js';

/** Readable clemency label (matches names-list styling). */
function clemencyTypeLine(type) {
    const t = (type || '').toLowerCase();
    if (t === 'commutation') return 'Commutation';
    if (t === 'pardon') return 'Pardon';
    return (type || '').trim();
}

/** "Pardoned by …" / "Commuted by …" (or typed fallback) when president is known. */
function clemencyByPresidentPhrase(type, presidentName) {
    const pres = (presidentName || '').trim();
    if (!pres) return '';
    const t = (type || '').toLowerCase();
    if (t === 'pardon') return `Pardoned by ${pres}`;
    if (t === 'commutation') return `Commuted by ${pres}`;
    const label = clemencyTypeLine(type);
    if (!label) return `Granted by ${pres}`;
    return `${label} by ${pres}`;
}

/** Non-empty facet for pills; omits blank and literal "None" from charts. */
function detailFacet(value) {
    const v = typeof value === 'string' ? value.trim() : (value == null ? '' : String(value).trim());
    if (!v || v === 'None') return '';
    return v;
}

function detailPill(value, className) {
    const v = detailFacet(value);
    if (!v) return '';
    return `<span class="record-tag ${className}">${v}</span>`;
}

/** Parsed giveback dollars + remedy label, or null if no amount. */
function givebackMoneyAndRemedy(record) {
    let amt = Number(record.forgivenAmountNum);
    if (!Number.isFinite(amt) || amt <= 0) {
        const raw = record.forgivenAmount;
        amt = raw === '' || raw == null ? NaN : Number(raw);
    }
    if (!Number.isFinite(amt) || amt <= 0) return null;

    const remedyRaw = typeof record.remedyType === 'string' ? record.remedyType.trim() : '';
    const remedyLabel = remedyRaw && remedyRaw !== 'None' ? remedyRaw : '';

    const moneyStr = new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
    }).format(amt);

    return { moneyStr, remedyLabel, slug: remedyTypeSlug(remedyLabel) };
}

function formatCourtDocDateCell(raw) {
    const s = (raw == null ? '' : String(raw)).trim();
    if (!s) return '—';
    const d = parseCsvGrantDate(s);
    if (!d || Number.isNaN(d.getTime())) return escapeHtml(s);
    return escapeHtml(formatDate(d));
}

function asTrimmedString(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function parseOptionalBool(value) {
    if (value == null) return null;
    const s = String(value).trim().toLowerCase();
    if (!s) return null;
    if (s === 'true' || s === '1' || s === 'yes' || s === 'y') return true;
    if (s === 'false' || s === '0' || s === 'no' || s === 'n') return false;
    return null;
}

function detailSourceLabel(sourceUrl) {
    const url = asTrimmedString(sourceUrl);
    if (!url) return '';
    try {
        const host = new URL(url).hostname.replace(/^www\./, '');
        if (host.includes('justice.gov') || host.includes('doj.gov')) return 'Department of Justice';
        return host;
    } catch (e) {
        return '';
    }
}

/**
 * @param {HTMLElement} panel
 * @param {object|null} record
 * @param {{ storiesByPardonId?: Map, getPdfDocumentPromise: (warrantKey: string, pdfUrl: string) => Promise, getSelectedRecord: () => object|null }} ctx
 */
export function renderPardonDetail(panel, record, ctx) {
    if (!record) {
        panel.innerHTML = `<div class="detail-empty">No record selected.</div>`;
        return;
    }

    const name = record.personName || 'Unknown';
    const dateStr = record.date && !isNaN(record.date) ? formatDate(record.date) : '';
    const presidentLine = (record.presidentName || record.displayPresidency || record.presidentTerm || '').trim();
    const byPhrase = clemencyByPresidentPhrase(record.clemencyType, presidentLine);
    const subtitleParts = [];
    if (dateStr) subtitleParts.push(dateStr);
    if (byPhrase) subtitleParts.push(byPhrase);
    const subtitleLine = subtitleParts.join(', ');

    const districtText = detailFacet(record.district);

    const detailTags = [
        detailPill(record.officeHeld, 'record-tag-occupation'),
        detailPill(record.relationship, 'record-tag-relationship'),
        detailPill(record.topic, 'record-tag-topic'),
    ].filter(Boolean).join('');

    const warrantUrl = asTrimmedString(record.warrantUrl);
    const warrantThumb = `<img id="warrant-thumb" class="record-warrant-canvas"
                        src="docs/warrants/thumbs/${record.warrantKey}.jpg"
                        style="width:220px" alt="Warrant preview">`;
    const warrantCanvasEl = `<canvas id="warrant-canvas" class="record-warrant-canvas" style="display:none"></canvas>`;
    const warrantPreviewInner = `${warrantThumb}${warrantCanvasEl}`;
    const warrantPreviewWrap = warrantUrl
        ? `<a href="${escapeHtml(warrantUrl)}" target="_blank" rel="noopener noreferrer" class="record-warrant-link">${warrantPreviewInner}</a>`
        : warrantPreviewInner;
    const warrantCanvas = record.warrantKey
        ? `<div class="record-warrant-wrap detail-clemency-doc-preview">
               ${warrantPreviewWrap}
               <div id="warrant-page-controls" class="warrant-page-controls detail-clemency-page-controls" style="display:none">
                   <button id="warrant-prev" class="warrant-nav-btn">← Prev</button>
                   <span id="warrant-page-label" class="warrant-page-label"></span>
                   <button id="warrant-next" class="warrant-nav-btn">Next →</button>
               </div>
           </div>`
        : '';

    const offenseSection = record.offense
        ? `<div class="detail-section"><div class="detail-label">Offense</div><div class="detail-value">${escapeHtml(record.offense)}</div></div>`
        : '';

    const sentencedSection = record.sentenced
        ? `<div class="detail-section"><div class="detail-label">Sentence</div><div class="detail-value">${escapeHtml(record.sentenced)}</div></div>`
        : '';

    const gb = givebackMoneyAndRemedy(record);
    const remedySection = gb
        ? `<div class="detail-section">
               <div class="detail-label">Remedy</div>
               <div class="detail-value detail-remedy-row">
                   ${gb.remedyLabel ? `<span class="remedy-type-pill remedy-type-pill--${gb.slug}">${escapeHtml(gb.remedyLabel)}</span>` : ''}
                   <span class="detail-giveback-amt">${escapeHtml(gb.moneyStr)}</span>
               </div>
           </div>`
        : '';

    const wikiTitle = asTrimmedString(record.wikipediaSummaryTitle) || asTrimmedString(record.wikipediaName);
    const wikiSummary = asTrimmedString(record.wikipediaSummaryExtract);
    const wikiThumbUrl = asTrimmedString(record.wikipediaThumbnailUrl);
    const wikiArticleUrl = asTrimmedString(record.wikipediaArticleUrl) || asTrimmedString(record.wikipediaUrl);
    const wikiHasValid = parseOptionalBool(record.hasValidWikipediaInfo);
    const wikiHasRenderableContent = !!(wikiTitle || wikiSummary || wikiThumbUrl || wikiArticleUrl);
    const showWikipediaBackground = wikiHasRenderableContent && (wikiHasValid == null || wikiHasValid === true);

    const matchingStories = (ctx.storiesByPardonId && ctx.storiesByPardonId.get(record.id)) || [];
    const storiesSection = matchingStories.length > 0 ? `
        <div class="detail-section detail-stories">
            <div class="detail-column-heading">Media coverage</div>
            ${matchingStories.map(s => {
                let domain = '';
                try { domain = new URL(s.storyUrl).hostname.replace(/^www\./, ''); } catch (e) { /* ignore */ }
                const faviconUrl = domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=32` : '';
                const thumbUrl = s.image || faviconUrl;
                const isArticleImage = !!s.image;
                const storyDateStr = s.publishDate ? s.publishDate.split(' ')[0] : '';
                return `<a href="${s.storyUrl}" target="_blank" rel="noopener noreferrer" class="story-card">
                    ${thumbUrl ? `<img class="story-thumb${isArticleImage ? ' story-thumb--article' : ''}" src="${thumbUrl}" alt="${domain}">` : ''}
                    <div class="story-info">
                        <div class="story-publisher">${domain}</div>
                        <div class="story-title">${s.storyTitle}</div>
                        ${s.authorList ? `<div class="story-author">${s.authorList}</div>` : ''}
                        ${storyDateStr ? `<div class="story-date">${storyDateStr}</div>` : ''}
                    </div>
                </a>`;
            }).join('')}
        </div>
    ` : '';

    const wikipediaBackgroundSection = showWikipediaBackground
        ? `<div class="detail-column detail-column-background">
               <div class="detail-column-heading">Background <span class="detail-column-heading-pill">Wikipedia</span></div>
               <div class="detail-background-card">
                   ${wikiThumbUrl ? `<img class="detail-background-thumb" src="${escapeHtml(wikiThumbUrl)}" alt="Wikipedia image for ${escapeHtml(name)}">` : ''}
                   <div class="detail-background-copy">
                       ${wikiTitle ? `<div class="detail-background-title">${escapeHtml(wikiTitle)}</div>` : ''}
                       ${wikiSummary ? `<div class="detail-background-summary">${escapeHtml(wikiSummary)}</div>` : ''}
                       ${wikiArticleUrl ? `<a class="detail-background-link" href="${escapeHtml(wikiArticleUrl)}" target="_blank" rel="noopener noreferrer">View Wikipedia article ↗</a>` : ''}
                   </div>
               </div>
               ${storiesSection}
           </div>`
        : '';

    const courtDocs = Array.isArray(record.courtDocuments) ? record.courtDocuments : [];
    const courtDocumentsSection = courtDocs.length > 0 ? `
        <div class="detail-section detail-court-docs">
            <div class="detail-label">Court documents</div>
            <div class="detail-court-docs-scroll">
                <table class="detail-court-docs-table">
                    <tbody>
                        ${courtDocs.map(doc => {
                            const url = typeof doc.sourceUrl === 'string' ? doc.sourceUrl.trim() : '';
                            const typeRaw = (doc.documentTypeName || doc.documentType || '').trim();
                            const typeDisplay = typeRaw || (url ? 'Document' : '—');
                            const typeCell = url
                                ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(typeDisplay)}</a>`
                                : escapeHtml(typeDisplay);
                            const dateCell = formatCourtDocDateCell(doc.documentDate);
                            const caseLabel = escapeHtml((doc.caseName || doc.title || '').trim() || '—');
                            const courtNameLabel = escapeHtml((doc.courtName || '').trim() || '—');
                            return `<tr><td>${typeCell}</td><td>${dateCell}</td><td>${caseLabel}</td><td>${courtNameLabel}</td></tr>`;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        </div>
    ` : '';

    const sourceLabel = detailSourceLabel(record.sourceUrl);
    const sourcePill = sourceLabel ? `<span class="detail-column-heading-pill">${escapeHtml(sourceLabel)}</span>` : '';
    const hasClemencyDoc = !!record.warrantKey;
    const clemencyDocSection = hasClemencyDoc ? `
        <div class="detail-section detail-clemency-document">
            <div class="detail-label">Clemency document</div>
            ${warrantCanvas}
        </div>
    ` : '';

    panel.innerHTML = `
        <div class="pardon-detail-inner">
            <div class="pardon-detail-main">
                <div class="detail-top">
                    <div class="detail-name-row">
                        <div class="detail-name">${name}</div>
                        ${warrantUrl ? `<a class="detail-primary-link" href="${escapeHtml(warrantUrl)}" target="_blank" rel="noopener noreferrer">Full pardon</a>` : ''}
                    </div>
                    ${(subtitleLine || districtText) ? `<div class="detail-date">${escapeHtml(subtitleLine)}${districtText ? ` <span class="detail-date-sep">•</span> ${escapeHtml(districtText)}` : ''}</div>` : ''}
                    ${detailTags ? `<div class="detail-tags">${detailTags}</div>` : ''}
                </div>
                <div class="detail-content-split${showWikipediaBackground ? '' : ' detail-content-split--single'}">
                    ${wikipediaBackgroundSection}
                    <div class="detail-column detail-column-official">
                        <div class="detail-column-heading">Official record ${sourcePill}</div>
                        ${remedySection}
                        ${offenseSection}
                        ${sentencedSection}
                        ${clemencyDocSection}
                        ${courtDocumentsSection}
                    </div>
                </div>
                ${showWikipediaBackground ? '' : storiesSection}
            </div>
        </div>
    `;

    if (record.warrantKey && hasClemencyDoc) {
        const pdfUrl = `docs/warrants/pdfs/${record.warrantKey}.pdf`;
        const thumb = document.getElementById('warrant-thumb');
        const canvas = document.getElementById('warrant-canvas');
        const controls = document.getElementById('warrant-page-controls');
        const prevBtn = document.getElementById('warrant-prev');
        const nextBtn = document.getElementById('warrant-next');
        const pageLabel = document.getElementById('warrant-page-label');

        const cssWidth = 220;
        const dpr = window.devicePixelRatio || 1;
        const isActiveRecord = () => ctx.getSelectedRecord()?.id === record.id;

        let currentPage = 1;
        let pdfDoc = null;

        const renderPage = (pdf, n) => {
            if (!isActiveRecord()) return;
            pdf.getPage(n).then(page => {
                if (!isActiveRecord()) return;
                const viewport = page.getViewport({ scale: 1 });
                const scale = (cssWidth / viewport.width) * dpr;
                const scaled = page.getViewport({ scale });
                canvas.width = scaled.width;
                canvas.height = scaled.height;
                canvas.style.width = cssWidth + 'px';
                canvas.style.height = (scaled.height / dpr) + 'px';
                page.render({ canvasContext: canvas.getContext('2d'), viewport: scaled }).promise.then(() => {
                    if (!isActiveRecord()) return;
                    if (thumb) thumb.style.display = 'none';
                    canvas.style.display = '';
                });
                if (pageLabel) pageLabel.textContent = `${n} / ${pdf.numPages}`;
                if (prevBtn) prevBtn.disabled = n <= 1;
                if (nextBtn) nextBtn.disabled = n >= pdf.numPages;
            });
        };

        const goToPage = (n) => {
            if (!pdfDoc || !isActiveRecord()) return;
            currentPage = n;
            if (n === 1) {
                canvas.style.display = 'none';
                if (thumb) thumb.style.display = '';
            } else {
                renderPage(pdfDoc, n);
            }
            if (pageLabel) pageLabel.textContent = `${n} / ${pdfDoc.numPages}`;
            if (prevBtn) prevBtn.disabled = n <= 1;
            if (nextBtn) nextBtn.disabled = n >= pdfDoc.numPages;
        };

        ctx.getPdfDocumentPromise(record.warrantKey, pdfUrl).then(pdf => {
            if (!isActiveRecord()) return;
            pdfDoc = pdf;
            if (pdf.numPages > 1 && controls) {
                controls.style.display = '';
                pageLabel.textContent = `1 / ${pdf.numPages}`;
                prevBtn.disabled = true;
                nextBtn.disabled = false;
                prevBtn.addEventListener('click', () => {
                    if (currentPage > 1) goToPage(currentPage - 1);
                });
                nextBtn.addEventListener('click', () => {
                    if (currentPage < pdf.numPages) goToPage(currentPage + 1);
                });
            }
        }).catch(() => {
            const wrap = canvas?.closest('.record-warrant-wrap');
            if (wrap) wrap.style.display = 'none';
        });
    }
}
