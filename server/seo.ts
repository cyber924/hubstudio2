export const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]!);

export const scriptJson = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c');

export function stripMetadata(template: string) {
  return template.replace(/<meta\b[^>]*(?:name=["']description["']|property=["'](?:og:[^"']+|article:[^"']+)["'])[^>]*>/gi, '')
    .replace(/<link\b[^>]*rel=["']canonical["'][^>]*>/gi, '');
}

export function articleBody(project: any, imageFor: (id: string) => string | undefined) {
  const content = project.content || {};
  return `<article class="max-w-4xl mx-auto px-6 py-12 font-sans">
    <a href="/webzine">웹진 목록</a>
    <h1 class="text-3xl font-bold my-6">${escapeHtml(content.title || project.title)}</h1>
    <p>${escapeHtml(content.description)}</p>
    <p class="my-6 whitespace-pre-line">${escapeHtml(content.intro)}</p>
    ${(content.sections || []).map((section: any) => {
      const url = section.imageId ? imageFor(section.imageId) : undefined;
      return `<section class="my-8"><h2 class="text-2xl font-bold mb-4">${escapeHtml(section.heading)}</h2>
      ${url ? `<figure><img src="${escapeHtml(url)}" alt="${escapeHtml(section.alt || section.heading)}" loading="lazy"><figcaption>${escapeHtml(section.caption)}</figcaption></figure>` : ''}
      <p class="whitespace-pre-line leading-relaxed">${escapeHtml(section.body)}</p></section>`;
    }).join('')}
    <p class="my-8 whitespace-pre-line">${escapeHtml(content.closing)}</p>
    ${(content.faq || []).map((faq: any) => `<section><h2>${escapeHtml(faq.question)}</h2><p>${escapeHtml(faq.answer)}</p></section>`).join('')}
  </article>`;
}
