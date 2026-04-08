/**
 * Shared detail panel HTML + warrant PDF preview (Pardons and Givebacks).
 */

import { formatDate, escapeHtml, remedyTypeSlug } from './shared.js';

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

    const warrantCanvas = record.warrantKey
        ? `<div class="record-warrant-wrap">
               <a href="${record.warrantUrl}" target="_blank" rel="noopener noreferrer" class="record-warrant-link">
                   <img id="warrant-thumb" class="record-warrant-canvas"
                        src="docs/warrants/thumbs/${record.warrantKey}.jpg"
                        style="width:256px" alt="Warrant preview">
               </a>
               <canvas id="warrant-canvas" class="record-warrant-canvas" style="display:none"></canvas>
               <div id="warrant-page-controls" class="warrant-page-controls" style="display:none">
                   <button id="warrant-prev" class="warrant-nav-btn">&#8592;</button>
                   <span id="warrant-page-label" class="warrant-page-label"></span>
                   <button id="warrant-next" class="warrant-nav-btn">&#8594;</button>
               </div>
           </div>`
        : '';

    const hasWarrant = !!record.warrantKey;

    const offenseSection = record.offense
        ? `<div class="detail-section"><div class="detail-label">Offense</div><div class="detail-value">${record.offense}</div></div>`
        : '';

    const sentencedSection = record.sentenced
        ? `<div class="detail-section"><div class="detail-label">Sentence</div><div class="detail-value">${record.sentenced}</div></div>`
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

    const matchingStories = (ctx.storiesByPardonId && ctx.storiesByPardonId.get(record.id)) || [];
    const storiesSection = matchingStories.length > 0 ? `
        <div class="detail-section detail-stories">
            <div class="detail-label">Media Coverage</div>
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

    panel.innerHTML = `
        <div class="pardon-detail-inner${hasWarrant ? ' pardon-detail-inner--has-warrant' : ''}">
            <div class="pardon-detail-left">
                <div class="detail-top">
                    <div class="detail-name-row">
                        <div class="detail-name">${name}</div>
                        ${districtText ? `<div class="detail-district">${districtText}</div>` : ''}
                    </div>
                    ${subtitleLine ? `<div class="detail-date">${subtitleLine}</div>` : ''}
                    ${detailTags ? `<div class="detail-tags">${detailTags}</div>` : ''}
                </div>
                ${remedySection}
                ${offenseSection}
                ${sentencedSection}
                ${storiesSection}
            </div>
            ${hasWarrant ? `<div class="pardon-detail-right">${warrantCanvas}</div>` : ''}
        </div>
    `;

    if (record.warrantKey) {
        const pdfUrl = `docs/warrants/pdfs/${record.warrantKey}.pdf`;
        const thumb = document.getElementById('warrant-thumb');
        const canvas = document.getElementById('warrant-canvas');
        const controls = document.getElementById('warrant-page-controls');
        const prevBtn = document.getElementById('warrant-prev');
        const nextBtn = document.getElementById('warrant-next');
        const pageLabel = document.getElementById('warrant-page-label');

        const cssWidth = 256;
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
